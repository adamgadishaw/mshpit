// Error aggregation and alerting.
//
// Render's log tail is all this app had: nothing survives a restart, nothing is
// searchable, and nobody is told when something breaks. This keeps a bounded,
// deduplicated record in the database the app already has, and emails a digest
// through the mail path that already exists. No third-party service, no new
// dependency, and it degrades to "console only" if either half fails.
//
// Three rules shape the whole design:
//
//   1. ONE ROW PER PROBLEM, not per occurrence. A 500 in a loop is one row with
//      a count. Per-occurrence rows would fill a 1GB disk and bury the signal.
//   2. NOTHING USER-AUTHORED IS STORED. Route patterns, stable codes, sanitized
//      cause names and a server-generated request UUID only — the same safe
//      diagnostic shape the console line prints.
//   3. LOGGING MUST NEVER BREAK A REQUEST, and alerting must never storm. Every
//      entry point swallows its own failure, and alerts are a rate-limited
//      digest rather than one mail per error.
import { createHash } from "node:crypto";
import { errorStmts } from "./db.js";
import { cleanEmail, isEmail } from "../src/domain/validation.mjs";

const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_ROWS = 2000;
const HOUR_MS = 60 * 60 * 1000;
const hourStart = (value) => Math.floor(Number(value) / HOUR_MS) * HOUR_MS;

// A digest, not a notification per error. During an outage the difference is
// one email versus thousands, and thousands means the alert gets muted and the
// next real incident is missed.
const DEFAULT_COOLDOWN_MS = 30 * 60 * 1000;

// Re-entrancy guard. If sending an alert fails and that failure were recorded as
// an error, it could trigger another alert. Nothing recorded while this is set
// can schedule mail.
let alerting = false;
let lastAlertAt = 0;
let alertedThrough = 0;

// Each field is matched against a SHAPE and replaced wholesale when it does not
// fit, rather than filtered character by character. Filtering is the wrong tool:
// stripping the punctuation out of "password=hunter2" leaves "passwordhunter2",
// so a loose filter still persists the secret. An allowlist of shapes means
// anything unexpected is discarded entirely instead of partially cleaned.
const shaped = (value, pattern, fallback, max) => {
  let text;
  try { text = String(value ?? "").trim(); } catch { return fallback; }
  if (!text) return fallback;
  if (text.length > max) return fallback;
  return pattern.test(text) ? text : fallback;
};

// "SqliteError", "AbortError/SQLITE_BUSY" — an error identity, never a message.
const CAUSE_RE = /^[A-Za-z][A-Za-z0-9_.]{0,38}(\/[A-Za-z0-9_.]{1,38})?$/;
// A stable catalogue code.
const CODE_RE = /^[A-Za-z][A-Za-z0-9_-]{0,38}$/;
// A route PATTERN. No query string, so no search terms or tokens can ride along.
const ROUTE_RE = /^[A-Za-z0-9/:._-]{1,80}$/;
const METHOD_RE = /^[A-Z]{3,7}$/;
const REQUEST_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function alertCooldownMs(env = process.env) {
  const raw = Number(env?.ERROR_ALERT_COOLDOWN_MIN);
  return Number.isFinite(raw) && raw > 0 ? raw * 60 * 1000 : DEFAULT_COOLDOWN_MS;
}

export function alertsEnabled(env = process.env) {
  const raw = String(env?.ERROR_ALERTS_ENABLED ?? "").trim().toLowerCase();
  if (!raw) return true;
  return !["0", "false", "no", "off"].includes(raw);
}

// Operational delivery must not own the bootstrap administrator identity.
// ALERT_EMAIL can move to a monitored Workspace queue without transferring the
// root admin, rotating its password, or revoking active admin sessions.
export function alertRecipient(env = process.env) {
  const operations = cleanEmail(env?.ALERT_EMAIL);
  if (isEmail(operations)) return operations;
  const admin = cleanEmail(env?.ADMIN_EMAIL);
  return isEmail(admin) ? admin : "";
}

export function fingerprintOf({ level, code, status, method, route, cause }) {
  return createHash("sha256")
    .update([level, code, status, method, route, cause].join("|"))
    .digest("hex").slice(0, 24);
}

/**
 * Record one occurrence. Safe to call from a catch block: it never throws, so a
 * logging failure cannot turn a handled 500 into an unhandled one.
 */
export function recordError({ level = "error", code = "", status = 0, method = "", route = "", cause = "", requestId = "", at = Date.now() } = {}) {
  try {
    const entry = {
      level: level === "fatal" ? "fatal" : "error",
      code: shaped(code, CODE_RE, "UNKNOWN", 40),
      status: Number.isFinite(Number(status)) ? Number(status) : 0,
      method: shaped(method, METHOD_RE, "", 8),
      // The PATTERN, never the path.
      route: shaped(route, ROUTE_RE, "", 80),
      cause: shaped(cause, CAUSE_RE, "unclassified", 80),
      requestId: shaped(requestId, REQUEST_ID_RE, null, 36),
    };
    const fingerprint = fingerprintOf(entry);
    const recordedAt = Number.isFinite(Number(at)) ? Number(at) : Date.now();
    errorStmts.record.run({ ...entry, fingerprint, at: recordedAt });
    errorStmts.recordBucket.run(fingerprint, hourStart(recordedAt));
    return fingerprint;
  } catch {
    return null;
  }
}

/** Age out old rows, then hard-cap the table. Cheap enough to run on a timer. */
export function pruneErrors(now = Date.now()) {
  try {
    errorStmts.prune.run(now - RETENTION_MS);
    errorStmts.pruneBuckets.run(hourStart(now - RETENTION_MS));
    const rows = errorStmts.countRows.get().c;
    if (rows > MAX_ROWS) {
      // Drop the oldest overflow in one statement rather than row by row.
      const cutoff = errorStmts.oldest.all(rows - MAX_ROWS).pop();
      if (cutoff) errorStmts.pruneBelow.run(cutoff.last_seen);
    }
  } catch {}
}

export function recentErrors(limit = 50) {
  try { return errorStmts.recent.all(Math.min(Math.max(1, limit), 200)); }
  catch { return []; }
}

export function errorStats(sinceMs) {
  if (Number(sinceMs) > Date.now()) return { occurrences: 0, kinds: 0 };
  try {
    const totals = errorStmts.totalSince.get(hourStart(sinceMs));
    return { occurrences: totals.c, kinds: totals.kinds };
  } catch { return { occurrences: 0, kinds: 0 }; }
}

/**
 * Email a digest of what has gone wrong since the last alert.
 *
 * Deliberately time-based and global rather than per-error: an outage produces
 * many distinct fingerprints at once, so a per-fingerprint rule would still send
 * a burst. One mail per cooldown, covering everything, is the only shape that
 * stays useful during the incident it exists for.
 *
 * Returns a reason string when it declines, which is what the tests assert on.
 */
export async function maybeAlert({ now = Date.now(), force = false } = {}) {
  if (alerting) return { sent: false, reason: "reentrant" };
  if (!alertsEnabled()) return { sent: false, reason: "disabled" };
  if (!force && now - lastAlertAt < alertCooldownMs()) return { sent: false, reason: "cooling-down" };

  const windowStart = alertedThrough || now - alertCooldownMs();
  let rows;
  try { rows = errorStmts.since.all(hourStart(windowStart), 20); }
  catch { return { sent: false, reason: "unavailable" }; }
  // Only server faults page anybody. A 404 or a validation error is not news.
  const serious = rows.filter((r) => r.level === "fatal" || r.status === 0 || r.status >= 500);
  if (!serious.length) return { sent: false, reason: "nothing-serious" };

  alerting = true;
  try {
    const { sendTemplate } = await import("./emailService.js");
    const recipient = alertRecipient();
    if (!recipient) return { sent: false, reason: "no-alert-email" };

    const total = serious.reduce((sum, r) => sum + r.count, 0);
    const lines = serious.map((r) => {
      const where = `${r.method} ${r.route}`.trim() || "(no route)";
      const correlation = r.last_request_id ? `  request ${r.last_request_id}` : "";
      return `${r.count}x  ${r.level === "fatal" ? "FATAL" : r.status}  ${where}  ${r.code || "-"}${r.cause ? `  (${r.cause})` : ""}${correlation}`;
    }).join("\n");

    const result = await sendTemplate("error_alert", {
      to: recipient,
      vars: {
        name: "there",
        summary: `${total} error${total === 1 ? "" : "s"} across ${serious.length} kind${serious.length === 1 ? "" : "s"}`,
        detail: lines,
      },
      // One alert per cooldown window, so a retry cannot double-send.
      idempotencyKey: `error-alert-${Math.floor(now / alertCooldownMs())}`,
    });
    lastAlertAt = now;
    alertedThrough = now;
    return { sent: !!result.sent, reason: result.reason ?? null, kinds: serious.length, occurrences: total };
  } catch {
    // A failed alert must not itself become a recorded error, or the two would
    // feed each other.
    lastAlertAt = now;
    return { sent: false, reason: "alert-failed" };
  } finally {
    alerting = false;
  }
}

/** Test seam: the module keeps alert state in memory by design. */
export function resetAlertStateForTests() {
  alerting = false;
  lastAlertAt = 0;
  alertedThrough = 0;
}
