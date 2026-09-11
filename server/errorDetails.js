// Founder-only error detail: where an error happened and why.
//
// error_events groups occurrences into one row per problem using a finite,
// deliberately coarse identity, so a failing loop stays one row with a count.
// That identity cannot carry a file, a line, or a sentence without splitting
// every variant into its own row. This companion table holds the most recent
// detail for each grouped problem instead: the first application stack frames,
// the redacted message and its cause chain, and the release that produced it.
//
// It exists for the owner's alert email. Public failures still use the stable
// PIT-* catalogue, and Render's log line still prints only the error class
// (safeLogging.js), because those audiences must not see internals.
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { redactDiagnosticText } from "../src/domain/errorRedaction.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// Used only when a frame's path is outside this checkout (a different build
// directory). The last application root in the path wins.
const APP_DIRECTORIES = Object.freeze(["server/", "src/", "scripts/", "public/"]);
const V8_FRAME = /^\s*at\s+(?:async\s+)?(?:(.*?)\s+\()?(.+?):(\d+):(\d+)\)?\s*$/;
const FINGERPRINT_RE = /^[A-Za-z0-9_-]{1,128}$/;

export const ERROR_DETAIL_LIMITS = Object.freeze({
  location: 240,
  reason: 480,
  message: 200,
  frames: 3,
  causes: 3,
});

export function ensureErrorDetailSchema(database) {
  database.exec(`CREATE TABLE IF NOT EXISTS error_event_details (
    fingerprint TEXT PRIMARY KEY,
    release     TEXT,
    location    TEXT,
    reason      TEXT,
    updated_at  INTEGER NOT NULL
  )`);
}

export function currentRelease(env = process.env) {
  const commit = String(env?.RENDER_GIT_COMMIT || "").trim();
  return /^[0-9a-f]{7,40}$/i.test(commit) ? commit.slice(0, 12).toLowerCase() : null;
}

function readField(value, field) {
  try { return value?.[field]; }
  catch { return undefined; } // architecture: allow-empty-catch -- a throwing getter means the field carries no diagnostic
}

function boundedText(value, max) {
  if (typeof value !== "string") return null;
  const text = value.replace(/[\u0000-\u001F\u007F]+/g, " ").replace(/\s+/g, " ").trim();
  if (!text) return null;
  return text.length > max ? `${text.slice(0, max - 3).trimEnd()}...` : text;
}

function repoRelativePath(rawPath, root = REPO_ROOT) {
  let path = String(rawPath || "").trim();
  if (!path || path.startsWith("node:") || path.includes("node_modules")) return null;
  if (/^file:\/\//i.test(path)) {
    try { path = fileURLToPath(path); }
    catch { return null; } // architecture: allow-empty-catch -- a malformed file URL is not an application frame
  }
  const inside = relative(root, path);
  if (inside && !inside.startsWith("..") && !isAbsolute(inside)) return inside.split(sep).join("/");
  const normalized = path.split("\\").join("/");
  const starts = APP_DIRECTORIES.map((directory) => normalized.lastIndexOf(`/${directory}`)).filter((index) => index >= 0);
  return starts.length ? normalized.slice(Math.max(...starts) + 1) : null;
}

function applicationFrames(error, root) {
  const stack = readField(error, "stack");
  if (typeof stack !== "string") return [];
  const frames = [];
  for (const line of stack.slice(0, 16_384).split("\n").slice(1, 40)) {
    const match = V8_FRAME.exec(line);
    if (!match) continue;
    const path = repoRelativePath(match[2], root);
    if (!path) continue;
    const name = String(match[1] || "").replace(/^async\s+/, "").replace(/[^\w$.<>[\] -]/g, "").trim().slice(0, 60);
    frames.push(`${path}:${match[3]}:${match[4]}${name ? ` in ${name}` : ""}`);
    if (frames.length >= ERROR_DETAIL_LIMITS.frames) break;
  }
  return frames;
}

function causeChain(error) {
  const chain = [];
  const seen = new Set();
  let current = error;
  while (current != null && chain.length < ERROR_DETAIL_LIMITS.causes) {
    if (typeof current === "object") {
      if (seen.has(current)) break;
      seen.add(current);
    }
    chain.push(current);
    current = typeof current === "object" ? readField(current, "cause") : undefined;
  }
  return chain;
}

/**
 * The first application frames of the error, or of the nearest cause that has
 * any. A DOMException's stack is captured where it was constructed, so an abort
 * reason points at the code that aborted, past Node's own internal frames.
 */
export function describeErrorLocation(error, { root = REPO_ROOT } = {}) {
  for (const candidate of causeChain(error)) {
    const frames = applicationFrames(candidate, root);
    if (frames.length) {
      const [where, ...via] = frames;
      return boundedText(via.length ? `${where} <- ${via.join(" <- ")}` : where, ERROR_DETAIL_LIMITS.location);
    }
  }
  return null;
}

function describeOne(value) {
  if (value !== null && typeof value === "object") {
    const name = String(readField(value, "name") || "Error").replace(/[^\w$.-]/g, "").slice(0, 40) || "Error";
    const rawCode = readField(value, "code");
    const code = /^[A-Za-z0-9_.-]{1,40}$/.test(String(rawCode ?? "")) ? String(rawCode) : "";
    const message = redactDiagnosticText(readField(value, "message"), { max: ERROR_DETAIL_LIMITS.message });
    return `${name}${code ? ` [${code}]` : ""}${message ? `: ${message}` : ""}`;
  }
  const text = redactDiagnosticText(value, { max: ERROR_DETAIL_LIMITS.message });
  return text ? `Thrown value: ${text}` : "";
}

/** The redacted message of the error and each cause, outermost first. */
export function describeErrorReason(error) {
  const parts = causeChain(error).map(describeOne).filter(Boolean);
  return parts.length ? boundedText(parts.join("; caused by "), ERROR_DETAIL_LIMITS.reason) : null;
}

export function errorDetailFromError(error, options) {
  if (error === undefined) return { location: null, reason: null };
  return { location: describeErrorLocation(error, options), reason: describeErrorReason(error) };
}

const statementsByDatabase = new WeakMap();
function statements(database) {
  let prepared = statementsByDatabase.get(database);
  if (!prepared) {
    prepared = {
      upsert: database.prepare(`INSERT INTO error_event_details (fingerprint,release,location,reason,updated_at)
        VALUES (@fingerprint,@release,@location,@reason,@at)
        ON CONFLICT(fingerprint) DO UPDATE SET
          release=excluded.release,
          location=COALESCE(excluded.location,error_event_details.location),
          reason=COALESCE(excluded.reason,error_event_details.reason),
          updated_at=excluded.updated_at`),
      prune: database.prepare("DELETE FROM error_event_details WHERE fingerprint NOT IN (SELECT fingerprint FROM error_events)"),
    };
    statementsByDatabase.set(database, prepared);
  }
  return prepared;
}

/**
 * Keep the latest detail for a grouped problem. An occurrence without a
 * location or reason (a caller that had no error object) keeps the previous
 * detail rather than erasing it. Returns whether anything was written.
 */
export function recordErrorDetail(database, { fingerprint, location, reason, release = currentRelease(), at = Date.now() } = {}) {
  if (typeof fingerprint !== "string" || !FINGERPRINT_RE.test(fingerprint)) return false;
  const safeLocation = boundedText(location, ERROR_DETAIL_LIMITS.location);
  // Defence in depth: the reason may have been built from a client report.
  const safeReason = boundedText(redactDiagnosticText(reason, { max: ERROR_DETAIL_LIMITS.reason }), ERROR_DETAIL_LIMITS.reason);
  if (!safeLocation && !safeReason) return false;
  statements(database).upsert.run({
    fingerprint,
    release: typeof release === "string" && /^[0-9a-f]{7,12}$/.test(release) ? release : null,
    location: safeLocation,
    reason: safeReason,
    at: Number.isFinite(Number(at)) ? Number(at) : Date.now(),
  });
  return true;
}

export function errorDetailsByFingerprint(database, fingerprints) {
  const wanted = [...new Set((Array.isArray(fingerprints) ? fingerprints : [])
    .filter((value) => typeof value === "string" && FINGERPRINT_RE.test(value)))].slice(0, 200);
  const details = new Map();
  if (!wanted.length) return details;
  const rows = database.prepare(`SELECT fingerprint,release,location,reason FROM error_event_details
    WHERE fingerprint IN (${wanted.map(() => "?").join(",")})`).all(...wanted);
  for (const row of rows) details.set(row.fingerprint, { release: row.release, location: row.location, reason: row.reason });
  return details;
}

export function pruneErrorDetails(database) {
  return Number(statements(database).prune.run().changes) || 0;
}

/** Bounded copy for a frozen alert batch; null when there is nothing to say. */
export function boundedAlertDetail(detail) {
  if (!detail || typeof detail !== "object") return null;
  const location = boundedText(detail.location, ERROR_DETAIL_LIMITS.location);
  const reason = boundedText(detail.reason, ERROR_DETAIL_LIMITS.reason);
  if (!location && !reason) return null;
  const bounded = {};
  if (location) bounded.location = location;
  if (reason) bounded.reason = reason;
  if (typeof detail.release === "string" && /^[0-9a-f]{7,12}$/.test(detail.release)) bounded.release = detail.release;
  return bounded;
}

export function formatErrorDetailLines(detail) {
  const bounded = boundedAlertDetail(detail);
  if (!bounded) return "";
  const lines = [];
  if (bounded.location) lines.push(`Where: ${bounded.location}`);
  if (bounded.reason) lines.push(`Why: ${bounded.reason}`);
  if (bounded.release) lines.push(`Release: ${bounded.release}`);
  return lines.join("\n");
}
