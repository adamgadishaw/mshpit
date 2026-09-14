import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { startPeriodicJob } from "./periodicJobScheduler.js";
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

function privateBackupFixtureEnvironment(directory) {
  return {
    NODE_ENV: "production", PIT_DATA_DIR: directory,
    BACKUP_S3_ENDPOINT: "https://private.example",
    BACKUP_S3_BUCKET: "pit-private-backups",
    BACKUP_S3_ACCESS_KEY_ID: "backup-id",
    BACKUP_S3_SECRET_ACCESS_KEY: "backup-secret",
    MEDIA_BUCKET: "pit-public-media",
  };
}

function backupSchedulerTimers() {
  const once = [];
  const repeating = [];
  const cleared = new Set();
  const handle = (callback, delay) => ({ callback, delay, unref() {} });
  return {
    once, repeating, cleared,
    setTimer(callback, delay) { const value = handle(callback, delay); once.push(value); return value; },
    clearTimer(value) { cleared.add(value); },
    setRepeatingTimer(callback, delay) { const value = handle(callback, delay); repeating.push(value); return value; },
    clearRepeatingTimer(value) { cleared.add(value); },
  };
}

test("enabling private off-host storage does not wait for a fresh local-only snapshot to expire", async () => {
  const directory = mkdtempSync(join(tmpdir(), "pit-backup-enable-offhost-"));
  const env = privateBackupFixtureEnvironment(directory);
  let calls = 0;
  let scheduler;
  try {
    mkdirSync(backupDirectory(env));
    const backupName = "pit-20260914-130000.db";
    writeFileSync(join(backupDirectory(env), backupName), "verified local snapshot");
    scheduler = startBackupScheduler({
      env,
      logger: { log() {}, warn() {}, error() {} },
      run: async () => {
        calls += 1;
        recordOffhostBackupReceipt(env, { backupName });
        return { uploaded: true };
      },
    });
    assert.equal(await scheduler.trigger(), true);
    assert.equal(calls, 1, "a current local copy is not evidence of a private remote upload");
    assert.equal(await scheduler.trigger(), true);
    assert.equal(calls, 1, "fresh local and off-host proof suppress duplicate work");
  } finally {
    await scheduler?.stop();
    rmSync(directory, { recursive: true, force: true });
  }
});

for (const [label, receipt, expectedCalls] of [
  ["missing", () => null, 1],
  ["malformed", () => "{torn", 1],
  ["future-dated", (backupName) => JSON.stringify({ version: 1, backupName, uploadedAt: Date.now() + 60 * 60_000 }), 1],
  ["overdue", (backupName) => JSON.stringify({ version: 1, backupName, uploadedAt: Date.now() - 27 * 60 * 60_000 }), 1],
  ["current", (backupName) => JSON.stringify({ version: 1, backupName, uploadedAt: Date.now() - 2 * 60 * 60_000 }), 0],
]) {
  test(`a fresh local snapshot respects ${label} off-host receipt evidence`, async () => {
    const directory = mkdtempSync(join(tmpdir(), "pit-backup-evidence-"));
    const env = privateBackupFixtureEnvironment(directory);
    let calls = 0;
    let scheduler;
    try {
      mkdirSync(backupDirectory(env));
      const backupName = "pit-20260914-130000.db";
      writeFileSync(join(backupDirectory(env), backupName), "verified local snapshot");
      const content = receipt(backupName);
      if (content !== null) writeFileSync(join(backupDirectory(env), ".offhost-upload-receipt-v1.json"), content);
      scheduler = startBackupScheduler({
        env, logger: { log() {}, warn() {}, error() {} },
        run: async () => { calls += 1; return { uploaded: true }; },
      });
      await scheduler.trigger();
      assert.equal(calls, expectedCalls);
    } finally {
      await scheduler?.stop();
      rmSync(directory, { recursive: true, force: true });
    }
  });
}

test("unconfigured private storage preserves the local-only daily cadence", async () => {
  const directory = mkdtempSync(join(tmpdir(), "pit-backup-local-only-"));
  const env = { NODE_ENV: "production", PIT_DATA_DIR: directory };
  let calls = 0;
  let scheduler;
  try {
    mkdirSync(backupDirectory(env));
    const snapshot = join(backupDirectory(env), "pit-20260914-130000.db");
    writeFileSync(snapshot, "verified local snapshot");
    scheduler = startBackupScheduler({
      env, logger: { log() {}, warn() {}, error() {} },
      run: async () => { calls += 1; return { uploaded: false }; },
    });
    await scheduler.trigger();
    assert.equal(calls, 0);
    const overdue = new Date(Date.now() - 25 * 60 * 60_000);
    utimesSync(snapshot, overdue, overdue);
    await scheduler.trigger();
    assert.equal(calls, 1);
  } finally {
    await scheduler?.stop();
    rmSync(directory, { recursive: true, force: true });
  }
});

for (const [label, ageMinutes, expectedCalls] of [
  ["initial backup completion", 24 * 60 - 5, 1],
  ["bounded recovery completion", 24 * 60 - 39, 1],
  ["genuinely recent recovery point", 24 * 60 - 41, 0],
]) {
  test(`daily backup timer does not lose a day after ${label}`, async () => {
    const directory = mkdtempSync(join(tmpdir(), "pit-backup-cadence-phase-"));
    const env = privateBackupFixtureEnvironment(directory);
    const timers = backupSchedulerTimers();
    let calls = 0;
    let scheduler;
    try {
      mkdirSync(backupDirectory(env));
      const backupName = "pit-20260914-130000.db";
      const snapshot = join(backupDirectory(env), backupName);
      writeFileSync(snapshot, "verified local and privately uploaded snapshot");
      const completedAt = Date.now() - ageMinutes * 60_000;
      utimesSync(snapshot, new Date(completedAt), new Date(completedAt));
      recordOffhostBackupReceipt(env, { backupName, uploadedAt: completedAt });
      scheduler = startBackupScheduler({
        env, logger: { log() {}, warn() {}, error() {} },
        run: async () => { calls += 1; return { uploaded: true }; },
        schedule: (options) => startPeriodicJob({ ...options, ...timers }),
      });
      assert.equal(timers.repeating[0].delay, 24 * 60 * 60_000);
      await timers.repeating[0].callback();
      assert.equal(calls, expectedCalls);
      assert.equal(timers.once.length, 1, "cadence alignment must not allocate additional retry timers");
    } finally {
      await scheduler?.stop();
      rmSync(directory, { recursive: true, force: true });
    }
  });
}

test("missing off-host proof coalesces concurrent triggers without overlapping backup work", async () => {
  const directory = mkdtempSync(join(tmpdir(), "pit-backup-singleflight-"));
  const env = privateBackupFixtureEnvironment(directory);
  let calls = 0;
  let release;
  let enter;
  const gate = new Promise((resolve) => { release = resolve; });
  const entered = new Promise((resolve) => { enter = resolve; });
  let scheduler;
  try {
    mkdirSync(backupDirectory(env));
    const backupName = "pit-20260914-130000.db";
    writeFileSync(join(backupDirectory(env), backupName), "verified local snapshot");
    scheduler = startBackupScheduler({
      env, logger: { log() {}, warn() {}, error() {} },
      run: async () => {
        calls += 1;
        enter();
        await gate;
        recordOffhostBackupReceipt(env, { backupName });
        return { uploaded: true };
      },
    });
    const first = scheduler.trigger();
    const duplicate = scheduler.trigger();
    assert.equal(first, duplicate);
    await entered;
    assert.equal(calls, 1);
    release();
    await first;
    await scheduler.trigger();
    assert.equal(calls, 1);
  } finally {
    release();
    await scheduler?.stop();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("unavailable off-host storage gets one recovery retry, then waits for the daily interval", async () => {
  const directory = mkdtempSync(join(tmpdir(), "pit-backup-retry-bounded-"));
  const env = privateBackupFixtureEnvironment(directory);
  const timers = backupSchedulerTimers();
  let calls = 0;
  let scheduler;
  try {
    mkdirSync(backupDirectory(env));
    writeFileSync(join(backupDirectory(env), "pit-20260914-130000.db"), "verified local snapshot");
    scheduler = startBackupScheduler({
      env, logger: { log() {}, warn() {}, error() {} },
      run: async () => { calls += 1; throw new Error("private provider unavailable"); },
      schedule: (options) => startPeriodicJob({ ...options, ...timers }),
    });
    assert.equal(timers.repeating[0].delay, 24 * 60 * 60_000);
    await timers.once[0].callback();
    assert.equal(calls, 1);
    assert.equal(timers.once[1].delay, 15 * 60_000);
    await timers.once[1].callback();
    assert.equal(calls, 2);
    assert.equal(timers.once.length, 2, "failed recovery must not create a retry loop");
    await timers.repeating[0].callback();
    assert.equal(calls, 3);
    assert.equal(timers.once.length, 3, "only the next daily slot opens a new recovery window");
  } finally {
    await scheduler?.stop();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a confirmed upload whose receipt write fails recovers the receipt without a second upload", async () => {
  const directory = mkdtempSync(join(tmpdir(), "pit-backup-receipt-retry-"));
  const env = privateBackupFixtureEnvironment(directory);
  const timers = backupSchedulerTimers();
  let spawns = 0;
  let scheduler;
  try {
    mkdirSync(backupDirectory(env));
    writeFileSync(join(backupDirectory(env), "pit-20260914-120000.db"), "verified local snapshot");
    const receiptPath = join(backupDirectory(env), ".offhost-upload-receipt-v1.json");
    mkdirSync(receiptPath);
    const backupName = "pit-20260914-130000.db";
    const fakeSpawn = () => {
      spawns += 1;
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      queueMicrotask(() => {
        writeFileSync(join(backupDirectory(env), backupName), "verified uploaded snapshot");
        child.emit("close", 0);
      });
      return child;
    };
    scheduler = startBackupScheduler({
      env, logger: { log() {}, warn() {}, error() {} },
      run: ({ signal }) => runScheduledBackup({ env, signal, spawnProcess: fakeSpawn }),
      schedule: (options) => startPeriodicJob({ ...options, ...timers }),
    });
    assert.equal(await timers.once[0].callback(), false);
    assert.equal(spawns, 1);
    assert.equal(offhostBackupReceipt(env), null);
    rmSync(receiptPath, { recursive: true });
    assert.equal(await timers.once[1].callback(), true);
    assert.equal(offhostBackupReceipt(env).backupName, backupName);
    assert.equal(spawns, 1, "the child already confirmed its upload; only its receipt needs repair");
    assert.equal(timers.once.length, 2);
    await scheduler.trigger();
    assert.equal(spawns, 1);
  } finally {
    await scheduler?.stop();
    rmSync(directory, { recursive: true, force: true });
  }
});

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

test("a date-named directory cannot masquerade as a completed backup", () => {
  const root = mkdtempSync(join(tmpdir(), "pit-backup-directory-"));
  const env = { PIT_DATA_DIR: root };
  try {
    mkdirSync(backupDirectory(env));
    mkdirSync(join(backupDirectory(env), "pit-20260909-010203.db"));
    assert.equal(latestBackupSnapshot(env), null);
    assert.equal(shouldRunScheduledBackup(latestBackupAt(env)), true);
  } finally { rmSync(root, { recursive: true, force: true }); }
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
  const errors = [];
  const handle = { trigger() {}, stop() { return Promise.resolve(); } };
  const scheduler = startBackupScheduler({
    env: { NODE_ENV: "production", BACKUP_ENABLED: "true" },
    logger: { log() {}, warn() {}, error: (line) => errors.push(line) },
    schedule: (options) => { configuration = options; return handle; },
  });

  assert.equal(scheduler, handle);
  assert.equal(configuration.initialDelayMs, 5 * 60 * 1000);
  assert.equal(configuration.intervalMs, 24 * 60 * 60 * 1000);
  assert.equal(configuration.retryDelayMs, 15 * 60 * 1000,
    "a transient failure is retried before the next daily slot");
  assert.equal(typeof configuration.run, "function");
  assert.equal(typeof configuration.report, "function");
  configuration.report(new Error("disk temporarily busy"), {
    willRetry: true,
    retryDelayMs: configuration.retryDelayMs,
  });
  configuration.report(new Error("disk still busy"), {
    willRetry: false,
    retryDelayMs: null,
  });
  assert.match(errors[0], /one recovery retry in 15m$/);
  assert.match(errors[1], /recovery retry exhausted; waiting for the normal backup interval$/);
});
