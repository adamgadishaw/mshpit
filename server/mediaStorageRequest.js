import { setTimeout as delay } from "node:timers/promises";

import { ApiError } from "./errors.js";

const STAGES = new Set(["head", "source_get", "digest_get", "photo_put", "poster_put"]);
const RETRY_STATUSES = new Set([408, 429, 500, 502, 503, 504]);
const RETRY_DELAYS_MS = [150, 350];
const MAX_RETRY_AFTER_MS = 2_000;
const NETWORK_CODES = new Map([
  ["ECONNRESET", "connection"], ["ECONNREFUSED", "connection"],
  ["EPIPE", "connection"], ["UND_ERR_SOCKET", "connection"],
  ["ENETUNREACH", "connection"], ["EHOSTUNREACH", "connection"],
  ["EAI_AGAIN", "dns"], ["ENOTFOUND", "dns"],
  ["ETIMEDOUT", "timeout"], ["UND_ERR_CONNECT_TIMEOUT", "timeout"],
  ["UND_ERR_HEADERS_TIMEOUT", "timeout"], ["UND_ERR_BODY_TIMEOUT", "timeout"],
]);

function networkKind(error, signal) {
  if (signal?.aborted) return signal.reason?.name === "TimeoutError" ? "timeout" : "cancelled";
  if (error?.name === "AbortError") return "cancelled";
  if (error?.name === "TimeoutError") return "timeout";
  // Node fetch usually wraps a finite system/Undici code in TypeError.cause.
  // Inspect only these exact codes, never messages, URLs or provider payloads.
  for (const candidate of [error, error?.cause]) {
    if (NETWORK_CODES.has(candidate?.code)) return NETWORK_CODES.get(candidate.code);
  }
  return error instanceof TypeError ? "network" : "other";
}

export function mediaStorageRequestFailure({ stage, error, status, signal } = {}) {
  if (!STAGES.has(stage)) throw new TypeError("Unknown media storage request stage");
  const numericStatus = Number(status);
  const kind = status !== undefined
    ? RETRY_STATUSES.has(numericStatus) ? `http_${numericStatus}`
      : numericStatus === 401 || numericStatus === 403 ? "access_denied" : "http_other"
    : networkKind(error, signal);
  const failure = new Error("Media storage request failed");
  failure.name = "MediaStorageRequest";
  failure.code = `${stage}_${kind}`;
  // Deliberately do not retain the original exception as a nested cause.
  return failure;
}

function retryAfterMs(response) {
  const value = response?.headers?.get?.("retry-after");
  if (!value) return 0;
  const seconds = /^\d+(?:\.\d+)?$/.test(value.trim()) ? Number(value) : NaN;
  const duration = Number.isFinite(seconds) ? seconds * 1_000 : Date.parse(value) - Date.now();
  return Number.isFinite(duration) ? Math.max(0, duration) : 0;
}

function discardResponse(response) {
  // Do not leave a retryable response holding a pooled connection. Cancellation
  // itself must not extend the caller's deadline or replace the original error.
  try { void response?.body?.cancel?.().catch(() => {}); } // architecture: allow-empty-catch -- asynchronous stream disposal is best-effort
  catch { /* architecture: allow-empty-catch -- best-effort response cleanup must not replace the bounded storage failure */ }
}

function withinSignal(task, signal, discardLate = discardResponse) {
  signal?.throwIfAborted();
  if (!signal) return Promise.resolve().then(task);
  return new Promise((resolve, reject) => {
    let settled = false;
    const abort = () => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", abort);
      reject(signal.reason);
    };
    signal.addEventListener("abort", abort, { once: true });
    // Attach both handlers immediately: an adapter that ignores cancellation
    // may settle after our deadline, but must never create an unhandled error
    // or hand a late response/consumer result back to finalization.
    Promise.resolve().then(() => {
      signal.throwIfAborted();
      return task();
    }).then((value) => {
      if (settled) { discardLate(value); return; }
      settled = true;
      signal.removeEventListener("abort", abort);
      resolve(value);
    }, (error) => {
      if (settled) { discardLate(); return; }
      settled = true;
      signal.removeEventListener("abort", abort);
      reject(error);
    });
  });
}

// Only idempotent reads may enter this retry loop. The caller creates ONE
// transfer signal before calling us; every attempt, body read and delay uses
// that original deadline. A consumer restarts from scratch on transport failure
// and must retain its generation/size/type validation on every response.
export async function requestMediaStorage({
  url, method, headers, signal, fetchImpl = fetch, stage, consume,
  waitImpl = (ms, options) => delay(ms, undefined, options),
} = {}) {
  if (method !== "HEAD" && method !== "GET") throw new TypeError("Only media storage reads may retry");
  if (!STAGES.has(stage) || stage.endsWith("_put")) throw new TypeError("Unknown media storage read stage");
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
    let response;
    let failure;
    let retryable = false;
    let waitMs = RETRY_DELAYS_MS[attempt];
    try {
      signal?.throwIfAborted();
      response = await withinSignal(
        () => fetchImpl(url, { method, headers, redirect: "error", signal }), signal,
      );
      signal?.throwIfAborted();
      if (RETRY_STATUSES.has(response?.status)) {
        failure = mediaStorageRequestFailure({ stage, status: response.status });
        const requestedWait = retryAfterMs(response);
        // Honor a short Retry-After; if a provider asks for longer, return the
        // existing retryable public error instead of retrying too early.
        retryable = requestedWait <= MAX_RETRY_AFTER_MS;
        waitMs = Math.max(waitMs || 0, requestedWait);
      } else {
        const result = consume
          ? await withinSignal(() => consume(response), signal, () => discardResponse(response))
          : response;
        signal?.throwIfAborted();
        return result;
      }
    } catch (error) {
      // A changed object, invalid image or authority failure is not transport.
      if (error instanceof ApiError) {
        discardResponse(response);
        throw error;
      }
      const kind = networkKind(error, signal);
      retryable = !signal?.aborted && ["connection", "dns", "network", "timeout"].includes(kind);
      failure = mediaStorageRequestFailure({ stage, error, signal });
    }
    discardResponse(response);
    if (!retryable || attempt === RETRY_DELAYS_MS.length) throw failure;
    try {
      await withinSignal(() => waitImpl(waitMs, { signal }), signal);
      signal?.throwIfAborted();
    } catch (error) {
      throw mediaStorageRequestFailure({ stage, error, signal });
    }
  }
}
