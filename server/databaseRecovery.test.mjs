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
