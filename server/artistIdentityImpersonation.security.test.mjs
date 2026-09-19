import assert from "node:assert/strict";
import test, { after, beforeEach } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LEGAL_ACCEPTANCE_VERSION } from "../src/domain/privacyDisclosures.mjs";

const directory = mkdtempSync(join(tmpdir(), "pit-artist-impersonation-"));
process.env.PIT_DATA_DIR = directory;
delete process.env.RESEND_API_KEY;
delete process.env.MAIL_FROM;
const { db, q, artistStmts, artistRow } = await import("./db.js");
const { routes } = await import("./api.js");
const { resetRateLimitsForTests } = await import("./auth.js");
const { completeVerification, mintVerifyToken } = await import("./verification.js");
let sequence = 0;
after(() => { db.close(); rmSync(directory, { recursive: true, force: true }); });
beforeEach(() => resetRateLimitsForTests());

function member({ role = "fan", emailVerified = true } = {}) {
  const id = `identity_guard_${++sequence}`;
  q.insertUser.run(id, `${id}@example.test`, "Independent Member", id, "fixture-hash", role,
    "Toronto", 43.65, -79.38, "IM", "#123456", Date.now());
  if (emailVerified) db.prepare("UPDATE users SET email_verified_at=? WHERE id=?").run(Date.now(), id);
  return q.userById.get(id);
}
const context = (user, body = {}, extra = {}) => ({ user, body, query: {}, ip: user?.id || `identity-guest-${++sequence}`, ...extra });
const failure = (run, code = "ARTIST_IDENTITY_REVIEW_REQUIRED") => assert.rejects(async () => await run(),
  error => error.status === 409 && error.code === code);
function catalogue(name) {
  const norm = name.toLowerCase();
  if (!artistStmts.byNorm.get(norm)) artistStmts.upsert.run(artistRow(norm, { name, popularity: 90 }, "test"));
  return artistStmts.byNorm.get(norm);
}
async function signup(body = {}) {
  const email = `identity_signup_${++sequence}@example.test`;
  const result = await routes["POST /api/signup"](context(null, {
    name: "Independent Listener", email, password: "account-password123", genres: ["Rock"],
    ageBand: "18_plus", termsVersion: LEGAL_ACCEPTANCE_VERSION, ...body,
  }, { setSession() {} }));
  return { result, user: q.userByEmail.get(email) };
}

test("ordinary fans may share a personal display name without gaining artist ownership", async () => {
  catalogue("Russ");
  const { result, user } = await signup({ name: "Russ", handle: `listener_${++sequence}`, role: "artist", verified: true,
    artistName: "Russ", ownerId: "forged" });
  assert.equal(result.created, true);
  assert.equal(user.name, "Russ");
  assert.equal(user.role, "fan");
  assert.equal(user.verified, 0);
  assert.equal(user.artist_name, null);
  assert.equal(db.prepare("SELECT 1 FROM artist_profiles WHERE owner_id=?").get(user.id), undefined);
});

test("signup rejects reserved artist handles and deceptive display names without partial accounts", async () => {
  catalogue("Drake");
  for (const input of [
    { handle: "drake" }, { handle: "Drake_Official" }, { handle: "realdrake" },
    { name: "Drake Official" }, { name: "Dr\u0430ke" },
  ]) {
    const before = db.prepare("SELECT COUNT(*) count FROM users").get().count;
    await failure(() => signup(input));
    assert.equal(db.prepare("SELECT COUNT(*) count FROM users").get().count, before);
  }
});

test("profile edits cannot bypass artist screening with forged ownership or verification fields", async () => {
  catalogue("Drake");
  const fan = member();
  for (const input of [{ handle: "drake" }, { name: "Drake Official" }, { name: "Dr\u0430ke" }]) {
    await failure(() => routes["PATCH /api/me"](context(fan, {
      ...input, role: "artist", artistName: "Drake", verified: true, ownerId: fan.id,
    })));
    assert.equal(q.userById.get(fan.id).handle, fan.handle);
    assert.equal(q.userById.get(fan.id).name, fan.name);
    assert.equal(q.userById.get(fan.id).verified, 0);
    assert.equal(q.userById.get(fan.id).role, "fan");
  }
});

test("email confirmation rechecks a pending handle against identities added after signup", async () => {
  const name = `Late Identity ${++sequence}`;
  const handle = name.toLowerCase().replaceAll(" ", "");
  const { user } = await signup({ handle });
  assert.equal(JSON.parse(user.extras).pendingSignupHandle, handle);
  catalogue(name);
  const verified = completeVerification(mintVerifyToken(user.id)).user;
  assert.ok(verified.email_verified_at > 0, "reserved handle must not break mailbox confirmation");
  assert.notEqual(verified.handle, handle, "a stale preference is not ownership of a newly protected artist handle");
  assert.equal(verified.role, "fan");
  assert.equal(verified.verified, 0);
});
