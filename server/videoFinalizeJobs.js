import { ApiError, ERROR_CATALOG } from "./errors.js";

// Video finalization can take longer than the public HTTP request budget. Keep
// only coordination metadata in this process: no upload capabilities, source
// URLs, verifier payloads, or exception causes are retained or projected.
const TERMINAL_TTL_MS = 30 * 60 * 1000;
const MAX_TERMINAL_OUTCOMES = 2_048;
const FAILURE_MESSAGES = Object.freeze({
  400: "Clip verification details are invalid.",
  401: "Log in again before resuming this clip.",
  403: "This clip cannot be processed by this account.",
  404: "That clip is no longer available.",
  409: "The clip conflicts with the saved upload. Add it again or retry the original edit.",
  413: "That clip is too large to process.",
  415: "That clip format could not be processed.",
  422: "That clip needs attention before it can be processed.",
  429: "Clip processing is busy. Try again later.",
  500: "Clip processing failed on our end. Try again.",
  502: "Clip processing is temporarily unavailable. Try again.",
  503: "Clip processing is temporarily unavailable. Try again.",
});

const jobs = new Map();

const jobKey = (ownerId, assetId) => `${String(ownerId)}\u0000${String(assetId)}`;

function prune(at = Date.now()) {
  const terminal = [];
  for (const [key, entry] of jobs) {
    if (entry.state === "processing") continue;
    if (entry.settledAt + TERMINAL_TTL_MS <= at) {
      jobs.delete(key);
      continue;
    }
    terminal.push([key, entry]);
  }
  if (terminal.length <= MAX_TERMINAL_OUTCOMES) return;
  terminal.sort((left, right) => left[1].settledAt - right[1].settledAt);
  for (let index = 0; index < terminal.length - MAX_TERMINAL_OUTCOMES; index += 1) {
    jobs.delete(terminal[index][0]);
  }
}

function safeFailure(error) {
  if (!(error instanceof ApiError)) {
    return Object.freeze({
      code: "INTERNAL_ERROR",
      status: 500,
      message: "Clip processing failed on our end. Try again.",
      retryable: true,
    });
  }
  const definition = ERROR_CATALOG[error.code] || ERROR_CATALOG.INTERNAL_ERROR;
  return Object.freeze({
    code: error.code,
    status: error.status,
    message: FAILURE_MESSAGES[error.status] || FAILURE_MESSAGES[500],
    retryable: definition.retryable === true,
  });
}

function publicState(entry) {
  if (!entry) return { state: "idle" };
  if (entry.state === "failed") return { state: "failed", error: { ...entry.error } };
  return { state: entry.state };
}

export function videoFinalizeState({ ownerId, assetId, asset = null, at = Date.now() } = {}) {
  prune(at);
  const key = jobKey(ownerId, assetId);
  if (asset?.status === "ready") {
    const current = jobs.get(key);
    if (current?.state !== "processing") jobs.delete(key);
    return { state: "completed" };
  }
  return publicState(jobs.get(key));
}

export function startVideoFinalizeJob({ ownerId, assetId, fingerprint, run, at = Date.now() } = {}) {
  if (typeof run !== "function") {
    throw new ApiError(500, "Clip processing could not be started.", "INTERNAL_ERROR");
  }
  if (typeof fingerprint !== "string" || !/^[a-f0-9]{64}$/u.test(fingerprint)) {
    throw new ApiError(500, "Clip processing identity is invalid.", "INTERNAL_ERROR");
  }
  prune(at);
  const key = jobKey(ownerId, assetId);
  const current = jobs.get(key);
  if (current?.state === "processing") {
    if (current.fingerprint !== fingerprint) {
      throw new ApiError(409, "That clip is already processing with different edits.", "CONFLICT");
    }
    return { finalize: { state: "processing" }, joined: true, completion: current.promise };
  }

  const entry = {
    state: "processing",
    startedAt: at,
    settledAt: null,
    error: null,
    fingerprint,
  };
  jobs.set(key, entry);

  // Queue the work after the route has constructed its response. The job owns
  // its verifier lifecycle; an HTTP disconnect must not abort shared work.
  const promise = Promise.resolve().then(run).then((result) => {
    if (result?.asset?.status !== "ready") {
      throw new ApiError(503, "Clip processing did not produce a ready asset.", "MEDIA_STORAGE_UNAVAILABLE");
    }
    return result;
  });
  entry.promise = promise;
  void promise.then(
    () => {
      if (jobs.get(key) !== entry) return;
      entry.state = "completed";
      entry.settledAt = Date.now();
      entry.promise = null;
      prune(entry.settledAt);
    },
    (error) => {
      if (jobs.get(key) !== entry) return;
      entry.state = "failed";
      entry.error = safeFailure(error);
      entry.settledAt = Date.now();
      entry.promise = null;
      prune(entry.settledAt);
    },
  );
  return { finalize: { state: "processing" }, joined: false, completion: promise };
}

export function waitForVideoFinalizeCompletion(completion, {
  timeoutMs,
  signal,
} = {}) {
  const boundedTimeout = Number(timeoutMs);
  if (!completion || typeof completion.then !== "function"
      || !Number.isSafeInteger(boundedTimeout) || boundedTimeout < 1 || boundedTimeout > 30_000) {
    throw new ApiError(500, "Clip processing wait is invalid.", "INTERNAL_ERROR");
  }
  if (signal?.aborted) return Promise.resolve({ settled: false });
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (callback, value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal?.removeEventListener?.("abort", onAbort);
      callback(value);
    };
    const onAbort = () => finish(resolve, { settled: false });
    const timer = setTimeout(() => finish(resolve, { settled: false }), boundedTimeout);
    signal?.addEventListener?.("abort", onAbort, { once: true });
    completion.then(
      (value) => finish(resolve, { settled: true, value }),
      (error) => finish(reject, error),
    );
  });
}

export function resetVideoFinalizeJobsForTests() {
  jobs.clear();
}
