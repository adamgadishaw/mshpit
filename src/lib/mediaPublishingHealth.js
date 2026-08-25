import {
  MEDIA_PUBLISHING_HEALTH_PATH,
  mediaPublishingCapabilitiesFromHealth,
} from "../domain/mediaPublishingCapabilities.mjs";

export const MEDIA_PUBLISHING_CAPABILITIES_TTL_MS = 30_000;

const capabilityStateByApi = new WeakMap();

function stateFor(apiCall) {
  let state = capabilityStateByApi.get(apiCall);
  if (!state) {
    state = { cached: null, inFlight: null };
    capabilityStateByApi.set(apiCall, state);
  }
  return state;
}

function abortError() {
  const error = new Error("Media publishing capability request was aborted.");
  error.name = "AbortError";
  return error;
}

function waitForInFlight(entry, signal) {
  if (signal?.aborted) {
    if (!entry.settled && entry.waiters === 0) entry.controller.abort();
    return Promise.reject(abortError());
  }

  entry.waiters += 1;
  return new Promise((resolve, reject) => {
    let finished = false;

    const finish = (settle, value) => {
      if (finished) return;
      finished = true;
      signal?.removeEventListener("abort", onAbort);
      entry.waiters = Math.max(0, entry.waiters - 1);
      settle(value);
    };
    const onAbort = () => {
      finish(reject, abortError());
      if (!entry.settled && entry.waiters === 0) entry.controller.abort();
    };

    signal?.addEventListener("abort", onAbort, { once: true });
    entry.promise.then(
      (capabilities) => finish(resolve, capabilities),
      (error) => finish(reject, error),
    );
  });
}

// Keep capability negotiation behind a service boundary so screens consume a
// stable product result instead of learning the health endpoint contract. The
// cache is intentionally short: panel/foreground checks can reuse it, while an
// upload can opt into a fresh authoritative negotiation with `force`.
export async function loadMediaPublishingCapabilities({
  signal,
  apiCall,
  force = false,
  now = Date.now,
} = {}) {
  if (typeof apiCall !== "function") {
    throw new TypeError("A PIT API adapter is required to load media publishing capability.");
  }
  if (signal?.aborted) throw abortError();

  const state = stateFor(apiCall);
  const checkedAt = now();
  const cacheAge = state.cached ? checkedAt - state.cached.checkedAt : Infinity;
  if (!force && cacheAge >= 0 && cacheAge < MEDIA_PUBLISHING_CAPABILITIES_TTL_MS) {
    return state.cached.capabilities;
  }
  if (state.inFlight) return waitForInFlight(state.inFlight, signal);

  const controller = new AbortController();
  const entry = {
    controller,
    promise: null,
    settled: false,
    waiters: 0,
  };
  entry.promise = Promise.resolve()
    .then(() => apiCall(MEDIA_PUBLISHING_HEALTH_PATH, {
      context: "Checking media publishing availability",
      silent: true,
      signal: controller.signal,
      skipIdentityCheck: true,
      timeoutMs: 3_000,
    }))
    .then((health) => {
      if (controller.signal.aborted) throw abortError();
      const capabilities = mediaPublishingCapabilitiesFromHealth(health);
      state.cached = { capabilities, checkedAt: now() };
      return capabilities;
    })
    .finally(() => {
      entry.settled = true;
      if (state.inFlight === entry) state.inFlight = null;
    });
  state.inFlight = entry;
  return waitForInFlight(entry, signal);
}
