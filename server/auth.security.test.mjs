import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

const dataDir = mkdtempSync(join(tmpdir(), "pit-auth-security-"));
process.env.PIT_DATA_DIR = dataDir;
process.env.PIT_ALLOW_EMPTY_DB_BOOTSTRAP = "true";
delete process.env.RESEND_API_KEY;
delete process.env.MAIL_FROM;

const { db, q } = await import("./db.js");
const {
  PRIVILEGED_SESSION_TTL_MS,
  PRODUCTION_COOKIE,
  STANDARD_SESSION_TTL_MS,
  COOKIE,
  clearSessionCookies,
  createSession,
  getSession,
  hashPassword,
  parseCookies,
  rateLimit,
  resetRateLimitsForTests,
  reserveRateLimits,
  sessionCookie,
  sessionCookieHeaders,
  sessionCookieName,
  sessionTtlForRole,
  verifyPassword,
  verifyPasswordForUser,
} = await import("./auth.js");
const { BOOTSTRAP_ADMIN_IDENTITY_KEY, reconcileAdminAccount } = await import("./adminBootstrap.js");
const {
  RECOVERY_RESPONSE_FLOOR_MAX_MS,
  RECOVERY_RESPONSE_FLOOR_MIN_MS,
  createRecoveryResponseFloor,
} = await import("./authResponseFloor.js");
const { routes } = await import("./api.js");

after(() => {
  db.close();
  rmSync(dataDir, { recursive: true, force: true });
});

let sequence = 0;
function addUser({ role = "fan", password = "test-password", banned = false, suspendedUntil = null, emailVerified = true } = {}) {
  sequence += 1;
  const id = `u_auth_security_${sequence}`;
  const email = `auth-security-${sequence}@example.test`;
  q.insertUser.run(
    id,
    email,
    `Auth User ${sequence}`,
    `auth_security_${sequence}`,
    hashPassword(password),
    role,
    "Toronto",
    43.65,
    -79.38,
    "AU",
    "#123456",
    Date.now(),
  );
  if (banned || suspendedUntil) {
    db.prepare("UPDATE users SET is_banned=?, suspended_until=? WHERE id=?")
      .run(banned ? 1 : 0, suspendedUntil, id);
  }
  if (emailVerified) db.prepare("UPDATE users SET email_verified_at=? WHERE id=?").run(Date.now(), id);
  return q.userById.get(id);
}

const silentLog = { info() {}, warn() {} };
const RATE_LIMIT_BUCKET_CAPACITY = 50_000;
const RATE_LIMIT_TEST_WINDOW_MS = 60_000;

const ownerBoundaryTriggerNames = [
  "owner_identity_no_update",
  "owner_identity_no_delete",
  "owner_account_security_boundary",
  "owner_account_no_delete",
];
const ownerBoundaryTriggers = db.prepare(`SELECT name,sql FROM sqlite_master
  WHERE type='trigger' AND name IN (${ownerBoundaryTriggerNames.map(() => "?").join(",")})`)
  .all(...ownerBoundaryTriggerNames);

function resetBootstrapIdentityForTest() {
  // Every bootstrap scenario models a separate production database. This test
  // suite shares one SQLite connection, so temporarily remove only the Owner
  // boundary triggers while replacing the fixture marker, then restore their
  // exact production SQL before the system under test runs.
  for (const name of ownerBoundaryTriggerNames) db.exec(`DROP TRIGGER IF EXISTS ${name}`);
  db.prepare("DELETE FROM app_meta WHERE key=?").run(BOOTSTRAP_ADMIN_IDENTITY_KEY);
  for (const trigger of ownerBoundaryTriggers) db.exec(trigger.sql);
}

function setBootstrapAdminIdentity(user, { version = 2 } = {}) {
  resetBootstrapIdentityForTest();
  const identity = { version, email: user.email, userId: user.id, ...(version === 2 ? { lockedAt: 1 } : {}) };
  db.prepare(`INSERT INTO app_meta (key,value) VALUES (?,?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value`)
    .run(BOOTSTRAP_ADMIN_IDENTITY_KEY, JSON.stringify(identity));
  return identity;
}

function getBootstrapAdminIdentity() {
  const value = db.prepare("SELECT value FROM app_meta WHERE key=?").get(BOOTSTRAP_ADMIN_IDENTITY_KEY)?.value;
  return value ? JSON.parse(value) : null;
}

function fillRateLimitBuckets(prefix, count, { max = 1, windowMs = RATE_LIMIT_TEST_WINDOW_MS } = {}) {
  for (let index = 0; index < count; index += 1) {
    assert.equal(
      rateLimit(`${prefix}:${index}`, max, windowMs),
      true,
      `expected rate-limit bucket ${index + 1} of ${count} to be admitted`,
    );
  }
}

test("recovery response floor waits only the remaining cryptographically sampled budget", async () => {
  const clock = [1_000, 1_075];
  const waits = [];
  const floor = createRecoveryResponseFloor({
    minMs: 220,
    maxMs: 300,
    randomInteger(minimum, maximumExclusive) {
      assert.equal(minimum, 220);
      assert.equal(maximumExclusive, 301);
      return 260;
    },
    now: () => clock.shift(),
    wait: async (delay) => { waits.push(delay); },
  });

  assert.deepEqual(await floor.settle(), { targetMs: 260, elapsedMs: 75, waitedMs: 185 });
  assert.deepEqual(waits, [185]);
  assert.equal((await floor.settle()).waitedMs, 185, "settling twice must not add a second timing delay");
});

test("recovery response floor remains bounded and never waits after work exceeds its target", async () => {
  let waited = false;
  const floor = createRecoveryResponseFloor({
    minMs: RECOVERY_RESPONSE_FLOOR_MIN_MS,
    maxMs: RECOVERY_RESPONSE_FLOOR_MAX_MS,
    randomInteger: () => RECOVERY_RESPONSE_FLOOR_MIN_MS,
    now: (() => {
      const clock = [5_000, 5_500];
      return () => clock.shift();
    })(),
    wait: async () => { waited = true; },
  });

  assert.deepEqual(await floor.settle(), {
    targetMs: RECOVERY_RESPONSE_FLOOR_MIN_MS,
    elapsedMs: 500,
    waitedMs: 0,
  });
  assert.equal(waited, false);
});

test("production admin bootstrap fails closed before touching the database when its password is absent", () => {
  const forbiddenQueries = { userByEmail: { get() { throw new Error("database should not be queried"); } } };
  assert.throws(
    () => reconcileAdminAccount({
      database: db,
      queries: forbiddenQueries,
      env: { NODE_ENV: "production", ADMIN_EMAIL: "owner@example.test" },
      production: true,
      log: silentLog,
    }),
    /ADMIN_PASSWORD is required/,
  );
});

test("production admin bootstrap fails closed when its login identifier is absent or malformed", () => {
  const forbiddenQueries = { userByEmail: { get() { throw new Error("database should not be queried"); } } };
  for (const ADMIN_EMAIL of [undefined, "", "not-an-email"]) {
    assert.throws(
      () => reconcileAdminAccount({
        database: db,
        queries: forbiddenQueries,
        env: { NODE_ENV: "production", ADMIN_EMAIL, ADMIN_PASSWORD: "valid-root-secret-9831" },
        production: true,
        log: silentLog,
      }),
      /valid ADMIN_EMAIL is required/,
    );
  }
});

test("development bootstrap uses a non-routable generic identity when ADMIN_EMAIL is omitted", () => {
  const id = `u_auth_security_local_default_${Date.now()}`;
  const result = reconcileAdminAccount({
    database: db,
    queries: q,
    env: {},
    production: false,
    log: silentLog,
    createId: () => id,
    createDevelopmentPassword: () => "local-generated-password",
  });
  const created = q.userById.get(id);
  assert.equal(result.created, true);
  assert.equal(created.email, "admin@localhost.invalid");
  assert.equal(created.name, "Pit Administrator");
  assert.equal(created.home_city, null);
});

test("production admin bootstrap rejects weak, placeholder, and email-derived secrets before database access", () => {
  const forbiddenQueries = { userByEmail: { get() { throw new Error("database should not be queried"); } } };
  const weakConfigurations = [
    { ADMIN_EMAIL: "owner@example.test", ADMIN_PASSWORD: "short" },
    { ADMIN_EMAIL: "owner@example.test", ADMIN_PASSWORD: "passwordpassword" },
    { ADMIN_EMAIL: "owner@example.test", ADMIN_PASSWORD: "change-me-change-me" },
    { ADMIN_EMAIL: "long-owner-address@example.test", ADMIN_PASSWORD: "long-owner-address@example.test" },
    { ADMIN_EMAIL: "owner@example.test", ADMIN_PASSWORD: "replace-this-password" },
    { ADMIN_EMAIL: "owner@example.test", ADMIN_PASSWORD: "aaaaaaaaaaaaaaaa" },
    { ADMIN_EMAIL: "owner@example.test", ADMIN_PASSWORD: "owner-owner-owner-owner" },
  ];
  for (const configuration of weakConfigurations) {
    assert.throws(
      () => reconcileAdminAccount({
        database: db,
        queries: forbiddenQueries,
        env: { NODE_ENV: "production", ...configuration },
        production: true,
        log: silentLog,
      }),
      (error) => /ADMIN_PASSWORD must be at least 16 characters/.test(error.message)
        && !error.message.includes(configuration.ADMIN_PASSWORD),
    );
  }
});

test("the production server process exits before listening when ADMIN_PASSWORD is absent", () => {
  const startupDataDir = mkdtempSync(join(tmpdir(), "pit-auth-startup-"));
  try {
    const env = {
      ...process.env,
      NODE_ENV: "production",
      PIT_DATA_DIR: startupDataDir,
      PIT_ALLOW_EMPTY_DB_BOOTSTRAP: "true",
    };
    delete env.ADMIN_PASSWORD;
    const result = spawnSync(process.execPath, ["server/index.js"], {
      cwd: new URL("..", import.meta.url),
      env,
      encoding: "utf8",
      timeout: 15_000,
    });
    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}\n${result.stderr}`, /ADMIN_PASSWORD is required/);
  } finally {
    rmSync(startupDataDir, { recursive: true, force: true });
  }
});

test("first production root adoption stores its identity and revokes every admin session", () => {
  const selected = addUser({ role: "admin", password: "initial-root-password1" });
  const peerAdmin = addUser({ role: "admin", password: "peer-root-password2" });
  const selectedSession = createSession(selected.id, "127.0.0.1", "selected");
  const peerSession = createSession(peerAdmin.id, "127.0.0.1", "peer");
  resetBootstrapIdentityForTest();

  const result = reconcileAdminAccount({
    database: db,
    queries: q,
    env: { ADMIN_EMAIL: selected.email, ADMIN_PASSWORD: "initial-root-password1" },
    production: true,
    log: silentLog,
  });

  assert.equal(result.sessionsRevoked, true);
  assert.deepEqual(
    { ...getBootstrapAdminIdentity(), lockedAt: true },
    { version: 2, email: selected.email, userId: selected.id, lockedAt: true },
  );
  assert.equal(getSession(selectedSession.token), null);
  assert.equal(getSession(peerSession.token), null);
  assert.equal(q.userById.get(peerAdmin.id).role, "admin", "adoption must not demote another legitimate administrator");
});

test("a locked v2 Owner cannot be transferred by changing deployment configuration", () => {
  const owner = addUser({ role: "admin", password: "locked-owner-password1" });
  const proposed = addUser({ role: "fan", password: "proposed-owner-password2" });
  setBootstrapAdminIdentity(owner);
  assert.throws(() => reconcileAdminAccount({
    database: db,
    queries: q,
    env: {
      ADMIN_EMAIL: proposed.email,
      OWNER_EMAIL: proposed.email,
      OWNER_MIGRATION_EMAIL: proposed.email,
      ADMIN_PASSWORD: "proposed-owner-password2",
    },
    production: true,
    log: silentLog,
  }), /does not match the locked Owner identity/u);
  assert.equal(getBootstrapAdminIdentity().userId, owner.id);
  assert.equal(q.userById.get(proposed.id).role, "fan");
});

test("a rolling deploy can preserve a healthy legacy root while explicit Owner migration is pending", () => {
  const legacyRoot = addUser({ role: "admin", password: "legacy-rolling-password1" });
  setBootstrapAdminIdentity(legacyRoot, { version: 1 });
  const session = createSession(legacyRoot.id, "127.0.0.1", "legacy-rolling");

  const result = reconcileAdminAccount({
    database: db,
    queries: q,
    env: {
      ADMIN_EMAIL: legacyRoot.email,
      ADMIN_PASSWORD: "legacy-rolling-password1",
    },
    production: true,
    log: silentLog,
  });

  assert.deepEqual(result, {
    created: false,
    passwordChanged: false,
    authorityChanged: false,
    sessionsRevoked: false,
    generated: false,
    migrationPending: true,
  });
  assert.deepEqual(getBootstrapAdminIdentity(), {
    version: 1,
    email: legacyRoot.email,
    userId: legacyRoot.id,
  });
  assert.equal(getSession(session.token)?.user_id, legacyRoot.id);
  assert.equal(q.userById.get(legacyRoot.id).role, "admin");
});

test("legacy rolling-deploy compatibility rejects authority or identity drift", () => {
  const legacyRoot = addUser({ role: "admin", password: "legacy-drift-password1" });
  const proposed = addUser({ role: "admin", password: "legacy-drift-password2" });
  setBootstrapAdminIdentity(legacyRoot, { version: 1 });

  assert.throws(() => reconcileAdminAccount({
    database: db,
    queries: q,
    env: {
      ADMIN_EMAIL: proposed.email,
      OWNER_EMAIL: proposed.email,
      ADMIN_PASSWORD: "legacy-drift-password2",
    },
    production: true,
    log: silentLog,
  }), /OWNER_MIGRATION_EMAIL must explicitly match/u);
  assert.deepEqual(getBootstrapAdminIdentity(), {
    version: 1,
    email: legacyRoot.email,
    userId: legacyRoot.id,
  });
});

test("SQLite itself blocks Owner identity replacement, restriction, demotion, and deletion", () => {
  const owner = addUser({ role: "admin", password: "database-owner-password1" });
  setBootstrapAdminIdentity(owner);
  assert.throws(() => db.prepare("UPDATE app_meta SET value='{}' WHERE key=?")
    .run(BOOTSTRAP_ADMIN_IDENTITY_KEY), /Owner identity is locked/u);
  assert.throws(() => db.prepare("DELETE FROM app_meta WHERE key=?")
    .run(BOOTSTRAP_ADMIN_IDENTITY_KEY), /Owner identity is locked/u);
  assert.throws(() => db.prepare("UPDATE users SET role='fan' WHERE id=?").run(owner.id), /Owner account security boundary/u);
  assert.throws(() => db.prepare("UPDATE users SET is_banned=1 WHERE id=?").run(owner.id), /Owner account security boundary/u);
  assert.throws(() => db.prepare("UPDATE users SET suspended_until=? WHERE id=?").run(Date.now() + 60_000, owner.id), /Owner account security boundary/u);
  assert.throws(() => db.prepare("UPDATE users SET email=? WHERE id=?").run("other@example.test", owner.id), /Owner account security boundary/u);
  assert.throws(() => db.prepare("UPDATE users SET email_verified_at=0 WHERE id=?").run(owner.id), /Owner account security boundary/u);
  assert.throws(() => db.prepare("DELETE FROM users WHERE id=?").run(owner.id), /Owner account cannot be deleted/u);

  db.prepare("UPDATE users SET name=?,handle=? WHERE id=?").run("Mshpit", "mshpit", owner.id);
  assert.deepEqual(
    { ...db.prepare("SELECT name,handle,role FROM users WHERE id=?").get(owner.id) },
    { name: "Mshpit", handle: "mshpit", role: "admin" },
    "public branding remains editable without becoming the source of authority",
  );
});

test("switching the configured root retires only the prior root and preserves unrelated admin roles", () => {
  const previousRoot = addUser({ role: "admin", password: "previous-root-password1" });
  const nextRoot = addUser({ role: "fan", password: "next-root-password2" });
  const unrelatedAdmin = addUser({ role: "admin", password: "unrelated-admin-password3" });
  const ordinary = addUser({ role: "fan", password: "ordinary-fan-password3" });
  setBootstrapAdminIdentity(previousRoot, { version: 1 });
  const previousSession = createSession(previousRoot.id, "127.0.0.1", "previous");
  const nextSession = createSession(nextRoot.id, "127.0.0.1", "next");
  const unrelatedAdminSession = createSession(unrelatedAdmin.id, "127.0.0.1", "unrelated-admin");
  const ordinarySession = createSession(ordinary.id, "127.0.0.1", "ordinary");

  const result = reconcileAdminAccount({
    database: db,
    queries: q,
    env: {
      ADMIN_EMAIL: nextRoot.email,
      OWNER_EMAIL: nextRoot.email,
      OWNER_MIGRATION_EMAIL: nextRoot.email,
      ADMIN_PASSWORD: "deployment-only-password4",
    },
    production: true,
    log: silentLog,
  });

  assert.equal(result.authorityChanged, true);
  assert.equal(result.sessionsRevoked, true);
  assert.deepEqual(
    { ...getBootstrapAdminIdentity(), lockedAt: true },
    { version: 2, email: nextRoot.email, userId: nextRoot.id, lockedAt: true },
  );
  const retiredRoot = q.userById.get(previousRoot.id);
  assert.equal(retiredRoot.role, "fan");
  assert.equal(retiredRoot.email, previousRoot.email, "root transfer preserves mailbox ownership for ordinary recovery");
  assert.equal(verifyPassword("previous-root-password1", retiredRoot.pass_hash), false);
  assert.equal(q.userById.get(nextRoot.id).role, "admin");
  assert.equal(verifyPassword("next-root-password2", q.userById.get(nextRoot.id).pass_hash), true,
    "Owner adoption preserves the confirmed member's own login password");
  assert.equal(verifyPassword("deployment-only-password4", q.userById.get(nextRoot.id).pass_hash), false);
  assert.equal(q.userById.get(unrelatedAdmin.id).role, "admin");
  assert.equal(getSession(previousSession.token), null);
  assert.equal(getSession(nextSession.token), null);
  assert.equal(getSession(unrelatedAdminSession.token), null, "root transfer still revokes every currently privileged cookie");
  assert.equal(getSession(ordinarySession.token)?.user_id, ordinary.id, "unprivileged sessions are outside the root-rotation boundary");
  assert.throws(
    () => routes["GET /api/admin/members"]({ user: retiredRoot, query: {} }),
    (error) => error?.code === "FORBIDDEN",
    "the retired root cannot exercise admin authority",
  );
});

test("a legacy Owner transfer cannot fabricate a replacement member account", () => {
  const previousRoot = addUser({ role: "admin", password: "new-email-previous-password1" });
  const unrelatedAdmin = addUser({ role: "admin", password: "new-email-peer-password2" });
  setBootstrapAdminIdentity(previousRoot, { version: 1 });
  const previousSession = createSession(previousRoot.id, "127.0.0.1", "previous");
  const unrelatedSession = createSession(unrelatedAdmin.id, "127.0.0.1", "unrelated");
  const newRootId = `u_auth_security_new_root_${Date.now()}`;
  const newRootEmail = `new-root-${Date.now()}@example.test`;

  assert.throws(() => reconcileAdminAccount({
    database: db,
    queries: q,
    env: {
      ADMIN_EMAIL: newRootEmail,
      OWNER_EMAIL: newRootEmail,
      OWNER_MIGRATION_EMAIL: newRootEmail,
      ADMIN_PASSWORD: "brand-new-root-password3",
    },
    production: true,
    log: silentLog,
    createId: () => newRootId,
  }), /requires an existing member account/u);

  assert.equal(q.userById.get(newRootId), undefined);
  assert.equal(q.userById.get(previousRoot.id).role, "admin");
  assert.equal(verifyPassword("new-email-previous-password1", q.userById.get(previousRoot.id).pass_hash), true);
  assert.equal(getSession(previousSession.token)?.user_id, previousRoot.id);
  assert.equal(getSession(unrelatedSession.token)?.user_id, unrelatedAdmin.id);
  assert.equal(q.userById.get(unrelatedAdmin.id).role, "admin");
  assert.deepEqual(getBootstrapAdminIdentity(), {
    version: 1,
    email: previousRoot.email,
    userId: previousRoot.id,
  });
});

test("configured root switch rolls back identity, authority, password, and revocation together", () => {
  const previousRoot = addUser({ role: "admin", password: "rollback-root-password1" });
  const nextRoot = addUser({ role: "fan", password: "rollback-target-old-password2" });
  setBootstrapAdminIdentity(previousRoot, { version: 1 });
  const previousSession = createSession(previousRoot.id, "127.0.0.1", "previous");
  const nextSession = createSession(nextRoot.id, "127.0.0.1", "next");
  db.exec(`CREATE TRIGGER auth_security_root_switch_revoke_failure
    BEFORE DELETE ON sessions WHEN OLD.user_id='${previousRoot.id}'
    BEGIN SELECT RAISE(ABORT, 'forced root switch revoke failure'); END`);
  try {
    assert.throws(() => reconcileAdminAccount({
      database: db,
      queries: q,
      env: {
        ADMIN_EMAIL: nextRoot.email,
        OWNER_EMAIL: nextRoot.email,
        OWNER_MIGRATION_EMAIL: nextRoot.email,
        ADMIN_PASSWORD: "rollback-target-new-password3",
      },
      production: true,
      log: silentLog,
    }), /forced root switch revoke failure/);
  } finally {
    db.exec("DROP TRIGGER auth_security_root_switch_revoke_failure");
  }

  assert.deepEqual(getBootstrapAdminIdentity(), {
    version: 1,
    email: previousRoot.email,
    userId: previousRoot.id,
  });
  const unchangedTarget = q.userById.get(nextRoot.id);
  const unchangedPreviousRoot = q.userById.get(previousRoot.id);
  assert.equal(unchangedTarget.role, "fan");
  assert.equal(unchangedPreviousRoot.role, "admin");
  assert.equal(verifyPassword("rollback-root-password1", unchangedPreviousRoot.pass_hash), true);
  assert.equal(verifyPassword("rollback-target-old-password2", unchangedTarget.pass_hash), true);
  assert.equal(verifyPassword("rollback-target-new-password3", unchangedTarget.pass_hash), false);
  assert.equal(getSession(previousSession.token)?.user_id, previousRoot.id);
  assert.equal(getSession(nextSession.token)?.user_id, nextRoot.id);
});

test("an unchanged configured admin password is not rehashed and does not revoke sessions", () => {
  const user = addUser({ role: "admin", password: "stable-admin-password" });
  setBootstrapAdminIdentity(user);
  const session = createSession(user.id, "127.0.0.1", "test");
  const originalHash = user.pass_hash;

  const result = reconcileAdminAccount({
    database: db,
    queries: q,
    env: { ADMIN_EMAIL: user.email, ADMIN_PASSWORD: "stable-admin-password" },
    production: true,
    log: silentLog,
  });

  assert.deepEqual(result, {
    created: false,
    passwordChanged: false,
    authorityChanged: false,
    sessionsRevoked: false,
    generated: false,
  });
  assert.equal(q.userById.get(user.id).pass_hash, originalHash);
  assert.equal(getSession(session.token)?.user_id, user.id);
});

test("a changed deployment password cannot rotate a locked production Owner", () => {
  const user = addUser({ role: "admin", password: "old-admin-password" });
  setBootstrapAdminIdentity(user);
  createSession(user.id, "127.0.0.1", "one");
  createSession(user.id, "127.0.0.1", "two");

  const result = reconcileAdminAccount({
    database: db,
    queries: q,
    env: { ADMIN_EMAIL: user.email, ADMIN_PASSWORD: "new-admin-password" },
    production: true,
    log: silentLog,
  });

  assert.equal(result.passwordChanged, false);
  assert.equal(result.sessionsRevoked, false);
  assert.equal(verifyPassword("old-admin-password", q.userById.get(user.id).pass_hash), true);
  assert.equal(verifyPassword("new-admin-password", q.userById.get(user.id).pass_hash), false);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM sessions WHERE user_id=?").get(user.id).count, 2);
});

test("development password rotation still rolls back if session revocation cannot complete", () => {
  const user = addUser({ role: "admin", password: "atomic-old-password" });
  setBootstrapAdminIdentity(user);
  createSession(user.id, "127.0.0.1", "test");
  db.exec(`CREATE TRIGGER auth_security_revoke_failure
    BEFORE DELETE ON sessions WHEN OLD.user_id='${user.id}'
    BEGIN SELECT RAISE(ABORT, 'forced revoke failure'); END`);
  try {
    assert.throws(() => reconcileAdminAccount({
      database: db,
      queries: q,
      env: { ADMIN_EMAIL: user.email, ADMIN_PASSWORD: "atomic-new-password" },
      production: false,
      log: silentLog,
    }), /forced revoke failure/);
    const unchanged = q.userById.get(user.id);
    assert.equal(verifyPassword("atomic-old-password", unchanged.pass_hash), true);
    assert.equal(verifyPassword("atomic-new-password", unchanged.pass_hash), false);
    assert.equal(db.prepare("SELECT COUNT(*) count FROM sessions WHERE user_id=?").get(user.id).count, 1);
  } finally {
    db.exec("DROP TRIGGER auth_security_revoke_failure");
  }
});

test("development omission leaves an existing admin credential and session untouched", () => {
  const user = addUser({ role: "admin", password: "local-admin-password" });
  const session = createSession(user.id, "127.0.0.1", "test");

  const result = reconcileAdminAccount({
    database: db,
    queries: q,
    env: { ADMIN_EMAIL: user.email },
    production: false,
    log: silentLog,
    createDevelopmentPassword: () => "must-not-be-used",
  });

  assert.equal(result.passwordChanged, false);
  assert.equal(q.userById.get(user.id).pass_hash, user.pass_hash);
  assert.equal(getSession(session.token)?.user_id, user.id);
});

test("authority repair restores the admin boundary and revokes old cookies", () => {
  const user = addUser({
    role: "moderator",
    password: "repair-admin-password",
    banned: true,
    suspendedUntil: Date.now() + 60_000,
  });
  setBootstrapAdminIdentity(user);
  createSession(user.id, "127.0.0.1", "test");

  const result = reconcileAdminAccount({
    database: db,
    queries: q,
    env: { ADMIN_EMAIL: user.email, ADMIN_PASSWORD: "repair-admin-password" },
    production: true,
    log: silentLog,
  });

  const repaired = q.userById.get(user.id);
  assert.equal(result.authorityChanged, true);
  assert.equal(result.sessionsRevoked, true);
  assert.equal(repaired.role, "admin");
  assert.equal(repaired.is_banned, 0);
  assert.equal(repaired.suspended_until, null);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM sessions WHERE user_id=?").get(user.id).count, 0);
});

test("the one-time legacy Owner migration refuses an unconfirmed mailbox", () => {
  const user = addUser({ role: "admin", password: "legacy-root-password1", emailVerified: false });
  setBootstrapAdminIdentity(user, { version: 1 });
  createSession(user.id, "127.0.0.1", "legacy-root");
  assert.throws(() => reconcileAdminAccount({
    database: db,
    queries: q,
    env: {
      ADMIN_EMAIL: user.email,
      OWNER_EMAIL: user.email,
      OWNER_MIGRATION_EMAIL: user.email,
      ADMIN_PASSWORD: "legacy-root-password1",
    },
    production: true,
    log: silentLog,
  }), /already-confirmed member email/u);
  assert.equal(q.userById.get(user.id).email_verified_at, 0);
});

test("staff sessions are capped at twelve hours while member sessions retain thirty days", () => {
  assert.equal(sessionTtlForRole("admin"), PRIVILEGED_SESSION_TTL_MS);
  assert.equal(sessionTtlForRole("moderator"), PRIVILEGED_SESSION_TTL_MS);
  assert.equal(sessionTtlForRole("fan"), STANDARD_SESSION_TTL_MS);

  const admin = addUser({ role: "admin" });
  const fan = addUser({ role: "fan" });
  const before = Date.now();
  const adminSession = createSession(admin.id, "127.0.0.1", "test");
  const fanSession = createSession(fan.id, "127.0.0.1", "test");
  const after = Date.now();

  assert.ok(adminSession.expiresAt >= before + PRIVILEGED_SESSION_TTL_MS);
  assert.ok(adminSession.expiresAt <= after + PRIVILEGED_SESSION_TTL_MS);
  assert.ok(fanSession.expiresAt >= before + STANDARD_SESSION_TTL_MS);
  assert.ok(fanSession.expiresAt <= after + STANDARD_SESSION_TTL_MS);
  const retainedMetadata = db.prepare("SELECT ip,ua FROM sessions WHERE user_id IN (?,?)").all(admin.id, fan.id);
  assert.equal(retainedMetadata.length, 2);
  assert.equal(retainedMetadata.every((row) => row.ip === "" && row.ua === ""), true,
    "session authorization does not retain raw network/device fingerprints");
});

test("banned accounts can authenticate only into a restricted self-service session", () => {
  const password = "restricted-account-password";
  const user = addUser({ password, banned: true });
  let session = null;
  const result = routes["POST /api/login"]({
    body: { email: user.email, password },
    ip: `restricted-login-${user.id}`,
    ua: "test",
    setSession(value) { session = value; },
  });
  assert.equal(result.user.id, user.id);
  assert.equal(result.user.isBanned, true);
  assert.ok(session?.token);
  assert.throws(
    () => routes["POST /api/me/analytics-consent"]({ user: q.userById.get(user.id), body: { enabled: true }, ip: `restricted-write-${user.id}` }),
    /banned/i,
  );
  assert.equal(routes["POST /api/me/export"]({ user: q.userById.get(user.id), ip: `restricted-export-${user.id}`, body: { password } }).profile.id, user.id);
});

test("password recovery keeps cooldown, response, and cookie behavior uniform across identities", async () => {
  const user = addUser({ banned: true });
  let cookieMutations = 0;
  const context = (email, suffix) => ({
    body: { email },
    ip: `forgot-${suffix}-${user.id}`,
    origin: "http://localhost:3000",
    setSession() { cookieMutations += 1; },
    clearSession() { cookieMutations += 1; },
  });
  const first = await routes["POST /api/forgot"](context(user.email, "first"));
  const issued = q.userById.get(user.id);
  assert.deepEqual(first, { ok: true });
  assert.ok(issued.reset_hash, "restricted accounts retain password recovery for export/deletion access");

  const second = await routes["POST /api/forgot"](context(user.email, "second"));
  const afterSecond = q.userById.get(user.id);
  assert.deepEqual(second, first);
  assert.equal(afterSecond.reset_hash, issued.reset_hash, "a distributed repeat must not invalidate the active link");
  assert.equal(afterSecond.reset_expires, issued.reset_expires);

  const unknown = await routes["POST /api/forgot"](context(`missing-${user.id}@example.test`, "missing"));
  assert.deepEqual(unknown, first);
  const malformed = await routes["POST /api/forgot"](context("not-an-email", "malformed"));
  assert.deepEqual(malformed, first);
  assert.equal(cookieMutations, 0);
});

test("password reset atomically consumes the token, revokes old sessions, and creates one replacement", () => {
  const oldPassword = "reset-success-old-password1";
  const newPassword = "reset-success-new-password2";
  const user = addUser({ password: oldPassword });
  const firstOldSession = createSession(user.id, "127.0.0.1", "old-one");
  const secondOldSession = createSession(user.id, "127.0.0.1", "old-two");
  const token = `reset-success-${user.id}`;
  const tokenHash = createHash("sha256").update(token).digest("hex");
  db.prepare("UPDATE users SET reset_hash=?,reset_expires=? WHERE id=?")
    .run(tokenHash, Date.now() + 60_000, user.id);
  let replacementSession = null;

  const result = routes["POST /api/reset"]({
    body: { token, password: newPassword },
    ip: `reset-success-${user.id}`,
    ua: "test",
    setSession(value) { replacementSession = value; },
  });

  const reset = q.userById.get(user.id);
  assert.equal(result.user.id, user.id);
  assert.equal(verifyPassword(oldPassword, reset.pass_hash), false);
  assert.equal(verifyPassword(newPassword, reset.pass_hash), true);
  assert.equal(reset.reset_hash, null);
  assert.equal(reset.reset_expires, 0);
  assert.equal(getSession(firstOldSession.token), null);
  assert.equal(getSession(secondOldSession.token), null);
  assert.equal(getSession(replacementSession?.token)?.user_id, user.id);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM sessions WHERE user_id=?").get(user.id).count, 1);
  assert.throws(() => routes["POST /api/reset"]({
    body: { token, password: "reset-replay-password3" },
    ip: `reset-replay-${user.id}`,
    ua: "test",
    setSession() {},
  }), (error) => error?.status === 400);
});

test("password reset rolls back token consumption and password change when prior-session revocation fails", () => {
  const oldPassword = "reset-rollback-old-password1";
  const newPassword = "reset-rollback-new-password2";
  const user = addUser({ password: oldPassword });
  const existingSession = createSession(user.id, "127.0.0.1", "existing-session");
  const token = `reset-revoke-failure-${user.id}`;
  const tokenHash = createHash("sha256").update(token).digest("hex");
  db.prepare("UPDATE users SET reset_hash=?,reset_expires=? WHERE id=?")
    .run(tokenHash, Date.now() + 60_000, user.id);
  db.exec(`CREATE TRIGGER auth_security_reset_revoke_failure
    BEFORE DELETE ON sessions WHEN OLD.user_id='${user.id}'
    BEGIN SELECT RAISE(ABORT, 'forced reset revoke failure'); END`);
  let replacementSession = null;
  try {
    assert.throws(() => routes["POST /api/reset"]({
      body: { token, password: newPassword },
      ip: `reset-revoke-failure-${user.id}`,
      ua: "test",
      setSession(value) { replacementSession = value; },
    }), /forced reset revoke failure/);
  } finally {
    db.exec("DROP TRIGGER auth_security_reset_revoke_failure");
  }

  const unchanged = q.userById.get(user.id);
  assert.equal(verifyPassword(oldPassword, unchanged.pass_hash), true);
  assert.equal(verifyPassword(newPassword, unchanged.pass_hash), false);
  assert.equal(unchanged.reset_hash, tokenHash);
  assert.equal(getSession(existingSession.token)?.user_id, user.id);
  assert.equal(replacementSession, null);
});

test("password reset rolls back revoked sessions when replacement-session creation fails", () => {
  const oldPassword = "reset-session-old-password1";
  const newPassword = "reset-session-new-password2";
  const user = addUser({ password: oldPassword });
  const existingSession = createSession(user.id, "127.0.0.1", "existing-session");
  const token = `reset-session-failure-${user.id}`;
  const tokenHash = createHash("sha256").update(token).digest("hex");
  db.prepare("UPDATE users SET reset_hash=?,reset_expires=? WHERE id=?")
    .run(tokenHash, Date.now() + 60_000, user.id);
  db.exec(`CREATE TRIGGER auth_security_reset_insert_failure
    BEFORE INSERT ON sessions WHEN NEW.user_id='${user.id}'
    BEGIN SELECT RAISE(ABORT, 'forced replacement session failure'); END`);
  let replacementSession = null;
  try {
    assert.throws(() => routes["POST /api/reset"]({
      body: { token, password: newPassword },
      ip: `reset-session-failure-${user.id}`,
      ua: "test",
      setSession(value) { replacementSession = value; },
    }), /forced replacement session failure/);
  } finally {
    db.exec("DROP TRIGGER auth_security_reset_insert_failure");
  }

  const unchanged = q.userById.get(user.id);
  assert.equal(verifyPassword(oldPassword, unchanged.pass_hash), true);
  assert.equal(verifyPassword(newPassword, unchanged.pass_hash), false);
  assert.equal(unchanged.reset_hash, tokenHash);
  assert.equal(getSession(existingSession.token)?.user_id, user.id);
  assert.equal(replacementSession, null);
});

test("signup never derives the public handle from a private email local-part", () => {
  const distinctive = `legal.name.work-id-${Date.now()}`;
  let session = null;
  const email = `${distinctive}@example.test`;
  const result = routes["POST /api/signup"]({
    body: {
      name: "Private Handle Test",
      email,
      password: "private-handle-password1",
      termsVersion: "2026-08",
    },
    ip: `signup-private-handle-${distinctive}`,
    ua: "test",
    setSession(value) { session = value; },
  });
  const created = q.userByEmail.get(email);
  assert.deepEqual(result, { ok: true, pending: true });
  assert.equal(created.handle.includes("legal"), false);
  assert.equal(created.handle.includes("work"), false);
  assert.match(created.handle, /^pitfan_[a-f0-9]{8}/u);
  assert.equal(session, null, "signup cannot reveal account existence through a Set-Cookie difference");
});

test("rate-limit capacity rejects new identities without clearing live limits", () => {
  resetRateLimitsForTests();
  try {
    fillRateLimitBuckets("capacity-live", RATE_LIMIT_BUCKET_CAPACITY, { max: 2 });

    assert.equal(rateLimit("capacity-overflow", 2, RATE_LIMIT_TEST_WINDOW_MS), false);
    assert.equal(rateLimit("capacity-live:0", 2, RATE_LIMIT_TEST_WINDOW_MS), true);
    assert.equal(rateLimit("capacity-live:0", 2, RATE_LIMIT_TEST_WINDOW_MS), false);
    assert.equal(rateLimit("capacity-overflow", 2, RATE_LIMIT_TEST_WINDOW_MS), false);
  } finally {
    resetRateLimitsForTests();
  }
});

test("rate-limit capacity prunes expired identities before rejecting a new one", () => {
  resetRateLimitsForTests();
  const realNow = Date.now;
  let now = realNow();
  Date.now = () => now;
  try {
    assert.equal(rateLimit("capacity-expired", 1, 1_000), true);
    now += 1_001;
    fillRateLimitBuckets("capacity-after-expiry", RATE_LIMIT_BUCKET_CAPACITY - 1);

    assert.equal(rateLimit("capacity-reclaimed", 1, RATE_LIMIT_TEST_WINDOW_MS), true);
    assert.equal(rateLimit("capacity-after-expiry:0", 1, RATE_LIMIT_TEST_WINDOW_MS), false);
  } finally {
    Date.now = realNow;
    resetRateLimitsForTests();
  }
});

test("multi-bucket reservations reject capacity overflow atomically", () => {
  resetRateLimitsForTests();
  try {
    fillRateLimitBuckets("reservation-capacity-live", RATE_LIMIT_BUCKET_CAPACITY - 1, { max: 2 });
    const reservation = reserveRateLimits([
      { key: "reservation-capacity-a", max: 1, windowMs: RATE_LIMIT_TEST_WINDOW_MS },
      { key: "reservation-capacity-b", max: 1, windowMs: RATE_LIMIT_TEST_WINDOW_MS },
    ]);

    assert.equal(reservation, null);
    assert.equal(
      rateLimit("reservation-capacity-a", 1, RATE_LIMIT_TEST_WINDOW_MS),
      true,
      "the denied reservation must not consume or create its first bucket",
    );
    assert.equal(rateLimit("reservation-capacity-b", 1, RATE_LIMIT_TEST_WINDOW_MS), false);
    assert.equal(
      rateLimit("reservation-capacity-live:0", 2, RATE_LIMIT_TEST_WINDOW_MS),
      true,
      "capacity rejection must not alter an existing bucket",
    );
  } finally {
    resetRateLimitsForTests();
  }
});

test("auth limits stay bound to the IP even when the caller supplies rotating account identities", () => {
  resetRateLimitsForTests();
  const sharedIp = `signup-rotation-${Date.now()}`;
  let currentUser = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const email = `rotation-${attempt}-${Date.now()}@example.test`;
    const result = routes["POST /api/signup"]({
      user: currentUser,
      body: {
        name: `Rotation User ${attempt}`,
        email,
        password: "rotation-test-password1",
        termsVersion: "2026-08",
      },
      ip: sharedIp,
      ua: "test",
      setSession() { throw new Error("signup must not issue a session"); },
    });
    assert.deepEqual(result, { ok: true, pending: true });
    currentUser = q.userByEmail.get(email);
  }
  assert.throws(
    () => routes["POST /api/signup"]({
      user: currentUser,
      body: {
        name: "Rotation User Six",
        email: `rotation-six-${Date.now()}@example.test`,
        password: "rotation-test-password1",
        termsVersion: "2026-08",
      },
      ip: sharedIp,
      ua: "test",
      setSession() {},
    }),
    (error) => error?.status === 429 && error?.code === "RATE_LIMITED",
  );
});

test("signup returns the same body and cookie behavior for new and registered addresses", () => {
  resetRateLimitsForTests();
  const email = `signup-enumeration-${Date.now()}@example.test`;
  const body = {
    name: "Enumeration Test",
    email,
    password: "enumeration-password1",
    termsVersion: "2026-08",
  };
  let newSession = null;
  const first = routes["POST /api/signup"]({ body, ip: `signup-enumeration-new-${Date.now()}`, ua: "test", setSession(value) { newSession = value; } });
  const originalHash = q.userByEmail.get(email).pass_hash;
  let existingSession = null;
  const second = routes["POST /api/signup"]({ body: { ...body, password: "different-password1" }, ip: `signup-enumeration-existing-${Date.now()}`, ua: "test", setSession(value) { existingSession = value; } });
  assert.deepEqual(first, { ok: true, pending: true });
  assert.deepEqual(second, first);
  assert.equal(newSession, null);
  assert.equal(existingSession, null);
  assert.equal(q.userByEmail.get(email).pass_hash, originalHash, "a duplicate request cannot replace the existing credential");
});

test("promotion cannot turn an existing long member cookie into a long-lived staff cookie", () => {
  const user = addUser({ role: "fan" });
  const session = createSession(user.id, "127.0.0.1", "test");
  db.prepare("UPDATE sessions SET created_at=? WHERE user_id=?")
    .run(Date.now() - PRIVILEGED_SESSION_TTL_MS - 1_000, user.id);
  db.prepare("UPDATE users SET role='admin' WHERE id=?").run(user.id);

  assert.equal(getSession(session.token), null);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM sessions WHERE user_id=?").get(user.id).count, 0);
});

test("nonexistent-user password checks still execute a real scrypt verification path", () => {
  const stored = hashPassword("correct-password");
  assert.equal(verifyPasswordForUser("correct-password", stored), true);
  assert.equal(verifyPasswordForUser("wrong-password", stored), false);
  assert.equal(verifyPasswordForUser("any-password", null), false);
});

test("production uses a host-only high-priority cookie while development keeps its legacy name", () => {
  const expiresAt = Date.now() + 60_000;
  const production = sessionCookie("prod-token", expiresAt, true);
  const development = sessionCookie("dev-token", expiresAt, false);

  assert.equal(sessionCookieName(true), PRODUCTION_COOKIE);
  assert.equal(sessionCookieName(false), COOKIE);
  assert.match(production, /^__Host-pit_session=prod-token;/);
  assert.match(production, /; Path=\//);
  assert.match(production, /; HttpOnly/);
  assert.match(production, /; SameSite=Lax/);
  assert.match(production, /; Secure/);
  assert.match(production, /; Priority=High/);
  assert.doesNotMatch(production, /; Domain=/i);
  assert.match(development, /^pit_session=dev-token;/);
  assert.doesNotMatch(development, /; Secure/);
});

test("production login and logout clear the legacy cookie without accepting it as active", () => {
  const loginHeaders = sessionCookieHeaders("new-token", Date.now() + 60_000, true);
  const logoutHeaders = clearSessionCookies(true);
  assert.equal(loginHeaders.length, 2);
  assert.match(loginHeaders[0], /^__Host-pit_session=new-token;/);
  assert.match(loginHeaders[1], /^pit_session=;/);
  assert.match(loginHeaders[1], /Max-Age=0/);
  assert.equal(logoutHeaders.length, 2);
  assert.match(logoutHeaders[0], /^__Host-pit_session=;/);
  assert.match(logoutHeaders[1], /^pit_session=;/);

  const parsed = parseCookies("pit_session=legacy-token; __Host-pit_session=active-token");
  assert.equal(parsed[COOKIE], "legacy-token");
  assert.equal(parsed[PRODUCTION_COOKIE], "active-token");
  assert.equal(parsed[sessionCookieName(true)], "active-token");
});
