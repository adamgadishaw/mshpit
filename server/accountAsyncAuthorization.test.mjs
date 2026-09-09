import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import test, { after } from "node:test";

const directory = mkdtempSync(join(tmpdir(), "pit-account-async-"));
process.env.PIT_DATA_DIR = directory;
process.env.PIT_ALLOW_EMPTY_DB_BOOTSTRAP = "true";
delete process.env.RESEND_API_KEY;
delete process.env.MAIL_FROM;
const { db, q } = await import("./db.js");
const { createSession, destroySession, getSession, hashPassword, verifyPassword } = await import("./auth.js");
const { ApiError } = await import("./errors.js");
const { readAuthorizedRequest } = await import("./requestAuthorization.js");
const { accountSecurityRoutes } = await import("./features/accountOnboarding/accountSecurityRoutes.js");
const { accountPrivacyRoutes } = await import("./features/accountPrivacy/accountPrivacyRoutes.js");
const { ownerApprovalRoutes } = await import("./features/ownerApprovals/ownerApprovalRoutes.js");
const { createOwnerApprovalRequest } = await import("./ownerApprovals.js");
const { ownerIdentity, storeOwnerIdentity } = await import("./ownerIdentity.js");
const { routes: apiRoutes } = await import("./api.js");
after(() => { db.close(); rmSync(directory, { recursive: true, force: true }); });

let sequence = 0;
const password = "Original-password1";
const replacement = "Replacement-password2";
function member(role = "fan") {
  const id = `async_account_${++sequence}`;
  q.insertUser.run(id, `${id}@example.test`, id, id, hashPassword(password), role,
    null, null, null, "AA", "#123456", Date.now());
  db.prepare("UPDATE users SET email_verified_at=? WHERE id=?").run(Date.now(), id);
  return q.userById.get(id);
}
const atomicWrite = (work) => {
  db.exec("BEGIN IMMEDIATE");
  try { const result = work(); db.exec("COMMIT"); return result; }
  catch (error) { db.exec("ROLLBACK"); throw error; }
};
const requireSessionUser = (ctx) => {
  if (!ctx.user) throw new ApiError(401, "Log in first.", "AUTH_REQUIRED");
  return ctx.user;
};
async function context(user, path, body) {
  const session = createSession(user.id);
  const authorized = await readAuthorizedRequest({ token: session.token, expectedAccount: user.id,
    method: "POST", pathname: path, readBody: () => body });
  return { ...authorized, token: session.token, session, setHeader() {},
    setSession(value) { this.replacementSession = value; }, ip: `test-${user.id}` };
}
function passwordRoute(overrides = {}) {
  return accountSecurityRoutes({ database: db, ApiError, requireSessionUser, limit() {},
    verifyPassword: async (text, hash) => verifyPassword(text, hash), hashPassword: async (text) => hashPassword(text),
    atomicWrite, createSession, cancelSignup() {}, ...overrides })["POST /api/me/password"];
}
function exportRoute(overrides = {}) {
  return accountPrivacyRoutes({ database: db, ApiError, requireSessionUser,
    findUserById: (id) => q.userById.get(id), marketingConsentVersion: "test", now: Date.now,
    ownedMediaAsset() { throw new Error("No fixture assets expected"); }, projectSelf: (user) => ({ id: user.id }),
    rateLimit() {}, setMarketingPreference() {},
    verifyPassword: async (text, hash) => verifyPassword(text, hash), ...overrides })["POST /api/me/export"];
}

test("password change awaits proof, hash, and sibling checks and rejects revocation at every yield", async () => {
  for (const phase of ["verify", "hash", "siblings"]) {
    const user = member();
    const ctx = await context(user, "/api/me/password", { currentPassword: password, password: replacement });
    const sibling = createSession(user.id);
    let grants = 0;
    const revoke = (at) => { if (at === phase) destroySession(ctx.token); };
    const route = passwordRoute({
      async verifyPassword(text, hash) { revoke("verify"); return verifyPassword(text, hash); },
      async hashPassword(text) { revoke("hash"); return hashPassword(text); },
      async matchingPasswordUsers() { revoke("siblings"); return []; },
      grantVerifiedAccounts() { grants += 1; },
    });
    await assert.rejects(route(ctx), (error) => error.code === "AUTH_REQUIRED", phase);
    assert.equal(q.userById.get(user.id).pass_hash, user.pass_hash);
    assert.equal(ctx.replacementSession, undefined);
    assert.equal(grants, 0);
    assert.ok(getSession(sibling.token), "an independent live session is not a substitute and is not revoked");
    assert.equal(db.isTransaction, false);
  }
});

test("password replacement compares fresh credentials and rolls back any synchronous grant failure", async () => {
  for (const failure of ["credential-change", "grant-failure"]) {
    const user = member();
    const ctx = await context(user, "/api/me/password", { currentPassword: password, password: replacement });
    const externalHash = hashPassword("Other-change3");
    const route = passwordRoute({
      async matchingPasswordUsers() {
        if (failure === "credential-change") db.prepare("UPDATE users SET pass_hash=? WHERE id=?").run(externalHash, user.id);
        return [];
      },
      grantVerifiedAccounts() { throw new Error("injected grant failure"); },
    });
    await assert.rejects(route(ctx), (error) => failure === "credential-change"
      ? error.code === "CONFLICT" : error.message === "injected grant failure");
    assert.equal(q.userById.get(user.id).pass_hash, failure === "credential-change" ? externalHash : user.pass_hash);
    assert.ok(getSession(ctx.token));
    assert.equal(ctx.replacementSession, undefined);
    assert.equal(db.isTransaction, false);
  }
});

test("async false password proofs cannot change credentials or expose portability data", async () => {
  const user = member();
  for (const [path, body, route] of [
    ["/api/me/password", { currentPassword: "wrong", password: replacement }, passwordRoute()],
    ["/api/me/export", { password: "wrong" }, exportRoute()],
  ]) {
    const ctx = await context(user, path, body);
    await assert.rejects(route(ctx), (error) => error.code === "AUTH_INVALID");
  }
  assert.equal(q.userById.get(user.id).pass_hash, user.pass_hash);
});

test("signup cancellation waits for deletion and propagates deletion failure instead of reporting success", async () => {
  const user = member();
  const token = "A".repeat(43);
  db.prepare("UPDATE users SET onboarding_version=0,signup_cancel_hash=? WHERE id=?")
    .run(createHash("sha256").update(token).digest("hex"), user.id);
  let rejectDeletion;
  const routes = accountSecurityRoutes({ database: db, ApiError, requireSessionUser, limit() {},
    verifyPassword, hashPassword, atomicWrite, createSession,
    cancelSignup: () => new Promise((_resolve, reject) => { rejectDeletion = reject; }) });
  let settled = false;
  const pending = routes["POST /api/signup/cancel"]({ body: { cancelToken: token }, setHeader() {} });
  pending.then(() => { settled = true; }, () => { settled = true; });
  await Promise.resolve();
  assert.equal(settled, false);
  const failure = new ApiError(409, "This signup changed.", "CONFLICT");
  rejectDeletion(failure);
  await assert.rejects(pending, (error) => error === failure);
  assert.ok(q.userById.get(user.id));
});

test("signup capability cancellation works signed out or in another account without borrowing its authority", async () => {
  for (const signedInElsewhere of [false, true]) {
    const signup = member();
    const token = (signedInElsewhere ? "B" : "C").repeat(43);
    db.prepare("UPDATE users SET email_verified_at=0,onboarding_version=0,signup_cancel_hash=? WHERE id=?")
      .run(createHash("sha256").update(token).digest("hex"), signup.id);
    const other = member();
    const otherSession = createSession(other.id);
    const authorized = await readAuthorizedRequest({
      token: signedInElsewhere ? otherSession.token : null,
      method: "POST", pathname: "/api/signup/cancel", readBody: () => ({ cancelToken: token }),
    });
    let cleared = false;
    const result = await apiRoutes["POST /api/signup/cancel"]({ ...authorized,
      ip: `capability-${signup.id}`, setHeader() {}, clearSession() { cleared = true; } });
    assert.deepEqual(result, { ok: true });
    assert.equal(q.userById.get(signup.id), undefined);
    assert.ok(q.userById.get(other.id));
    assert.ok(getSession(otherSession.token));
    assert.equal(cleared, false, "a signup capability cannot clear another account's cookie");
  }
});

test("export rejects expired, revoked, or changed credentials after its password await", async () => {
  for (const change of ["logout", "expiry", "password"]) {
    const user = member();
    const ctx = await context(user, "/api/me/export", { password });
    let projected = false;
    const route = exportRoute({
      async verifyPassword(text, hash) {
        if (change === "logout") destroySession(ctx.token);
        if (change === "expiry") db.prepare("UPDATE sessions SET expires_at=0 WHERE user_id=?").run(user.id);
        if (change === "password") db.prepare("UPDATE users SET pass_hash=? WHERE id=?").run(hashPassword(replacement), user.id);
        return verifyPassword(text, hash);
      },
      projectSelf() { projected = true; return {}; },
    });
    await assert.rejects(route(ctx), (error) => error.code === "AUTH_REQUIRED", change);
    assert.equal(projected, false);
  }
});

test("moderation restrictions retain password and portability rights without weakening ordinary guards", async () => {
  for (const restriction of ["is_banned", "suspended_until"]) {
    const user = member();
    const value = restriction === "is_banned" ? 1 : Date.now() + 60_000;
    db.prepare(`UPDATE users SET ${restriction}=? WHERE id=?`).run(value, user.id);
    const exportCtx = await context(user, "/api/me/export", { password });
    assert.throws(() => exportCtx.assertCurrentSession(), (error) => error.code === "FORBIDDEN");
    assert.equal((await exportRoute()(exportCtx)).profile.id, user.id);
    const changeCtx = await context(user, "/api/me/password", { currentPassword: password, password: replacement });
    const result = await passwordRoute()(changeCtx);
    assert.equal(result.accountId, user.id);
    assert.equal(getSession(changeCtx.token), null);
    assert.ok(getSession(changeCtx.replacementSession.token));
    assert.equal(q.userById.get(user.id)[restriction], value, "password changes do not lift moderation");
  }
});

test("Owner approval cannot consume a capability or create a receipt after password-work revocation", async () => {
  const owner = member("admin");
  storeOwnerIdentity(db, ownerIdentity(owner.email, owner.id, Date.now()));
  for (const change of ["logout", "password"]) {
    const currentOwner = q.userById.get(owner.id);
    const request = createOwnerApprovalRequest(db, { kind: "security_release", requestedBy: owner.id,
      summary: "Isolated security review", payload: { category: "security_audit" }, at: Date.now() });
    const ctx = await context(currentOwner, "/api/owner-approvals/decide",
      { token: request.token, password, decision: "approved" });
    const routes = ownerApprovalRoutes({ database: db, ApiError, applyRoleChange() {},
      getUser: (id) => q.userById.get(id), limit() {}, now: Date.now, requireAdmin: requireSessionUser,
      requireOwner: requireSessionUser, roleChangeTouchesHead() {}, selectedRoleHandle() {},
      async verifyPassword() {
        if (change === "logout") destroySession(ctx.token);
        else db.prepare("UPDATE users SET pass_hash=? WHERE id=?").run(hashPassword(replacement), owner.id);
        return true;
      } });
    await assert.rejects(routes["POST /api/owner-approvals/decide"](ctx), (error) => error.code === "AUTH_REQUIRED");
    assert.equal(db.prepare("SELECT status FROM owner_approval_requests WHERE id=?").get(request.request.id).status, "pending");
    assert.equal(db.prepare("SELECT COUNT(*) n FROM owner_approval_receipts WHERE request_id=?").get(request.request.id).n, 0);
    assert.equal(db.isTransaction, false);
  }
});
