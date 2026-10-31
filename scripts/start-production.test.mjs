import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";

import { runStartupBackup, runStartupWebAssetArchive, startProduction, startupBackupPlan } from "./start-production.mjs";

test("production startup backs up an existing persistent database", () => {
  const plan = startupBackupPlan({
    env: { NODE_ENV: "production", PIT_DATA_DIR: "/data", PIT_ALLOW_EMPTY_DB_BOOTSTRAP: "false" },
    exists: (path) => path.replaceAll("\\", "/").endsWith("/data/pit.db"),
  });
  assert.equal(plan.ok, true);
  assert.equal(plan.backup, true);
  assert.equal(plan.reason, "existing-database");
});

test("production startup skips backup only for an explicit first boot", () => {
  assert.deepEqual(
    startupBackupPlan({
      env: { NODE_ENV: "production", PIT_DATA_DIR: "/data", PIT_ALLOW_EMPTY_DB_BOOTSTRAP: "true" },
      exists: () => false,
    }),
    { ok: true, reason: "intentional-first-boot", databasePath: resolve("/data/pit.db"), backup: false },
  );
  assert.equal(startupBackupPlan({
    env: { NODE_ENV: "production", PIT_DATA_DIR: "/data", PIT_ALLOW_EMPTY_DB_BOOTSTRAP: "false" },
    exists: () => false,
  }).ok, false);
});

test("a failed backup prevents the server module from loading", async () => {
  let loaded = false;
  let archived = false;
  await assert.rejects(
    startProduction({
      env: { NODE_ENV: "production", PIT_DATA_DIR: "/data", PIT_ALLOW_EMPTY_DB_BOOTSTRAP: "false" },
      exists: () => true,
      spawn: () => ({ status: 7 }),
      prepareWebAssets: () => { archived = true; },
      loadServer: async () => { loaded = true; },
    }),
    /backup failed with exit code 7/,
  );
  assert.equal(loaded, false);
  assert.equal(archived, false);
});

test("a timed-out backup is killed and prevents the server module from loading", async () => {
  let loaded = false;
  let spawnOptions;
  const timeoutError = Object.assign(new Error("backup timed out"), { code: "ETIMEDOUT" });
  await assert.rejects(
    startProduction({
      env: {
        NODE_ENV: "production",
        PIT_DATA_DIR: "/data",
        PIT_ALLOW_EMPTY_DB_BOOTSTRAP: "false",
        BACKUP_PROCESS_TIMEOUT_MS: "1",
      },
      exists: () => true,
      spawn: (_command, _args, options) => {
        spawnOptions = options;
        return { error: timeoutError, status: null, signal: "SIGKILL" };
      },
      loadServer: async () => { loaded = true; },
    }),
    /backup timed out after 30000ms; refusing to start/,
  );
  assert.equal(spawnOptions.timeout, 30_000, "the configurable timeout is clamped to its safe minimum");
  assert.equal(spawnOptions.killSignal, "SIGKILL");
  assert.equal(loaded, false);
});

test("a verified backup completes before optional retention and server loading", async () => {
  const order = [];
  const plan = await startProduction({
    env: { NODE_ENV: "production", PIT_DATA_DIR: "/data", PIT_ALLOW_EMPTY_DB_BOOTSTRAP: "false" },
    exists: () => true,
    spawn: () => { order.push("backup"); return { status: 0 }; },
    prepareWebAssets: () => { order.push("assets"); return { ok: true }; },
    loadServer: async () => { order.push("server"); },
  });
  assert.deepEqual(order, ["backup", "assets", "server"]);
  assert.equal(plan.backup, true);
});

test("the backup subprocess receives only its least-privilege environment", () => {
  const env = {
    NODE_ENV: "production",
    PIT_DATA_DIR: "/data",
    BACKUP_S3_ACCESS_KEY_ID: "backup-id",
    BACKUP_S3_SECRET_ACCESS_KEY: "backup-secret",
    ADMIN_PASSWORD: "must-not-leak",
    RESEND_API_KEY: "must-not-leak",
    MEDIA_SECRET_ACCESS_KEY: "must-not-leak",
  };
  let call;
  runStartupBackup({ env, spawn: (...args) => { call = args; return { status: 0 }; } });
  assert.equal(call[0], process.execPath);
  assert.match(call[1][0].replaceAll("\\", "/"), /\/scripts\/backup-db\.mjs$/);
  assert.equal(call[2].env.NODE_ENV, "production");
  assert.equal(call[2].env.PIT_DATA_DIR, "/data");
  assert.equal(call[2].env.BACKUP_S3_ACCESS_KEY_ID, undefined);
  assert.equal(call[2].env.BACKUP_S3_SECRET_ACCESS_KEY, undefined);
  assert.equal(call[1].includes("--upload"), false, "startup never waits for a remote provider");
  assert.equal(call[2].windowsHide, true);
  assert.equal(Object.hasOwn(call[2].env, "ADMIN_PASSWORD"), false);
  assert.equal(Object.hasOwn(call[2].env, "RESEND_API_KEY"), false);
  assert.equal(Object.hasOwn(call[2].env, "MEDIA_SECRET_ACCESS_KEY"), false);
  assert.equal(call[2].stdio, "inherit");
  assert.equal(call[2].timeout, 10 * 60 * 1000);
  assert.equal(call[2].killSignal, "SIGKILL");
});

test("the startup backup timeout is capped at thirty minutes", () => {
  let options;
  runStartupBackup({
    env: { BACKUP_PROCESS_TIMEOUT_MS: String(24 * 60 * 60 * 1000) },
    spawn: (_command, _args, spawnOptions) => {
      options = spawnOptions;
      return { status: 0 };
    },
  });
  assert.equal(options.timeout, 30 * 60 * 1000);
  assert.equal(options.killSignal, "SIGKILL");
});

test("optional retention failure preserves startup after the mandatory backup", async () => {
  const order = [];
  await startProduction({
    env: { NODE_ENV: "production", PIT_DATA_DIR: "/data" }, exists: () => true,
    spawn: () => { order.push("backup"); return { status: 0 }; },
    prepareWebAssets: () => { order.push("assets"); throw new Error("synthetic disk failure"); },
    loadServer: async () => { order.push("server"); },
  });
  assert.deepEqual(order, ["backup", "assets", "server"]);
});

test("retention uses a killed-on-timeout child with a bounded receipt and least privilege", () => {
  let call;
  const installed = [];
  const result = runStartupWebAssetArchive({
    env: { NODE_ENV: "production", PIT_DATA_DIR: "/data", RENDER_GIT_COMMIT: "a".repeat(40), NODE_OPTIONS: "fixture", ADMIN_PASSWORD: "fixture" },
    spawn: (...args) => { call = args; return { error: { code: "ETIMEDOUT" }, signal: "SIGKILL", status: null }; },
    install: (snapshot) => installed.push(snapshot),
  });
  assert.deepEqual(result, { ok: false, reason: "timeout" });
  assert.deepEqual(installed, [null]);
  assert.equal(call[0], process.execPath);
  assert.match(call[1][0].replaceAll("\\", "/"), /\/scripts\/web-asset-archive\.mjs$/);
  assert.equal(call[1][1], "prepare");
  assert.equal(call[2].timeout, 30_000);
  assert.equal(call[2].killSignal, "SIGKILL");
  assert.equal(call[2].maxBuffer, 4 * 1024 * 1024);
  assert.deepEqual(call[2].env, { PIT_DATA_DIR: "/data", RENDER_GIT_COMMIT: "a".repeat(40) });
});

test("retention installs only a successful verified child receipt", () => {
  const installed = [];
  const snapshot = { synthetic: true };
  const options = {
    env: { NODE_ENV: "production", PIT_DATA_DIR: "/data", RENDER_GIT_COMMIT: "a".repeat(40) },
    install: (value) => installed.push(value),
  };
  assert.deepEqual(runStartupWebAssetArchive({ ...options, spawn: () => ({ status: 0, stdout: JSON.stringify({ ok: true, status: "published", snapshot }) }) }), { ok: true, reason: "published" });
  assert.deepEqual(installed, [null, snapshot]);
  assert.deepEqual(runStartupWebAssetArchive({ ...options, spawn: () => ({ status: 0, stdout: "not JSON" }) }), { ok: false, reason: "invalid_receipt" });
  assert.equal(installed.at(-1), null);
  assert.deepEqual(runStartupWebAssetArchive({ env: {}, install: () => {}, spawn: () => assert.fail("must not spawn") }), { ok: false, reason: "not_configured" });
});
