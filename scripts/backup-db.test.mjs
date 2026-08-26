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

const BACKUP_SCRIPT = fileURLToPath(new URL("./backup-db.mjs", import.meta.url));

function createSnapshot(directory, name = "snapshot.db") {
  const path = join(directory, name);
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY);
    CREATE TABLE posts (id TEXT PRIMARY KEY);
    CREATE TABLE artists (id TEXT PRIMARY KEY);
    INSERT INTO users VALUES ('u1'), ('u2');
    INSERT INTO posts VALUES ('p1');
  `);
  db.close();
  return path;
}

test("backup verification opens a real snapshot and reports critical row counts", () => {
  const directory = mkdtempSync(join(tmpdir(), "pit-backup-verify-"));
  try {
    const path = createSnapshot(directory);
    assert.deepEqual(verifyBackupSnapshot(path), { users: 2, posts: 1, artists: 0 });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("backup verification allows inserts newer than the baseline but rejects lost rows", () => {
  const directory = mkdtempSync(join(tmpdir(), "pit-backup-floor-"));
  try {
    const path = createSnapshot(directory);
    assert.deepEqual(
      verifyBackupSnapshot(path, { users: 1, posts: 1, artists: 0 }),
      { users: 2, posts: 1, artists: 0 },
      "a snapshot may contain an insert committed after the baseline was read",
    );
    assert.throws(
      () => verifyBackupSnapshot(path, { users: 3, posts: 1, artists: 0 }),
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
    assert.deepEqual(backupTableCounts(db), { users: 0, posts: null, artists: null });
    db.close();
    assert.throws(() => verifyBackupSnapshot(incomplete), /posts is missing from the snapshot/);

    const complete = createSnapshot(directory, "complete.db");
    assert.throws(
      () => verifyBackupSnapshot(complete, { users: null, posts: 1, artists: 0 }),
      /users: source row baseline is unavailable/,
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
    assert.match(result.stdout, /verified\s+integrity_check ok\s+users=2\s+posts=1\s+artists=0/);

    const snapshots = readdirSync(backupDirectory).filter((name) => name.endsWith(".db"));
    assert.equal(snapshots.length, 1);
    assert.equal(readdirSync(backupDirectory).some((name) => name.includes(".partial-")), false);
    assert.deepEqual(verifyBackupSnapshot(join(backupDirectory, snapshots[0])), {
      users: 2,
      posts: 1,
      artists: 0,
    });
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
    assert.deepEqual(verifyBackupSnapshot(existing), { users: 2, posts: 1, artists: 0 });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
