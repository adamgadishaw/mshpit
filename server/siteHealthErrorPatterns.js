// The daily operations email needs enough metadata to identify a problem, not
// the member content or exception detail involved. Unknown fields are withheld
// whole. A route-shaped URL alone is not proof that it is a route pattern.
import { ERROR_CATALOG } from "./errors.js";

const HOUR_MS = 3_600_000;
export const SITE_HEALTH_ERROR_PATTERN_LIMIT = 8;
const KNOWN_CODES = new Set([
  ...Object.keys(ERROR_CATALOG), "UNKNOWN", "UNHANDLED", "PROCESS",
  "PIT-APP-001", "PIT-APP-002", "PIT-APP-003",
]);
const KNOWN_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS", "PROCESS", "CLIENT"]);
// This is deliberately a small, exact diagnostic vocabulary, not another
// router. Other routes still have code/status/fingerprint for moderation lookup.
const KNOWN_ROUTES = new Set([
  "/api/media/assets", "/api/media/assets/:id/finalize", "/api/media/assets/:id",
  "/api/share-cards/render", "/api/artists/resolve", "/api/tourdates",
  "/api/feed", "/api/posts", "/api/posts/:id", "/api/posts/:id/comments",
  "/api/posts/:id/like", "/api/login", "/api/logout", "/api/signup", "/api/signup/cancel",
  "/api/me", "/api/going", "/api/ratings", "/media/landing/:postId",
  "uncaughtException", "unhandledRejection",
  ...["landing", "artist", "venue", "show", "post", "artists", "venues", "events",
    "concerts", "search", "discover", "feed", "you", "auth", "settings", "app"]
    .map((surface) => `/client/${surface}`),
]);

const nonnegativeInteger = (value) => Math.max(0, Math.floor(Number(value) || 0));

function patternMetadata(row) {
  return Object.freeze({
    fingerprint: typeof row.fingerprint === "string" && /^[a-f0-9]{24}$/.test(row.fingerprint)
      ? row.fingerprint : null,
    code: KNOWN_CODES.has(row.code) ? row.code : "UNKNOWN",
    level: row.level === "fatal" ? "fatal" : "error",
    status: Number.isInteger(row.status) && (row.status === 0 || (row.status >= 100 && row.status <= 599))
      ? row.status : null,
    method: KNOWN_METHODS.has(row.method) ? row.method : null,
    route: KNOWN_ROUTES.has(row.route) ? row.route : null,
    occurrences: nonnegativeInteger(row.occurrences),
    firstObservedHour: row.first_hour,
    lastObservedHour: row.last_hour,
  });
}

/**
 * Totals and ranked patterns come from the SAME query/window. These are bucket
 * counts, not retained lifetime totals. Hour granularity cannot recover exact
 * event times inside either boundary hour, including a historical end hour.
 */
export function collectSeriousErrorPatterns(database, { since, until } = {}) {
  if (!Number.isSafeInteger(since) || !Number.isSafeInteger(until)
    || since < 0 || until < since || until > 8_640_000_000_000_000 - HOUR_MS) return null;
  const startedAt = Math.floor(since / HOUR_MS) * HOUR_MS;
  const finalHour = Math.floor(until / HOUR_MS) * HOUR_MS;
  try {
    const rows = database.prepare(`WITH active AS (
      SELECT e.fingerprint,e.level,e.code,e.status,e.method,e.route,
        SUM(b.count) occurrences,MIN(b.hour_start) first_hour,MAX(b.hour_start) last_hour
      FROM error_occurrence_buckets b
      JOIN error_events e ON e.fingerprint=b.fingerprint
      WHERE b.hour_start>=? AND b.hour_start<=? AND b.count>0
        AND (e.level='fatal' OR e.status=0 OR e.status>=500)
        AND NOT (e.method='GET' AND e.route='/api/readiness'
          AND e.status=503 AND e.code='MEDIA_STORAGE_UNAVAILABLE')
      GROUP BY e.fingerprint
    ) SELECT *,SUM(occurrences) OVER () total_occurrences,COUNT(*) OVER () total_kinds
      FROM active ORDER BY occurrences DESC,last_hour DESC,fingerprint ASC LIMIT ?`)
      .all(startedAt, finalHour, SITE_HEALTH_ERROR_PATTERN_LIMIT);
    const kinds = nonnegativeInteger(rows[0]?.total_kinds);
    return Object.freeze({
      occurrences: nonnegativeInteger(rows[0]?.total_occurrences),
      kinds,
      startedAt,
      collectedThrough: until,
      bucketEndExclusive: finalHour + HOUR_MS,
      patterns: Object.freeze(rows.map(patternMetadata)),
      omittedKinds: Math.max(0, kinds - rows.length),
    });
  } catch {
    return null;
  }
}

export function formatSeriousErrorPatterns(report) {
  if (!report) return ["Fault-pattern details: unavailable; check moderation and server logs."];
  const lines = [
    `Fault window: ${new Date(report.startedAt).toISOString()} to ${new Date(report.collectedThrough).toISOString()} (hourly counters; boundary hours are approximate).`,
  ];
  for (const pattern of report.patterns) {
    const status = pattern.level === "fatal" ? "FATAL" : pattern.status ?? "unknown status";
    const operation = [pattern.method, pattern.route || "route withheld; check moderation"].filter(Boolean).join(" ");
    lines.push(`${pattern.occurrences}x ${status} ${operation} / ${pattern.code}; pattern ${pattern.fingerprint || "unavailable"}; latest affected hour ${new Date(pattern.lastObservedHour).toISOString()}`);
  }
  if (report.omittedKinds) lines.push(`${report.omittedKinds} additional pattern(s) are not listed here; check moderation.`);
  return lines;
}
