import { VIDEO_POSTER_ERROR_CODES, VideoPosterError } from "../domain/videoPoster.mjs";

export const VIDEO_POSTER_TRANSIENT_RETRY_DELAYS_MS = Object.freeze([900]);
const BUSY_RECHECK_MS = 250;
const MAX_TRACKED_URIS = 256;

const transientCodes = new Set([
  VIDEO_POSTER_ERROR_CODES.timeout,
  VIDEO_POSTER_ERROR_CODES.loadFailed,
]);

export function videoPosterFailureDisposition(error) {
  if (error?.code === VIDEO_POSTER_ERROR_CODES.aborted) return "cancelled";
  if (transientCodes.has(error?.code)) return "transient";
  return "permanent";
}

const fallbackError = (error = null) => error instanceof Error
  ? error
  : new VideoPosterError(VIDEO_POSTER_ERROR_CODES.frameFailed);

// One shared, bounded session registry prevents remounting an uncooperative
// legacy URL from repeatedly downloading and tainting a canvas. A lease keeps
// cancellation from one tile from mutating another tile's in-flight attempt.
export function createVideoPosterRetryPolicy({ now = () => Date.now(), retryDelaysMs = VIDEO_POSTER_TRANSIENT_RETRY_DELAYS_MS } = {}) {
  const delays = [...retryDelaysMs]
    .map((value) => Math.max(0, Math.round(Number(value) || 0)))
    .slice(0, 3);
  const entries = new Map();
  let leaseSequence = 0;

  const remember = (uri, state) => {
    entries.delete(uri);
    entries.set(uri, state);
    while (entries.size > MAX_TRACKED_URIS) entries.delete(entries.keys().next().value);
    return state;
  };

  const decision = (uri) => {
    const key = String(uri || "").trim();
    if (!key) return { action: "fallback", error: new VideoPosterError(VIDEO_POSTER_ERROR_CODES.sourceInvalid) };
    const state = entries.get(key);
    if (!state) return { action: "attempt" };
    if (state.permanent) {
      return { action: "fallback", error: fallbackError(state.error) };
    }
    if (state.inFlight) return { action: "wait", retryAfterMs: BUSY_RECHECK_MS };
    if (state.attempts >= delays.length + 1) {
      return { action: "fallback", error: fallbackError(state.error) };
    }
    const retryAfterMs = Math.max(0, state.retryAt - now());
    return retryAfterMs > 0 ? { action: "wait", retryAfterMs } : { action: "attempt" };
  };

  const claim = (uri) => {
    const key = String(uri || "").trim();
    const currentDecision = decision(key);
    if (currentDecision.action !== "attempt") return currentDecision;
    const state = entries.get(key) || { attempts: 0, retryAt: 0, permanent: false, error: null, inFlight: null };
    const lease = ++leaseSequence;
    remember(key, { ...state, attempts: state.attempts + 1, inFlight: lease });
    return { action: "attempt", lease };
  };

  const cancel = (uri, lease) => {
    const key = String(uri || "").trim();
    const state = entries.get(key);
    if (!state || state.inFlight !== lease) return false;
    const attempts = Math.max(0, state.attempts - 1);
    if (!attempts && !state.permanent && !state.error) entries.delete(key);
    else remember(key, { ...state, attempts, inFlight: null, retryAt: 0 });
    return true;
  };

  const succeed = (uri, lease) => {
    const key = String(uri || "").trim();
    const state = entries.get(key);
    if (!state || state.inFlight !== lease) return false;
    entries.delete(key);
    return true;
  };

  const fail = (uri, lease, error) => {
    const key = String(uri || "").trim();
    const state = entries.get(key);
    if (!state || state.inFlight !== lease) return { action: "ignored" };
    const disposition = videoPosterFailureDisposition(error);
    if (disposition === "cancelled") {
      cancel(key, lease);
      return { action: "cancelled" };
    }
    if (disposition === "permanent" || state.attempts >= delays.length + 1) {
      remember(key, { ...state, inFlight: null, permanent: true, retryAt: 0, error: fallbackError(error) });
      return { action: "fallback", error: fallbackError(error) };
    }
    const delay = delays[Math.max(0, state.attempts - 1)] || 0;
    remember(key, { ...state, inFlight: null, retryAt: now() + delay, error: fallbackError(error) });
    return { action: "retry", retryAfterMs: delay };
  };

  const block = (uri, error) => {
    const key = String(uri || "").trim();
    if (!key) return;
    const state = entries.get(key) || { attempts: 1, inFlight: null };
    remember(key, { ...state, permanent: true, retryAt: 0, error: fallbackError(error), inFlight: null });
  };

  const snapshot = (uri) => {
    const state = entries.get(String(uri || "").trim());
    return state ? { ...state } : null;
  };

  return Object.freeze({ decision, claim, cancel, succeed, fail, block, snapshot });
}

export const sharedVideoPosterRetryPolicy = createVideoPosterRetryPolicy();
