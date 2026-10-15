// MusicBrainz permits one request per second per application/IP. Every feature
// shares this process-wide gate. The gate is deliberately bounded: an upstream
// outage must not turn a one-request-per-second provider into an ever-growing
// in-process backlog that consumes memory and makes interactive requests hang.
import { PROVIDER_RETRY_AFTER_MAX_MS, withProviderRetryDeadline } from "./providerResponsePolicy.js";

export const MUSICBRAINZ_REQUEST_INTERVAL_MS = 1_100;
export const MUSICBRAINZ_MAX_PENDING_REQUESTS = 8;
export const MUSICBRAINZ_MAX_QUEUE_WAIT_MS = 10_000;
export const MUSICBRAINZ_BREAKER_BASE_MS = 30_000;
export const MUSICBRAINZ_BREAKER_MAX_MS = 5 * 60_000;

function abortError(signal) {
  return signal?.reason || new DOMException("Aborted", "AbortError");
}

function abortableDelay(milliseconds, { signal } = {}) {
  if (signal?.aborted) return Promise.reject(abortError(signal));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(finish, Math.max(0, milliseconds));
    // An awaited request also runs in catalogue CLIs. Keep the cooldown alive;
    // cancellation clears it when the caller no longer needs the slot.
    function finish() {
      signal?.removeEventListener("abort", abort);
      resolve();
    }
    function abort() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      reject(abortError(signal));
    }
    signal?.addEventListener("abort", abort, { once: true });
  });
}

export class MusicBrainzThrottleError extends Error {
  constructor(code, message, retryAfterMs = null, at = Date.now()) {
    super(message);
    this.name = "MusicBrainzThrottleError";
    this.code = code;
    this.status = 503;
    this.retryable = true;
    this.retryAfterMs = retryAfterMs != null && Number.isFinite(Number(retryAfterMs))
      ? Math.max(0, Math.trunc(Number(retryAfterMs)))
      : null;
    this.retryAt = this.retryAfterMs == null ? null : at + this.retryAfterMs;
  }
}

function transientProviderFailure(error) {
  const status = Number(error?.status);
  return error?.code === "network"
    || error?.code === "rate_limited"
    || error?.code === "upstream_5xx"
    || status === 429
    || (Number.isInteger(status) && status >= 500);
}

function providerRefusedRequests(error) {
  const status = Number(error?.status);
  return error?.code === "quota_or_forbidden" || status === 401 || status === 403;
}

function deterministicProviderResponse(error) {
  const status = Number(error?.status);
  return Number.isInteger(status) && status >= 400 && status < 500
    && status !== 401 && status !== 403 && status !== 429;
}

function boundedInteger(value, fallback, minimum, maximum) {
  const numeric = Number(value);
  return Number.isFinite(numeric)
    ? Math.max(minimum, Math.min(maximum, Math.trunc(numeric)))
    : fallback;
}

export function createMusicBrainzRequestThrottle({
  minimumIntervalMs = MUSICBRAINZ_REQUEST_INTERVAL_MS,
  maxPendingRequests = MUSICBRAINZ_MAX_PENDING_REQUESTS,
  interactiveReservedSlots = 2,
  maxQueueWaitMs = MUSICBRAINZ_MAX_QUEUE_WAIT_MS,
  breakerFailureThreshold = 2,
  breakerBaseMs = MUSICBRAINZ_BREAKER_BASE_MS,
  breakerMaxMs = MUSICBRAINZ_BREAKER_MAX_MS,
  clock = () => Date.now(),
  wait = abortableDelay,
  cooldownStore = null,
  onCooldownPersistenceError = (operation) => console.error(`[musicbrainz] cooldown state ${operation} failed; provider requests remain bounded.`),
} = {}) {
  if (cooldownStore && (typeof cooldownStore.readDeadline !== "function" || typeof cooldownStore.extendDeadline !== "function")) {
    throw new TypeError("MusicBrainz cooldown storage requires readDeadline and extendDeadline.");
  }
  const interval = boundedInteger(minimumIntervalMs, MUSICBRAINZ_REQUEST_INTERVAL_MS, 1_000, 60_000);
  const capacity = boundedInteger(maxPendingRequests, MUSICBRAINZ_MAX_PENDING_REQUESTS, 1, 1_000);
  const interactiveReserve = boundedInteger(interactiveReservedSlots, 2, 0, Math.max(0, capacity - 1));
  const backgroundCapacity = capacity - interactiveReserve;
  const queueDeadline = boundedInteger(maxQueueWaitMs, MUSICBRAINZ_MAX_QUEUE_WAIT_MS, 1, 10 * 60_000);
  const failureThreshold = boundedInteger(breakerFailureThreshold, 2, 1, 20);
  const breakerBase = boundedInteger(breakerBaseMs, MUSICBRAINZ_BREAKER_BASE_MS, 1, 60 * 60_000);
  const breakerMaximum = boundedInteger(breakerMaxMs, MUSICBRAINZ_BREAKER_MAX_MS, breakerBase, 24 * 60 * 60_000);

  const queue = [];
  let active = null;
  let lastStartedAt = null;
  let consecutiveFailures = 0;
  let breakerTrips = 0;
  let breakerOpenUntil = 0;
  let highestObservedCooldownDeadline = 0;
  let halfOpenProbe = false;
  let cooldownPersistenceError = null;

  function persistenceFailed(operation) {
    if (cooldownPersistenceError !== operation) {
      try { onCooldownPersistenceError(operation); }
      catch { /* architecture: allow-empty-catch -- a diagnostic callback must not mask the original provider failure */ }
    }
    cooldownPersistenceError = operation;
  }

  function synchronizeCooldown(at) {
    if (!cooldownStore) return;
    try {
      const deadline = cooldownStore.readDeadline(at);
      if (Number.isSafeInteger(deadline) && deadline > highestObservedCooldownDeadline
        && deadline <= at + PROVIDER_RETRY_AFTER_MAX_MS) {
        // A fresh process restores one recovery probe even if the durable wait
        // already expired. Remember the row so success cannot restore it again.
        highestObservedCooldownDeadline = deadline;
        breakerOpenUntil = Math.max(breakerOpenUntil, deadline);
      }
      if (cooldownPersistenceError === "read") cooldownPersistenceError = null;
    } catch {
      persistenceFailed("read");
      throw new MusicBrainzThrottleError(
        "cooldown_state_unavailable", "MusicBrainz recovery state is temporarily unavailable.", breakerBase, at,
      );
    }
  }

  function removeQueued(job) {
    const index = queue.indexOf(job);
    if (index >= 0) queue.splice(index, 1);
  }

  function settle(job, method, value) {
    if (job.settled) return;
    job.settled = true;
    if (job.queueTimer) clearTimeout(job.queueTimer);
    job.signal?.removeEventListener("abort", job.onAbort);
    job[method](value);
  }

  function circuitError(at = Number(clock())) {
    const remaining = Math.max(0, breakerOpenUntil - at);
    return new MusicBrainzThrottleError(
      "circuit_open",
      "MusicBrainz requests are paused while the provider recovers.",
      remaining,
      at,
    );
  }

  function retryDelay(error, at) {
    // Some background providers report an absolute Retry-After deadline. It
    // protects interactive callers too, not just that individual scheduler.
    const absolute = Number(error?.retryAt);
    if (error?.retryAt != null && Number.isSafeInteger(absolute) && absolute > 0) {
      return Math.max(0, Math.min(PROVIDER_RETRY_AFTER_MAX_MS, absolute - at));
    }
    const relative = Number(error?.retryAfterMs);
    return Number.isFinite(relative) ? Math.max(0, Math.min(PROVIDER_RETRY_AFTER_MAX_MS, relative)) : 0;
  }

  function openBreaker(at, error) {
    breakerTrips += 1;
    const cooldown = Math.min(breakerMaximum, breakerBase * (2 ** Math.min(8, breakerTrips - 1)));
    const requested = retryDelay(error, Number(at));
    breakerOpenUntil = Math.max(breakerOpenUntil, Number(at) + Math.max(cooldown, requested));
    if (cooldownStore) {
      try {
        const stored = cooldownStore.extendDeadline(breakerOpenUntil, Number(at));
        if (Number.isSafeInteger(stored) && stored > 0 && stored <= Number(at) + PROVIDER_RETRY_AFTER_MAX_MS) {
          breakerOpenUntil = Math.max(breakerOpenUntil, stored);
        }
        cooldownPersistenceError = null;
      } catch {
        // Keep the in-memory wait and original provider error, but expose that
        // this process cannot promise recovery state will survive a restart.
        persistenceFailed("write");
      }
    }
    return withProviderRetryDeadline(error, breakerOpenUntil, Number(clock()));
  }

  function beforeProviderRequest() {
    const at = Number(clock());
    synchronizeCooldown(at);
    if (breakerOpenUntil > at) throw circuitError(at);
    if (breakerOpenUntil > 0) {
      // Only one request probes a provider after the cooldown. Other queued
      // work fails fast instead of producing another recovery traffic spike.
      if (halfOpenProbe) throw circuitError(at);
      halfOpenProbe = true;
      return true;
    }
    return false;
  }

  function providerSucceeded() {
    consecutiveFailures = 0;
    breakerTrips = 0;
    // Success never deletes durable state: a different process may have
    // extended the deadline while this request was in flight.
    if (breakerOpenUntil <= Number(clock())) breakerOpenUntil = 0;
  }

  function providerFailed(error, { probe = false } = {}) {
    // A caller cancellation is not evidence about MusicBrainz. In particular,
    // an aborted half-open probe must leave the breaker eligible for another
    // bounded probe instead of declaring the upstream recovered.
    if (error?.name === "AbortError") return;
    // A provider-level refusal is deterministic for this process/IP and is
    // more dangerous to fan out than an ordinary transient failure. Preserve
    // the original 401/403 for the triggering caller, but stop every queued
    // catalogue/genre/memorial request until one bounded half-open probe.
    if (providerRefusedRequests(error)) {
      consecutiveFailures += 1;
      return openBreaker(Number(clock()), error);
    }
    if (deterministicProviderResponse(error)) {
      // A deterministic 4xx still proves that the provider is reachable. Do
      // not leave an expired outage circuit stuck in half-open mode forever.
      if (probe) providerSucceeded();
      return;
    }
    // Timeouts, network/provider failures, malformed replies, and unknown
    // request errors all fail closed. An unfamiliar error must not reset a
    // half-open circuit and release the queued background fan-out.
    consecutiveFailures += 1;
    if (probe || Number(error?.status) === 429 || retryDelay(error, Number(clock())) > 0 || consecutiveFailures >= failureThreshold) {
      return openBreaker(Number(clock()), error);
    }
    return error;
  }

  async function execute(job) {
    if (job.signal?.aborted) throw abortError(job.signal);
    let probe = false;
    let requested = false;
    try {
      if (lastStartedAt != null) {
        // Recheck after every wait so an early timer or a test clock that moves
        // in small steps cannot weaken the provider-wide start-time contract.
        let remaining = lastStartedAt + interval - Number(clock());
        while (remaining > 0) {
          await wait(remaining, { signal: job.signal });
          if (job.signal?.aborted) throw abortError(job.signal);
          remaining = lastStartedAt + interval - Number(clock());
        }
      }
      // Re-read after pacing in case another process received Retry-After
      // since this request joined the queue.
      probe = beforeProviderRequest();
      if (job.signal?.aborted) throw abortError(job.signal);
      lastStartedAt = Number(clock());
      requested = true;
      const result = await job.request();
      if (job.signal?.aborted) throw abortError(job.signal);
      providerSucceeded();
      return result;
    } catch (error) {
      // A transport abort says nothing about the provider. A concrete response
      // received before cancellation still carries provider policy for everyone.
      const rejection = requested && (!job.signal?.aborted || error?.providerResponse === true)
        ? providerFailed(error, { probe }) || error : error;
      if (job.signal?.aborted) throw abortError(job.signal);
      throw rejection;
    } finally {
      if (probe) halfOpenProbe = false;
    }
  }

  function pump() {
    if (active) return;
    let job;
    while ((job = queue.shift())) {
      if (!job.settled && !job.signal?.aborted) break;
      if (!job.settled) settle(job, "reject", abortError(job.signal));
      job = null;
    }
    if (!job) return;
    active = job;
    job.state = "active";
    if (job.queueTimer) {
      clearTimeout(job.queueTimer);
      job.queueTimer = null;
    }
    Promise.resolve()
      .then(() => execute(job))
      .then(
        (value) => settle(job, "resolve", value),
        (error) => settle(job, "reject", error),
      )
      .finally(() => {
        active = null;
        pump();
      });
  }

  function runMusicBrainzRequest(request, { signal, priority = "normal" } = {}) {
    if (typeof request !== "function") return Promise.reject(new TypeError("MusicBrainz request must be a function"));
    if (signal?.aborted) return Promise.reject(abortError(signal));
    const at = Number(clock());
    try { synchronizeCooldown(at); }
    catch (error) { return Promise.reject(error); }
    if (breakerOpenUntil > at) return Promise.reject(circuitError(at));
    const interactive = priority === "interactive";
    const totalPending = queue.length + (active ? 1 : 0);
    const backgroundPending = queue.filter((job) => job.priority !== "interactive").length
      + (active?.priority === "interactive" ? 0 : active ? 1 : 0);
    if (totalPending >= capacity || (!interactive && backgroundPending >= backgroundCapacity)) {
      return Promise.reject(new MusicBrainzThrottleError(
        "queue_saturated",
        "MusicBrainz request capacity is temporarily full.",
        queueDeadline,
        at,
      ));
    }

    return new Promise((resolve, reject) => {
      const job = {
        request,
        signal,
        priority: interactive ? "interactive" : "normal",
        state: "queued",
        settled: false,
        resolve,
        reject,
        queueTimer: null,
        onAbort: null,
      };
      job.onAbort = () => {
        if (job.state !== "queued") return;
        removeQueued(job);
        settle(job, "reject", abortError(signal));
        pump();
      };
      signal?.addEventListener("abort", job.onAbort, { once: true });
      job.queueTimer = setTimeout(() => {
        if (job.state !== "queued" || job.settled) return;
        removeQueued(job);
        settle(job, "reject", new MusicBrainzThrottleError(
          "queue_timeout",
          "MusicBrainz request waited too long for provider capacity.",
          queueDeadline,
          Number(clock()),
        ));
        pump();
      }, queueDeadline);
      job.queueTimer.unref?.();

      if (job.priority === "interactive") {
        const firstNormal = queue.findIndex((queued) => queued.priority !== "interactive");
        if (firstNormal < 0) queue.push(job);
        else queue.splice(firstNormal, 0, job);
      } else {
        queue.push(job);
      }
      pump();
    });
  }

  runMusicBrainzRequest.status = () => {
    const at = Number(clock());
    try { synchronizeCooldown(at); }
    catch { /* architecture: allow-empty-catch -- report storage failures without breaking local status reads; outbound admission fails closed */ }
    return Object.freeze({
      active: Boolean(active),
      queued: queue.filter((job) => !job.settled).length,
      capacity,
      circuitOpen: breakerOpenUntil > at || cooldownPersistenceError === "read",
      retryAt: breakerOpenUntil > at ? breakerOpenUntil : null,
      consecutiveFailures,
      ...(cooldownPersistenceError ? { cooldownPersistenceError } : {}),
    });
  };
  return runMusicBrainzRequest;
}

let configuredCooldownStore = null;

// db.js binds app_meta after schema initialization. This module stays safe to
// import in isolated clients and tests without opening a production database.
export function configureMusicBrainzCooldownStore(store) {
  if (typeof store?.readDeadline !== "function" || typeof store?.extendDeadline !== "function") {
    throw new TypeError("MusicBrainz cooldown storage requires readDeadline and extendDeadline.");
  }
  configuredCooldownStore = store;
}

export const runMusicBrainzRequest = createMusicBrainzRequestThrottle({
  cooldownStore: {
    readDeadline: (at) => configuredCooldownStore?.readDeadline(at) || 0,
    extendDeadline: (deadline, at) => configuredCooldownStore?.extendDeadline(deadline, at) || deadline,
  },
});
