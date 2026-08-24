// Render mounts the persistent disk only for the runtime process, not during
// the build. Create and verify a consistent SQLite snapshot here, before
// importing server/index.js (whose db import applies additive migrations).
// A failed backup aborts startup before migrations. Render persistent disks do
// not support zero-downtime deploys, so this preserves data but may leave the
// service unavailable until the operator fixes the backup or rolls back.
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { backupChildEnvironment } from "../server/backupScheduler.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const BACKUP_SCRIPT = join(HERE, "backup-db.mjs");
const SERVER_ENTRY = pathToFileURL(join(ROOT, "server", "index.js")).href;

function enabled(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

export function startupBackupPlan({ env = process.env, exists = existsSync } = {}) {
  const production = String(env.NODE_ENV || "").trim().toLowerCase() === "production";
  const configured = String(env.PIT_DATA_DIR || "").trim();
  if (production && !configured) {
    return { ok: false, reason: "missing-data-directory", databasePath: null, backup: false };
  }

  const dataDirectory = resolve(configured || join(ROOT, "server", "data"));
  const databasePath = join(dataDirectory, "pit.db");
  if (exists(databasePath)) return { ok: true, reason: "existing-database", databasePath, backup: true };
  if (production && !enabled(env.PIT_ALLOW_EMPTY_DB_BOOTSTRAP)) {
    return { ok: false, reason: "missing-database", databasePath, backup: false };
  }
  return {
    ok: true,
    reason: production ? "intentional-first-boot" : "development-without-database",
    databasePath,
    backup: false,
  };
}

export function runStartupBackup({ env = process.env, spawn = spawnSync } = {}) {
  const result = spawn(process.execPath, [BACKUP_SCRIPT], {
    cwd: ROOT,
    // The pre-migration path gets the same least-privilege environment as the
    // scheduled backup worker—never admin, mail, provider, or media secrets.
    env: backupChildEnvironment(env),
    stdio: "inherit",
  });
  if (result.error) throw new Error("The pre-migration backup process could not start.", { cause: result.error });
  if (result.status !== 0) {
    throw new Error(`The pre-migration backup failed with exit code ${result.status ?? "unknown"}; refusing to start.`);
  }
}

export async function startProduction({
  env = process.env,
  exists = existsSync,
  spawn = spawnSync,
  loadServer = () => import(SERVER_ENTRY),
} = {}) {
  const plan = startupBackupPlan({ env, exists });
  if (!plan.ok) {
    throw new Error(
      plan.reason === "missing-data-directory"
        ? "PIT_DATA_DIR is required in production; refusing to start without a backup target."
        : `The production database is missing at ${plan.databasePath}; refusing to start without an explicit first-boot approval.`,
    );
  }
  if (plan.backup) runStartupBackup({ env, spawn });
  else console.log(`[pit] pre-migration backup skipped (${plan.reason}).`);
  await loadServer();
  return plan;
}

const invokedDirectly = process.argv[1]
  && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (invokedDirectly) {
  startProduction().catch((error) => {
    console.error(`[pit] production startup failed: ${error?.message || "unknown error"}`);
    process.exitCode = 1;
  });
}
