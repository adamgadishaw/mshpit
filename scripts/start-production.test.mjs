import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";

import { runStartupBackup, startProduction, startupBackupPlan } from "./start-production.mjs";

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
  await assert.rejects(
    startProduction({
      env: { NODE_ENV: "production", PIT_DATA_DIR: "/data", PIT_ALLOW_EMPTY_DB_BOOTSTRAP: "false" },
      exists: () => true,
      spawn: () => ({ status: 7 }),
      loadServer: async () => { loaded = true; },
    }),
    /backup failed with exit code 7/,
  );
  assert.equal(loaded, false);
});

test("a verified backup completes before the server module loads", async () => {
  const order = [];
  const plan = await startProduction({
    env: { NODE_ENV: "production", PIT_DATA_DIR: "/data", PIT_ALLOW_EMPTY_DB_BOOTSTRAP: "false" },
    exists: () => true,
    spawn: () => { order.push("backup"); return { status: 0 }; },
    loadServer: async () => { order.push("server"); },
  });
  assert.deepEqual(order, ["backup", "server"]);
  assert.equal(plan.backup, true);
});

test("the backup subprocess inherits the production environment", () => {
  const env = { NODE_ENV: "production", PIT_DATA_DIR: "/data", SENTINEL: "kept" };
  let call;
  runStartupBackup({ env, spawn: (...args) => { call = args; return { status: 0 }; } });
  assert.equal(call[0], process.execPath);
  assert.match(call[1][0].replaceAll("\\", "/"), /\/scripts\/backup-db\.mjs$/);
  assert.equal(call[2].env, env);
  assert.equal(call[2].stdio, "inherit");
});
