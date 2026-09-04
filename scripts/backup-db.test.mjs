import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  backupRetentionCount,
  backupTableCounts,
  boundedBackupTimeout,
  verifyBackupSnapshot,
} from "./backup-db-verification.mjs";
import { registerPitSqliteFunctions } from "../server/sqliteFunctions.js";
import { PIT_SQLITE_APPLICATION_ID } from "../server/dataDirectory.js";

const BACKUP_SCRIPT = fileURLToPath(new URL("./backup-db.mjs", import.meta.url));
const snapshotCounts = (overrides = {}) => ({
  schema_version: 1,
  users: 2,
  posts: 1,
  artists: 1,
  tour_dates: 0,
  artist_profiles: 0,
  venue_reviews: 0,
  app_meta: 1,
  ...overrides,
});

function createSnapshot(directory, name = "snapshot.db") {
  const path = join(directory, name);
  const db = new DatabaseSync(path);
  registerPitSqliteFunctions(db);
  db.exec(`
    PRAGMA application_id = ${PIT_SQLITE_APPLICATION_ID};
    CREATE TABLE schema_version (version INTEGER NOT NULL);
    CREATE TABLE users (id TEXT PRIMARY KEY);
    CREATE TABLE posts (id TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id));
    CREATE TABLE artists (id TEXT PRIMARY KEY);
    CREATE TABLE tour_dates (source TEXT, venue_provider_id TEXT);
    CREATE TABLE artist_profiles (artist_key TEXT PRIMARY KEY);
    CREATE TABLE venue_reviews (id TEXT PRIMARY KEY);
    CREATE TABLE app_meta (key TEXT PRIMARY KEY, value TEXT);
    CREATE INDEX idx_test_provider_venue_slug
      ON tour_dates(pit_venue_public_slug(source, venue_provider_id));
    INSERT INTO schema_version VALUES (1);
    INSERT INTO users VALUES ('u1'), ('u2');
    INSERT INTO posts VALUES ('p1', 'u1');
    INSERT INTO artists VALUES ('a1');
    INSERT INTO app_meta VALUES ('fixture', 'ready');
  `);
  db.close();
  return path;
}

test("backup verification opens a real snapshot and reports critical row counts", () => {
  const directory = mkdtempSync(join(tmpdir(), "pit-backup-verify-"));
  try {
    const path = createSnapshot(directory);
    assert.deepEqual(verifyBackupSnapshot(path), snapshotCounts());
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("backup verification allows inserts newer than the baseline but rejects lost rows", () => {
  const directory = mkdtempSync(join(tmpdir(), "pit-backup-floor-"));
  try {
    const path = createSnapshot(directory);
    assert.deepEqual(
      verifyBackupSnapshot(path, snapshotCounts({ users: 1 })),
      snapshotCounts(),
      "a snapshot may contain an insert committed after the baseline was read",
    );
    assert.throws(
      () => verifyBackupSnapshot(path, snapshotCounts({ users: 3 })),
      /users: snapshot lost rows \(2 < 3\)/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("backup verification rejects missing critical tables and invalid source baselines", () => {
  const directory = mkdtempSync(join(tmpdir(), "pit-backup-invalid-"));
  try {
    const incomplete = join(directory, "incomplete.db");
    const db = new DatabaseSync(incomplete);
    db.exec("CREATE TABLE users (id TEXT PRIMARY KEY)");
    assert.deepEqual(backupTableCounts(db), {
      schema_version: null,
      users: 0,
      posts: null,
      artists: null,
      tour_dates: null,
      artist_profiles: null,
      venue_reviews: null,
      app_meta: null,
    });
    db.close();
    assert.throws(() => verifyBackupSnapshot(incomplete), /schema_version is missing from the snapshot/);

    const complete = createSnapshot(directory, "complete.db");
    assert.throws(
      () => verifyBackupSnapshot(complete, snapshotCounts({ users: null })),
      /users: source row baseline is unavailable/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("backup verification rejects referential corruption without exposing row contents", () => {
  const directory = mkdtempSync(join(tmpdir(), "pit-backup-foreign-key-"));
  try {
    const path = createSnapshot(directory);
    const database = new DatabaseSync(path);
    database.exec("PRAGMA foreign_keys=OFF; INSERT INTO posts VALUES ('orphan', 'missing-user')");
    database.close();
    assert.throws(
      () => verifyBackupSnapshot(path),
      /foreign_key_check failed \(1 violation\(s\)\)/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("the current recovery contract deliberately rejects a pre-profile schema", () => {
  const directory = mkdtempSync(join(tmpdir(), "pit-backup-old-schema-"));
  try {
    const path = createSnapshot(directory);
    const database = new DatabaseSync(path);
    database.exec("DROP TABLE artist_profiles");
    database.close();
    assert.throws(
      () => verifyBackupSnapshot(path),
      /artist_profiles is missing from the snapshot/,
      "historical snapshots must be migrated on an isolated clone before production restore",
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("backup retention and network deadlines reject or bound unsafe configuration", () => {
  assert.equal(backupRetentionCount(undefined), 7);
  assert.equal(backupRetentionCount("3"), 3);
  assert.throws(() => backupRetentionCount("garbage"), /positive safe integer/);
  assert.throws(() => backupRetentionCount("0"), /positive safe integer/);
  assert.throws(() => backupRetentionCount(String(Number.MAX_SAFE_INTEGER + 1)), /positive safe integer/);
  assert.equal(boundedBackupTimeout("garbage", 120_000), 120_000);
  assert.equal(boundedBackupTimeout("999999999", 120_000), 30 * 60 * 1000);
});

test("backup CLI creates, verifies, and retains a VACUUM INTO snapshot end to end", () => {
  const root = mkdtempSync(join(tmpdir(), "pit-backup-cli-"));
  const dataDirectory = join(root, "data");
  const backupDirectory = join(root, "backups");
  mkdirSync(dataDirectory);
  try {
    createSnapshot(dataDirectory, "pit.db");
    const result = spawnSync(process.execPath, [BACKUP_SCRIPT], {
      encoding: "utf8",
      env: {
        ...process.env,
        PIT_DATA_DIR: dataDirectory,
        BACKUP_DIR: backupDirectory,
        BACKUP_KEEP: "2",
      },
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout,
      /verified\s+integrity_check ok\s+schema_version=1\s+users=2\s+posts=1\s+artists=1\s+tour_dates=0\s+artist_profiles=0\s+venue_reviews=0\s+app_meta=1/);

    const snapshots = readdirSync(backupDirectory).filter((name) => name.endsWith(".db"));
    assert.equal(snapshots.length, 1);
    assert.equal(readdirSync(backupDirectory).some((name) => name.includes(".partial-")), false);
    assert.deepEqual(verifyBackupSnapshot(join(backupDirectory, snapshots[0])), snapshotCounts());
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("backup retention reserves one verified replacement slot before VACUUM INTO", () => {
  const root = mkdtempSync(join(tmpdir(), "pit-backup-rollover-"));
  const dataDirectory = join(root, "data");
  const backupDirectory = join(root, "backups");
  mkdirSync(dataDirectory);
  mkdirSync(backupDirectory);
  try {
    createSnapshot(dataDirectory, "pit.db");
    const oldest = createSnapshot(backupDirectory, "pit-20260801-010203.db");
    const newest = createSnapshot(backupDirectory, "pit-20260802-010203.db");
    const oldClock = new Date("2026-08-01T01:02:03Z");
    const newClock = new Date("2026-08-02T01:02:03Z");
    utimesSync(oldest, oldClock, oldClock);
    utimesSync(newest, newClock, newClock);

    const result = spawnSync(process.execPath, [BACKUP_SCRIPT], {
      encoding: "utf8",
      env: {
        ...process.env,
        PIT_DATA_DIR: dataDirectory,
        BACKUP_DIR: backupDirectory,
        BACKUP_KEEP: "2",
      },
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /preflight 1 verified snapshot\(s\) kept, 1 oldest pruned/);
    assert.equal(existsSync(oldest), false, "the replaceable oldest snapshot frees capacity first");
    assert.equal(existsSync(newest), true, "the newest verified recovery point is never removed");
    const snapshots = readdirSync(backupDirectory).filter((name) => name.endsWith(".db"));
    assert.equal(snapshots.length, 2, "the verified replacement restores configured retention");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a failed verification publishes no final snapshot and cleans its partial file", () => {
  const root = mkdtempSync(join(tmpdir(), "pit-backup-atomic-failure-"));
  const dataDirectory = join(root, "data");
  const backupDirectory = join(root, "backups");
  mkdirSync(dataDirectory);
  try {
    const source = new DatabaseSync(join(dataDirectory, "pit.db"));
    source.exec("CREATE TABLE users (id TEXT PRIMARY KEY); CREATE TABLE posts (id TEXT PRIMARY KEY)");
    source.close();
    const result = spawnSync(process.execPath, [BACKUP_SCRIPT], {
      encoding: "utf8",
      env: { ...process.env, PIT_DATA_DIR: dataDirectory, BACKUP_DIR: backupDirectory },
    });
    assert.notEqual(result.status, 0, "missing artists table must fail snapshot verification");
    const files = readdirSync(backupDirectory);
    assert.equal(files.some((name) => /^pit-\d{8}-\d{6}\.db$/.test(name)), false);
    assert.equal(files.some((name) => name.includes(".partial-")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("an invalid retention value fails before it can prune existing snapshots", () => {
  const root = mkdtempSync(join(tmpdir(), "pit-backup-invalid-retention-"));
  const dataDirectory = join(root, "data");
  const backupDirectory = join(root, "backups");
  mkdirSync(dataDirectory);
  mkdirSync(backupDirectory);
  try {
    createSnapshot(dataDirectory, "pit.db");
    const existing = createSnapshot(backupDirectory, "pit-20260801-010203.db");
    const result = spawnSync(process.execPath, [BACKUP_SCRIPT], {
      encoding: "utf8",
      env: {
        ...process.env,
        PIT_DATA_DIR: dataDirectory,
        BACKUP_DIR: backupDirectory,
        BACKUP_KEEP: "garbage",
      },
    });
    assert.notEqual(result.status, 0);
    assert.deepEqual(verifyBackupSnapshot(existing), snapshotCounts());
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
