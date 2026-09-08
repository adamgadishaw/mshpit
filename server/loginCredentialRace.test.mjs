import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after, beforeEach } from "node:test";

const directory = mkdtempSync(join(tmpdir(), "pit-login-credential-race-"));
process.env.PIT_DATA_DIR = directory;
process.env.PIT_ALLOW_EMPTY_DB_BOOTSTRAP = "true";
delete process.env.RESEND_API_KEY;
delete process.env.MAIL_FROM;
const { db, q } = await import("./db.js");
const { routes } = await import("./api.js");
const { createSession, getSession, hashPassword, resetRateLimitsForTests } = await import("./auth.js");
after(() => { db.close(); rmSync(directory, { recursive: true, force: true }); });
beforeEach(() => resetRateLimitsForTests());
let sequence = 0;
function member() {
  const id = `login_race_${++sequence}`;
  q.insertUser.run(id, `${id}@example.test`, id, id, hashPassword("Original-password1"),
    "fan", null, null, null, "LR", "#123456", Date.now());
  db.prepare("UPDATE users SET email_verified_at=? WHERE id=?").run(Date.now(), id);
  return q.userById.get(id);
}

test("login verifies the exact password and rejects overlength input without issuing a session", () => {
  const user = member();
  const password = "A1" + "a".repeat(98);
  db.prepare("UPDATE users SET pass_hash=? WHERE id=?").run(hashPassword(password), user.id);
  for (const supplied of [password + "x", password + "-wrong-suffix", "a".repeat(10_000)]) {
    let issued;
    assert.throws(() => routes["POST /api/login"]({
      body: { email: user.email, password: supplied }, ip: "login-exact-password", ua: "test",
      setSession(session) { issued = session; },
    }), (error) => error.status === 400);
    assert.equal(issued, undefined);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM sessions WHERE user_id=?").get(user.id).n, 0);
  }
  let issued;
  assert.equal(routes["POST /api/login"]({
    body: { email: user.email, password }, ip: "login-exact-password", ua: "test",
    setSession(session) { issued = session; },
  }).user.id, user.id);
  assert.equal(getSession(issued.token).user_id, user.id);
});

test("a password reset/change committed after verification cannot mint an old-password login session", () => {
  for (const mode of ["reset", "change"]) {
    const user = member();
    const previous = createSession(user.id);
    const resetToken = randomBytes(32).toString("base64url");
    if (mode === "reset") db.prepare("UPDATE users SET reset_hash=?,reset_expires=? WHERE id=?")
      .run(createHash("sha256").update(resetToken).digest("hex"), Date.now() + 60_000, user.id);
    let replacement;
    let staleLoginCookie;
    let verifiedSnapshotObserved = false;
    assert.throws(() => routes["POST /api/login"]({
      body: { email: user.email, password: "Original-password1", accountId: user.id },
      ip: `login-race-${mode}`, ua: "test",
      // Production sets no-store after successful password matching and before
      // session issuance. Simulate another process committing the real reset
      // or password-change route at this deterministic interleaving point.
      setHeader(name) {
        if (name !== "Cache-Control" || verifiedSnapshotObserved) return;
        verifiedSnapshotObserved = true;
        const context = { user: q.userById.get(user.id), token: previous.token,
          ip: `credential-race-${mode}`, ua: "test", setHeader() {},
          setSession(session) { replacement = session; },
          body: mode === "reset" ? { token: resetToken, password: "Replacement-password2" }
            : { currentPassword: "Original-password1", password: "Replacement-password2" },
        };
        routes[mode === "reset" ? "POST /api/reset" : "POST /api/me/password"](context);
      },
      setSession(session) { staleLoginCookie = session; },
    }), (error) => error.status === 401 && error.code === "AUTH_INVALID");
    assert.equal(verifiedSnapshotObserved, true);
    assert.equal(staleLoginCookie, undefined);
    assert.equal(getSession(previous.token), null);
    assert.equal(getSession(replacement.token).user_id, user.id);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM sessions WHERE user_id=?").get(user.id).n, 1,
      "only the reset/change replacement session may survive");
    assert.equal(db.isTransaction, false);
    let currentCookie;
    assert.equal(routes["POST /api/login"]({ body: { email: user.email, password: "Replacement-password2" },
      ip: `fresh-login-${mode}`, ua: "test", setSession(session) { currentCookie = session; } }).user.id, user.id);
    assert.equal(getSession(currentCookie.token).user_id, user.id);
  }
});

test("changing a verified login email before issuance invalidates the old identifier proof", () => {
  const user = member();
  let issued;
  assert.throws(() => routes["POST /api/login"]({
    body: { email: user.email, password: "Original-password1" }, ip: "login-email-race", ua: "test",
    setHeader() { db.prepare("UPDATE users SET email=? WHERE id=?").run(`changed-${user.email}`, user.id); },
    setSession(session) { issued = session; },
  }), (error) => error.status === 401 && error.code === "AUTH_INVALID");
  assert.equal(issued, undefined);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM sessions WHERE user_id=?").get(user.id).n, 0);
});
