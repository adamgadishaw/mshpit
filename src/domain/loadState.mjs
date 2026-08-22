import { isAppErrorLike } from "./commandResult.mjs";

const LOAD_STATUSES = Object.freeze([
  "idle",
  "loading",
  "refreshing",
  "ready",
  "error",
]);

const VALID_STATUS = new Set(LOAD_STATUSES);

// Caller cancellation is lifecycle control, not a failed resource. PIT's API
// adapter intentionally preserves an AbortError (or an explicit signal reason)
// so loaders can stop without recording a false diagnostic or error state.
export function isLoadCancellation(error, signal) {
  return signal?.aborted === true || error?.name === "AbortError";
}

function cleanUpdatedAt(value) {
  if (value == null) return null;
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp) || timestamp < 0) {
    throw new TypeError("LoadState updatedAt must be a non-negative timestamp or null");
  }
  return timestamp;
}

export function createLoadState({
  scope = null,
  status = "idle",
  data = null,
  error = null,
  updatedAt = null,
} = {}) {
  if (!VALID_STATUS.has(status)) throw new TypeError(`Unknown LoadState status: ${String(status)}`);
  if (status === "error") {
    if (!isAppErrorLike(error)) throw new TypeError("An error LoadState requires an AppError");
  } else if (error != null) {
    throw new TypeError("Only an error LoadState may carry an error");
  }
  return {
    scope,
    status,
    data,
    error,
    updatedAt: cleanUpdatedAt(updatedAt),
  };
}

export function beginLoadState(current, { scope, emptyData = null, retainData = true } = {}) {
  const mayRefresh = retainData
    && current?.scope === scope
    && current?.updatedAt != null;
  return createLoadState({
    scope,
    status: mayRefresh ? "refreshing" : "loading",
    data: mayRefresh ? current.data : emptyData,
    updatedAt: mayRefresh ? current.updatedAt : null,
  });
}

export function resolveLoadState({ scope, data, updatedAt = Date.now() } = {}) {
  return createLoadState({ scope, status: "ready", data, updatedAt });
}

export function rejectLoadState(current, {
  scope,
  error,
  emptyData = null,
  retainData = true,
} = {}) {
  if (isLoadCancellation(error)) {
    throw new TypeError("Cancelled reads must not become an error LoadState");
  }
  const mayRetain = retainData
    && current?.scope === scope
    && current?.updatedAt != null;
  return createLoadState({
    scope,
    status: "error",
    data: mayRetain ? current.data : emptyData,
    error,
    updatedAt: mayRetain ? current.updatedAt : null,
  });
}

// Render-time projection closes the commit before an effect can clear state.
// A new account/target therefore receives an empty loading resource immediately.
export function projectLoadState(current, scope, emptyData = null) {
  return current?.scope === scope
    ? current
    : createLoadState({ scope, status: "loading", data: emptyData });
}
