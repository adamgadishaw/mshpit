import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  backupDirectory,
  backupChildEnvironment,
  backupOperationalStatus,
  backupSchedulerEnabled,
  backupStartupWarnings,
  latestBackupAt,
  latestBackupSnapshot,
  offhostBackupReceipt,
  offhostBackupConfigured,
  recordOffhostBackupReceipt,
  runScheduledBackup,
  scheduledBackupArgs,
  shouldRunScheduledBackup,
  startBackupScheduler,
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
  assert.equal(offhostBackupConfigured({ ...complete, BACKUP_S3_ENDPOINT: "http://private.example" }), false);
  assert.equal(scheduledBackupArgs({}).includes("--upload"), false);
});

test("off-host receipts report only confirmed, bounded freshness evidence", () => {
  const root = mkdtempSync(join(tmpdir(), "pit-backup-receipt-"));
  const complete = {
    NODE_ENV: "production",
    PIT_DATA_DIR: root,
    BACKUP_S3_ENDPOINT: "https://private.example",
    BACKUP_S3_BUCKET: "pit-private-backups",
    BACKUP_S3_ACCESS_KEY_ID: "id",
    BACKUP_S3_SECRET_ACCESS_KEY: "secret",
    MEDIA_BUCKET: "pit-public-media",
  };
  try {
    mkdirSync(backupDirectory(complete));
    const uploadedAt = Date.parse("2026-08-31T00:00:00Z");
    writeFileSync(join(backupDirectory(complete), "pit-20260831-000000.db"), "verified snapshot");
    recordOffhostBackupReceipt(complete, {
      backupName: "pit-20260831-000000.db",
      uploadedAt,
    });
    assert.deepEqual(offhostBackupReceipt(complete), {
      version: 1,
      backupName: "pit-20260831-000000.db",
      uploadedAt,
    });
    assert.deepEqual(backupOperationalStatus(complete, { now: uploadedAt + 2 * 60 * 60 * 1000 }), {
      schedulerEnabled: true,
      offhostConfigured: true,
      offhostStatus: "current",
      offhostAgeHours: 2,
      latestOffhostBackupAt: uploadedAt,
      latestOffhostBackupName: "pit-20260831-000000.db",
    });
    const stale = backupOperationalStatus(complete, { now: uploadedAt + 37 * 60 * 60 * 1000 });
    assert.equal(stale.offhostStatus, "stale");
    assert.equal(stale.offhostAgeHours, 37);
    assert.match(backupStartupWarnings(complete, { now: uploadedAt + 37 * 60 * 60 * 1000 })[0], /37 hours old/);
    assert.deepEqual(backupStartupWarnings({ ...complete, NODE_ENV: "development" }), []);
    assert.deepEqual(backupStartupWarnings({ ...complete, PIT_ENV: "staging" }), []);
    assert.throws(
      () => recordOffhostBackupReceipt(complete, { backupName: "../pit.db", uploadedAt }),
      /published snapshot name/,
    );
    assert.throws(
      () => recordOffhostBackupReceipt(complete, { backupName: "pit-20260830-000000.db", uploadedAt }),
      /published local snapshot/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a successful scheduled off-host child records the newly published snapshot", async () => {
  const root = mkdtempSync(join(tmpdir(), "pit-backup-upload-observed-"));
  const env = {
    NODE_ENV: "production",
    PIT_DATA_DIR: root,
    BACKUP_S3_ENDPOINT: "https://private.example",
    BACKUP_S3_BUCKET: "pit-private-backups",
    BACKUP_S3_ACCESS_KEY_ID: "id",
    BACKUP_S3_SECRET_ACCESS_KEY: "secret",
    MEDIA_BUCKET: "pit-public-media",
  };
  try {
    mkdirSync(backupDirectory(env));
    const fakeSpawn = () => {
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      queueMicrotask(() => {
        writeFileSync(join(backupDirectory(env), "pit-20260901-010203.db"), "verified snapshot");
        child.stdout.emit("data", "uploaded verified private off-host copy");
        child.emit("close", 0);
      });
      return child;
    };
    const result = await runScheduledBackup({ env, spawnProcess: fakeSpawn });
    assert.equal(result.uploaded, true);
    assert.equal(latestBackupSnapshot(env).name, "pit-20260901-010203.db");
    assert.equal(offhostBackupReceipt(env).backupName, "pit-20260901-010203.db");
    assert.equal(backupOperationalStatus(env).offhostStatus, "current");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("backup subprocess receives only the secrets it needs", () => {
  const child = backupChildEnvironment({
    NODE_ENV: "production",
    PIT_DATA_DIR: "/data",
    BACKUP_S3_ENDPOINT: "https://private.example",
    BACKUP_S3_BUCKET: "pit-backup",
    BACKUP_S3_ACCESS_KEY_ID: "backup-id",
    BACKUP_S3_SECRET_ACCESS_KEY: "backup-secret",
    MEDIA_BUCKET: "pit-public",
    ADMIN_PASSWORD: "must-not-leak",
    RESEND_API_KEY: "must-not-leak",
    MEDIA_SECRET_ACCESS_KEY: "must-not-leak",
    YOUTUBE_API_KEY: "must-not-leak",
  });
  assert.equal(child.BACKUP_S3_SECRET_ACCESS_KEY, "backup-secret");
  assert.equal(child.ADMIN_PASSWORD, undefined);
  assert.equal(child.RESEND_API_KEY, undefined);
  assert.equal(child.MEDIA_SECRET_ACCESS_KEY, undefined);
  assert.equal(child.YOUTUBE_API_KEY, undefined);
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

test("cooperative shutdown kills the backup child and waits for close", async () => {
  const controller = new AbortController();
  let killedWith = null;
  let child = null;
  const fakeSpawn = () => {
    child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = (signal) => {
      killedWith = signal;
      queueMicrotask(() => child.emit("close", 137));
      return true;
    };
    return child;
  };

  const active = runScheduledBackup({ env: {}, spawnProcess: fakeSpawn, signal: controller.signal });
  controller.abort(new DOMException("deploy", "AbortError"));
  await assert.rejects(active, (error) => error?.name === "AbortError");
  assert.equal(killedWith, "SIGKILL");
});

test("the daily backup scheduler owns its lifecycle and configures a prompt retry", async () => {
  let configuration = null;
  const handle = { trigger() {}, stop() { return Promise.resolve(); } };
  const scheduler = startBackupScheduler({
    env: { NODE_ENV: "production", BACKUP_ENABLED: "true" },
    logger: { log() {}, warn() {}, error() {} },
    schedule: (options) => { configuration = options; return handle; },
  });

  assert.equal(scheduler, handle);
  assert.equal(configuration.initialDelayMs, 5 * 60 * 1000);
  assert.equal(configuration.intervalMs, 24 * 60 * 60 * 1000);
  assert.equal(configuration.retryDelayMs, 15 * 60 * 1000,
    "a transient failure is retried before the next daily slot");
  assert.equal(typeof configuration.run, "function");
  assert.equal(typeof configuration.report, "function");
});
