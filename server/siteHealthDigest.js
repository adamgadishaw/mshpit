// Founder-facing operational mail. This deliberately stays outside api.js: it
// is a server-owned scheduler, not a browser-triggerable mail relay.
//
// The digest is intentionally modest. It reports only bounded aggregate state
// already held by this process/SQLite and never performs remote probes of its
// own. Consequently it cannot prove that DNS, Render, Google Workspace, or the
// public internet can reach an otherwise healthy process. Those require an
// external monitor; the email says so instead of overstating what it verified.
import { randomUUID } from "node:crypto";

import {
  backupSchedulerEnabled,
  latestBackupAt,
  offhostBackupConfigured,
} from "./backupScheduler.js";
import { sendTemplate } from "./emailService.js";
import { isProduction } from "./environment.js";
import { privateErrorLabel } from "./errors.js";
import { parseMailFrom } from "./mailer.js";
import {
  mediaConfigured,
  privateMediaIsolationStatus,
  privateVideoMediaConfigured,
} from "./media.js";
import { mediaDeletionHealth } from "./mediaDeletion.js";
import {
  ownerIdentityDeliveryScope,
  recordAndEmailDeploymentStamp,
} from "./ownerApprovals.js";
import { ownerAccount } from "./ownerIdentity.js";
import { videoVerifierRuntimeStatus } from "./videoVerifier.js";

export const SITE_HEALTH_TIME_ZONE = "America/Toronto";
export const SITE_HEALTH_DEFAULT_HOUR = 9;
export const SITE_HEALTH_TICK_MS = 5 * 60 * 1000;
export const SITE_HEALTH_CLAIM_LEASE_MS = 15 * 60 * 1000;
export const SITE_HEALTH_MAX_ATTEMPTS = 6;
export const SITE_HEALTH_MARKER_RETENTION_DAYS = 45;

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const MARKER_PREFIX = "operations.site_health_digest.v1:";
const TRUE_VALUES = new Set(["1", "true", "yes", "on", "enabled"]);
const FALSE_VALUES = new Set(["0", "false", "no", "off", "disabled"]);
const RETRY_DELAYS_MS = [5 * 60 * 1000, 30 * 60 * 1000, 2 * HOUR_MS, 6 * HOUR_MS, 6 * HOUR_MS];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/u;
const OWNER_SCOPE_RE = /^v[12]-[a-f0-9]{64}$/u;
const SAFE_CODE_RE = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/u;
const COMMIT_RE = /^[a-f0-9]{7,64}$/iu;

function liveProduction(env) {
  return String(env?.NODE_ENV || "").trim().toLowerCase() === "production" && isProduction(env);
}

export function siteHealthDigestEnabled(env = process.env) {
  const raw = String(env?.SITE_HEALTH_DIGEST_ENABLED || "").trim().toLowerCase();
  if (raw) {
    if (TRUE_VALUES.has(raw)) return liveProduction(env);
    if (FALSE_VALUES.has(raw)) return false;
    return false;
  }
  return liveProduction(env);
}

export function siteHealthDigestHour(env = process.env) {
  const raw = String(env?.SITE_HEALTH_DIGEST_HOUR ?? "").trim();
  if (!raw) return SITE_HEALTH_DEFAULT_HOUR;
  const value = Number(raw);
  return Number.isInteger(value) && value >= 0 && value <= 23 ? value : SITE_HEALTH_DEFAULT_HOUR;
}

function torontoParts(at) {
  const date = new Date(at);
  if (!Number.isFinite(date.getTime())) throw new TypeError("Site-health clock is invalid");
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: SITE_HEALTH_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const part = (type) => parts.find((entry) => entry.type === type)?.value || "";
  const day = `${part("year")}-${part("month")}-${part("day")}`;
  const hour = Number(part("hour"));
  if (!DATE_RE.test(day) || !Number.isInteger(hour)) throw new TypeError("Toronto site-health date is unavailable");
  return { day, hour };
}

export function siteHealthDigestSlot(at = Date.now(), env = process.env) {
  const parts = torontoParts(at);
  const scheduledHour = siteHealthDigestHour(env);
  return Object.freeze({
    date: parts.day,
    hour: parts.hour,
    scheduledHour,
    due: parts.hour >= scheduledHour,
    timeZone: SITE_HEALTH_TIME_ZONE,
  });
}

function transaction(database, work) {
  database.exec("BEGIN IMMEDIATE");
  try {
    const result = work();
    database.exec("COMMIT");
    return result;
  } catch (error) {
    try { database.exec("ROLLBACK"); }
    catch { /* architecture: allow-empty-catch -- preserve the operational-state failure */ }
    throw error;
  }
}

function markerDateKey(date) {
  if (!DATE_RE.test(String(date || ""))) throw new TypeError("Site-health marker date is invalid");
  return `${MARKER_PREFIX}${date}`;
}

function markerKey(date, ownerScope) {
  if (!OWNER_SCOPE_RE.test(String(ownerScope || ""))) throw new TypeError("Site-health Owner scope is invalid");
  return `${markerDateKey(date)}:${ownerScope}`;
}

function parseMarker(value) {
  try {
    const parsed = JSON.parse(value || "{}");
    if (parsed?.version !== 1 || typeof parsed.state !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

function safeCode(value, fallback = "operation_failed") {
  const code = String(value || "").trim();
  return SAFE_CODE_RE.test(code) ? code : fallback;
}

export function pruneSiteHealthDigestMarkers(database, {
  at = Date.now(),
  retentionDays = SITE_HEALTH_MARKER_RETENTION_DAYS,
} = {}) {
  const days = Math.min(120, Math.max(7, Math.floor(Number(retentionDays) || SITE_HEALTH_MARKER_RETENTION_DAYS)));
  const cutoff = torontoParts(at - days * DAY_MS).day;
  return database.prepare("DELETE FROM app_meta WHERE key GLOB ? AND key < ?")
    .run(`${MARKER_PREFIX}*`, markerDateKey(cutoff)).changes;
}

/**
 * Claim one Toronto calendar-day digest with a durable lease. BEGIN IMMEDIATE
 * makes this safe if a rolling deploy briefly leaves two processes sharing the
 * disk. A stale lease may be reclaimed with the same provider idempotency key.
 */
export function claimSiteHealthDigest(database, {
  date,
  ownerScope,
  at = Date.now(),
  leaseMs = SITE_HEALTH_CLAIM_LEASE_MS,
} = {}) {
  const key = markerKey(date, ownerScope);
  const boundedLease = Math.min(HOUR_MS, Math.max(60_000, Number(leaseMs) || SITE_HEALTH_CLAIM_LEASE_MS));
  return transaction(database, () => {
    const current = parseMarker(database.prepare("SELECT value FROM app_meta WHERE key=?").get(key)?.value);
    if (current?.state === "sent" || current?.state === "dead") {
      return { claimed: false, reason: current.state, key, attempts: Number(current.attempts) || 0 };
    }
    if (current?.state === "sending" && Number(current.leaseUntil) > at) {
      return { claimed: false, reason: "in-progress", key, attempts: Number(current.attempts) || 0 };
    }
    if (current?.state === "retry" && Number(current.nextAttemptAt) > at) {
      return { claimed: false, reason: "waiting", key, attempts: Number(current.attempts) || 0,
        nextAttemptAt: Number(current.nextAttemptAt) };
    }

    const claimId = randomUUID();
    const attempts = Math.max(0, Number(current?.attempts) || 0) + 1;
    const next = {
      version: 1,
      state: "sending",
      claimId,
      attempts,
      claimedAt: at,
      leaseUntil: at + boundedLease,
    };
    database.prepare(`INSERT INTO app_meta (key,value) VALUES (?,?)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run(key, JSON.stringify(next));
    return { claimed: true, key, claimId, attempts };
  });
}

export function settleSiteHealthDigestClaim(database, {
  key,
  claimId,
  at = Date.now(),
  sent,
  status = "unknown",
  reason = null,
} = {}) {
  if (!String(key || "").startsWith(MARKER_PREFIX) || !claimId) return { settled: false, reason: "bad-claim" };
  return transaction(database, () => {
    const current = parseMarker(database.prepare("SELECT value FROM app_meta WHERE key=?").get(key)?.value);
    if (!current || current.state !== "sending" || current.claimId !== claimId) {
      return { settled: false, reason: "lease-lost" };
    }
    let next;
    if (sent) {
      next = {
        version: 1,
        state: "sent",
        attempts: current.attempts,
        sentAt: at,
        status: ["healthy", "watch", "needs_attention"].includes(status) ? status : "unknown",
      };
    } else if (Number(current.attempts) >= SITE_HEALTH_MAX_ATTEMPTS) {
      next = {
        version: 1,
        state: "dead",
        attempts: current.attempts,
        failedAt: at,
        lastErrorCode: safeCode(reason),
      };
    } else {
      const delayIndex = Math.min(Math.max(0, Number(current.attempts) - 1), RETRY_DELAYS_MS.length - 1);
      next = {
        version: 1,
        state: "retry",
        attempts: current.attempts,
        failedAt: at,
        nextAttemptAt: at + RETRY_DELAYS_MS[delayIndex],
        lastErrorCode: safeCode(reason),
      };
    }
    database.prepare("UPDATE app_meta SET value=? WHERE key=?").run(JSON.stringify(next), key);
    return { settled: true, state: next.state, attempts: next.attempts, nextAttemptAt: next.nextAttemptAt || null };
  });
}

function count(database, sql, ...params) {
  try { return Math.max(0, Number(database.prepare(sql).get(...params)?.count) || 0); }
  catch { return null; }
}

function seriousErrorStats(database, since) {
  const bucketStart = Math.floor(Number(since) / HOUR_MS) * HOUR_MS;
  try {
    const row = database.prepare(`SELECT COALESCE(SUM(b.count),0) occurrences,
        COUNT(DISTINCT b.fingerprint) kinds
      FROM error_occurrence_buckets b
      JOIN error_events e ON e.fingerprint=b.fingerprint
      WHERE b.hour_start>=? AND (e.level='fatal' OR e.status=0 OR e.status>=500)
        AND NOT (
          e.method='GET' AND e.route='/api/readiness'
          AND e.status=503 AND e.code='MEDIA_STORAGE_UNAVAILABLE'
        )`).get(bucketStart);
    return {
      occurrences: Math.max(0, Number(row?.occurrences) || 0),
      kinds: Math.max(0, Number(row?.kinds) || 0),
    };
  } catch {
    return null;
  }
}

function groupedEmailStats(database, since) {
  const result = { sent: 0, failed: 0, skipped: 0 };
  try {
    const rows = database.prepare(`SELECT status,COUNT(*) count FROM email_log
      WHERE created_at>=? GROUP BY status`).all(since);
    for (const row of rows) if (Object.hasOwn(result, row.status)) result[row.status] = Math.max(0, Number(row.count) || 0);
  } catch {
    return null;
  }
  return result;
}

function ageHours(at, timestamp) {
  const value = Number(timestamp);
  return Number.isFinite(value) && value > 0 ? Math.max(0, Math.floor((at - value) / HOUR_MS)) : null;
}

function yesNo(value) {
  return value ? "yes" : "no";
}

function numberOrUnavailable(value) {
  return Number.isFinite(value) ? String(value) : "unavailable";
}

function safeCommit(env) {
  const commit = String(env?.RENDER_GIT_COMMIT || "").trim();
  return COMMIT_RE.test(commit) ? commit.slice(0, 12).toLowerCase() : null;
}

function publishingEnabled(env) {
  return TRUE_VALUES.has(String(env?.PIT_VIDEO_PUBLISHING_ENABLED || "").trim().toLowerCase());
}

/** Build a fixed, aggregate-only snapshot suitable for founder email. */
export function collectSiteHealthDigest(database, {
  env = process.env,
  at = Date.now(),
  uptimeSeconds = process.uptime(),
} = {}) {
  let databaseReady = false;
  try { databaseReady = database.prepare("SELECT 1 ok").get()?.ok === 1; }
  catch { databaseReady = false; }

  const persistentStorageConfigured = !!String(env?.PIT_DATA_DIR || "").trim();
  const backupEnabled = backupSchedulerEnabled(env);
  let backupAgeHours = null;
  try { backupAgeHours = ageHours(at, latestBackupAt(env)); }
  catch { backupAgeHours = null; }
  const offhostConfigured = offhostBackupConfigured(env);

  const mailFrom = parseMailFrom(env?.MAIL_FROM);
  const mailConfigured = !!String(env?.RESEND_API_KEY || "").trim() && mailFrom.ok;
  const replyTo = String(env?.MAIL_REPLY_TO || "").trim();
  const replyToValid = !replyTo || parseMailFrom(replyTo).ok;

  const publicMediaConfigured = mediaConfigured(env);
  const privateVideoConfigured = privateVideoMediaConfigured(env);
  const privateIsolation = privateMediaIsolationStatus(env);
  const verifier = videoVerifierRuntimeStatus(env, at);
  let deletion = null;
  try { deletion = mediaDeletionHealth(database, { env, at }); }
  catch { deletion = null; }

  // Hourly counters keep the readout windowed. The lifetime fingerprint row is
  // useful for diagnosis but must never be mislabeled as today's volume.
  const serverFaults24h = seriousErrorStats(database, at - DAY_MS);
  const mail24h = groupedEmailStats(database, at - DAY_MS);
  const pendingOwnerApprovals = count(database, `SELECT COUNT(*) count FROM owner_approval_requests
    WHERE status='pending' AND expires_at>?`, at);

  const issues = [];
  const warnings = [];
  if (!databaseReady) issues.push("database_unavailable");
  if (!persistentStorageConfigured) issues.push("persistent_storage_unconfigured");
  if (!mailConfigured || !replyToValid) issues.push("mail_unconfigured");
  if (!backupEnabled) issues.push("backup_scheduler_disabled");
  else if (backupAgeHours === null) issues.push("backup_missing");
  else if (backupEnabled && backupAgeHours > 36) issues.push("backup_stale");
  else if (backupEnabled && backupAgeHours > 26) warnings.push("backup_aging");
  if (backupEnabled && !offhostConfigured) warnings.push("offhost_backup_unconfigured");
  if (!publicMediaConfigured || !privateVideoConfigured) issues.push("media_storage_unconfigured");
  else if (!privateIsolation.ready) issues.push("private_media_unverified");
  if (publishingEnabled(env) && !verifier.ready) issues.push("video_verifier_not_ready");
  if (!deletion) issues.push("media_cleanup_status_unavailable");
  else if (!deletion.enabled) issues.push("media_cleanup_disabled");
  if ((deletion?.deadLetter || 0) + (deletion?.ownerSweeps?.deadLetter || 0) > 0) issues.push("media_cleanup_dead_letter");
  else if ((deletion?.retrying || 0) + (deletion?.ownerSweeps?.retrying || 0) > 0) warnings.push("media_cleanup_retrying");
  if (serverFaults24h === null || mail24h === null || pendingOwnerApprovals === null) {
    issues.push("operational_telemetry_unavailable");
  }
  if ((serverFaults24h?.kinds || 0) > 0) warnings.push("server_error_patterns");
  if ((mail24h?.failed || 0) > 0) warnings.push("email_delivery_failures");
  if ((pendingOwnerApprovals || 0) > 0) warnings.push("owner_approvals_pending");

  const status = issues.length ? "needs_attention" : warnings.length ? "watch" : "healthy";
  const statusLabel = status === "needs_attention" ? "NEEDS ATTENTION" : status === "watch" ? "WATCH" : "HEALTHY";
  const commit = safeCommit(env);
  const mediaDead = (deletion?.deadLetter || 0) + (deletion?.ownerSweeps?.deadLetter || 0);
  const mediaRetry = (deletion?.retrying || 0) + (deletion?.ownerSweeps?.retrying || 0);
  const summary = `${statusLabel}: Mshpit's privacy-safe daily operational check`;
  const detail = [
    `Generated: ${new Date(at).toISOString()} (${SITE_HEALTH_TIME_ZONE} daily slot)`,
    `Release: ${commit || "unavailable"}; process uptime: ${Math.max(0, Math.floor(Number(uptimeSeconds) || 0))} seconds`,
    `Core: database ready ${yesNo(databaseReady)}; persistent data directory configured ${yesNo(persistentStorageConfigured)}`,
    `Mail: configured ${yesNo(mailConfigured)}; reply routing valid ${yesNo(replyToValid)}; last 24h sent ${numberOrUnavailable(mail24h?.sent)}, failed ${numberOrUnavailable(mail24h?.failed)}, skipped ${numberOrUnavailable(mail24h?.skipped)}`,
    `Backups: scheduled ${yesNo(backupEnabled)}; latest verified local snapshot age ${backupAgeHours === null ? "unavailable" : `${backupAgeHours}h`}; private off-host destination configured ${yesNo(offhostConfigured)}`,
    `Media: public and private storage configured ${yesNo(publicMediaConfigured && privateVideoConfigured)}; private-source privacy proof ready ${yesNo(privateIsolation.ready)}; video verifier ready ${yesNo(verifier.ready)}`,
    `Cleanup: retrying ${numberOrUnavailable(mediaRetry)}; dead-letter ${numberOrUnavailable(mediaDead)}`,
    `App and server faults: ${numberOrUnavailable(serverFaults24h?.occurrences)} occurrence(s) across ${numberOrUnavailable(serverFaults24h?.kinds)} serious pattern(s) in the hourly-bucketed last 24h`,
    `Owner approvals: ${numberOrUnavailable(pendingOwnerApprovals)} pending`,
    `Attention codes: ${issues.length ? issues.join(", ") : "none"}${warnings.length ? `; watch codes: ${warnings.join(", ")}` : ""}`,
    "Coverage limit: this in-process check cannot prove public DNS, Render control-plane/build status, Google Workspace delivery, or reachability while the app is down. Keep external Render and uptime notifications enabled.",
    `Off-host note: configuration is reported, but the current runtime does not retain independent proof of the latest remote upload.`,
  ].join("\n");

  return Object.freeze({
    status,
    summary,
    detail,
    aggregate: Object.freeze({
      generatedAt: at,
      commit,
      uptimeSeconds: Math.max(0, Math.floor(Number(uptimeSeconds) || 0)),
      databaseReady,
      persistentStorageConfigured,
      mailConfigured,
      replyToValid,
      mail24h,
      backupEnabled,
      backupAgeHours,
      offhostConfigured,
      publicMediaConfigured,
      privateVideoConfigured,
      privateMediaReady: !!privateIsolation.ready,
      videoVerifierReady: !!verifier.ready,
      mediaCleanupRetrying: mediaRetry,
      mediaCleanupDeadLetter: mediaDead,
      activeServerErrorOccurrences: serverFaults24h?.occurrences ?? null,
      activeServerErrorKinds: serverFaults24h?.kinds ?? null,
      pendingOwnerApprovals,
      issues: Object.freeze(issues),
      warnings: Object.freeze(warnings),
    }),
  });
}

export async function sendSiteHealthDigest(database, digest, {
  env = process.env,
  date,
  owner = null,
  ownerScope = null,
  sendTemplateImpl = sendTemplate,
} = {}) {
  const account = owner || ownerAccount(database);
  const resolvedScope = ownerIdentityDeliveryScope(account?.identity);
  if (!account || !resolvedScope || (ownerScope && ownerScope !== resolvedScope)) {
    return { sent: false, reason: "no-owner-email" };
  }
  const recipient = account.identity.email;
  return sendTemplateImpl("site_health_digest", {
    to: recipient,
    vars: {
      name: "Mshpit Founder",
      summary: digest.summary,
      detail: digest.detail,
    },
    idempotencyKey: `site-health-${date}-${resolvedScope}`,
  });
}

export async function runSiteHealthDigest(database, {
  env = process.env,
  at = Date.now(),
  uptimeSeconds = process.uptime(),
  sendTemplateImpl = sendTemplate,
} = {}) {
  if (!siteHealthDigestEnabled(env)) return { sent: false, reason: "disabled" };
  const slot = siteHealthDigestSlot(at, env);
  if (!slot.due) return { sent: false, reason: "not-due", slot };
  const owner = ownerAccount(database);
  const ownerScope = ownerIdentityDeliveryScope(owner?.identity);
  if (!owner || !ownerScope) return { sent: false, reason: "no-owner", slot };
  pruneSiteHealthDigestMarkers(database, { at });
  const claim = claimSiteHealthDigest(database, { date: slot.date, ownerScope, at });
  if (!claim.claimed) return { sent: false, reason: claim.reason, slot, claim };

  try {
    const digest = collectSiteHealthDigest(database, { env, at, uptimeSeconds });
    const delivery = await sendSiteHealthDigest(database, digest, {
      env,
      date: slot.date,
      owner,
      ownerScope,
      sendTemplateImpl,
    });
    const settled = settleSiteHealthDigestClaim(database, {
      key: claim.key,
      claimId: claim.claimId,
      at,
      sent: !!delivery?.sent,
      status: digest.status,
      reason: delivery?.reason || "delivery_failed",
    });
    return { sent: !!delivery?.sent, reason: delivery?.reason || null, slot, claim, settled, digest };
  } catch (error) {
    const reason = safeCode(privateErrorLabel(error));
    const settled = settleSiteHealthDigestClaim(database, {
      key: claim.key,
      claimId: claim.claimId,
      at,
      sent: false,
      reason,
    });
    return { sent: false, reason, slot, claim, settled };
  }
}

export async function recordLiveDeploymentStamp(database, {
  env = process.env,
  at = Date.now(),
  recordAndEmail = recordAndEmailDeploymentStamp,
} = {}) {
  if (!liveProduction(env)) return { created: false, reason: "not-production" };
  const commit = String(env?.RENDER_GIT_COMMIT || "").trim();
  if (!COMMIT_RE.test(commit)) return { created: false, reason: "no-commit" };
  return recordAndEmail(database, {
    env,
    at,
    commit,
    summary: `Mshpit release ${commit.slice(0, 12).toLowerCase()} is live: the web process is listening after its startup checks`,
  });
}

/** Start deployment stamping plus the bounded daily digest loop. */
export function startFounderOperationsScheduler({
  database,
  env = process.env,
  clock = Date.now,
  initialDelayMs = 30_000,
  deploymentDelayMs = 5_000,
  intervalMs = SITE_HEALTH_TICK_MS,
  runDigest = runSiteHealthDigest,
  stampDeployment = recordLiveDeploymentStamp,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  logger = console,
} = {}) {
  let stopped = false;
  let digestTimer = null;
  let deploymentTimer = null;
  let active = null;
  let deploymentActive = null;
  const enabled = siteHealthDigestEnabled(env);
  const hostedProduction = liveProduction(env);

  const report = (kind, error) => {
    try { logger?.error?.(`[health] founder ${kind} failed safely cause=${safeCode(privateErrorLabel(error))}`); }
    catch { /* architecture: allow-empty-catch -- logging cannot own the scheduler */ }
  };

  const schedule = (delay) => {
    if (stopped || !enabled) return;
    digestTimer = setTimer(async () => {
      digestTimer = null;
      if (active) await active;
      active = Promise.resolve(runDigest(database, { env, at: clock() }))
        .catch((error) => { report("digest", error); return null; })
        .finally(() => { active = null; });
      await active;
      schedule(Math.max(60_000, Number(intervalMs) || SITE_HEALTH_TICK_MS));
    }, Math.max(1_000, Number(delay) || 1_000));
    digestTimer?.unref?.();
  };

  if (hostedProduction) {
    deploymentTimer = setTimer(() => {
      deploymentTimer = null;
      deploymentActive = Promise.resolve(stampDeployment(database, { env, at: clock() }))
        .then((result) => {
          if (result?.reason) {
            logger?.error?.(`[health] founder deployment stamp skipped reason=${safeCode(result.reason)}`);
          } else if (result?.created && result?.delivery && !result.delivery.sent) {
            logger?.error?.(`[health] founder deployment receipt not sent reason=${safeCode(result.delivery.reason, "delivery_failed")}`);
          }
          return result;
        })
        .catch((error) => { report("deployment stamp", error); return null; })
        .finally(() => { deploymentActive = null; });
    }, Math.max(1_000, Number(deploymentDelayMs) || 5_000));
    deploymentTimer?.unref?.();
  }
  schedule(initialDelayMs);

  if (hostedProduction) logger?.log?.(`[health] founder operations on (${enabled ? `daily at ${siteHealthDigestHour(env)}:00 ${SITE_HEALTH_TIME_ZONE}` : "digest disabled"}).`);

  return {
    enabled,
    hostedProduction,
    tick() {
      if (active) return active;
      active = Promise.resolve(runDigest(database, { env, at: clock() }))
        .catch((error) => { report("digest", error); return null; })
        .finally(() => { active = null; });
      return active;
    },
    stop() {
      stopped = true;
      if (digestTimer !== null) clearTimer(digestTimer);
      if (deploymentTimer !== null) clearTimer(deploymentTimer);
      digestTimer = null;
      deploymentTimer = null;
      return Promise.all([active, deploymentActive].filter(Boolean));
    },
  };
}
