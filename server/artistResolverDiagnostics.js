// Operational observations only: fixed labels and bounded numbers, never
// names, URLs, cache keys, identities, messages, or individual request history.
import { performance } from "node:perf_hooks";

const SOURCES = ["none", "catalog", "catalog_hidden", "musicbrainz_cache_fresh", "musicbrainz_cache_stale", "deezer_cache", "musicbrainz", "deezer"];
const OUTCOMES = ["matched", "no_match", "unavailable", "cancelled", "rate_limited", "invalid", "error"];
const PROVIDER_OUTCOMES = ["not_started", "matched", "no_match", "unavailable", "error", "caller_cancelled", "cancelled_after_winner", "cancelled_after_failure"];
const ORIGINS = ["not_started", "new_work", "shared_work", "memoized_result", "memoized_error", "capacity_rejected"];
const FAILURES = ["none", "network", "upstream_5xx", "provider_timeout", "circuit_open", "cooldown_state_unavailable", "rate_limited", "quota_or_forbidden", "http_error", "invalid_json", "invalid_payload", "provider_payload_error", "queue_saturated", "other"];
const CACHE_WRITES = ["not_attempted", "stored", "not_eligible", "not_written", "optional_storage_failure", "error"];
const ENTRY_POINTS = ["unknown", "event_page", "artist_page", "search_page", "other_same_origin"];
const PROVIDERS = ["musicbrainz", "deezer"];
const STORED_MATCH_SOURCES = ["catalog", "musicbrainz_cache_fresh", "musicbrainz_cache_stale", "deezer_cache"];
const MINUTE = 60_000, WINDOW = 60, MAX_DURATION = 60_000;
const BOUNDS = [25, 100, 500, 1500, 3000, 6000, 10000, MAX_DURATION];
const safeField = (value, key) => { try { return value?.[key]; } catch { return undefined; } };
const label = (value, allowed, fallback) => typeof value === "string" && allowed.includes(value) ? value : fallback;
const duration = (value) => typeof value === "number" && Number.isFinite(value) ? Math.min(MAX_DURATION, Math.max(0, Math.round(value))) : null;
const counts = (keys) => Object.fromEntries(keys.map((key) => [key, 0]));

// Observers are optional and cannot influence provider scheduling or results.
export function observeArtistLookup(observer, event) {
  try {
    if (typeof observer !== "function") return;
    const result = observer(Object.freeze(event));
    if (result && typeof result.then === "function") Promise.resolve(result).catch(() => {
      /* architecture: allow-empty-catch -- asynchronous observers are never request work */
    });
  } catch { /* architecture: allow-empty-catch -- diagnostics must never change lookup behavior */ }
}

export function artistLookupFailureCode(error) {
  let current = error;
  for (let depth = 0; current && depth < 3; depth++) {
    const code = safeField(current, "code");
    if (typeof code === "string" && FAILURES.includes(code) && code !== "none") return code;
    current = safeField(current, "cause");
  }
  return "other";
}

export function artistLookupFailureOutcome(error) {
  return safeField(error, "code") === "PROVIDER_UNAVAILABLE" ? "unavailable" : "error";
}

// Referer is optional, client-controlled context, never evidence of a person or
// bot. Accept only a configured same-origin URL and immediately discard it.
export function artistResolverEntryPoint(referer, publicOrigin) {
  try {
    if (typeof referer !== "string" || referer.length > 2048 || typeof publicOrigin !== "string") return "unknown";
    const expected = new URL(publicOrigin), url = new URL(referer);
    if (!["http:", "https:"].includes(expected.protocol) || url.origin !== expected.origin || url.username || url.password) return "unknown";
    if (/^\/event\/[^/]+\/?$/.test(url.pathname)) return "event_page";
    if (/^\/artist\/[^/]+(?:\/[^/]+)?\/?$/.test(url.pathname)) return "artist_page";
    if (url.pathname === "/search" || url.pathname === "/search/") return "search_page";
    return "other_same_origin";
  } catch { return "unknown"; }
}

export function sanitizeArtistResolverDiagnostic(value) {
  const provider = (key) => {
    const row = safeField(value, key);
    return Object.freeze({
      outcome: label(safeField(row, "outcome"), PROVIDER_OUTCOMES, "not_started"),
      origin: label(safeField(row, "origin"), ORIGINS, "not_started"),
      failure: label(safeField(row, "failure"), FAILURES, "none"),
      elapsedMs: duration(safeField(row, "elapsedMs")),
    });
  };
  return Object.freeze({ version: 1, operation: "artist_resolve",
    entryPoint: label(safeField(value, "entryPoint"), ENTRY_POINTS, "unknown"),
    source: label(safeField(value, "source"), SOURCES, "none"),
    outcome: label(safeField(value, "outcome"), OUTCOMES, "error"),
    elapsedMs: duration(safeField(value, "elapsedMs")),
    cacheWrite: label(safeField(value, "cacheWrite"), CACHE_WRITES, "not_attempted"),
    musicbrainz: provider("musicbrainz"), deezer: provider("deezer"),
  });
}

// Append to the existing failed-request line, whose UUID supplies correlation.
// No new log line, arbitrary property, raw error, or serialized request object.
export function formatArtistResolverFailure(value) {
  if (!value) return "";
  try { return ` resolver=${JSON.stringify(sanitizeArtistResolverDiagnostic(value))}`; }
  catch { return ""; }
}

const emptyTiming = () => ({ count: 0, total: 0, max: 0, histogram: BOUNDS.map(() => 0) });
const empty = () => ({ completed: 0, storedMatches: 0, sources: counts(SOURCES), outcomes: counts(OUTCOMES),
  entryPoints: counts(ENTRY_POINTS), cacheWrites: counts(CACHE_WRITES), timing: emptyTiming(),
  providers: Object.fromEntries(PROVIDERS.map((key) => [key, {
    outcomes: counts(PROVIDER_OUTCOMES), origins: counts(ORIGINS), failures: counts(FAILURES), timing: emptyTiming(),
  }])),
});
const add = (left, right) => Math.min(Number.MAX_SAFE_INTEGER, left + right);
function recordTiming(row, ms) {
  if (ms === null) return;
  row.count = add(row.count, 1); row.total = add(row.total, ms); row.max = Math.max(row.max, ms);
  const index = BOUNDS.findIndex((bound) => ms <= bound);
  row.histogram[index] = add(row.histogram[index], 1);
}
function mergeTiming(target, source) {
  for (const key of ["count", "total"]) target[key] = add(target[key], source[key]);
  target.max = Math.max(target.max, source.max);
  source.histogram.forEach((count, index) => { target.histogram[index] = add(target.histogram[index], count); });
}
function timing(row) {
  let cumulative = 0, p95UpperBoundMs = null;
  if (row.count) for (let index = 0; index < BOUNDS.length; index++) {
    cumulative += row.histogram[index];
    if (cumulative >= Math.ceil(row.count * 0.95)) { p95UpperBoundMs = BOUNDS[index]; break; }
  }
  return Object.freeze({ count: row.count, meanMs: row.count ? Math.round(row.total / row.count) : null,
    maxMs: row.count ? row.max : null, p95UpperBoundMs });
}
function mergeCounts(target, source) { for (const key of Object.keys(target)) target[key] = add(target[key], source[key]); }

export function createArtistResolverMetrics({ now = Date.now } = {}) {
  const buckets = new Map(), observedSince = now();
  function prune(at) {
    const minute = Math.floor(at / MINUTE);
    for (const key of buckets.keys()) if (key <= minute - WINDOW || key > minute) buckets.delete(key);
    return minute;
  }
  return Object.freeze({
    record(value) {
      try {
        const at = now();
        if (!Number.isSafeInteger(at) || at < 0) return;
        const minute = prune(at), detail = sanitizeArtistResolverDiagnostic(value);
        if (!buckets.has(minute)) buckets.set(minute, empty());
        const row = buckets.get(minute);
        row.completed = add(row.completed, 1);
        if (detail.outcome === "matched" && STORED_MATCH_SOURCES.includes(detail.source)) row.storedMatches = add(row.storedMatches, 1);
        for (const [field, key] of [["sources", "source"], ["outcomes", "outcome"], ["entryPoints", "entryPoint"], ["cacheWrites", "cacheWrite"]]) {
          row[field][detail[key]] = add(row[field][detail[key]], 1);
        }
        recordTiming(row.timing, detail.elapsedMs);
        for (const key of PROVIDERS) {
          for (const [field, item] of [["outcomes", "outcome"], ["origins", "origin"], ["failures", "failure"]]) {
            row.providers[key][field][detail[key][item]] = add(row.providers[key][field][detail[key][item]], 1);
          }
          recordTiming(row.providers[key].timing, detail[key].elapsedMs);
        }
      } catch { /* architecture: allow-empty-catch -- aggregate bookkeeping is optional */ }
    },
    snapshot() {
      try {
        const at = now();
        if (!Number.isSafeInteger(at) || at < 0) throw new RangeError("Invalid observation clock");
        const minute = prune(at), row = empty();
        for (const bucket of buckets.values()) {
          row.completed = add(row.completed, bucket.completed);
          row.storedMatches = add(row.storedMatches, bucket.storedMatches);
          for (const field of ["sources", "outcomes", "entryPoints", "cacheWrites"]) mergeCounts(row[field], bucket[field]);
          mergeTiming(row.timing, bucket.timing);
          for (const key of PROVIDERS) {
            for (const field of ["outcomes", "origins", "failures"]) mergeCounts(row.providers[key][field], bucket.providers[key][field]);
            mergeTiming(row.providers[key].timing, bucket.providers[key].timing);
          }
        }
        return Object.freeze({ version: 1, operation: "artist_resolve", scope: "process_local_handler_completions",
          observedSince, collectedAt: at, windowStartedAt: Math.max(observedSince, (minute - WINDOW + 1) * MINUTE),
          windowMinutes: WINDOW, durationCapMs: MAX_DURATION, completed: row.completed, storedMatches: row.storedMatches,
          sources: Object.freeze(row.sources), outcomes: Object.freeze(row.outcomes), entryPoints: Object.freeze(row.entryPoints),
          cacheWrites: Object.freeze(row.cacheWrites), timing: timing(row.timing),
          providers: Object.freeze(Object.fromEntries(PROVIDERS.map((key) => [key, Object.freeze({
            outcomes: Object.freeze(row.providers[key].outcomes), origins: Object.freeze(row.providers[key].origins),
            failures: Object.freeze(row.providers[key].failures), timing: timing(row.providers[key].timing),
          })]))),
        });
      } catch {
        return Object.freeze({ version: 1, operation: "artist_resolve", scope: "process_local_handler_completions", state: "unavailable" });
      }
    },
  });
}

export const artistResolverMetrics = createArtistResolverMetrics();

export function createArtistResolverDiagnostics({ capture, entryPoint, metrics = artistResolverMetrics, monotonicNow = () => performance.now() } = {}) {
  const clock = () => { try { const value = monotonicNow(); return Number.isFinite(value) ? value : 0; } catch { return 0; } };
  const started = clock(), starts = {}, state = { entryPoint, source: "none", outcome: "error", cacheWrite: "not_attempted" };
  for (const key of PROVIDERS) state[key] = { outcome: "not_started", origin: "not_started", failure: "none", elapsedMs: null };
  let finished = false;
  return Object.freeze({
    source(value) { if (!finished) state.source = label(value, SOURCES, "none"); },
    result(value) { if (!finished) state.outcome = label(value, OUTCOMES, "error"); },
    cacheWrite(value) { if (!finished) state.cacheWrite = label(value, CACHE_WRITES, "error"); },
    work(provider, event) {
      if (!finished && PROVIDERS.includes(provider)) state[provider].origin = label(safeField(event, "origin"), ORIGINS, "not_started");
    },
    provider(event) {
      if (finished) return;
      const key = safeField(event, "provider");
      if (!PROVIDERS.includes(key)) return;
      if (safeField(event, "type") === "start") { starts[key] = clock(); return; }
      state[key].outcome = label(safeField(event, "outcome"), PROVIDER_OUTCOMES, "error");
      state[key].failure = label(safeField(event, "failure"), FAILURES, "none");
      state[key].elapsedMs = Object.hasOwn(starts, key) ? duration(clock() - starts[key]) : null;
    },
    failed(error, cancelled = false) {
      if (finished) return;
      const code = safeField(error, "code"), status = safeField(error, "status");
      state.outcome = cancelled ? "cancelled" : code === "PROVIDER_UNAVAILABLE" ? "unavailable"
        : status === 429 ? "rate_limited" : typeof status === "number" && status >= 400 && status < 500 ? "invalid" : "error";
    },
    finish() {
      if (finished) return;
      finished = true;
      const detail = sanitizeArtistResolverDiagnostic({ ...state, elapsedMs: clock() - started });
      observeArtistLookup(capture, detail);
      try { metrics.record(detail); } catch { /* architecture: allow-empty-catch -- metrics failure cannot replace the route result */ }
    },
  });
}
