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
import { boundedBackupTimeout } from "./backup-db-verification.mjs";
import { assertDatabaseRecoveryPathReady } from "../server/databaseRecovery.js";
import { installWebAssetArchiveSnapshot, webAssetProcessEnvironment } from "../server/webAssetArchive.js";
import { WEB_ASSET_LIMITS } from "../server/webAssetManifest.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const BACKUP_SCRIPT = join(HERE, "backup-db.mjs");
const ASSET_SCRIPT = join(HERE, "web-asset-archive.mjs");
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
  const timeoutMs = boundedBackupTimeout(env.BACKUP_PROCESS_TIMEOUT_MS, 10 * 60 * 1000, {
    min: 30_000,
    max: 30 * 60 * 1000,
  });
  const localBackupEnv = backupChildEnvironment(env);
  for (const key of Object.keys(localBackupEnv)) {
    if (key.startsWith("BACKUP_S3_")) delete localBackupEnv[key];
  }
  const result = spawn(process.execPath, [BACKUP_SCRIPT], {
    cwd: ROOT,
    // Startup requires a local pre-migration recovery point, not an available
    // storage provider. No --upload and no remote credentials: daily off-host
    // durability/retries belong to the scheduler, not every restart.
    env: localBackupEnv,
    windowsHide: true,
    stdio: "inherit",
    // VACUUM/integrity verification is intentionally a hard startup gate, but
    // a wedged child must not leave the persistent-disk service down forever.
    timeout: timeoutMs,
    killSignal: "SIGKILL",
  });
  if (result.error?.code === "ETIMEDOUT") {
    throw new Error(`The pre-migration backup timed out after ${timeoutMs}ms; refusing to start.`, {
      cause: result.error,
    });
  }
  if (result.error) throw new Error("The pre-migration backup process could not start.", { cause: result.error });
  if (result.signal) {
    throw new Error(`The pre-migration backup was terminated by ${result.signal}; refusing to start.`);
  }
  if (result.status !== 0) {
    throw new Error(`The pre-migration backup failed with exit code ${result.status ?? "unknown"}; refusing to start.`);
  }
}

export function runStartupWebAssetArchive({ env = process.env, spawn = spawnSync, install = installWebAssetArchiveSnapshot } = {}) {
  install(null);
  if (env.NODE_ENV !== "production" || !env.PIT_DATA_DIR || !/^[a-f0-9]{40}$/.test(env.RENDER_GIT_COMMIT || "")) {
    return { ok: false, reason: "not_configured" };
  }
  const result = spawn(process.execPath, [ASSET_SCRIPT, "prepare"], {
    cwd: ROOT, env: webAssetProcessEnvironment(env), windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"], encoding: "utf8", maxBuffer: 4 * 1024 * 1024,
    timeout: WEB_ASSET_LIMITS.deadlineMs, killSignal: "SIGKILL",
  });
  if (result.error || result.signal || result.status !== 0) return { ok: false, reason: result.error?.code === "ETIMEDOUT" ? "timeout" : "archive_unavailable" };
  try {
    const receipt = JSON.parse(result.stdout);
    if (!receipt.ok || !receipt.snapshot) return { ok: false, reason: "invalid_receipt" };
    install(receipt.snapshot);
    return { ok: true, reason: receipt.status };
  } catch { install(null); return { ok: false, reason: "invalid_receipt" }; }
}

export async function startProduction({
  env = process.env,
  exists = existsSync,
  spawn = spawnSync,
  loadServer = () => import(SERVER_ENTRY),
  prepareWebAssets = runStartupWebAssetArchive,
} = {}) {
  const plan = startupBackupPlan({ env, exists });
  if (!plan.ok) {
    throw new Error(
      plan.reason === "missing-data-directory"
        ? "PIT_DATA_DIR is required in production; refusing to start without a backup target."
        : `The production database is missing at ${plan.databasePath}; refusing to start without an explicit first-boot approval.`,
    );
  }
  if (plan.backup) {
    assertDatabaseRecoveryPathReady(plan.databasePath);
    runStartupBackup({ env, spawn });
  }
  else console.log(`[pit] pre-migration backup skipped (${plan.reason}).`);
  // Optional public-asset continuity cannot weaken the mandatory backup gate
  // or stop the current web/API release. The subprocess owns a hard deadline;
  // its verified bounded snapshot avoids scanning/hashing on request paths.
  try {
    const assets = prepareWebAssets({ env });
    if (!assets?.ok && assets?.reason !== "not_configured") console.warn("[web-assets] previous-build retention unavailable; serving current build");
  } catch {
    installWebAssetArchiveSnapshot(null);
    console.warn("[web-assets] previous-build retention unavailable; serving current build");
  }
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
