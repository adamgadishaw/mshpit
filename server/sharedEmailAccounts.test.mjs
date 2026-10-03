import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test, { after, beforeEach } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureSharedEmailSchema } from "./features/accountOnboarding/sharedEmailSchema.js";
import { LEGAL_ACCEPTANCE_VERSION } from "../src/domain/privacyDisclosures.mjs";

const directory = mkdtempSync(join(tmpdir(), "pit-shared-email-"));
process.env.PIT_DATA_DIR = directory;
process.env.PIT_ALLOW_EMPTY_DB_BOOTSTRAP = "true";
process.env.EMAIL_VERIFICATION_ENABLED = "true";
delete process.env.RESEND_API_KEY;
delete process.env.MAIL_FROM;
const { db, q } = await import("./db.js");
const { routes } = await import("./api.js");
const { createSession, getSession, hashPassword, verifyPassword, resetRateLimitsForTests } = await import("./auth.js");
const { reconcileAdminAccount } = await import("./adminBootstrap.js");
after(() => { db.close(); rmSync(directory, { recursive: true, force: true }); });
beforeEach(() => resetRateLimitsForTests());
let sequence = 0;
function context(body = {}, user) {
  const result = { body, user, ...(user ? { token: createSession(user.id).token } : {}), ip: `shared-email-${++sequence}`, ua: "test", setHeader() {},
    setSession(value) { result.session = value; }, clearSession() { result.cleared = true; } };
  return result;
}
function member(email = `member-${++sequence}@example.test`, password = "first-password1") {
  const id = `shared_${++sequence}`;
  q.insertUser.run(id, email, id, id, hashPassword(password), "fan", null, null, null, "SF", "#123456", Date.now());
  db.prepare("UPDATE users SET email_verified_at=? WHERE id=?").run(Date.now(), id);
  return q.userById.get(id);
}
async function signup(email, extra = {}, actor) {
  const ctx = context({ name: "Second Member", email, password: "second-password2", genres: ["Rock"], ageBand: "18_plus", termsVersion: LEGAL_ACCEPTANCE_VERSION, ...extra }, actor);
  return { ctx, result: (await routes["POST /api/signup"](ctx)) };
}
async function login(email, password, accountId) {
  const ctx = context({ email, password, ...(accountId ? { accountId } : {}) });
  return { ctx, result: (await routes["POST /api/login"](ctx)) };
}
const rejects = (action, status) => assert.rejects(async () => await action(), (error) => error.status === status);

test("migration preserves users, children, indexes, views and triggers and is repeatable", () => {
  const fixture = new DatabaseSync(":memory:");
  try {
    fixture.exec(`PRAGMA foreign_keys=ON;
      CREATE TABLE users(id TEXT PRIMARY KEY,email TEXT NOT NULL UNIQUE,handle TEXT UNIQUE,created_at INTEGER,extras TEXT);
      CREATE INDEX idx_fixture_handle ON users(handle);
      CREATE TABLE child(id TEXT,user_id TEXT REFERENCES users(id) ON DELETE CASCADE);
      CREATE TABLE audit(id TEXT);
      CREATE TRIGGER fixture_insert AFTER INSERT ON users BEGIN INSERT INTO audit VALUES(NEW.id); END;
      CREATE VIEW fixture_view AS SELECT id,email FROM users;
      INSERT INTO users VALUES('a','shared@example.test','alpha',1,'preserve me');
      INSERT INTO child VALUES('post','a');`);
    ensureSharedEmailSchema(fixture);
    ensureSharedEmailSchema(fixture);
    assert.equal(fixture.prepare("SELECT extras FROM users WHERE id='a'").get().extras, "preserve me");
    assert.equal(fixture.prepare("SELECT COUNT(*) n FROM child").get().n, 1);
    assert.equal(fixture.prepare("SELECT COUNT(*) n FROM fixture_view").get().n, 1);
    assert.equal(fixture.prepare("SELECT COUNT(*) n FROM audit").get().n, 1, "migration must not replay insert side effects");
    fixture.exec("INSERT INTO users VALUES('b',' SHARED@example.test ','beta',2,'',NULL)");
    assert.throws(() => fixture.exec("INSERT INTO users VALUES('c','shared@example.test','gamma',3,'',NULL)"), /EMAIL_ACCOUNT_LIMIT/);
    fixture.exec("INSERT INTO users VALUES('c','other@example.test','gamma',3,'',NULL)");
    assert.throws(() => fixture.exec("UPDATE users SET email='shared@example.test' WHERE id='c'"), /EMAIL_ACCOUNT_LIMIT/);
    assert.throws(() => fixture.exec("UPDATE users SET handle='alpha' WHERE id='c'"), /UNIQUE/);
    assert.equal(fixture.prepare("PRAGMA foreign_keys").get().foreign_keys, 1);
    assert.deepEqual(fixture.prepare("PRAGMA foreign_key_check").all(), []);
  } finally { fixture.close(); }
});

test("failed migration rolls back without losing the original parent or child rows", () => {
  const fixture = new DatabaseSync(":memory:");
  try {
    fixture.exec(`CREATE TABLE users(id TEXT PRIMARY KEY,email TEXT NOT NULL UNIQUE,created_at INTEGER);
      INSERT INTO users VALUES('a','same@example.test',1),('b','SAME@example.test',2),('c',' Same@example.test ',3);
      CREATE TABLE child(user_id TEXT REFERENCES users(id)); INSERT INTO child VALUES('a'); PRAGMA foreign_keys=ON;`);
    assert.throws(() => ensureSharedEmailSchema(fixture), /More than two/);
    assert.equal(fixture.prepare("SELECT COUNT(*) n FROM users").get().n, 3);
    assert.equal(fixture.prepare("SELECT COUNT(*) n FROM child").get().n, 1);
    assert.match(fixture.prepare("SELECT sql FROM sqlite_schema WHERE name='users'").get().sql, /UNIQUE/);
    assert.equal(fixture.prepare("PRAGMA foreign_keys").get().foreign_keys, 1);
  } finally { fixture.close(); }
});

test("a shared password gives a chooser without a session; selection authenticates just that account", async () => {
  const first = member(), second = member(first.email);
  const choice = (await login(first.email.toUpperCase(), "first-password1"));
  assert.equal(choice.ctx.session, undefined);
  assert.equal(choice.result.chooseAccount, true);
  assert.deepEqual(new Set(choice.result.accounts.map((user) => user.id)), new Set([first.id, second.id]));
  assert.deepEqual(Object.keys(choice.result.accounts[0]).sort(), ["handle", "id", "name"]);
  const chosen = (await login(first.email, "first-password1", second.id));
  assert.equal(chosen.result.user.id, second.id);
  assert.equal(getSession(chosen.ctx.session.token).user_id, second.id);
});

test("different passwords sign directly into only the matching account", async () => {
  const first = member(), second = member(first.email, "other-password2");
  assert.equal((await login(first.email, "first-password1")).result.user.id, first.id);
  assert.equal((await login(first.email, "other-password2")).result.user.id, second.id);
  (await rejects(async () => (await login(first.email, "first-password1", second.id)), 401));
  (await rejects(async () => (await login(first.email, "wrong-password3")), 401));
  (await rejects(async () => (await login("missing@example.test", "first-password1")), 401));
});

function confirmPending(email) {
  const token = `shared-reservation-${++sequence}`;
  db.prepare("UPDATE signup_reservations SET token_hash=? WHERE rowid=(SELECT rowid FROM signup_reservations WHERE email=? AND status='pending' ORDER BY created_at DESC,rowid DESC LIMIT 1)")
    .run(createHash("sha256").update(token).digest("hex"), email);
  return routes["POST /api/verify-email"](context({ token }));
}

test("Settings add-account requires verified password/session proof and creates its second user only at verification", async () => {
  const first = member();
  await rejects(() => signup(first.email, { addAccount: true, currentPassword: "first-password1" }), 401);
  await rejects(() => signup(first.email, { addAccount: true, currentPassword: "wrong-password1" }, first), 401);
  await rejects(() => signup("other@example.test", { addAccount: true, currentPassword: "first-password1" }, first), 401);
  await rejects(() => signup(first.email, { addAccount: true, currentPassword: "first-password1" }, { ...first, email_verified_at: 0 }), 403);
  const staged = await signup(first.email, { addAccount: true, currentPassword: "first-password1" }, first);
  assert.equal(staged.result.pending, true); assert.equal(staged.ctx.session, undefined);
  assert.equal(q.usersByEmail.all(first.email).length, 1);
  assert.equal(confirmPending(first.email).verified, true);
  assert.equal(q.usersByEmail.all(first.email).length, 2);
  assert.equal(q.userById.get(first.id).pass_hash, first.pass_hash);
  await rejects(() => signup(first.email, { addAccount: true, currentPassword: "first-password1" }, first), 409);
});

test("public signup cannot disclose or reserve an existing account's sibling slot", async () => {
  const first = member(); const firstCookie = createSession(first.id);
  for (const extra of [{}, { password: "first-password1" }, { createAdditional: true, password: "first-password1" }]) {
    const { result, ctx } = await signup(first.email, extra);
    assert.equal(result.pending, true); assert.equal(result.user, undefined); assert.equal(result.accounts, undefined);
    assert.equal(ctx.session, undefined);
    await routes["POST /api/signup/cancel"](context({ cancelToken: result.cancelToken }));
    assert.equal(q.usersByEmail.all(first.email).length, 1);
    assert.equal(q.userById.get(first.id).pass_hash, first.pass_hash);
    assert.equal(getSession(firstCookie.token).user_id, first.id);
  }
});

test("concurrent ordinary submissions reserve no user rows and create only one account after confirmation", async () => {
  const email = `concurrent-first-${++sequence}@example.test`;
  const results = await Promise.all(Array.from({ length: 5 }, (_, n) => signup(email, { name: `Concurrent Member ${n}` })));
  assert.ok(results.every(entry => entry.result.pending && !entry.ctx.session));
  assert.equal(q.usersByEmail.all(email).length, 0);
  assert.equal(confirmPending(email).verified, true);
  assert.equal(q.usersByEmail.all(email).length, 1);
});

test("reservation cancellation is retry-safe and never borrows or clears another account's session", async () => {
  const first = member(); const before = q.userById.get(first.id);
  const { result } = await signup(first.email, { addAccount: true, currentPassword: "first-password1" }, first);
  const cancel = context({ cancelToken: result.cancelToken }, first);
  assert.deepEqual(await routes["POST /api/signup/cancel"](cancel), { ok: true });
  assert.equal(cancel.cleared, undefined);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM signup_reservations WHERE email=?").get(first.email).n, 0);
  // Session issuance updates activity, not the existing credential/content.
  assert.equal(q.userById.get(first.id).pass_hash, before.pass_hash);
  assert.equal(q.usersByEmail.all(first.email).length, 1);
  assert.deepEqual(await routes["POST /api/signup/cancel"](context({ cancelToken: result.cancelToken })), { ok: true });
});

test("confirmed accounts retain setup and password-confirmed deletion; obsolete reservation cancellation cannot erase them", async () => {
  const email = `finish-${++sequence}@example.test`; const { result } = await signup(email);
  assert.equal(confirmPending(email).verified, true);
  const user = q.userByEmail.get(email);
  assert.ok(user.email_verified_at);
  routes["POST /api/me/onboarding/complete"](context({ version: 1 }, user));
  await routes["POST /api/signup/cancel"](context({ cancelToken: result.cancelToken }));
  assert.ok(q.userById.get(user.id));
  await rejects(() => routes["DELETE /api/me"](context({ password: "second-password2", onboardingOnly: true }, user)), 409);
  assert.equal(q.userById.get(user.id).signup_cancel_hash, null);
});
test("legacy unfinished signup cancellation still erases only its account, sessions and owned-media cleanup", async () => {
  const first = member(); const legacy = member(first.email, "legacy-password2");
  const firstSession = createSession(first.id), legacySession = createSession(legacy.id);
  const cancelToken = "L".repeat(43);
  db.prepare("UPDATE users SET onboarding_version=0,email_verified_at=0,signup_cancel_hash=? WHERE id=?")
    .run(createHash("sha256").update(cancelToken).digest("hex"), legacy.id);
  const cancellation = context({ cancelToken }, first);
  assert.deepEqual(await routes["POST /api/signup/cancel"](cancellation), { ok: true });
  assert.equal(q.userById.get(legacy.id), undefined);
  assert.equal(getSession(legacySession.token), null);
  assert.ok(db.prepare("SELECT 1 FROM media_owner_sweeps WHERE owner_id=?").get(legacy.id));
  assert.equal(getSession(firstSession.token).user_id, first.id);
  assert.equal(q.userById.get(first.id).pass_hash, first.pass_hash);
  assert.equal(cancellation.cleared, undefined);
  assert.deepEqual(await routes["POST /api/signup/cancel"](context({ cancelToken })), { ok: true });
});

test("authenticated cancellation cannot erase legacy or completed accounts", async () => {
  const user = member();
  (await rejects(async () => (await routes["DELETE /api/me"](context({ password: "first-password1", onboardingOnly: true }, user))), 409));
  assert.ok(q.userById.get(user.id));
});

test("password change revokes this account's sessions and recovery tokens, not its sibling", async () => {
  const first = member(), second = member(first.email), firstCookie = createSession(first.id), secondCookie = createSession(second.id);
  db.prepare("UPDATE users SET reset_hash='old-reset',reset_expires=? WHERE id=?").run(Date.now() + 100000, first.id);
  (await rejects(async () => (await routes["POST /api/me/password"](context({ currentPassword: "wrong", password: "replacement-password3" }, first))), 401));
  const ctx = context({ currentPassword: "first-password1", password: "replacement-password3" }, first);
  assert.equal((await routes["POST /api/me/password"](ctx)).accountId, first.id);
  assert.equal(getSession(firstCookie.token), null);
  assert.equal(getSession(ctx.session.token).user_id, first.id);
  assert.equal(getSession(secondCookie.token).user_id, second.id);
  assert.equal(q.userById.get(first.id).reset_hash, null);
  assert.equal(q.userById.get(second.id).pass_hash, second.pass_hash);
  assert.ok(verifyPassword("replacement-password3", q.userById.get(first.id).pass_hash));
  assert.equal((await login(first.email, "first-password1")).result.user.id, second.id);
});

test("mailbox recovery creates separate reset tokens for both accounts and respects cooldown", async () => {
  const first = member(), second = member(first.email);
  assert.deepEqual(await routes["POST /api/forgot"](context({ email: first.email })), { ok: true });
  const a = q.userById.get(first.id).reset_hash, b = q.userById.get(second.id).reset_hash;
  assert.ok(a && b && a !== b);
  await routes["POST /api/forgot"](context({ email: first.email }));
  assert.equal(q.userById.get(first.id).reset_hash, a);
  assert.equal(q.userById.get(second.id).reset_hash, b);
});

test("Owner bootstrap fails closed for ambiguity and retains the locked ID with a shared email", () => {
  const first = member(), second = member(first.email);
  const env = { NODE_ENV: "production", ADMIN_EMAIL: first.email, ADMIN_PASSWORD: "LongDeploymentBootstrap-89!" };
  const options = { database: db, queries: q, env, production: true, log: { info() {}, warn() {} } };
  assert.throws(() => reconcileAdminAccount(options), /More than one account/);
  db.prepare("UPDATE users SET email=? WHERE id=?").run("temporarily-separate@example.test", second.id);
  reconcileAdminAccount(options);
  db.prepare("UPDATE users SET email=?,created_at=1 WHERE id=?").run(first.email, second.id);
  assert.equal(q.userByEmail.get(first.email).id, second.id, "fixture must put sibling first in email lookup");
  const result = reconcileAdminAccount(options);
  assert.equal(result.authorityChanged, false);
  assert.equal(q.userById.get(first.id).role, "admin");
  assert.equal(q.userById.get(second.id).role, "fan");
});
