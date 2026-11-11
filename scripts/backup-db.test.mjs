import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

import {
  BACKUP_WORKING_RESERVE_BYTES,
  backupRetentionCount,
  backupSourceManifest,
  backupTableCounts,
  boundedBackupTimeout,
  isDiskFullError,
  requiredBackupBytes,
  snapshotsToFreeSpace,
  verifyBackupSnapshot,
} from "./backup-db-verification.mjs";
import { registerPitSqliteFunctions } from "../server/sqliteFunctions.js";
import { PIT_SQLITE_APPLICATION_ID } from "../server/dataDirectory.js";
import { assertDatabaseRecoveryPathReady } from "../server/databaseRecovery.js";
import { BACKUP_PARTIAL_MIN_AGE_MS } from "./backup-db-partials.mjs";

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
      /foreign_key_check failed \(1 violation\(s\) or more\)/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("source-aware backup verification rejects missing populated and empty member tables", () => {
  const directory = mkdtempSync(join(tmpdir(), "pit-backup-member-manifest-"));
  try {
    const path = createSnapshot(directory);
    for (const minimumRows of [1, 0]) {
      const manifest = { comments: { columns: ["id", "user_id", "text"], minimumRows } };
      assert.throws(() => verifyBackupSnapshot(path, snapshotCounts(), manifest),
        /comments is missing from the source-matched snapshot/);
    }
    assert.deepEqual(verifyBackupSnapshot(path), snapshotCounts(),
      "standalone historical verification does not demand tables from a newer deployment");
    const database = new DatabaseSync(path);
    database.exec("CREATE VIEW comments AS SELECT id, user_id, '' AS text FROM posts");
    database.close();
    assert.throws(() => verifyBackupSnapshot(path, null, {
      comments: { columns: ["id", "user_id", "text"], minimumRows: 1 },
    }), /comments is missing from the source-matched snapshot/,
    "a matching view is not a durable table");
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("source-aware backup verification rejects lost relation rows and columns", () => {
  const directory = mkdtempSync(join(tmpdir(), "pit-backup-member-floor-"));
  try {
    const path = createSnapshot(directory);
    const database = new DatabaseSync(path);
    database.exec("CREATE TABLE comments (id TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id), text TEXT)");
    database.close();
    const comments = { columns: ["id", "user_id", "text"], minimumRows: 1 };
    assert.throws(() => verifyBackupSnapshot(path, null, { comments }),
      /comments: snapshot lost rows \(0 < 1\)/);
    assert.throws(() => verifyBackupSnapshot(path, null, {
      comments: { columns: [...comments.columns, "kept_metadata"], minimumRows: 0 },
    }), /comments: snapshot is missing source column kept_metadata/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("backup verification rejects invalid schema version metadata", () => {
  const directory = mkdtempSync(join(tmpdir(), "pit-backup-schema-marker-"));
  try {
    const path = createSnapshot(directory);
    const database = new DatabaseSync(path);
    database.exec("UPDATE schema_version SET version=0");
    database.close();
    assert.throws(() => verifyBackupSnapshot(path), /schema_version has no valid version marker/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("source manifests preserve member rows while allowing volatile cache and session pruning", () => {
  const directory = mkdtempSync(join(tmpdir(), "pit-backup-source-inventory-"));
  try {
    const path = createSnapshot(directory);
    const database = new DatabaseSync(path);
    registerPitSqliteFunctions(database);
    database.exec(`
      CREATE TABLE comments (id TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id), text TEXT);
      CREATE TABLE account_mutes (muter_id TEXT REFERENCES users(id), muted_id TEXT REFERENCES users(id));
      CREATE TABLE provider_cache (key TEXT PRIMARY KEY, payload TEXT);
      CREATE TABLE sessions (id TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id));
      INSERT INTO comments VALUES ('comment', 'u1', 'keep this');
      INSERT INTO provider_cache VALUES ('lookup', 'replaceable');
      INSERT INTO sessions VALUES ('expired', 'u1');
    `);
    const manifest = backupSourceManifest(database);
    assert.deepEqual(manifest.comments, { columns: ["id", "user_id", "text"], minimumRows: 1 });
    assert.equal(manifest.account_mutes.minimumRows, 0, "empty durable tables remain inventoried");
    assert.equal(manifest.provider_cache.minimumRows, null);
    assert.equal(manifest.sessions.minimumRows, null);
    assert.equal(manifest.users.minimumRows, 2);
    assert.equal(Object.hasOwn(manifest, "newer_deployment_table"), false);
    database.exec("DELETE FROM provider_cache; DELETE FROM sessions");
    database.close();
    assert.deepEqual(verifyBackupSnapshot(path, snapshotCounts(), manifest), snapshotCounts());
    const changed = new DatabaseSync(path);
    changed.exec("DELETE FROM comments");
    changed.close();
    assert.throws(() => verifyBackupSnapshot(path, snapshotCounts(), manifest),
      /comments: snapshot lost rows \(0 < 1\)/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
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
      /verified\s+integrity_check ok\s+schema_version=1\s+users=2\s+posts=1\s+artists=1\s+tour_dates=0\s+artist_profiles=0\s+venue_reviews=0\s+app_meta=2/);

    const snapshots = readdirSync(backupDirectory).filter((name) => name.endsWith(".db"));
    assert.equal(snapshots.length, 1);
    assert.equal(readdirSync(backupDirectory).some((name) => name.includes(".partial-")), false);
    assert.deepEqual(verifyBackupSnapshot(join(backupDirectory, snapshots[0])), snapshotCounts({ app_meta: 2 }));
    assert.throws(() => assertDatabaseRecoveryPathReady(join(backupDirectory, snapshots[0])), /quarantined/);
    assert.doesNotThrow(() => assertDatabaseRecoveryPathReady(join(dataDirectory, "pit.db")), "the live source must never be fenced");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("failed off-host configuration keeps the verified local recovery point but returns failure", () => {
  const root = mkdtempSync(join(tmpdir(), "pit-backup-local-survives-"));
  const dataDirectory = join(root, "data");
  const backupDirectory = join(root, "backups");
  mkdirSync(dataDirectory);
  try {
    createSnapshot(dataDirectory, "pit.db");
    const result = spawnSync(process.execPath, [BACKUP_SCRIPT, "--upload"], {
      encoding: "utf8", windowsHide: true,
      env: { ...process.env, PIT_DATA_DIR: dataDirectory, BACKUP_DIR: backupDirectory,
        BACKUP_S3_ENDPOINT: "", BACKUP_S3_BUCKET: "", BACKUP_S3_ACCESS_KEY_ID: "", BACKUP_S3_SECRET_ACCESS_KEY: "" },
    });
    assert.notEqual(result.status, 0, "remote failure must remain a failed job for retry/reporting");
    assert.match(result.stderr, /BACKUP_CONFIG_INVALID/);
    const snapshots = readdirSync(backupDirectory);
    assert.equal(snapshots.length, 1);
    assert.match(snapshots[0], /^pit-\d{8}-\d{6}\.db$/);
    assert.deepEqual(verifyBackupSnapshot(join(backupDirectory, snapshots[0])), snapshotCounts({ app_meta: 2 }));
  } finally { rmSync(root, { recursive: true, force: true }); }
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

test("backup space planning prunes the oldest snapshots only when that makes the copy fit", () => {
  const snapshots = [
    { f: "pit-20260803-010203.db", size: 300 },
    { f: "pit-20260802-010203.db", size: 300 },
    { f: "pit-20260801-010203.db", size: 300 },
  ];
  assert.deepEqual(snapshotsToFreeSpace({ snapshots, freeBytes: 1_000, requiredBytes: 900 }), { fits: true, remove: [] });
  assert.deepEqual(snapshotsToFreeSpace({ snapshots, freeBytes: 400, requiredBytes: 900 }),
    { fits: true, remove: ["pit-20260801-010203.db", "pit-20260802-010203.db"] });
  assert.deepEqual(snapshotsToFreeSpace({ snapshots, freeBytes: 200, requiredBytes: 900 }), { fits: false, remove: [] },
    "the newest recovery point is never chosen, and history is kept when pruning cannot make room");
  assert.deepEqual(snapshotsToFreeSpace({ snapshots, freeBytes: Number.NaN, requiredBytes: 900 }), { fits: false, remove: [] },
    "unknown free space cannot admit a copy or discard recovery history");
  assert.equal(requiredBackupBytes(1_000, 200), 1_320 + BACKUP_WORKING_RESERVE_BYTES);
  assert.equal(isDiskFullError(Object.assign(new Error("database or disk is full"), { errcode: 13 })), true);
  assert.equal(isDiskFullError(Object.assign(new Error("write failed"), { code: "ENOSPC" })), true);
  assert.equal(isDiskFullError(new Error("integrity_check failed: corrupt")), false);
});

test("backup preflight prunes the oldest snapshots when free space cannot hold the copy", () => {
  const root = mkdtempSync(join(tmpdir(), "pit-backup-space-"));
  const dataDirectory = join(root, "data");
  const backupDirectory = join(root, "backups");
  mkdirSync(dataDirectory);
  mkdirSync(backupDirectory);
  try {
    createSnapshot(dataDirectory, "pit.db");
    const paths = ["pit-20260801-010203.db", "pit-20260802-010203.db", "pit-20260803-010203.db"].map((name, index) => {
      const path = createSnapshot(backupDirectory, name);
      const clock = new Date(Date.UTC(2026, 7, 1 + index, 1, 2, 3));
      utimesSync(path, clock, clock);
      return path;
    });

    const result = spawnSync(process.execPath, [BACKUP_SCRIPT], {
      encoding: "utf8", windowsHide: true,
      env: { ...process.env, PIT_DATA_DIR: dataDirectory, BACKUP_DIR: backupDirectory, BACKUP_KEEP: "7", PIT_TEST_BACKUP_FREE_BYTES: String(BACKUP_WORKING_RESERVE_BYTES + 1) },
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /space\s+preflight: pruned 2 oldest snapshot\(s\)/);
    assert.equal(existsSync(paths[0]), false);
    assert.equal(existsSync(paths[1]), false);
    assert.equal(existsSync(paths[2]), true, "the newest verified recovery point is never removed");
    assert.equal(readdirSync(backupDirectory).filter((name) => name.endsWith(".db")).length, 2);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a disk-full copy keeps the newest snapshot, prunes older ones, and retries once", () => {
  const root = mkdtempSync(join(tmpdir(), "pit-backup-disk-full-"));
  const dataDirectory = join(root, "data");
  const backupDirectory = join(root, "backups");
  mkdirSync(dataDirectory);
  mkdirSync(backupDirectory);
  try {
    createSnapshot(dataDirectory, "pit.db");
    const oldest = createSnapshot(backupDirectory, "pit-20260801-010203.db");
    const newest = createSnapshot(backupDirectory, "pit-20260802-010203.db");
    utimesSync(oldest, new Date("2026-08-01T01:02:03Z"), new Date("2026-08-01T01:02:03Z"));
    utimesSync(newest, new Date("2026-08-02T01:02:03Z"), new Date("2026-08-02T01:02:03Z"));

    const result = spawnSync(process.execPath, [BACKUP_SCRIPT], {
      encoding: "utf8", windowsHide: true,
      env: { ...process.env, PIT_DATA_DIR: dataDirectory, BACKUP_DIR: backupDirectory, BACKUP_KEEP: "7", PIT_TEST_BACKUP_DISK_FULL_ONCE: "1" },
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /disk full during copy: pruned 1 older snapshot\(s\), kept the newest, retrying once/);
    assert.equal(existsSync(oldest), false);
    assert.equal(existsSync(newest), true, "the newest verified recovery point is never removed");
    const files = readdirSync(backupDirectory);
    assert.equal(files.filter((name) => name.endsWith(".db")).length, 2);
    assert.equal(files.some((name) => name.includes(".partial-")), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a disk-full copy with no older snapshot to prune still refuses and leaves no partial", () => {
  const root = mkdtempSync(join(tmpdir(), "pit-backup-disk-full-refuse-"));
  const dataDirectory = join(root, "data");
  const backupDirectory = join(root, "backups");
  mkdirSync(dataDirectory);
  try {
    createSnapshot(dataDirectory, "pit.db");
    const result = spawnSync(process.execPath, [BACKUP_SCRIPT], {
      encoding: "utf8", windowsHide: true,
      env: { ...process.env, PIT_DATA_DIR: dataDirectory, BACKUP_DIR: backupDirectory, PIT_TEST_BACKUP_DISK_FULL_ONCE: "1" },
    });
    assert.notEqual(result.status, 0, "a backup that cannot be written must still refuse");
    assert.match(result.stderr, /database or disk is full/);
    assert.deepEqual(readdirSync(backupDirectory), []);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("production ignores the backup space test fixtures", () => {
  const root = mkdtempSync(join(tmpdir(), "pit-backup-production-fixtures-"));
  const dataDirectory = join(root, "data");
  const backupDirectory = join(root, "backups");
  mkdirSync(dataDirectory);
  mkdirSync(backupDirectory);
  try {
    createSnapshot(dataDirectory, "pit.db");
    const older = createSnapshot(backupDirectory, "pit-20260801-010203.db");
    const result = spawnSync(process.execPath, [BACKUP_SCRIPT], {
      encoding: "utf8", windowsHide: true,
      env: {
        ...process.env, NODE_ENV: "production", PIT_DATA_DIR: dataDirectory, BACKUP_DIR: backupDirectory,
        BACKUP_KEEP: "7", PIT_TEST_BACKUP_FREE_BYTES: "1", PIT_TEST_BACKUP_DISK_FULL_ONCE: "1",
      },
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.doesNotMatch(result.stdout, /space\s+(preflight|disk full)/);
    assert.equal(existsSync(older), true);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("insufficient or unknown space refuses before retention or snapshot writes", () => {
  for (const freeBytes of ["0", "unknown"]) {
    const root = mkdtempSync(join(tmpdir(), "pit-backup-space-refusal-"));
    const dataDirectory = join(root, "data");
    const backupDirectory = join(root, "backups");
    mkdirSync(dataDirectory);
    mkdirSync(backupDirectory);
    try {
      createSnapshot(dataDirectory, "pit.db");
      const names = ["pit-20260801-010203.db", "pit-20260802-010203.db"];
      for (const name of names) createSnapshot(backupDirectory, name);
      const result = spawnSync(process.execPath, [BACKUP_SCRIPT], {
        encoding: "utf8", windowsHide: true,
        env: { ...process.env, NODE_ENV: "test", PIT_DATA_DIR: dataDirectory,
          BACKUP_DIR: backupDirectory, BACKUP_KEEP: "2", PIT_TEST_BACKUP_FREE_BYTES: freeBytes },
      });
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /BACKUP_DISK_SPACE/);
      assert.deepEqual(readdirSync(backupDirectory).sort(), names);
      for (const name of names) assert.deepEqual(verifyBackupSnapshot(join(backupDirectory, name)), snapshotCounts());
    } finally { rmSync(root, { recursive: true, force: true }); }
  }
});

test("backup retention ignores date-named directories without deleting their contents", () => {
  const root = mkdtempSync(join(tmpdir(), "pit-backup-directory-retention-"));
  const dataDirectory = join(root, "data");
  const backupDirectory = join(root, "backups");
  mkdirSync(dataDirectory);
  mkdirSync(backupDirectory);
  const unrelated = join(backupDirectory, "pit-20260801-010203.db");
  mkdirSync(unrelated);
  try {
    createSnapshot(dataDirectory, "pit.db");
    createSnapshot(unrelated, "preserved.db");
    const result = spawnSync(process.execPath, [BACKUP_SCRIPT], {
      encoding: "utf8", windowsHide: true,
      env: { ...process.env, PIT_DATA_DIR: dataDirectory, BACKUP_DIR: backupDirectory, BACKUP_KEEP: "1" },
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.deepEqual(verifyBackupSnapshot(join(unrelated, "preserved.db")), snapshotCounts());
  } finally { rmSync(root, { recursive: true, force: true }); }
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

test("a real SIGKILL partial is reconciled before the next backup's disk admission", async () => {
  const root = mkdtempSync(join(tmpdir(), "pit-backup-killed-child-"));
  const dataDirectory = join(root, "data");
  const backupDirectory = join(root, "backups");
  mkdirSync(dataDirectory);
  mkdirSync(backupDirectory);
  const hookPath = join(root, "synthetic-pause.mjs");
  const marker = join(root, "vacuum-completed");
  // Isolated preload, never a production test bypass: run the actual VACUUM,
  // then pause deterministically before verification/publication. All network
  // transports are disabled and the child receives no service credentials.
  writeFileSync(hookPath, `
    import { DatabaseSync } from 'node:sqlite';
    import fs from 'node:fs';
    import net from 'node:net';
    import tls from 'node:tls';
    import http from 'node:http';
    import https from 'node:https';
    import { join } from 'node:path';
    import { syncBuiltinESMExports } from 'node:module';
    const blocked = () => { throw new Error('Synthetic regression blocks outbound services'); };
    globalThis.fetch = blocked;
    net.connect = net.createConnection = tls.connect = http.request = http.get = https.request = https.get = blocked;
    if (process.env.PIT_TEST_CAPACITY_BYTES) fs.statfsSync = (directory) => ({ bsize: 1,
      bavail: Number(process.env.PIT_TEST_CAPACITY_BYTES) - fs.readdirSync(directory)
        .reduce((bytes, name) => bytes + fs.lstatSync(join(directory, name)).size, 0) });
    syncBuiltinESMExports();
    const original = DatabaseSync.prototype.exec;
    DatabaseSync.prototype.exec = function(sql) {
      const result = original.call(this, sql);
      if (/^VACUUM INTO /u.test(sql) && process.env.PIT_TEST_PAUSE_MARKER) {
        fs.writeFileSync(process.env.PIT_TEST_PAUSE_MARKER, 'real copy completed');
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 30000);
      }
      return result;
    };
  `);
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    /^(PATH|PATHEXT|SystemRoot|WINDIR|TEMP|TMP|USERPROFILE|APPDATA|LOCALAPPDATA)$/i.test(key)));
  Object.assign(env, { NODE_ENV: "test", PIT_DATA_DIR: dataDirectory, BACKUP_DIR: backupDirectory,
    BACKUP_KEEP: "1", BACKUP_ENABLED: "false", NODE_NO_WARNINGS: "1" });
  let child;
  let closed;
  try {
    const source = createSnapshot(dataDirectory, "pit.db");
    const sourceHash = createHash("sha256").update(readFileSync(source)).digest("hex");
    const args = ["--import", pathToFileURL(hookPath).href, BACKUP_SCRIPT];
    child = spawn(process.execPath, args, { env: { ...env, PIT_TEST_PAUSE_MARKER: marker },
      windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });
    closed = once(child, "close");
    const deadline = Date.now() + 10000;
    while (!existsSync(marker) && child.exitCode === null && Date.now() < deadline) {
      await new Promise((resolveWait) => setTimeout(resolveWait, 10));
    }
    assert.equal(existsSync(marker), true, output);
    const name = readdirSync(backupDirectory).find((entry) => entry.includes(".partial-") && !entry.endsWith(".owner.json"));
    assert.ok(name);
    const partial = join(backupDirectory, name);
    assert.ok(statSync(partial).size > 0, "the actual SQLite copy finished before termination");
    assert.equal(child.kill("SIGKILL"), true);
    await closed;
    assert.equal(existsSync(partial), true, "SIGKILL bypassed the child's catch cleanup");
    const ownerPath = `${partial}.owner.json`;
    const owner = JSON.parse(readFileSync(ownerPath, "utf8"));
    assert.equal(owner.pid, child.pid);
    const old = Date.now() - BACKUP_PARTIAL_MIN_AGE_MS - 10000;
    writeFileSync(ownerPath, JSON.stringify({ ...owner, createdAt: old }));
    utimesSync(partial, old / 1000, old / 1000);
    utimesSync(ownerPath, old / 1000, old / 1000);
    const legacy = join(backupDirectory, "pit-20000101-000000.db.partial-123");
    writeFileSync(legacy, "unproven legacy partial");
    // This filesystem fixture can admit a copy only after abandoned bytes have
    // been reclaimed. The unknown legacy file is accounted for, never deleted.
    const capacity = requiredBackupBytes(statSync(source).size) + statSync(legacy).size;
    const next = spawnSync(process.execPath, args, { encoding: "utf8", windowsHide: true, timeout: 30000,
      env: { ...env, PIT_TEST_CAPACITY_BYTES: String(capacity) } });
    assert.equal(next.status, 0, next.stderr || next.stdout);
    assert.match(next.stdout, /partials\s+1 abandoned removed .*1 preserved/);
    assert.match(next.stdout, /capacity\s+.*required including write headroom/);
    assert.equal(existsSync(partial), false);
    assert.equal(existsSync(ownerPath), false);
    assert.equal(readFileSync(legacy, "utf8"), "unproven legacy partial");
    const published = readdirSync(backupDirectory).filter((entry) => /^pit-\d{8}-\d{6}\.db$/.test(entry));
    assert.equal(published.length, 1);
    assert.deepEqual(verifyBackupSnapshot(join(backupDirectory, published[0])), snapshotCounts({ app_meta: 2 }));
    assert.equal(createHash("sha256").update(readFileSync(source)).digest("hex"), sourceHash);
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    if (closed) await closed;
    rmSync(root, { recursive: true, force: true });
  }
});
