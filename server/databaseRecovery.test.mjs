import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertDatabaseRecoveryReady, fenceBackupSnapshot, prepareRecoveryDatabase, RESTORE_GATE_KEY } from "./databaseRecovery.js";
import { prepareOfflineRestore } from "../scripts/prepare-db-restore.mjs";
import { startProduction } from "../scripts/start-production.mjs";
import { PIT_SQLITE_APPLICATION_ID } from "./dataDirectory.js";
import { createMediaApiService } from "./features/mediaApi/mediaApiService.js";
import { MEDIA_API_SCOPES, secretHash } from "./features/mediaApi/mediaApiPolicy.js";
import { createApiGrantService, ensureApiGrantSchema } from "./features/apiGrants/apiGrantService.js";
import { CATALOG_SCOPES } from "./features/catalogApi/catalogApiPolicy.js";
import { catalogAudit, ensureCatalogWorkSchema } from "./features/catalogResearch/catalogWorkQueue.js";
import { ownerIdentity, storeOwnerIdentity } from "./ownerIdentity.js";
import { ensureSignupReservationsSchema, prepareSignupReservation, consumeSignupReservation,
  cancelSignupReservation } from "./features/accountOnboarding/signupReservations.js";

function fixture(path = ":memory:") {
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA application_id=${PIT_SQLITE_APPLICATION_ID}; PRAGMA foreign_keys=ON;
    CREATE TABLE app_meta (key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE schema_version (version INTEGER NOT NULL); INSERT INTO schema_version VALUES(1);
    CREATE TABLE users (id TEXT PRIMARY KEY,pass_hash TEXT,reset_hash TEXT,reset_expires INTEGER,
      email_verify_hash TEXT,email_verify_expires INTEGER,signup_cancel_hash TEXT);
    INSERT INTO users VALUES('member','password-record','old-reset',9000,'old-verify',9000,'old-cancel');
    CREATE TABLE sessions (token_hash TEXT PRIMARY KEY,user_id TEXT REFERENCES users(id));
    INSERT INTO sessions VALUES('old-session','member');
    CREATE TABLE linked_account_session_grants (token_hash TEXT REFERENCES sessions(token_hash));
    INSERT INTO linked_account_session_grants VALUES('old-session');
    CREATE TABLE email_verification_receipts (token_hash TEXT); INSERT INTO email_verification_receipts VALUES('old-verify');
    CREATE TABLE email_queue (id TEXT); INSERT INTO email_queue VALUES('old-mail');
    CREATE TABLE owner_approval_requests (id TEXT PRIMARY KEY,status TEXT,token_hash TEXT,decided_at INTEGER);
    INSERT INTO owner_approval_requests VALUES ('pending','pending','old-approval',NULL),('decided','approved',NULL,3000);
    CREATE TABLE owner_approval_receipts (id TEXT PRIMARY KEY); INSERT INTO owner_approval_receipts VALUES('immutable-history');
    CREATE TABLE posts (id TEXT PRIMARY KEY,user_id TEXT REFERENCES users(id)); INSERT INTO posts VALUES('post','member');
    CREATE TABLE artists (id TEXT PRIMARY KEY); INSERT INTO artists VALUES('artist');
    CREATE TABLE tour_dates (id TEXT); CREATE TABLE artist_profiles (id TEXT); CREATE TABLE venue_reviews (id TEXT);`);
  return db;
}
const reviews = { privacyReplayReference: "incident-2026-09/privacy", credentialReviewReference: "incident-2026-09/auth", at: 5000 };

function apiCapabilityFixture() {
  const db = fixture();
  db.exec(`ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'admin';
    ALTER TABLE users ADD COLUMN email_verified_at INTEGER DEFAULT 1000;
    ALTER TABLE users ADD COLUMN is_banned INTEGER DEFAULT 0;
    ALTER TABLE users ADD COLUMN suspended_until INTEGER;
    ALTER TABLE users ADD COLUMN dormant_at INTEGER;`);
  storeOwnerIdentity(db, ownerIdentity("member@example.test", "member", 1000));
  const media = createMediaApiService({ database: db, now: () => reviews.at, env: { PIT_MEDIA_API_ENABLED: "true" } });
  const paired = media.issuePairing({ ownerId: "member", actorType: "assistant", actorLabel: "Synthetic restore",
    scopes: [...MEDIA_API_SCOPES] });
  const grant = media.exchangePairing({ pairingCode: paired.pairingCode });
  const pending = media.issuePairing({ ownerId: "member", actorType: "human", actorLabel: "Synthetic pending restore",
    scopes: [...MEDIA_API_SCOPES] });
  ensureApiGrantSchema(db); ensureCatalogWorkSchema(db);
  const catalogToken = "synthetic_restore_catalog_not_a_real_credential";
  db.prepare(`INSERT INTO api_grants(id,audience,owner_id,actor_type,actor_label,scopes,token_hash,status,issued_at,expires_at)
    VALUES ('restore-catalog','pit-catalog-v1','member','assistant','Synthetic restore',?,?,'active',1000,9000)`)
    .run(JSON.stringify(CATALOG_SCOPES), secretHash(catalogToken));
  db.prepare(`INSERT INTO media_api_idempotency
    (grant_id,operation,idempotency_key,payload_hash,status,response_json,created_at,updated_at,expires_at)
    VALUES (?,'news.create','synthetic-history','synthetic-hash','completed','{"ok":true}',1000,1000,9000)`).run(grant.grantId);
  db.exec(`INSERT INTO catalog_api_receipts VALUES
    ('restore-catalog','claim','synthetic-history','synthetic-hash','{"ok":true}',1000,9000);`);
  catalogAudit(db, { actorType: "owner", actorLabel: "owner", action: "synthetic-history", at: 1000 });
  const catalog = createApiGrantService({ database: db, now: () => reviews.at });
  const history = () => Object.fromEntries(["media_api_audit", "media_api_idempotency", "catalog_work_audit", "catalog_api_receipts"]
    .map(table => [table, db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));
  return { db, media, catalog, grant, pending, history,
    mediaAuthorization: `Bearer ${grant.accessToken}`, catalogAuthorization: `Bearer ${catalogToken}` };
}

test("restore preparation revokes every scoped API capability while preserving audit and receipt history", () => {
  const f = apiCapabilityFixture();
  try {
    for (const scope of MEDIA_API_SCOPES) assert.doesNotThrow(() => f.media.authorize(f.mediaAuthorization, scope));
    for (const scope of CATALOG_SCOPES) assert.doesNotThrow(() => f.catalog.authorize(f.catalogAuthorization, scope));
    const history = f.history();
    fenceBackupSnapshot(f.db);
    const counts = prepareRecoveryDatabase(f.db, reviews);
    assert.equal(counts.mediaApiGrants, 1); assert.equal(counts.apiGrants, 1); assert.equal(counts.mediaApiPairings, 1);
    assert.doesNotThrow(() => assertDatabaseRecoveryReady(f.db));
    for (const scope of MEDIA_API_SCOPES) assert.throws(() => f.media.authorize(f.mediaAuthorization, scope), { code: "AUTH_INVALID" });
    for (const scope of CATALOG_SCOPES) assert.throws(() => f.catalog.authorize(f.catalogAuthorization, scope), { code: "AUTH_INVALID" });
    assert.throws(() => f.media.exchangePairing({ pairingCode: f.pending.pairingCode }), { code: "AUTH_INVALID" });
    assert.equal(f.db.prepare("SELECT token_hash FROM media_api_grants WHERE id=?").get(f.grant.grantId).token_hash, null);
    assert.equal(f.db.prepare("SELECT status FROM media_api_pairings WHERE id=?").get(f.pending.pairingId).status, "revoked");
    assert.deepEqual(f.history(), history);
    assert.equal(f.db.prepare("SELECT count(*) n FROM posts").get().n, 1);
    assert.equal(f.db.prepare("SELECT count(*) n FROM sessions").get().n, 0);
  } finally { f.db.close(); }
});

test("repeated recovery leaves terminal API state and prior revocation timestamps intact", () => {
  const f = apiCapabilityFixture();
  try {
    f.db.prepare("UPDATE media_api_grants SET status='revoked',token_hash=NULL,revoked_at=2000,updated_at=2000 WHERE id=?").run(f.grant.grantId);
    f.db.exec("UPDATE api_grants SET status='revoked',revoked_at=2000; UPDATE media_api_pairings SET status='expired' WHERE status='pending';");
    const state = () => ["media_api_grants", "api_grants", "media_api_pairings"].map(table => f.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all());
    const before = state(), history = f.history();
    for (const at of [5000, 6000]) {
      const counts = prepareRecoveryDatabase(f.db, { ...reviews, at });
      assert.equal(counts.mediaApiGrants, 0); assert.equal(counts.apiGrants, 0); assert.equal(counts.mediaApiPairings, 0);
      assert.deepEqual(state(), before); assert.deepEqual(f.history(), history);
    }
  } finally { f.db.close(); }
});

test("a later recovery failure rolls back API revocation, session cleanup and the reviewed gate together", () => {
  const f = apiCapabilityFixture();
  try {
    fenceBackupSnapshot(f.db);
    const history = f.history();
    f.db.exec("CREATE TRIGGER fail_restore_mail BEFORE DELETE ON email_queue BEGIN SELECT RAISE(ABORT,'synthetic restore failure'); END;");
    assert.throws(() => prepareRecoveryDatabase(f.db, reviews), /synthetic restore failure/);
    assert.equal(f.db.prepare("SELECT count(*) n FROM sessions").get().n, 1);
    assert.equal(f.db.prepare("SELECT status FROM media_api_pairings WHERE id=?").get(f.pending.pairingId).status, "pending");
    for (const scope of MEDIA_API_SCOPES) assert.doesNotThrow(() => f.media.authorize(f.mediaAuthorization, scope));
    for (const scope of CATALOG_SCOPES) assert.doesNotThrow(() => f.catalog.authorize(f.catalogAuthorization, scope));
    assert.deepEqual(f.history(), history);
    assert.throws(() => assertDatabaseRecoveryReady(f.db), { code: "DATABASE_RESTORE_REVIEW_REQUIRED" });
  } finally { f.db.close(); }
});

function signupRecoveryFixture() {
  const db = fixture();
  db.exec("ALTER TABLE users ADD COLUMN email TEXT;");
  ensureSignupReservationsSchema(db);
  const reservations = {};
  db.exec("BEGIN IMMEDIATE");
  for (const status of ["pending", "occupied", "revoked"]) {
    reservations[status] = prepareSignupReservation(db, {
      payload: { email: `${status}@example.test`, passwordHash: "synthetic-staged-password" },
      cancelToken: `synthetic-cancel-${status}`, at: 1000,
    });
    if (status !== "pending") db.prepare("UPDATE signup_reservations SET status=?,payload='{}' WHERE token_hash=?")
      .run(status, reservations[status].tokenHash);
  }
  db.exec("COMMIT");
  return { db, reservations, terminalRows: () => db.prepare("SELECT * FROM signup_reservations WHERE status<>'pending' ORDER BY token_hash").all() };
}

test("recovery removes guest signup capabilities before account creation and preserves terminal outcomes", () => {
  const f = signupRecoveryFixture();
  try {
    const pending = f.db.prepare("SELECT * FROM signup_reservations WHERE token_hash=?").get(f.reservations.pending.tokenHash);
    assert.equal(pending.actor_id, null); assert.equal(pending.session_hash, null);
    const consume = () => consumeSignupReservation(f.db, {
      tokenHash: f.reservations.pending.tokenHash, at: reviews.at, sessionTtlForRole: () => 10000,
      createAccount(payload) {
        f.db.prepare("INSERT INTO users(id,email,pass_hash) VALUES ('restored-signup',?,?)").run(payload.email, payload.passwordHash);
        return { id: "restored-signup" };
      },
    });
    // Prove this exact guest token can create an account, then roll back the
    // control operation so recovery receives the original pending snapshot.
    f.db.exec("BEGIN IMMEDIATE");
    assert.equal(consume().user.id, "restored-signup");
    f.db.exec("ROLLBACK");
    const terminalRows = f.terminalRows();
    fenceBackupSnapshot(f.db);
    assert.equal(prepareRecoveryDatabase(f.db, reviews).signupReservations, 1);
    assert.doesNotThrow(() => assertDatabaseRecoveryReady(f.db));
    f.db.exec("BEGIN IMMEDIATE");
    assert.equal(consume(), null);
    f.db.exec("COMMIT");
    assert.equal(cancelSignupReservation(f.db, secretHash("synthetic-cancel-pending")), false);
    assert.equal(f.db.prepare("SELECT count(*) n FROM users WHERE id='restored-signup'").get().n, 0);
    assert.deepEqual(f.terminalRows(), terminalRows);
    assert.equal(prepareRecoveryDatabase(f.db, { ...reviews, at: 6000 }).signupReservations, 0);
    assert.deepEqual(f.terminalRows(), terminalRows);
  } finally { f.db.close(); }
});

test("failed recovery restores pending guest signup capabilities and leaves the snapshot quarantined", () => {
  const f = signupRecoveryFixture();
  try {
    fenceBackupSnapshot(f.db);
    const before = f.db.prepare("SELECT * FROM signup_reservations ORDER BY token_hash").all();
    f.db.exec("CREATE TRIGGER fail_signup_restore BEFORE DELETE ON email_queue BEGIN SELECT RAISE(ABORT,'synthetic signup restore failure'); END;");
    assert.throws(() => prepareRecoveryDatabase(f.db, reviews), /synthetic signup restore failure/);
    assert.deepEqual(f.db.prepare("SELECT * FROM signup_reservations ORDER BY token_hash").all(), before);
    assert.equal(f.db.prepare("SELECT count(*) n FROM sessions").get().n, 1);
    assert.throws(() => assertDatabaseRecoveryReady(f.db), { code: "DATABASE_RESTORE_REVIEW_REQUIRED" });
  } finally { f.db.close(); }
});

test("live database remains ready; new snapshot is fenced until reviewed", () => {
  const db = fixture();
  try {
    assert.doesNotThrow(() => assertDatabaseRecoveryReady(db));
    fenceBackupSnapshot(db, 4000);
    assert.throws(() => assertDatabaseRecoveryReady(db), { code: "DATABASE_RESTORE_REVIEW_REQUIRED" });
    prepareRecoveryDatabase(db, reviews);
    assert.doesNotThrow(() => assertDatabaseRecoveryReady(db));
    fenceBackupSnapshot(db, 6000);
    assert.throws(() => assertDatabaseRecoveryReady(db), /quarantined/);
  } finally { db.close(); }
});

test("restore preparation invalidates all old bearer capabilities without deleting content", () => {
  const db = fixture();
  try {
    fenceBackupSnapshot(db);
    const counts = prepareRecoveryDatabase(db, reviews);
    assert.equal(counts.sessions, 1);
    for (const table of ["sessions", "linked_account_session_grants", "email_verification_receipts", "email_queue"]) {
      assert.equal(db.prepare(`SELECT count(*) AS c FROM ${table}`).get().c, 0);
    }
    const user = db.prepare("SELECT * FROM users").get();
    assert.equal(user.pass_hash, "password-record", "operator must reconcile password changes in the offline clone");
    assert.equal(user.reset_hash, null); assert.equal(user.email_verify_hash, null);
    assert.equal(user.signup_cancel_hash, null); assert.equal(user.reset_expires, 0);
    assert.equal(counts.ownerApprovalRequests, 1);
    assert.deepEqual({ ...db.prepare("SELECT status,token_hash,decided_at FROM owner_approval_requests WHERE id='pending'").get() },
      { status: "expired", token_hash: null, decided_at: 5000 });
    assert.equal(db.prepare("SELECT decided_at FROM owner_approval_requests WHERE id='decided'").get().decided_at, 3000);
    assert.equal(db.prepare("SELECT id FROM owner_approval_receipts").get().id, "immutable-history");
    assert.equal(db.prepare("SELECT count(*) AS c FROM posts").get().c, 1);
    assert.deepEqual(prepareRecoveryDatabase(db, reviews).sessions, 0, "safe to repeat preparation");
  } finally { db.close(); }
});

test("missing review or malformed marker never grants restore approval", () => {
  const db = fixture();
  try {
    fenceBackupSnapshot(db);
    assert.throws(() => prepareRecoveryDatabase(db, {}), /Privacy replay/);
    assert.equal(db.prepare("SELECT count(*) AS c FROM sessions").get().c, 1);
    db.prepare("UPDATE app_meta SET value=? WHERE key=?").run('{"version":1,"state":"reviewed"}', RESTORE_GATE_KEY);
    assert.throws(() => assertDatabaseRecoveryReady(db), /quarantined/);
    for (const change of [ { privacyReplayReference: {} }, { credentialReviewReference: ["fake-ref"] },
      { privacyReplayReference: " " }, { credentialReviewReference: "bad reference" }, { preparedAt: -1 }, { preparedAt: 0 } ]) {
      db.prepare("UPDATE app_meta SET value=? WHERE key=?").run(JSON.stringify({ version: 1, state: "reviewed",
        preparedAt: 5000, privacyReplayReference: "privacy-ref", credentialReviewReference: "credential-ref", ...change }), RESTORE_GATE_KEY);
      assert.throws(() => assertDatabaseRecoveryReady(db), /quarantined/);
    }
  } finally { db.close(); }
});

test("failed preparation rolls back invalidation and does not approve the copy", () => {
  const db = fixture();
  try {
    fenceBackupSnapshot(db);
    db.exec("CREATE TRIGGER fail_mail_cleanup BEFORE DELETE ON email_queue BEGIN SELECT RAISE(ABORT,'fixture cleanup failure'); END;");
    assert.throws(() => prepareRecoveryDatabase(db, reviews), /fixture cleanup failure/);
    assert.equal(db.prepare("SELECT count(*) AS c FROM sessions").get().c, 1);
    assert.throws(() => assertDatabaseRecoveryReady(db), /quarantined/);
  } finally { db.close(); }
});

test("quarantined restore cannot start a production server or run startup work", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pit-restore-gate-"));
  try {
    const db = fixture(join(dir, "pit.db")); fenceBackupSnapshot(db); db.close();
    let started = false;
    await assert.rejects(startProduction({ env: { NODE_ENV: "production", PIT_DATA_DIR: dir },
      spawn: () => { started = true; return { status: 0 }; },
      loadServer: async () => { started = true; } }), /quarantined/);
    assert.equal(started, false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("offline restore creates only a new sanitized copy and preserves source", () => {
  const dir = mkdtempSync(join(tmpdir(), "pit-restore-copy-"));
  try {
    const source = join(dir, "snapshot.db"), output = join(dir, "prepared.db");
    const db = fixture(source); fenceBackupSnapshot(db); db.close();
    assert.equal(prepareOfflineRestore({ source, output, ...reviews, env: {} }).sessions, 1);
    const original = new DatabaseSync(source, { readOnly: true });
    const prepared = new DatabaseSync(output, { readOnly: true });
    try {
      assert.equal(original.prepare("SELECT count(*) AS c FROM sessions").get().c, 1);
      assert.equal(prepared.prepare("SELECT count(*) AS c FROM sessions").get().c, 0);
      assert.throws(() => assertDatabaseRecoveryReady(original), /quarantined/);
      assert.doesNotThrow(() => assertDatabaseRecoveryReady(prepared));
    } finally { original.close(); prepared.close(); }
    assert.throws(() => prepareOfflineRestore({ source, output, ...reviews, env: {} }), /new offline output/);
    assert.throws(() => prepareOfflineRestore({ source, output: source, ...reviews, env: {} }), /new offline output/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("offline restore rejects configured live input and missing live output through directory aliases", () => {
  const dir = mkdtempSync(join(tmpdir(), "pit-restore-alias-"));
  try {
    const liveDir = join(dir, "live"), alias = join(dir, "alias");
    mkdirSync(liveDir); symlinkSync(liveDir, alias, process.platform === "win32" ? "junction" : "dir");
    const source = join(dir, "snapshot.db"), live = join(liveDir, "pit.db"), offline = join(dir, "prepared.db");
    const db = fixture(source); fenceBackupSnapshot(db); db.close();
    assert.throws(() => prepareOfflineRestore({ source, output: live, ...reviews, env: { PIT_DATA_DIR: alias } }), /new offline output/);
    assert.equal(existsSync(live), false);
    const active = fixture(live); active.close();
    assert.throws(() => prepareOfflineRestore({ source: live, output: offline, ...reviews, env: { PIT_DATA_DIR: alias } }), /new offline output/);
    assert.equal(existsSync(offline), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("offline restore rejects a dangling output link before SQLite can create its target", t => {
  const dir = mkdtempSync(join(tmpdir(), "pit-restore-link-"));
  try {
    const source = join(dir, "snapshot.db"), target = join(dir, "must-not-create.db"), output = join(dir, "prepared.db");
    const db = fixture(source); fenceBackupSnapshot(db); db.close();
    try { symlinkSync(target, output, "file"); }
    catch (error) {
      if (process.platform === "win32" && ["EPERM", "EACCES"].includes(error.code)) { t.skip("Host does not permit file symlinks"); return; }
      throw error;
    }
    assert.throws(() => prepareOfflineRestore({ source, output, ...reviews, env: {} }), /new offline output/);
    assert.equal(existsSync(target), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
