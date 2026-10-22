import { compactVenueMapEvents, projectVenueMapEvent, venueMapPublicEventSignature } from "./venueMapCatalogueProjection.mjs";

export const VENUE_MAP_CATALOGUE_CACHE_DEFAULTS = Object.freeze({
  cacheTtlMs: 5 * 60 * 1000,
  // Existing conservative source-witness policy; not a provider contract term.
  sourceMaxAgeMs: 60 * 60 * 1000,
  refreshCooldownMs: 60 * 1000,
  failureBackoffMs: 30 * 1000,
  timeoutMs: 8000,
  maxPages: 256,
  maxEvents: 100000,
  maxInputSerializedBytes: 64 * 1024 * 1024,
  maxSerializedBytes: 12 * 1024 * 1024,
});
const DEFAULT = VENUE_MAP_CATALOGUE_CACHE_DEFAULTS;
const FAILURE_CODES = new Set(["ABORTED", "CLOCK", "CURSOR", "EVENT_LIMIT", "INPUT_LIMIT", "NO_PROGRESS", "OUTPUT_LIMIT", "PAGE_LIMIT", "SCHEMA", "TIMEOUT", "WITNESS_CONFLICT"].map(code => `VENUE_MAP_CACHE_${code}`));
const text = value => typeof value === "string" ? value.trim() : "";
const yieldToEventLoop = () => new Promise(resolve => setImmediate(resolve));

function failure(message, code) {
  const error = new Error(message); error.code = code; return error;
}
const cancelled = () => Object.assign(failure("Venue catalogue loading was cancelled.", "VENUE_MAP_CACHE_ABORTED"), { name: "AbortError" });
const reason = signal => signal?.reason instanceof Error ? signal.reason : cancelled();
const limit = (name, value, minimum, maximum) => {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new RangeError(`${name} must be an integer from ${minimum} to ${maximum}.`);
  return value;
};

function freezeDeep(value, check) {
  const pending = [value], seen = new Set();
  while (pending.length) {
    const item = pending.pop();
    if (!item || typeof item !== "object" || seen.has(item)) continue;
    seen.add(item); Object.freeze(item);
    for (const child of Object.values(item)) if (child && typeof child === "object") pending.push(child);
    if (seen.size % 256 === 0) check();
  }
  check(); return value;
}

/** In-process cache over injected shared-safe PUBLIC page projections only.
 * Caller owns scope/authorization (including exclusions from a shared cache).
 * No DB/network IO
 * is introduced here. Async readers must honor signal; sync work is checked on
 * both sides because AbortController cannot interrupt a synchronous DB call.
 * Query hints cannot bypass reuse/cooldown/backoff. A safety limit fails the
 * entire candidate rather than publishing a truncated "complete" catalogue. */
export function createVenueMapCatalogueCache({ readPage, now = Date.now, yieldControl = yieldToEventLoop,
  cacheTtlMs = DEFAULT.cacheTtlMs, sourceMaxAgeMs = DEFAULT.sourceMaxAgeMs,
  refreshCooldownMs = DEFAULT.refreshCooldownMs, failureBackoffMs = DEFAULT.failureBackoffMs,
  timeoutMs = DEFAULT.timeoutMs, maxPages = DEFAULT.maxPages, maxEvents = DEFAULT.maxEvents,
  maxInputSerializedBytes = DEFAULT.maxInputSerializedBytes, maxSerializedBytes = DEFAULT.maxSerializedBytes } = {}) {
  if (typeof readPage !== "function" || typeof now !== "function" || typeof yieldControl !== "function") throw new TypeError("A public page reader, clock and yield function are required.");
  const limits = Object.freeze({
    cacheTtlMs: limit("cacheTtlMs", cacheTtlMs, 1, DEFAULT.cacheTtlMs),
    sourceMaxAgeMs: limit("sourceMaxAgeMs", sourceMaxAgeMs, 1, DEFAULT.sourceMaxAgeMs),
    refreshCooldownMs: limit("refreshCooldownMs", refreshCooldownMs, DEFAULT.refreshCooldownMs, DEFAULT.sourceMaxAgeMs),
    failureBackoffMs: limit("failureBackoffMs", failureBackoffMs, DEFAULT.failureBackoffMs, DEFAULT.sourceMaxAgeMs),
    timeoutMs: limit("timeoutMs", timeoutMs, 1, DEFAULT.timeoutMs),
    maxPages: limit("maxPages", maxPages, 1, DEFAULT.maxPages), maxEvents: limit("maxEvents", maxEvents, 1, DEFAULT.maxEvents),
    maxInputSerializedBytes: limit("maxInputSerializedBytes", maxInputSerializedBytes, 1, DEFAULT.maxInputSerializedBytes),
    maxSerializedBytes: limit("maxSerializedBytes", maxSerializedBytes, 1, DEFAULT.maxSerializedBytes),
  });
  let complete = null, fallback = null, inflight = null, generation = 0;
  let lastAttemptAt = null, failureUntil = 0, lastFailureCode = null;
  const clock = () => {
    const value = now();
    if (!Number.isFinite(value) || !Number.isFinite(new Date(value).getTime())) throw failure("The venue catalogue clock is invalid.", "VENUE_MAP_CACHE_CLOCK");
    return value;
  };
  const retryAt = () => Math.max(lastAttemptAt === null ? 0 : lastAttemptAt + limits.refreshCooldownMs, failureUntil);
  const valid = at => complete && at >= complete.timestamp && at < complete.expires;
  const fresh = at => valid(at) && at - complete.timestamp < limits.cacheTtlMs;
  const unavailable = at => {
    const error = failure("The complete venue catalogue is temporarily unavailable. Please retry later.", "VENUE_MAP_CACHE_UNAVAILABLE");
    error.status = 503; error.statusCode = 503; error.failureCode = lastFailureCode;
    // Preserve only the bounded internal category for founder diagnostics.
    // Never retain a database error's SQL, parameters or arbitrary message.
    if (lastFailureCode) error.cause = failure("The bounded venue catalogue scan did not complete.", lastFailureCode);
    error.retryAt = Math.max(at, retryAt()); error.retryAfterMs = Math.max(0, retryAt() - at);
    return error;
  };
  const priorOrThrow = at => {
    if (!valid(at)) throw unavailable(at);
    if (!fallback) fallback = Object.freeze({ ...complete.value, refreshFailed: true, cacheStale: true, refreshRetryAt: new Date(retryAt()).toISOString() });
    return fallback;
  };

  function check(operation) {
    if (operation.controller.signal.aborted) throw reason(operation.controller.signal);
    if (clock() - operation.timestamp >= limits.timeoutMs) {
      operation.controller.abort(failure("The venue catalogue scan exceeded its deadline.", "VENUE_MAP_CACHE_TIMEOUT"));
      throw reason(operation.controller.signal);
    }
  }

  async function step(action, operation) {
    check(operation);
    const signal = operation.controller.signal;
    let rejectAborted;
    const aborted = new Promise((resolve, reject) => { rejectAborted = () => reject(reason(signal)); });
    signal.addEventListener("abort", rejectAborted, { once: true });
    try {
      return await Promise.race([Promise.resolve().then(() => { check(operation); return action(); }), aborted]);
    } finally { signal.removeEventListener("abort", rejectAborted); }
  }

  async function scan(operation) {
    const rows = [], ids = new Map(), cursors = new Set();
    let after = null, pages = 0, scannedEvents = 0, inputBytes = 2;
    while (true) {
      check(operation);
      if (pages >= limits.maxPages) throw failure("The venue catalogue page limit was exceeded.", "VENUE_MAP_CACHE_PAGE_LIMIT");
      const page = await step(() => readPage({ after, limit: 500, timestamp: operation.timestamp, signal: operation.controller.signal }), operation);
      check(operation); pages += 1;
      if (!page || !Array.isArray(page.rows) || page.rows.length > 500 || !Object.hasOwn(page, "nextCursor")
        || (page.nextCursor !== null && (typeof page.nextCursor !== "string" || !page.nextCursor || page.nextCursor.length > 2048))) throw failure("The public venue page was invalid.", "VENUE_MAP_CACHE_SCHEMA");
      if (scannedEvents + page.rows.length > limits.maxEvents) throw failure("The venue catalogue event limit was exceeded.", "VENUE_MAP_CACHE_EVENT_LIMIT");
      let added = 0;
      for (const raw of page.rows) {
        check(operation);
        if (!raw || typeof raw !== "object" || Array.isArray(raw) || !text(raw.id)) throw failure("The public venue event was invalid.", "VENUE_MAP_CACHE_SCHEMA");
        // Strip before retaining/counting. A JSON round-trip detaches nested
        // coordinate assertions from mutable page-reader objects.
        const serialized = JSON.stringify(projectVenueMapEvent(raw));
        inputBytes += Buffer.byteLength(serialized) + (scannedEvents ? 1 : 0); scannedEvents += 1;
        if (inputBytes > limits.maxInputSerializedBytes) throw failure("The venue catalogue input byte limit was exceeded.", "VENUE_MAP_CACHE_INPUT_LIMIT");
        const row = JSON.parse(serialized), signature = venueMapPublicEventSignature(row);
        if (ids.has(row.id)) {
          if (ids.get(row.id) !== signature) throw failure("The public venue scan changed an event coordinate witness.", "VENUE_MAP_CACHE_WITNESS_CONFLICT");
        } else { ids.set(row.id, signature); rows.push(row); added += 1; }
      }
      check(operation);
      if (page.nextCursor === null) {
        const value = { ...compactVenueMapEvents(rows, { fetchedAt: operation.timestamp, pages }),
          expiresAt: new Date(operation.timestamp + limits.sourceMaxAgeMs).toISOString() };
        check(operation);
        if (Buffer.byteLength(JSON.stringify(value)) > limits.maxSerializedBytes) throw failure("The venue catalogue response byte limit was exceeded.", "VENUE_MAP_CACHE_OUTPUT_LIMIT");
        return freezeDeep(value, () => check(operation));
      }
      if (page.nextCursor === after || cursors.has(page.nextCursor)) throw failure("The public venue scan repeated a cursor.", "VENUE_MAP_CACHE_CURSOR");
      if (!added && page.rows.length) throw failure("The public venue scan made no progress.", "VENUE_MAP_CACHE_NO_PROGRESS");
      cursors.add(page.nextCursor); after = page.nextCursor;
      await step(yieldControl, operation); check(operation);
    }
  }

  function start(at) {
    lastAttemptAt = at;
    const operation = { timestamp: at, generation: ++generation, controller: new AbortController(), waiters: 0, promise: null };
    inflight = operation;
    const timer = setTimeout(() => operation.controller.abort(failure("The venue catalogue scan exceeded its deadline.", "VENUE_MAP_CACHE_TIMEOUT")), limits.timeoutMs);
    operation.promise = (async () => {
      try {
        const value = await scan(operation); check(operation);
        if (inflight !== operation || generation !== operation.generation) throw cancelled();
        complete = { value, timestamp: at, expires: at + limits.sourceMaxAgeMs };
        fallback = null; failureUntil = 0; lastFailureCode = null;
        return value;
      } catch (error) {
        if (inflight === operation && generation === operation.generation) {
          const failedAt = clock();
          failureUntil = failedAt + limits.failureBackoffMs; fallback = null;
          lastFailureCode = FAILURE_CODES.has(error?.code) ? error.code : "VENUE_MAP_CACHE_READ_FAILED";
        }
        throw error;
      } finally { clearTimeout(timer); if (inflight === operation) inflight = null; }
    })();
    // architecture: allow-empty-catch -- callers observe failures; also consume a late rejection after the final disconnected caller has left.
    operation.promise.catch(() => {});
    return operation;
  }

  async function get({ signal } = {}) {
    if (signal?.aborted) throw reason(signal);
    const at = clock();
    if (fresh(at)) return complete.value;
    const operation = inflight && !inflight.controller.signal.aborted ? inflight : at >= retryAt() ? start(at) : null;
    if (!operation) return priorOrThrow(at);
    operation.waiters += 1;
    let rejectAborted;
    const aborted = new Promise((resolve, reject) => { rejectAborted = () => reject(reason(signal)); });
    signal?.addEventListener("abort", rejectAborted, { once: true });
    if (signal?.aborted) rejectAborted();
    try { return await Promise.race([operation.promise, aborted]); }
    catch (error) { if (signal?.aborted) throw reason(signal); return priorOrThrow(clock()); }
    finally {
      signal?.removeEventListener("abort", rejectAborted); operation.waiters -= 1;
      if (!operation.waiters && inflight === operation) operation.controller.abort(cancelled());
    }
  }

  return Object.freeze({ get, limits, inspect: () => Object.freeze({ hasComplete: Boolean(complete), inflight: Boolean(inflight),
    fetchedAt: complete?.value.fetchedAt || null, expiresAt: complete?.value.expiresAt || null,
    lastAttemptAt: lastAttemptAt === null ? null : new Date(lastAttemptAt).toISOString(), retryAt: new Date(retryAt()).toISOString(), lastFailureCode }) });
}
