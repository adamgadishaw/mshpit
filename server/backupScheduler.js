import { spawn } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runBackgroundJob } from "./backgroundJobCoordinator.js";
import { boundedBackupTimeout } from "../scripts/backup-db-verification.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const SCRIPT = join(ROOT, "scripts", "backup-db.mjs");
const TRUE_VALUES = new Set(["1", "true", "yes", "on", "enabled"]);
const FALSE_VALUES = new Set(["0", "false", "no", "off", "disabled"]);
const BACKUP_NAME = /^pit-\d{8}-\d{6}\.db$/;
const UPLOAD_KEYS = ["BACKUP_S3_ENDPOINT", "BACKUP_S3_BUCKET", "BACKUP_S3_ACCESS_KEY_ID", "BACKUP_S3_SECRET_ACCESS_KEY"];

export function backupSchedulerEnabled(env = process.env) {
  const value = String(env?.BACKUP_ENABLED || "").trim().toLowerCase();
  if (value) {
    if (TRUE_VALUES.has(value)) return true;
    if (FALSE_VALUES.has(value)) return false;
    return false;
  }
  return String(env?.NODE_ENV || "").trim().toLowerCase() === "production";
}

export function backupDirectory(env = process.env) {
  const dataDirectory = resolve(String(env?.PIT_DATA_DIR || "").trim() || join(ROOT, "server", "data"));
  return resolve(String(env?.BACKUP_DIR || "").trim() || join(dataDirectory, "backups"));
}

export function latestBackupAt(env = process.env) {
  const directory = backupDirectory(env);
  if (!existsSync(directory)) return 0;
  let latest = 0;
  for (const name of readdirSync(directory)) {
    if (!BACKUP_NAME.test(name)) continue;
    try { latest = Math.max(latest, statSync(join(directory, name)).mtimeMs || 0); } catch {}
  }
  return latest;
}

export function shouldRunScheduledBackup(lastBackupAt, now = Date.now(), intervalMs = 24 * 60 * 60 * 1000) {
  const interval = Math.max(60_000, Number(intervalMs) || 24 * 60 * 60 * 1000);
  return !Number.isFinite(lastBackupAt) || lastBackupAt <= 0 || now - lastBackupAt >= interval;
}

export function offhostBackupConfigured(env = process.env) {
  if (!UPLOAD_KEYS.every((key) => String(env?.[key] || "").trim())) return false;
  const backupBucket = String(env.BACKUP_S3_BUCKET).trim();
  const publicMediaBucket = String(env.MEDIA_BUCKET || "").trim();
  return !publicMediaBucket || backupBucket !== publicMediaBucket;
}

export function scheduledBackupArgs(env = process.env) {
  return [SCRIPT, ...(offhostBackupConfigured(env) ? ["--upload"] : [])];
}

export function runScheduledBackup({ env = process.env, spawnProcess = spawn, processTimeoutMs } = {}) {
  return new Promise((resolveRun, rejectRun) => {
    // Make the child and the freshness probe agree on the same persistent path.
    // Without this explicit env value the child historically defaulted to the
    // repo's ephemeral /backups directory while the scheduler inspected /data.
    const childEnv = { ...env, BACKUP_DIR: backupDirectory(env) };
    const child = spawnProcess(process.execPath, scheduledBackupArgs(env), {
      cwd: ROOT,
      env: childEnv,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const append = (current, chunk) => (current + String(chunk || "")).slice(-12_000);
    child.stdout?.on?.("data", (chunk) => { stdout = append(stdout, chunk); });
    child.stderr?.on?.("data", (chunk) => { stderr = append(stderr, chunk); });
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) rejectRun(error);
      else resolveRun(result);
    };
    const timeoutMs = processTimeoutMs == null
      ? boundedBackupTimeout(env?.BACKUP_PROCESS_TIMEOUT_MS, 10 * 60 * 1000, {
        min: 30_000,
        max: 30 * 60 * 1000,
      })
      : Math.max(1, Math.round(Number(processTimeoutMs) || 1));
    const timeout = setTimeout(() => {
      // A wedged VACUUM/upload must not own the global maintenance coordinator
      // forever. SIGKILL is deliberate: the unpublished .partial file is ignored
      // and cleaned on the next run, while a graceful signal could hang too.
      try { child.kill?.("SIGKILL"); } catch {}
      finish(new Error(`backup process timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    timeout.unref?.();
    child.once("error", (error) => finish(error));
    child.once("close", (code) => {
      if (code === 0) finish(null, { uploaded: scheduledBackupArgs(env).includes("--upload"), output: stdout.trim() });
      else finish(new Error(`backup process exited ${code}: ${(stderr || stdout).trim().slice(-2000)}`));
    });
  });
}

export async function runBackupJobSafely(job, report = (error) => {
  console.error("[pit] scheduled database backup failed safely:", error);
}) {
  try {
    await job();
    return true;
  } catch (error) {
    try { report(error); } catch {}
    return false;
  }
}

export function startBackupScheduler({
  env = process.env,
  initialDelayMs = 5 * 60 * 1000,
  intervalMs = 24 * 60 * 60 * 1000,
  run = () => runScheduledBackup({ env }),
} = {}) {
  if (!backupSchedulerEnabled(env)) {
    console.log("[pit] database backup scheduler disabled.");
    return;
  }
  console.log(`[pit] database backups scheduled (${offhostBackupConfigured(env) ? "persistent disk + private off-host" : "persistent disk only"}).`);
  const trigger = () => {
    void runBackupJobSafely(() => runBackgroundJob(async () => {
      if (!shouldRunScheduledBackup(latestBackupAt(env), Date.now(), intervalMs)) return;
      const result = await run();
      console.log(`[pit] database backup verified${result?.uploaded ? " and uploaded off-host" : " on persistent disk"}.`);
    }));
  };
  setTimeout(trigger, Math.max(1_000, Number(initialDelayMs) || 5 * 60 * 1000)).unref();
  setInterval(trigger, Math.max(60_000, Number(intervalMs) || 24 * 60 * 60 * 1000)).unref();
}
