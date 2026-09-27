import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { backupSourceManifest, backupTableCounts, verifyBackupSnapshot } from "../scripts/backup-db-verification.mjs";
import { assertExistingProductionDatabase } from "./dataDirectory.js";
import { registerPitSqliteFunctions } from "./sqliteFunctions.js";
import { assertDatabaseRecoveryReady, RESTORE_GATE_KEY } from "./databaseRecovery.js";
import { prepareOfflineRestore } from "../scripts/prepare-db-restore.mjs";

function runFixture(directory, script) {
  return spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: process.cwd(), encoding: "utf8", windowsHide: true,
    env: { ...process.env, NODE_ENV: "test", PIT_DATA_DIR: directory, PIT_ALLOW_EMPTY_DB_BOOTSTRAP: "false" },
  });
}

const seedMemberGraph = `
  import { db } from './server/db.js';
  if (db.prepare('PRAGMA foreign_keys').get().foreign_keys !== 1) throw new Error('foreign keys must be enabled');
  if (db.prepare('PRAGMA busy_timeout').get().timeout !== 5000) throw new Error('writer contention must be bounded');
  if (db.prepare('PRAGMA synchronous').get().synchronous !== 2) throw new Error('WAL commits must use FULL durability');
  db.exec("BEGIN IMMEDIATE");
  db.prepare("INSERT INTO users (id,email,name,handle,pass_hash,extras,created_at) VALUES (?,?,?,?,?,?,?)")
    .run('durable_member','member@example.test','Durable member','durable_member','fixture-hash',JSON.stringify({theme:'night'}),1000);
  db.prepare("INSERT INTO users (id,email,name,handle,pass_hash,created_at) VALUES (?,?,?,?,?,?)")
    .run('durable_friend','friend@example.test','Durable friend','durable_friend','fixture-hash',1000);
  db.exec(\`INSERT INTO posts (id,user_id,artist,venue,date,overall,review,created_at)
      VALUES ('durable_post','durable_member','Durable Band','Durable Hall','2026-09-08',5,'A lasting memory',1000);
    INSERT INTO comments (id,post_id,user_id,text,created_at)
      VALUES ('durable_comment','durable_post','durable_friend','A lasting comment',1001);
    INSERT INTO likes VALUES ('durable_post','durable_friend');
    INSERT INTO follows VALUES ('durable_friend','durable_member');
    INSERT INTO dms (id,from_id,to_id,text,created_at)
      VALUES ('durable_message','durable_member','durable_friend','A lasting message',1002);
    INSERT INTO ratings VALUES ('durable_member','artist','durable band',5);
    INSERT INTO going (user_id,concert_key,artist,venue,date,created_at)
      VALUES ('durable_member','durable-show','Durable Band','Durable Hall','2026-09-10',1003);\`);
  db.exec("COMMIT");
`;

function assertMemberGraph(database) {
  assert.equal(database.prepare("SELECT review FROM posts WHERE id='durable_post'").get().review, "A lasting memory");
  assert.equal(database.prepare("SELECT text FROM comments WHERE id='durable_comment'").get().text, "A lasting comment");
  assert.equal(database.prepare("SELECT text FROM dms WHERE id='durable_message'").get().text, "A lasting message");
  for (const table of ["likes", "follows", "ratings", "going"]) {
    assert.equal(database.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n, 1, table);
  }
  assert.equal(JSON.parse(database.prepare("SELECT extras FROM users WHERE id='durable_member'").get().extras).theme, "night");
  assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
}

test("committed member data survives a killed WAL writer while unfinished writes roll back", () => {
  const directory = mkdtempSync(join(tmpdir(), "pit-durability-crash-"));
  try {
    const killed = runFixture(directory, seedMemberGraph + `
      db.exec("BEGIN IMMEDIATE");
      db.exec("UPDATE posts SET review='Uncommitted change' WHERE id='durable_post'");
      db.exec("DELETE FROM comments WHERE id='durable_comment'");
      process.kill(process.pid, 'SIGKILL');
    `);
    assert.notEqual(killed.status, 0, "the fixture is intentionally killed without closing SQLite");
    const database = new DatabaseSync(join(directory, "pit.db"));
    registerPitSqliteFunctions(database);
    try {
      assert.equal(database.prepare("PRAGMA journal_mode").get().journal_mode, "wal");
      assert.equal(database.prepare("PRAGMA synchronous").get().synchronous, 2, "FULL is retained for committed WAL durability");
      assertMemberGraph(database);
    } finally { database.close(); }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("a real-schema backup preserves the member graph across verification and reviewed cold reopen", () => {
  const root = mkdtempSync(join(tmpdir(), "pit-durability-restore-"));
  const dataDirectory = join(root, "data");
  const backupDirectory = join(root, "backups");
  const rawDirectory = join(root, "raw-restore");
  const reviewedDirectory = join(root, "reviewed-restore");
  mkdirSync(dataDirectory);
  mkdirSync(rawDirectory);
  mkdirSync(reviewedDirectory);
  try {
    const seeded = runFixture(dataDirectory, seedMemberGraph + `
      db.exec("BEGIN IMMEDIATE");
      db.exec(\`UPDATE users SET reset_hash='old-reset',reset_expires=9000,
          email_verify_hash='old-verify',email_verify_expires=9000,signup_cancel_hash='old-cancel'
          WHERE id='durable_member';
        INSERT INTO sessions (token_hash,user_id,created_at,expires_at)
          VALUES ('old-session','durable_member',1000,9000);
        INSERT INTO email_verification_receipts (token_hash,user_id,email_hash,verified_at,expires_at)
          VALUES ('old-verification','durable_member','fixture-email-hash',1000,9000);
        INSERT INTO email_campaigns (id,name,subject,body,created_at,updated_at)
          VALUES ('durable-campaign','Fixture','Fixture','Fixture body',1000,1000);
        INSERT INTO email_queue (campaign_id,user_id,to_email,created_at)
          VALUES ('durable-campaign','durable_member','member@example.test',1000);
        INSERT INTO owner_approval_requests (id,kind,safe_summary,payload,payload_hash,token_hash,requested_at,expires_at)
          VALUES ('old-approval','security_release','Fixture','{}','fixture-payload','old-owner-token',1000,9000);
        INSERT INTO owner_approval_receipts (id,kind,decision,safe_summary,payload_hash,previous_stamp,stamp,requested_at,created_at)
          VALUES ('durable-receipt','security_release','recorded','Fixture','fixture-payload','','fixture-stamp',1000,1001);\`);
      db.exec("COMMIT");
      db.close();
    `);
    assert.equal(seeded.status, 0, seeded.stderr || seeded.stdout);
    const source = new DatabaseSync(join(dataDirectory, "pit.db"), { readOnly: true });
    registerPitSqliteFunctions(source);
    let counts;
    let manifest;
    try {
      counts = backupTableCounts(source);
      manifest = backupSourceManifest(source);
      assertMemberGraph(source);
    } finally { source.close(); }
    const backedUp = spawnSync(process.execPath, ["scripts/backup-db.mjs"], {
      cwd: process.cwd(), encoding: "utf8", windowsHide: true,
      env: { ...process.env, NODE_ENV: "test", PIT_DATA_DIR: dataDirectory, BACKUP_DIR: backupDirectory, BACKUP_KEEP: "2" },
    });
    assert.equal(backedUp.status, 0, backedUp.stderr || backedUp.stdout);
    const [name] = readdirSync(backupDirectory).filter((entry) => /^pit-\d{8}-\d{6}\.db$/.test(entry));
    assert.ok(name);
    const snapshotPath = join(backupDirectory, name);
    assert.deepEqual(verifyBackupSnapshot(snapshotPath, counts, manifest), { ...counts, app_meta: counts.app_meta + 1 });
    assert.doesNotThrow(() => assertExistingProductionDatabase(snapshotPath));
    const raw = new DatabaseSync(snapshotPath, { readOnly: true });
    registerPitSqliteFunctions(raw);
    try {
      assertMemberGraph(raw);
      assert.equal(JSON.parse(raw.prepare("SELECT value FROM app_meta WHERE key=?").get(RESTORE_GATE_KEY).value).state, "snapshot");
      assert.throws(() => assertDatabaseRecoveryReady(raw), { code: "DATABASE_RESTORE_REVIEW_REQUIRED" });
    } finally { raw.close(); }
    copyFileSync(snapshotPath, join(rawDirectory, "pit.db"));
    const refused = runFixture(rawDirectory, "import { db } from './server/db.js'; db.close();");
    assert.notEqual(refused.status, 0, "raw snapshots must not cold-start the application");
    assert.match(refused.stderr, /DATABASE_RESTORE_REVIEW_REQUIRED/);

    const reviewedPath = join(reviewedDirectory, "pit.db");
    const invalidated = prepareOfflineRestore({ source: snapshotPath, output: reviewedPath,
      privacyReplayReference: "fixture/privacy-reviewed", credentialReviewReference: "fixture/credentials-reviewed",
      env: { PIT_DATA_DIR: dataDirectory } });
    assert.equal(invalidated.sessions, 1);
    assert.equal(invalidated.email_queue, 1);
    assert.equal(invalidated.ownerApprovalRequests, 1);
    const reopened = runFixture(reviewedDirectory, "import { db } from './server/db.js'; db.close();");
    assert.equal(reopened.status, 0, reopened.stderr || reopened.stdout);
    const restored = new DatabaseSync(reviewedPath, { readOnly: true });
    registerPitSqliteFunctions(restored);
    try {
      assertMemberGraph(restored);
      assert.doesNotThrow(() => assertDatabaseRecoveryReady(restored));
      for (const table of ["sessions", "email_verification_receipts", "email_queue"]) {
        assert.equal(restored.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n, 0, table);
      }
      const user = restored.prepare("SELECT pass_hash,reset_hash,reset_expires,email_verify_hash,email_verify_expires,signup_cancel_hash FROM users WHERE id='durable_member'").get();
      assert.deepEqual({ ...user }, { pass_hash: "fixture-hash", reset_hash: null, reset_expires: 0,
        email_verify_hash: null, email_verify_expires: 0, signup_cancel_hash: null });
      const approval = restored.prepare("SELECT status,token_hash FROM owner_approval_requests WHERE id='old-approval'").get();
      assert.deepEqual({ ...approval }, { status: "expired", token_hash: null });
      assert.equal(restored.prepare("SELECT COUNT(*) n FROM owner_approval_receipts WHERE id='durable-receipt'").get().n, 1);
      assert.equal(restored.prepare("SELECT COUNT(*) n FROM email_campaigns WHERE id='durable-campaign'").get().n, 1);
    }
    finally { restored.close(); }
    const unchanged = new DatabaseSync(snapshotPath, { readOnly: true });
    try {
      assert.equal(unchanged.prepare("SELECT COUNT(*) n FROM sessions").get().n, 1, "preparation never changes the snapshot");
      assert.equal(unchanged.prepare("SELECT COUNT(*) n FROM email_queue").get().n, 1);
      assert.throws(() => assertDatabaseRecoveryReady(unchanged), { code: "DATABASE_RESTORE_REVIEW_REQUIRED" });
    } finally { unchanged.close(); }
  } finally { rmSync(root, { recursive: true, force: true }); }
});
