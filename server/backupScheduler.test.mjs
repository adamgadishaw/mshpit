import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  backupDirectory,
  backupSchedulerEnabled,
  latestBackupAt,
  offhostBackupConfigured,
  runScheduledBackup,
  scheduledBackupArgs,
  shouldRunScheduledBackup,
} from "./backupScheduler.js";

test("production backups default on, explicit values fail closed, and development stays quiet", () => {
  assert.equal(backupSchedulerEnabled({ NODE_ENV: "production" }), true);
  assert.equal(backupSchedulerEnabled({ NODE_ENV: "development" }), false);
  assert.equal(backupSchedulerEnabled({ NODE_ENV: "production", BACKUP_ENABLED: "false" }), false);
  assert.equal(backupSchedulerEnabled({ NODE_ENV: "production", BACKUP_ENABLED: "flase" }), false);
  assert.equal(backupSchedulerEnabled({ NODE_ENV: "development", BACKUP_ENABLED: "yes" }), true);
});

test("scheduled snapshots live under the mounted data directory and respect freshness", () => {
  const root = mkdtempSync(join(tmpdir(), "pit-backup-schedule-"));
  try {
    const env = { PIT_DATA_DIR: root };
    assert.equal(backupDirectory(env), join(root, "backups"));
    assert.equal(latestBackupAt(env), 0);
    assert.equal(shouldRunScheduledBackup(0, 100_000, 60_000), true);
    mkdirSync(join(root, "backups"));
    const snapshot = join(root, "backups", "pit-20260813-010203.db");
    writeFileSync(snapshot, "snapshot");
    const partial = `${snapshot}.partial-123`;
    writeFileSync(partial, "not verified");
    const old = new Date(Date.now() - 60_000);
    const fresh = new Date();
    utimesSync(snapshot, old, old);
    utimesSync(partial, fresh, fresh);
    assert.equal(latestBackupAt(env), statSync(snapshot).mtimeMs, "an incomplete newer .partial file never suppresses a retry");
    assert.equal(shouldRunScheduledBackup(95_000, 100_000, 60_000), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("off-host upload requires a complete private bucket and controls the CLI flag", () => {
  const complete = {
    BACKUP_S3_ENDPOINT: "https://private.example",
    BACKUP_S3_BUCKET: "pit-private-backups",
    BACKUP_S3_ACCESS_KEY_ID: "id",
    BACKUP_S3_SECRET_ACCESS_KEY: "secret",
    MEDIA_BUCKET: "pit-public-media",
  };
  assert.equal(offhostBackupConfigured(complete), true);
  assert.equal(scheduledBackupArgs(complete).at(-1), "--upload");
  assert.equal(offhostBackupConfigured({ ...complete, BACKUP_S3_SECRET_ACCESS_KEY: "" }), false);
  assert.equal(offhostBackupConfigured({ ...complete, BACKUP_S3_BUCKET: "pit-public-media" }), false);
  assert.equal(scheduledBackupArgs({}).includes("--upload"), false);
});

test("scheduled backup process is hidden, bounded, and reports success", async () => {
  let options;
  const fakeSpawn = (_command, args, received) => {
    options = { args, received };
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    queueMicrotask(() => {
      child.stdout.emit("data", "verified integrity_check ok");
      child.emit("close", 0);
    });
    return child;
  };
  const result = await runScheduledBackup({ env: {}, spawnProcess: fakeSpawn });
  assert.equal(options.received.windowsHide, true);
  assert.deepEqual(options.received.stdio, ["ignore", "pipe", "pipe"]);
  assert.equal(options.received.env.BACKUP_DIR, backupDirectory({}), "the child writes where freshness and retention inspect");
  assert.equal(result.uploaded, false);
  assert.match(result.output, /integrity_check ok/);
});

test("a wedged backup child is killed and cannot deadlock the maintenance queue", async () => {
  let killedWith = null;
  const fakeSpawn = () => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = (signal) => { killedWith = signal; return true; };
    return child;
  };

  await assert.rejects(
    runScheduledBackup({ env: {}, spawnProcess: fakeSpawn, processTimeoutMs: 5 }),
    /backup process timed out after 5ms/,
  );
  assert.equal(killedWith, "SIGKILL");
});
