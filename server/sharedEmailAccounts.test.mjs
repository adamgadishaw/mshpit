import assert from "node:assert/strict";
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
  const result = { body, user, ip: `shared-email-${++sequence}`, ua: "test", setHeader() {},
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

test("Settings add-account requires a verified current account and reauthentication; third account rejected", async () => {
  const first = member();
  (await rejects(async () => (await signup(first.email, { addAccount: true, currentPassword: "first-password1" })), 401));
  (await rejects(async () => (await signup(first.email, { addAccount: true, currentPassword: "wrong-password1" }, first)), 401));
  (await rejects(async () => (await signup("someone-else@example.test", { addAccount: true, currentPassword: "first-password1" }, first)), 401));
  (await rejects(async () => (await signup(first.email, { addAccount: true, currentPassword: "first-password1" }, { ...first, email_verified_at: 0 })), 403));
  (await signup(first.email, { addAccount: true, currentPassword: "first-password1" }, first));
  assert.equal(q.usersByEmail.all(first.email).length, 2);
  assert.equal(q.userById.get(first.id).pass_hash, first.pass_hash);
  (await rejects(async () => (await signup(first.email, { addAccount: true, currentPassword: "first-password1" }, first)), 409));
  assert.equal(q.usersByEmail.all(first.email).length, 2);
});

test("different-password public signup creates a restricted sibling and cancellation cannot erase the existing account", async () => {
  const first = member();
  const firstCookie = createSession(first.id);
  const { result, ctx } = (await signup(first.email));
  assert.equal(result.created, true);
  assert.equal(result.verificationRequired, true);
  assert.equal(result.user.emailVerified, false);
  assert.equal(result.user.role, "fan");
  assert.notEqual(result.user.id, first.id);
  assert.equal(getSession(ctx.session.token).user_id, result.user.id);
  assert.equal(getSession(firstCookie.token).user_id, first.id);
  assert.equal(q.usersByEmail.all(first.email).length, 2);
  (await rejects(async () => (await signup(first.email, { password: "third-password3" })), 409));
  assert.equal(q.usersByEmail.all(first.email).length, 2);
  (await routes["POST /api/signup/cancel"](context({ cancelToken: result.cancelToken })));
  assert.equal(q.userById.get(first.id).pass_hash, first.pass_hash);
  assert.equal(getSession(firstCookie.token).user_id, first.id);
  assert.equal(getSession(ctx.session.token), null);
  assert.equal(q.usersByEmail.all(first.email).length, 1);
});

test("concurrent ordinary first signups cannot create an unintended sibling account", async () => {
  const email = `concurrent-first-${++sequence}@example.test`;
  const attempts = Array.from({ length: 5 }, (_, index) => {
    const ctx = context({
      name: `Concurrent Member ${index}`,
      email,
      password: "concurrent-password1",
      genres: ["Rock"],
      ageBand: "18_plus",
      termsVersion: LEGAL_ACCEPTANCE_VERSION,
    });
    return routes["POST /api/signup"](ctx);
  });
  const settled = await Promise.allSettled(attempts);
  assert.equal(q.usersByEmail.all(email).length, 1);
  assert.equal(settled.filter((entry) => entry.status === "fulfilled" && entry.value?.created).length, 1);
  for (const entry of settled.filter((result) => result.status === "rejected")) {
    assert.equal(entry.reason?.status, 409);
    assert.equal(entry.reason?.code, "CONFLICT");
  }
});

test("matching signup credentials require an explicit choice before creating a same-password sibling", async () => {
  const first = member();
  const choice = (await signup(first.email, { password: "first-password1" }));
  assert.equal(choice.result.needsAccountChoice, true);
  assert.equal(choice.result.canCreate, true);
  assert.equal(choice.result.accounts.length, 1);
  assert.equal(choice.result.accounts[0].id, first.id);
  assert.equal(choice.result.cancelToken, undefined);
  assert.equal(choice.ctx.session, undefined);
  assert.equal(q.usersByEmail.all(first.email).length, 1);
  (await rejects(async () => (await signup(first.email, { createAdditional: true, password: "wrong-password4" })), 401));
  assert.equal(q.usersByEmail.all(first.email).length, 1);
  const created = (await signup(first.email, { createAdditional: true, password: "first-password1" }));
  assert.equal(created.result.created, true);
  assert.equal(created.result.verificationRequired, true);
  assert.equal(created.result.user.emailVerified, false);
  assert.notEqual(created.result.user.id, first.id);
  assert.equal(getSession(created.ctx.session.token).user_id, created.result.user.id);
  const fullChoice = (await signup(first.email, { password: "first-password1" }));
  assert.equal(fullChoice.result.needsAccountChoice, true);
  assert.equal(fullChoice.result.canCreate, false);
  assert.equal(fullChoice.result.accounts.length, 2);
  assert.equal(fullChoice.ctx.session, undefined);
  (await rejects(async () => (await signup(first.email, { createAdditional: true, password: "first-password1" })), 409));
  assert.equal(q.usersByEmail.all(first.email).length, 2);
  assert.equal(q.userById.get(first.id).pass_hash, first.pass_hash);
});

test("explicit signup cancellation deletes only the unfinished account and is retry-safe", async () => {
  const first = member();
  const { result } = (await signup(first.email, { addAccount: true, currentPassword: "first-password1" }, first));
  const second = q.usersByEmail.all(first.email).find((entry) => entry.id !== first.id);
  const cookie = createSession(second.id);
  db.prepare("UPDATE users SET created_at=1 WHERE id=?").run(second.id);
  assert.ok(q.userById.get(second.id), "unfinished accounts have no age cutoff");
  const cancel = context({ cancelToken: result.cancelToken }, first);
  assert.deepEqual((await routes["POST /api/signup/cancel"](cancel)), { ok: true });
  assert.equal(cancel.cleared, undefined, "sibling session remains intact");
  assert.equal(q.userById.get(second.id), undefined);
  assert.equal(getSession(cookie.token), null);
  assert.ok(db.prepare("SELECT 1 FROM media_owner_sweeps WHERE owner_id=?").get(second.id), "all uploaded objects remain queued for cleanup after the user row is erased");
  assert.ok(q.userById.get(first.id));
  assert.deepEqual((await routes["POST /api/signup/cancel"](context({ cancelToken: result.cancelToken }))), { ok: true });
});

test("Finish setup prevents later cancellation even before verification", async () => {
  const email = `finish-${++sequence}@example.test`, { result } = (await signup(email));
  const user = q.userByEmail.get(email);
  assert.equal(user.email_verified_at, 0);
  routes["POST /api/me/onboarding/complete"](context({ version: 1 }, user));
  (await routes["POST /api/signup/cancel"](context({ cancelToken: result.cancelToken })));
  assert.ok(q.userById.get(user.id));
  (await rejects(async () => (await routes["DELETE /api/me"](context({ password: "second-password2", onboardingOnly: true }, user))), 409));
  assert.equal(q.userById.get(user.id).signup_cancel_hash, null);
  assert.equal(q.userById.get(user.id).email_verified_at, 0);
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
