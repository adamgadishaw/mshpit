import assert from "node:assert/strict";
import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { ApiError } from "../../errors.js";
import { createLinkedAccounts, ensureLinkedAccountsSchema } from "./linkedAccounts.js";

const HOUR = 60 * 60 * 1000;
const ttl = (role) => ["admin", "moderator"].includes(role) ? 12 * HOUR : 30 * 24 * HOUR;
const hashToken = (token) => createHash("sha256").update(token).digest("hex");
const passwordHash = (password) => {
  const salt = randomBytes(16).toString("hex");
  return `scrypt:${salt}:${scryptSync(password, Buffer.from(salt, "hex"), 64).toString("hex")}`;
};
const verify = (password, stored) => {
  try {
    const [algorithm, salt, hash] = String(stored).split(":");
    return algorithm === "scrypt" && timingSafeEqual(scryptSync(password, Buffer.from(salt, "hex"), 64), Buffer.from(hash, "hex"));
  } catch { return false; }
};

// No server/db.js import: every test operates only on a private in-memory DB.
function fixture(t, options = {}) {
  const db = new DatabaseSync(":memory:");
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE users (id TEXT PRIMARY KEY,email TEXT NOT NULL,name TEXT,handle TEXT,pass_hash TEXT,
      role TEXT DEFAULT 'fan',avatar_uri TEXT,avatar_color TEXT,initials TEXT,
      email_verified_at INTEGER,is_banned INTEGER DEFAULT 0,suspended_until INTEGER,created_at INTEGER);
    CREATE TABLE sessions (token_hash TEXT PRIMARY KEY,user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      created_at INTEGER,expires_at INTEGER,ip TEXT,ua TEXT);`);
  t.after(() => db.close());
  let at = 1_800_000_000_000;
  let sequence = 0;
  const activations = [];
  const rates = [];
  function addUser({ email = "shared@example.test", password = "Matching-pass1", role = "fan", verified = true,
    banned = false, suspendedUntil = null } = {}) {
    const id = `user_${++sequence}`;
    db.prepare(`INSERT INTO users
      (id,email,name,handle,pass_hash,role,avatar_uri,avatar_color,initials,email_verified_at,is_banned,suspended_until,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, email, `User ${sequence}`, `handle_${sequence}`, passwordHash(password), role,
      `https://example.test/${id}.jpg`, "#123456", "TU", verified ? at : null, banned ? 1 : 0, suspendedUntil, at);
    return db.prepare("SELECT * FROM users WHERE id=?").get(id);
  }
  function createSession(userId) {
    const token = randomBytes(32).toString("base64url");
    const role = db.prepare("SELECT role FROM users WHERE id=?").get(userId)?.role;
    const expiresAt = at + ttl(role);
    db.prepare("INSERT INTO sessions VALUES (?,?,?,?,?,?)").run(hashToken(token), userId, at, expiresAt, "", "");
    return { token, expiresAt };
  }
  function atomicWrite(work) {
    db.exec("BEGIN IMMEDIATE");
    try { const result = work(); db.exec("COMMIT"); return result; }
    catch (error) { db.exec("ROLLBACK"); throw error; }
  }
  const service = createLinkedAccounts({
    database: db, ApiError, verifyPassword: options.verifyPassword || verify, atomicWrite, createSession,
    sessionTtlForRole: ttl, now: () => at,
    requireSessionUser: (ctx) => {
      if (!ctx.user) throw new ApiError(401, "Log in", "AUTH_REQUIRED");
      return ctx.user;
    },
    limit: (...args) => rates.push(args),
    publicUser: (user, { self = false } = {}) => ({ id: user.id, name: user.name, handle: user.handle,
      avatarUri: user.avatar_uri, avatarColor: user.avatar_color, initials: user.initials, role: user.role,
      ...(self ? { email: user.email } : {}), unwantedPublicField: "not-a-switcher-field" }),
    onAuthenticated: options.onAuthenticated || ((id) => activations.push(id)),
  });
  function context(user, session, body = {}) {
    const headers = {};
    return { user, token: session.token, body, headers,
      setHeader: (name, value) => { headers[name] = value; },
      setSession: (replacement) => { session.token = replacement.token; session.expiresAt = replacement.expiresAt; },
    };
  }
  const list = (user, session) => service.routes["GET /api/me/accounts"](context(user, session));
  const connect = async (user, session, password = "Matching-pass1") => (await service.routes["POST /api/me/accounts/connect"](context(user, session, { password })));
  const swap = (user, session, accountId) => service.routes["POST /api/me/accounts/switch"](context(user, session, { accountId }));
  const count = (table) => db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n;
  return { db, service, addUser, createSession, context, list, connect, swap, count, activations, rates,
    now: () => at, advance: (ms) => { at += ms; } };
}

test("same salted-password proof is browser-local, minimal, and non-enumerating", async (t) => {
  const f = fixture(t);
  const member = f.addUser();
  const owner = f.addUser({ role: "admin" });
  assert.notEqual(member.pass_hash, owner.pass_hash);
  const browser = f.createSession(member.id);
  const otherBrowser = f.createSession(member.id);
  const unlinked = f.list(member, browser);
  assert.deepEqual(unlinked.accounts.map((a) => a.id), [member.id]);
  assert.equal(unlinked.connected, false);
  assert.equal(unlinked.canConnect, true);
  const linked = (await f.connect(member, browser));
  assert.deepEqual(linked.accounts.map((a) => a.id), [member.id, owner.id]);
  assert.equal(linked.connected, true);
  assert.equal(linked.canConnect, false);
  assert.deepEqual(Object.keys(linked.accounts[1]).sort(), ["avatarColor", "avatarUri", "handle", "id", "initials", "isCurrent", "name", "role"]);
  assert.equal(linked.accounts[1].isCurrent, false);
  assert.deepEqual(f.list(member, otherBrowser).accounts.map((a) => a.id), [member.id]);
  assert.throws(() => f.swap(member, otherBrowser, owner.id), { code: "FORBIDDEN" });
  assert.equal(f.count("linked_account_pairs"), 1);
  assert.equal(f.count("linked_account_session_grants"), 1);
});

test("matching email alone, matching password alone, and whitespace variants never link", async (t) => {
  for (const target of [{ password: "Different-pass2" }, { password: "Matching-pass1 " }, { email: "other@example.test" }]) {
    const f = fixture(t);
    const member = f.addUser();
    const sibling = f.addUser(target);
    const session = f.createSession(member.id);
    assert.equal((await f.connect(member, session)).connected, false);
    assert.deepEqual(f.list(member, session).accounts.map((a) => a.id), [member.id]);
    assert.throws(() => f.swap(member, session, sibling.id), { code: "FORBIDDEN" });
    assert.equal(f.count("linked_account_pairs"), 0);
  }
});

test("source password, real live session, and exact granted target are all required", async (t) => {
  const f = fixture(t);
  const member = f.addUser();
  const sibling = f.addUser({ role: "admin" });
  const unrelated = f.addUser({ email: "unrelated@example.test" });
  const session = f.createSession(member.id);
  (await assert.rejects(async () => (await f.connect(member, session, "Wrong-pass2")), { code: "AUTH_INVALID" }));
  (await assert.rejects(async () => (await f.connect(member, session, "Matching-pass1" + "x".repeat(100))), { code: "AUTH_INVALID" }));
  (await assert.rejects(async () => (await f.connect(member, session, { password: "Matching-pass1" })), { code: "AUTH_INVALID" }));
  assert.equal(f.count("linked_account_pairs"), 0);
  assert.throws(() => f.list(member, { token: "forged" }), { code: "AUTH_REQUIRED" });
  assert.throws(() => f.list(sibling, session), { code: "AUTH_REQUIRED" });
  (await f.connect(member, session));
  assert.throws(() => f.swap(member, session, unrelated.id), { code: "FORBIDDEN" });
  assert.throws(() => f.swap(member, session, member.id), { code: "FORBIDDEN" });
  assert.throws(() => f.swap(member, session, { id: sibling.id }), { code: "VALIDATION_FAILED" });
});

test("both accounts must be verified; a pre-proven signup appears only after confirmation", async (t) => {
  const f = fixture(t);
  const member = f.addUser();
  const pending = f.addUser({ verified: false });
  const session = f.createSession(member.id);
  assert.equal((await f.connect(member, session)).connected, false);
  assert.equal(f.count("linked_account_pairs"), 1);
  assert.deepEqual(f.list(member, session).accounts.map((a) => a.id), [member.id]);
  assert.throws(() => f.swap(member, session, pending.id), { code: "FORBIDDEN" });
  f.db.prepare("UPDATE users SET email_verified_at=? WHERE id=?").run(f.now(), pending.id);
  assert.equal(f.list(member, session).connected, true);
  f.db.prepare("UPDATE users SET email_verified_at=NULL WHERE id=?").run(member.id);
  assert.equal(f.count("linked_account_pairs"), 0);
  assert.equal(f.count("linked_account_session_grants"), 0);
  (await assert.rejects(async () => (await f.connect(member, session)), { code: "EMAIL_VERIFICATION_REQUIRED" }));
});

test("source and target restrictions deny linking and switching", async (t) => {
  for (const restricted of [{ banned: true }, { suspendedUntil: 1_900_000_000_000 }]) {
    const f = fixture(t);
    const member = f.addUser();
    const target = f.addUser(restricted);
    const session = f.createSession(member.id);
    assert.equal((await f.connect(member, session)).connected, false);
    assert.throws(() => f.swap(member, session, target.id), { code: "FORBIDDEN" });
    assert.throws(() => f.list(target, f.createSession(target.id)), { code: "FORBIDDEN" });
  }
});

test("password and email updates to EITHER account revoke all browser grants immediately", async (t) => {
  for (const side of [0, 1]) for (const [column, value] of [["pass_hash", "replacement-password-record"], ["email", "changed@example.test"]]) {
    const f = fixture(t);
    const users = [f.addUser(), f.addUser({ role: "admin" })];
    const browser = f.createSession(users[0].id);
    const otherBrowser = f.createSession(users[0].id);
    (await f.connect(users[0], browser));
    (await f.connect(users[0], otherBrowser));
    assert.equal(f.count("linked_account_session_grants"), 2);
    f.db.prepare(`UPDATE users SET ${column}=? WHERE id=?`).run(value, users[side].id);
    assert.equal(f.count("linked_account_pairs"), 0);
    assert.equal(f.count("linked_account_session_grants"), 0);
    assert.throws(() => f.swap(users[0], browser, users[1].id), { code: "FORBIDDEN" });
  }
});

test("role/restriction changes revoke proof, but profile and verification completion do not", async (t) => {
  for (const [column, value] of [["role", "moderator"], ["is_banned", 1], ["suspended_until", 1_900_000_000_000]]) {
    const f = fixture(t);
    const member = f.addUser();
    const target = f.addUser();
    const session = f.createSession(member.id);
    (await f.connect(member, session));
    f.db.prepare("UPDATE users SET name='Renamed' WHERE id=?").run(target.id);
    assert.equal(f.count("linked_account_pairs"), 1);
    f.db.prepare(`UPDATE users SET ${column}=? WHERE id=?`).run(value, target.id);
    assert.equal(f.count("linked_account_pairs"), 0);
    assert.equal(f.count("linked_account_session_grants"), 0);
  }
});

test("deleting either account cascades links; logout deletes only that browser's grant", async (t) => {
  for (const side of [0, 1]) {
    const f = fixture(t);
    const users = [f.addUser(), f.addUser()];
    const first = f.createSession(users[0].id);
    const second = f.createSession(users[0].id);
    (await f.connect(users[0], first));
    (await f.connect(users[0], second));
    f.db.prepare("DELETE FROM sessions WHERE token_hash=?").run(hashToken(first.token));
    assert.equal(f.count("linked_account_pairs"), 1);
    assert.equal(f.count("linked_account_session_grants"), 1);
    f.db.prepare("DELETE FROM users WHERE id=?").run(users[side].id);
    assert.equal(f.count("linked_account_pairs"), 0);
    assert.equal(f.count("linked_account_session_grants"), 0);
    assert.deepEqual(f.db.prepare("PRAGMA foreign_key_check").all(), []);
  }
});

test("member-to-admin bounces and repeated proof cannot extend the original privileged TTL", async (t) => {
  const f = fixture(t);
  const member = f.addUser();
  const admin = f.addUser({ role: "admin" });
  const session = f.createSession(member.id);
  const originalToken = session.token;
  const authenticatedAt = f.now();
  (await f.connect(member, session));
  let grant = f.db.prepare("SELECT * FROM linked_account_session_grants").get();
  assert.equal(grant.expires_at, authenticatedAt + 12 * HOUR);
  f.advance(4 * HOUR);
  (await f.connect(member, session));
  assert.equal(f.db.prepare("SELECT expires_at FROM linked_account_session_grants").get().expires_at, grant.expires_at);
  const result = f.swap(member, session, admin.id);
  assert.equal(result.user.id, admin.id);
  assert.equal(result.user.email, admin.email);
  assert.notEqual(session.token, originalToken);
  assert.equal(f.db.prepare("SELECT * FROM sessions WHERE token_hash=?").get(hashToken(originalToken)), undefined);
  assert.equal(session.expiresAt, authenticatedAt + 12 * HOUR);
  f.advance(4 * HOUR);
  f.swap(admin, session, member.id);
  assert.equal(session.expiresAt, authenticatedAt + 12 * HOUR);
  const row = f.db.prepare("SELECT * FROM sessions WHERE token_hash=?").get(hashToken(session.token));
  assert.equal(row.created_at, authenticatedAt);
  assert.equal(row.expires_at, authenticatedAt + 12 * HOUR);
  assert.deepEqual(f.activations, [admin.id, member.id]);
  assert.equal(f.count("linked_account_session_grants"), 1);
  f.advance(4 * HOUR);
  assert.throws(() => f.swap(member, session, admin.id), { code: "AUTH_REQUIRED" });
});

test("an older member session cannot create fresh staff authority via connect", async (t) => {
  const f = fixture(t);
  const member = f.addUser();
  const admin = f.addUser({ role: "admin" });
  const session = f.createSession(member.id);
  f.advance(13 * HOUR);
  assert.equal((await f.connect(member, session)).connected, false);
  assert.equal(f.count("linked_account_session_grants"), 0);
  assert.throws(() => f.swap(member, session, admin.id), { code: "FORBIDDEN" });
});

test("switch failure rolls back session rotation and does not set a cookie", async (t) => {
  const f = fixture(t, { onAuthenticated: () => { throw new Error("simulated lifecycle failure"); } });
  const member = f.addUser();
  const sibling = f.addUser();
  const session = f.createSession(member.id);
  (await f.connect(member, session));
  const before = session.token;
  assert.throws(() => f.swap(member, session, sibling.id), /simulated lifecycle failure/);
  assert.equal(session.token, before);
  assert.equal(f.count("sessions"), 1);
  assert.equal(f.count("linked_account_session_grants"), 1);
  assert.equal(f.list(member, session).connected, true);
});

test("credential changes racing password verification cannot persist stale proof", async (t) => {
  let f;
  let targetId;
  let verifications = 0;
  f = fixture(t, { verifyPassword: (password, stored) => {
    const valid = verify(password, stored);
    if (++verifications === 2) f.db.prepare("UPDATE users SET pass_hash=? WHERE id=?").run("changed-concurrently", targetId);
    return valid;
  } });
  const member = f.addUser();
  targetId = f.addUser().id;
  const session = f.createSession(member.id);
  assert.equal((await f.connect(member, session)).connected, false);
  assert.equal(f.count("linked_account_pairs"), 0);
  assert.equal(f.count("linked_account_session_grants"), 0);
});

test("schema installation is idempotent and auth responses are no-store and rate-limited", async (t) => {
  const f = fixture(t);
  ensureLinkedAccountsSchema(f.db);
  ensureLinkedAccountsSchema(f.db);
  const member = f.addUser();
  const sibling = f.addUser();
  const session = f.createSession(member.id);
  const listCtx = f.context(member, session);
  f.service.routes["GET /api/me/accounts"](listCtx);
  assert.equal(listCtx.headers["Cache-Control"], "no-store");
  const connectCtx = f.context(member, session, { password: "Matching-pass1" });
  (await f.service.routes["POST /api/me/accounts/connect"](connectCtx));
  assert.equal(connectCtx.headers["Cache-Control"], "no-store");
  const switchCtx = f.context(member, session, { accountId: sibling.id });
  f.service.routes["POST /api/me/accounts/switch"](switchCtx);
  assert.equal(switchCtx.headers["Cache-Control"], "no-store");
  assert.deepEqual(f.rates.map((args) => args[1]), ["connect-accounts", "switch-accounts"]);
});

test("schema refuses to install without deletion-cascade enforcement", (t) => {
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  db.exec("PRAGMA foreign_keys=OFF");
  assert.throws(() => ensureLinkedAccountsSchema(db), /foreign-key enforcement/);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM sqlite_schema WHERE type='table'").get().n, 0);
});

test("proof is valid in either account direction and email normalization is consistent", async (t) => {
  const f = fixture(t);
  const admin = f.addUser({ role: "admin", email: " SHARED@example.test " });
  const member = f.addUser();
  const session = f.createSession(admin.id);
  assert.equal((await f.connect(admin, session)).connected, true);
  const response = f.swap(admin, session, member.id);
  assert.equal(response.user.id, member.id);
  assert.deepEqual(response.accounts.map((account) => [account.id, account.isCurrent]), [[member.id, true], [admin.id, false]]);
  assert.equal(session.expiresAt, f.now() + 12 * HOUR);
});

test("source unverified proof cannot expose or switch into a verified account", async (t) => {
  const f = fixture(t);
  const pending = f.addUser({ verified: false });
  const admin = f.addUser({ role: "admin" });
  const session = f.createSession(pending.id);
  assert.equal((await f.service.proveAndGrant({ userId: pending.id, password: "Matching-pass1", token: session.token })).connected, false);
  assert.equal(f.list(pending, session).connected, false);
  assert.deepEqual(f.list(pending, session).accounts.map((account) => account.id), [pending.id]);
  assert.throws(() => f.swap(pending, session, admin.id), { code: "FORBIDDEN" });
});
