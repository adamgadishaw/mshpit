import { spawn } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runBackgroundJob } from "./backgroundJobCoordinator.js";
import { privateErrorLabel } from "./errors.js";
import { isProduction } from "./environment.js";
import { boundedBackupTimeout } from "../scripts/backup-db-verification.mjs";
import { privateBackupStorageConfig } from "./backupStorageSecurity.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const SCRIPT = join(ROOT, "scripts", "backup-db.mjs");
const TRUE_VALUES = new Set(["1", "true", "yes", "on", "enabled"]);
const FALSE_VALUES = new Set(["0", "false", "no", "off", "disabled"]);
const BACKUP_NAME = /^pit-\d{8}-\d{6}\.db$/;
const OFFHOST_RECEIPT_NAME = ".offhost-upload-receipt-v1.json";
const UPLOAD_KEYS = ["BACKUP_S3_ENDPOINT", "BACKUP_S3_BUCKET", "BACKUP_S3_ACCESS_KEY_ID", "BACKUP_S3_SECRET_ACCESS_KEY"];
const HOUR_MS = 60 * 60 * 1000;
const FUTURE_CLOCK_SKEW_MS = 5 * 60 * 1000;

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

export function latestBackupSnapshot(env = process.env) {
  const directory = backupDirectory(env);
  if (!existsSync(directory)) return null;
  let latest = null;
  for (const name of readdirSync(directory)) {
    if (!BACKUP_NAME.test(name)) continue;
    try {
      const updatedAt = statSync(join(directory, name)).mtimeMs || 0;
      if (updatedAt > 0 && (!latest || updatedAt > latest.updatedAt
        || (updatedAt === latest.updatedAt && name > latest.name))) {
        latest = { name, updatedAt };
      }
    } catch {
      // architecture: allow-empty-catch -- a snapshot may disappear during
      // retention; one raced stat must not hide other completed snapshots.
    }
  }
  return latest;
}

export function latestBackupAt(env = process.env) {
  return latestBackupSnapshot(env)?.updatedAt || 0;
}

export function shouldRunScheduledBackup(lastBackupAt, now = Date.now(), intervalMs = 24 * 60 * 60 * 1000) {
  const interval = Math.max(60_000, Number(intervalMs) || 24 * 60 * 60 * 1000);
  return !Number.isFinite(lastBackupAt) || lastBackupAt <= 0 || now - lastBackupAt >= interval;
}

export function offhostBackupConfigured(env = process.env) {
  return UPLOAD_KEYS.every((key) => String(env?.[key] || "").trim())
    && !!privateBackupStorageConfig(env);
}

function offhostReceiptPath(env = process.env) {
  return join(backupDirectory(env), OFFHOST_RECEIPT_NAME);
}

export function recordOffhostBackupReceipt(env = process.env, {
  backupName,
  uploadedAt = Date.now(),
} = {}) {
  const name = String(backupName || "").trim();
  const timestamp = Number(uploadedAt);
  if (!BACKUP_NAME.test(name)) throw new TypeError("Off-host backup receipt requires a published snapshot name.");
  if (!Number.isSafeInteger(timestamp) || timestamp <= 0) {
    throw new TypeError("Off-host backup receipt requires a positive millisecond timestamp.");
  }
  let published = false;
  try { published = statSync(join(backupDirectory(env), name)).isFile(); }
  catch { /* architecture: allow-empty-catch -- absence is reported by the explicit published-snapshot guard below */ }
  if (!published) throw new Error("Off-host backup receipt requires the published local snapshot.");
  const receipt = Object.freeze({ version: 1, backupName: name, uploadedAt: timestamp });
  // This marker contains no credentials, bucket names, or object keys. A torn
  // write is treated as unavailable by the reader instead of as fresh proof.
  writeFileSync(offhostReceiptPath(env), `${JSON.stringify(receipt)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  return receipt;
}

export function offhostBackupReceipt(env = process.env) {
  try {
    const parsed = JSON.parse(readFileSync(offhostReceiptPath(env), "utf8"));
    const backupName = String(parsed?.backupName || "").trim();
    const uploadedAt = Number(parsed?.uploadedAt);
    if (parsed?.version !== 1 || !BACKUP_NAME.test(backupName)
      || !Number.isSafeInteger(uploadedAt) || uploadedAt <= 0) return null;
    return Object.freeze({ version: 1, backupName, uploadedAt });
  } catch {
    return null;
  }
}

export function backupOperationalStatus(env = process.env, { now = Date.now() } = {}) {
  const at = Number(now);
  const observedAt = Number.isFinite(at) && at >= 0 ? at : Date.now();
  const schedulerEnabled = backupSchedulerEnabled(env);
  const offhostConfigured = offhostBackupConfigured(env);
  const receipt = offhostBackupReceipt(env);
  const uploadedAt = receipt?.uploadedAt || 0;
  const validClock = uploadedAt > 0 && uploadedAt <= observedAt + FUTURE_CLOCK_SKEW_MS;
  const offhostAgeHours = validClock
    ? Math.round((Math.max(0, observedAt - uploadedAt) / HOUR_MS) * 10) / 10
    : null;
  const offhostStatus = !offhostConfigured
    ? "unconfigured"
    : offhostAgeHours === null
      ? "unverified"
      : offhostAgeHours > 36
        ? "stale"
        : offhostAgeHours > 26
          ? "aging"
          : "current";
  return Object.freeze({
    schedulerEnabled,
    offhostConfigured,
    offhostStatus,
    offhostAgeHours,
    latestOffhostBackupAt: validClock ? uploadedAt : null,
    latestOffhostBackupName: validClock ? receipt.backupName : null,
  });
}

export function backupStartupWarnings(env = process.env, options = {}) {
  if (String(env?.NODE_ENV || "").trim().toLowerCase() !== "production" || !isProduction(env)) {
    return Object.freeze([]);
  }
  const status = backupOperationalStatus(env, options);
  if (!status.schedulerEnabled) return Object.freeze([]);
  if (status.offhostStatus === "unconfigured") {
    return Object.freeze(["private off-host database backups are not configured; verified snapshots exist only on the service disk"]);
  }
  if (status.offhostStatus === "unverified") {
    return Object.freeze(["private off-host database backups are configured, but this disk has no valid successful-upload receipt yet"]);
  }
  if (status.offhostStatus === "stale") {
    return Object.freeze([`the latest confirmed private off-host database upload is ${status.offhostAgeHours} hours old`]);
  }
  if (status.offhostStatus === "aging") {
    return Object.freeze([`the latest confirmed private off-host database upload is aging (${status.offhostAgeHours} hours old)`]);
  }
  return Object.freeze([]);
}

const BACKUP_CHILD_KEYS = new Set([
  "NODE_ENV", "PIT_DATA_DIR", "BACKUP_DIR", "BACKUP_KEEP",
  "BACKUP_UPLOAD_TIMEOUT_MS", "BACKUP_S3_ENDPOINT", "BACKUP_S3_BUCKET",
  "BACKUP_S3_REGION", "BACKUP_S3_ACCESS_KEY_ID", "BACKUP_S3_SECRET_ACCESS_KEY",
  "MEDIA_BUCKET", "PATH", "Path", "PATHEXT", "SystemRoot", "WINDIR",
  "TEMP", "TMP", "HOME", "USERPROFILE",
]);

export function backupChildEnvironment(env = process.env) {
  const child = {};
  for (const [key, value] of Object.entries(env || {})) {
    if (BACKUP_CHILD_KEYS.has(key) && value != null) child[key] = String(value);
  }
  child.BACKUP_DIR = backupDirectory(env);
  return child;
}

export function scheduledBackupArgs(env = process.env) {
  return [SCRIPT, ...(offhostBackupConfigured(env) ? ["--upload"] : [])];
}

export function runScheduledBackup({ env = process.env, spawnProcess = spawn, processTimeoutMs } = {}) {
  return new Promise((resolveRun, rejectRun) => {
    // Make the child and the freshness probe agree on the same persistent path.
    // Without this explicit env value the child historically defaulted to the
    // repo's ephemeral /backups directory while the scheduler inspected /data.
    // Do not hand the backup subprocess unrelated production credentials such
    // as admin, email, maps, ticketing, media-write, or verifier secrets.
    const childEnv = backupChildEnvironment(env);
    const expectsUpload = scheduledBackupArgs(env).includes("--upload");
    const beforeSnapshot = expectsUpload ? latestBackupSnapshot(env) : null;
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
      if (code !== 0) {
        finish(new Error(`backup process exited ${code}: ${(stderr || stdout).trim().slice(-2000)}`));
        return;
      }
      if (expectsUpload) {
        const published = latestBackupSnapshot(env);
        if (!published || published.name === beforeSnapshot?.name) {
          finish(new Error("backup process reported success without publishing a new snapshot"));
          return;
        }
        try {
          recordOffhostBackupReceipt(env, {
            backupName: published.name,
            uploadedAt: Date.now(),
          });
        } catch (error) {
          finish(error);
          return;
        }
      }
      finish(null, { uploaded: expectsUpload, output: stdout.trim() });
    });
  });
}

export async function runBackupJobSafely(job, report = (error) => {
  console.error(`[pit] scheduled database backup failed safely cause=${privateErrorLabel(error)}`);
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
  logger = console,
} = {}) {
  if (!backupSchedulerEnabled(env)) {
    logger.log?.("[pit] database backup scheduler disabled.");
    return;
  }
  logger.log?.(`[pit] database backups scheduled (${offhostBackupConfigured(env) ? "persistent disk + private off-host" : "persistent disk only"}).`);
  for (const warning of backupStartupWarnings(env)) {
    logger.warn?.(`[pit] backup warning: ${warning}.`);
  }
  const trigger = () => {
    void runBackupJobSafely(() => runBackgroundJob(async () => {
      if (!shouldRunScheduledBackup(latestBackupAt(env), Date.now(), intervalMs)) return;
      const result = await run();
      logger.log?.(`[pit] database backup verified${result?.uploaded ? " and uploaded off-host" : " on persistent disk"}.`);
    }), (error) => logger.error?.(`[pit] scheduled database backup failed safely cause=${privateErrorLabel(error)}`));
  };
  setTimeout(trigger, Math.max(1_000, Number(initialDelayMs) || 5 * 60 * 1000)).unref();
  setInterval(trigger, Math.max(60_000, Number(intervalMs) || 24 * 60 * 60 * 1000)).unref();
}
