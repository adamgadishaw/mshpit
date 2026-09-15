// Bounded process-local counters. Never retain URLs, queries, identities,
// cookies, bodies or individual request records. Not a bandwidth invoice.
import { performance } from "node:perf_hooks";

const MINUTE = 60_000;
const WINDOW = 60;
const BOUNDS = [25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000, 60000, Infinity];
const CATEGORIES = ["health", "artist_lookup", "media", "api", "crawler", "document", "asset", "other"];
const SUMS = ["completed", "aborted", "serverErrors", "rateLimited", "knownResponseBytes", "responsesWithoutLength", "durationTotalMs"];
const empty = () => ({ ...Object.fromEntries(SUMS.map(key => [key, 0])), maxMs: 0, histogram: BOUNDS.map(() => 0) });

export function requestMetricCategory(pathname) {
  if (typeof pathname !== "string") return "other";
  const path = pathname.split("?", 1)[0];
  if (["/api/health", "/api/readiness", "/api/admin/health"].includes(path)) return "health";
  if (path === "/api/artists/resolve") return "artist_lookup";
  if (path.startsWith("/media/") || path.startsWith("/api/media/") || path.startsWith("/api/share-cards/")) return "media";
  if (path.startsWith("/api/")) return "api";
  if (path === "/robots.txt" || path === "/sitemap.xml" || path.startsWith("/sitemaps/")) return "crawler";
  if (/\.(?:js|css|png|jpe?g|webp|avif|svg|ico|woff2?|ttf|mp4|map)$/i.test(path)) return "asset";
  return path.startsWith("/") ? "document" : "other";
}

function merge(target, source) {
  for (const key of SUMS) target[key] += source[key];
  target.maxMs = Math.max(target.maxMs, source.maxMs);
  source.histogram.forEach((count, index) => { target.histogram[index] += count; });
}

function project(row) {
  let count = 0, bound = null;
  const rank = Math.ceil(row.completed * 0.95);
  if (rank) for (let index = 0; index < row.histogram.length; index++) {
    count += row.histogram[index];
    if (count >= rank) { bound = Number.isFinite(BOUNDS[index]) ? BOUNDS[index] : null; break; }
  }
  return Object.freeze({ completed: row.completed, aborted: row.aborted,
    serverErrors: row.serverErrors, rateLimited: row.rateLimited,
    knownResponseBytes: row.knownResponseBytes, responsesWithoutLength: row.responsesWithoutLength,
    meanMs: row.completed ? Math.round(row.durationTotalMs / row.completed) : null,
    p95UpperBoundMs: bound, maxMs: row.completed ? Math.ceil(row.maxMs) : null });
}

export function createRequestMetrics({ now = Date.now } = {}) {
  const buckets = new Map();
  const startedAt = now();
  function prune(at) {
    const minute = Math.floor(at / MINUTE);
    for (const key of buckets.keys()) if (key <= minute - WINDOW || key > minute) buckets.delete(key);
    return minute;
  }
  return Object.freeze({
    record({ category = "other", status = 0, durationMs = 0, responseBytes = null, aborted = false } = {}) {
      const minute = prune(now());
      if (!buckets.has(minute)) buckets.set(minute, new Map());
      const rows = buckets.get(minute);
      const key = CATEGORIES.includes(category) ? category : "other";
      if (!rows.has(key)) rows.set(key, empty());
      const row = rows.get(key);
      if (aborted) { row.aborted++; return; }
      const duration = Number.isFinite(durationMs) ? Math.max(0, durationMs) : 0;
      row.completed++;
      row.serverErrors += Number(status >= 500 && status <= 599);
      row.rateLimited += Number(status === 429);
      row.durationTotalMs += duration;
      row.maxMs = Math.max(row.maxMs, duration);
      row.histogram[BOUNDS.findIndex(bound => duration <= bound)]++;
      if (Number.isSafeInteger(responseBytes) && responseBytes >= 0) row.knownResponseBytes += responseBytes;
      else row.responsesWithoutLength++;
    },
    snapshot() {
      const at = now(), minute = prune(at);
      const aggregate = new Map(CATEGORIES.map(category => [category, empty()]));
      for (const rows of buckets.values()) for (const [category, row] of rows) merge(aggregate.get(category), row);
      const total = empty();
      for (const [category, row] of aggregate) if (category !== "health") merge(total, row);
      return Object.freeze({ observedSince: startedAt, collectedAt: at,
        windowStartedAt: Math.max(startedAt, (minute - WINDOW + 1) * MINUTE), windowMinutes: WINDOW,
        excludesHealthChecks: true, total: project(total),
        categories: Object.freeze(Object.fromEntries([...aggregate].map(([key, row]) => [key, project(row)]))) });
    },
  });
}

export const requestMetrics = createRequestMetrics();

export function observeRequestResponse(req, res, { pathname, metrics = requestMetrics, monotonicNow = () => performance.now() } = {}) {
  const started = monotonicNow(), category = requestMetricCategory(pathname);
  let settled = false;
  const settle = aborted => {
    if (settled) return;
    settled = true;
    res.off("finish", finished);
    res.off("close", closed);
    const length = res.getHeader("content-length");
    const noBody = req.method === "HEAD" || res.statusCode === 204 || res.statusCode === 304;
    const responseBytes = noBody ? 0 : length !== undefined && /^\d+$/.test(String(length)) ? Number(length) : null;
    metrics.record({ category, status: res.statusCode, durationMs: monotonicNow() - started, responseBytes, aborted });
  };
  const finished = () => settle(false);
  const closed = () => settle(!res.writableFinished);
  res.once("finish", finished);
  res.once("close", closed);
}

export function formatRequestMetrics(report) {
  const t = report.total;
  return `Traffic: process-local rolling 60m, excluding health checks; completed ${t.completed}; disconnected ${t.aborted}; 5xx ${t.serverErrors}; 429 ${t.rateLimited}; mean ${t.meanMs === null ? "unavailable" : `${t.meanMs}ms`}; p95 bucket ${t.p95UpperBoundMs === null ? "unavailable" : `<=${t.p95UpperBoundMs}ms`}; known response bodies ${(t.knownResponseBytes / 1048576).toFixed(1)}MiB; responses without length ${t.responsesWithoutLength}. Not total billable bandwidth.`;
}
