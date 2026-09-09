import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after, beforeEach } from "node:test";
import { LEGAL_ACCEPTANCE_VERSION } from "../src/domain/privacyDisclosures.mjs";

const directory = mkdtempSync(join(tmpdir(), "pit-account-foundation-"));
process.env.PIT_DATA_DIR = directory;
process.env.PIT_ALLOW_EMPTY_DB_BOOTSTRAP = "true";
process.env.EMAIL_VERIFICATION_ENABLED = "true";
delete process.env.RESEND_API_KEY;
delete process.env.MAIL_FROM;
const { db, q } = await import("./db.js");
const { routes } = await import("./api.js");
const { createSession, destroySession, getSession, hashPassword, resetRateLimitsForTests } = await import("./auth.js");
const { readAuthorizedRequest } = await import("./requestAuthorization.js");
const { mintVerifyToken } = await import("./verification.js");
after(() => { db.close(); rmSync(directory, { recursive: true, force: true }); });
beforeEach(() => resetRateLimitsForTests());
const password = "Foundation-password1";
let sequence = 0;
function member(email) {
  const id = `account_foundation_${++sequence}`;
  q.insertUser.run(id, email || `${id}@example.test`, id, id, hashPassword(password),
    "fan", null, null, null, "AF", "#123456", Date.now());
  db.prepare("UPDATE users SET email_verified_at=? WHERE id=?").run(Date.now(), id);
  return q.userById.get(id);
}
function context(body = {}, extra = {}) {
  return { body, ip: `account-foundation-${++sequence}`, setHeader() {},
    setSession(session) { this.session = session; }, ...extra };
}
function snapshot() {
  return Object.fromEntries(["users", "sessions", "linked_account_pairs", "linked_account_session_grants", "email_log"]
    .map((table) => [table, db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n]));
}
const flush = () => new Promise((resolve) => setImmediate(resolve));

for (const phase of ["before-start", "during-password-work"]) {
  for (const action of ["signup", "login", "reset", "password", "connect"]) {
    test(`${action} cancellation ${phase} cannot commit account, credential, session, or link changes`, async () => {
      const user = member();
      const sibling = member(user.email);
      const session = createSession(user.id);
      const resetToken = randomBytes(32).toString("base64url");
      db.prepare("UPDATE users SET reset_hash=?,reset_expires=? WHERE id=?")
        .run(createHash("sha256").update(resetToken).digest("hex"), Date.now() + 60_000, user.id);
      const controller = new AbortController();
      const [route, body] = action === "signup"
        ? ["POST /api/signup", { name: "Canceled Signup", email: `aborted-${++sequence}@example.test`, password,
          genres: ["Rock"], ageBand: "18_plus", termsVersion: LEGAL_ACCEPTANCE_VERSION }]
        : action === "login" ? ["POST /api/login", { email: user.email, password, accountId: user.id }]
          : action === "reset" ? ["POST /api/reset", { token: resetToken, password: "Replacement-password2" }]
            : action === "password" ? ["POST /api/me/password", { currentPassword: password, password: "Replacement-password2" }]
              : ["POST /api/me/accounts/connect", { password }];
      const authorized = await readAuthorizedRequest({ token: session.token, expectedAccount: user.id,
        method: "POST", pathname: route.slice(5), readBody: () => body });
      const ctx = context(body, { ...authorized, token: session.token, signal: controller.signal });
      await flush();
      const before = snapshot();
      const userBefore = q.userById.get(user.id);
      const siblingBefore = q.userById.get(sibling.id);
      if (phase === "before-start") controller.abort();
      const pending = routes[route](ctx);
      if (phase === "during-password-work") controller.abort();
      await assert.rejects(pending, { name: "AbortError" });
      await flush();
      assert.deepEqual(snapshot(), before, "no rows are created, deleted, or scheduled for mail");
      assert.deepEqual(q.userById.get(user.id), userBefore, "original credentials and recovery link remain intact");
      assert.deepEqual(q.userById.get(sibling.id), siblingBefore, "shared-email sibling is unchanged");
      assert.equal(getSession(session.token)?.user_id, user.id, "the previous session stays valid");
      assert.equal(ctx.session, undefined, "no replacement cookie is issued");
      assert.equal(db.isTransaction, false);
    });
  }
}

for (const route of ["GET /api/me", "POST /api/verify-email"]) {
  for (const mode of ["logout", "expiry", "role-change"]) {
    test(`${route} cannot disclose private self data after ${mode} at dispatch`, async () => {
      const user = member();
      const session = createSession(user.id);
      const token = mintVerifyToken(user.id);
      const [method, pathname] = route.split(" ");
      const authorized = await readAuthorizedRequest({ token: session.token, expectedAccount: user.id,
        method, pathname, readBody: () => ({ token }) });
      if (mode === "logout") destroySession(session.token);
      if (mode === "expiry") db.prepare("UPDATE sessions SET expires_at=0 WHERE user_id=?").run(user.id);
      if (mode === "role-change") db.prepare("UPDATE users SET role='moderator' WHERE id=?").run(user.id);
      assert.throws(() => routes[route](context(authorized.body, authorized)), { code: "AUTH_REQUIRED" });
      if (route === "POST /api/verify-email") {
        const replay = routes[route](context({ token }));
        assert.equal(replay.verified, true, "session revocation cannot undo token-authorized confirmation");
        assert.equal(replay.alreadyVerified, true, "a guest retry uses the committed verification receipt");
        assert.equal(Object.hasOwn(replay, "user"), false, "the receipt never grants private account access");
      }
      await flush();
    });
  }
}

test("self hydration returns fresh account restrictions without removing recovery access", async () => {
  const user = member();
  const session = createSession(user.id);
  const authorized = await readAuthorizedRequest({ token: session.token, method: "GET", pathname: "/api/me", readBody: () => ({}) });
  db.prepare("UPDATE users SET name='Updated private account',is_banned=1,email_verified_at=0 WHERE id=?").run(user.id);
  const response = routes["GET /api/me"](context({}, authorized));
  assert.equal(response.user.name, "Updated private account");
  assert.equal(response.user.isBanned, true);
  assert.equal(response.user.emailVerified, false);
  assert.equal(getSession(session.token)?.user_id, user.id);
});

test("a signup disconnect after commit preserves its account, session, and verification delivery", async () => {
  const controller = new AbortController();
  const ctx = context({ name: "Committed Signup", email: `committed-${++sequence}@example.test`, password,
    genres: ["Rock"], ageBand: "18_plus", termsVersion: LEGAL_ACCEPTANCE_VERSION }, {
    signal: controller.signal,
    setSession(session) {
      assert.equal(db.isTransaction, false);
      this.session = session;
      controller.abort();
    },
  });
  const result = await routes["POST /api/signup"](ctx);
  await flush();
  assert.equal(result.created, true);
  assert.equal(result.user.emailVerified, false);
  assert.equal(getSession(ctx.session.token)?.user_id, result.user.id);
  assert.ok(q.userById.get(result.user.id).signup_cancel_hash);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM email_log WHERE user_id=? AND template_key='verify_email'")
    .get(result.user.id).n, 1);
});

test("live cancellation-aware authentication still chooses, signs in, links, and switches exactly one account", async () => {
  const first = member();
  const second = member(first.email);
  const controller = new AbortController();
  const choiceCtx = context({ email: first.email, password }, { signal: controller.signal });
  const choice = await routes["POST /api/login"](choiceCtx);
  assert.equal(choice.chooseAccount, true);
  assert.deepEqual(new Set(choice.accounts.map((user) => user.id)), new Set([first.id, second.id]));
  assert.equal(choiceCtx.session, undefined);
  const selected = context({ email: first.email, password, accountId: second.id }, { signal: controller.signal });
  assert.equal((await routes["POST /api/login"](selected)).user.id, second.id);
  const token = selected.session.token;
  const authorized = await readAuthorizedRequest({ token, expectedAccount: second.id, method: "POST",
    pathname: "/api/me/accounts/switch", readBody: () => ({ accountId: first.id }) });
  const switched = context(authorized.body, { ...authorized, token, signal: controller.signal });
  assert.equal(routes["POST /api/me/accounts/switch"](switched).user.id, first.id);
  assert.equal(getSession(token), null, "the selected-account token is rotated, not reassigned");
  assert.equal(getSession(switched.session.token)?.user_id, first.id);
});
