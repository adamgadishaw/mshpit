import { createHash } from "node:crypto";

import { ApiError } from "./errors.js";
import { createMediaDownloadCapability, privateVideoMediaConfigured } from "./media.js";
import {
  VIDEO_VERIFIER_PIPELINE_VERSION,
  VIDEO_VERIFIER_PROTOCOL_VERSION,
  signVideoVerifierRequest,
  verifyVideoVerifierResponse,
} from "./videoVerifierProtocol.js";

export const VIDEO_VERIFIER_HEALTH_FRESH_MS = 90_000;
export const VIDEO_VERIFIER_HEALTH_INTERVAL_MS = 30_000;
export const VIDEO_VERIFIER_JOB_TIMEOUT_MS = 55_000;
export const VIDEO_VERIFIER_MAX_RESPONSE_BYTES = 3 * 1024 * 1024;
export const VIDEO_VERIFIER_MAX_POSTER_BYTES = 1_500_000;
export const VIDEO_VERIFIER_POSTER_MAX_EDGE = 1_280;

const PRIVATE_HOSTPORT = /^(?![0-9.]+:)(?!localhost:)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?:([1-9][0-9]{1,4})$/;
const FORBIDDEN_RENDER_PORTS = new Set([10_000, 18_012, 18_013, 19_099]);
const STRONG_ETAG = /^"[\x21\x23-\x7e]{1,200}"$/u;
const OBJECT_KEY = /^users\/[A-Za-z0-9_-]{1,128}\/post\/[A-Za-z0-9_-]{1,240}\.mp4$/;
const SHA256 = /^[a-f0-9]{64}$/;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

let healthTimer = null;
let healthInFlight = null;
let activeVerification = null;
let shutdownController = new AbortController();
const runtime = {
  fingerprint: null,
  lastAttemptAt: 0,
  lastSuccessAt: 0,
  lastErrorCode: null,
  ffmpegVersion: null,
};

function cleanHostport(value) {
  const hostport = String(value || "").trim().toLowerCase();
  const match = PRIVATE_HOSTPORT.exec(hostport);
  if (!match) return null;
  const port = Number(match[1]);
  if (port > 65_535 || FORBIDDEN_RENDER_PORTS.has(port)) return null;
  return hostport;
}

function fixedVerifierBase(env) {
  const privateHostport = cleanHostport(env?.PIT_VIDEO_VERIFIER_HOSTPORT);
  if (privateHostport) return new URL(`http://${privateHostport}`);
  const production = String(env?.NODE_ENV || "").toLowerCase() === "production";
  // Production verification is a private-service trust boundary. A public URL
  // is never accepted as a fallback because that would silently turn a Render
  // wiring mistake into an Internet-reachable HMAC decoder endpoint.
  if (production) return null;
  const raw = String(env?.PIT_VIDEO_VERIFIER_URL || "").trim();
  if (!raw) return null;
  let url;
  try { url = new URL(raw); }
  catch { return null; }
  const localDevelopment = !production && url.protocol === "http:"
    && new Set(["127.0.0.1", "localhost", "::1"]).has(url.hostname);
  if (url.protocol !== "https:" && !localDevelopment) return null;
  if (url.username || url.password || url.search || url.hash || !["", "/"].includes(url.pathname)) return null;
  return url;
}

export function getVideoVerifierConfig(env = process.env) {
  const base = fixedVerifierBase(env);
  const secret = String(env?.PIT_VIDEO_VERIFIER_SECRET || "");
  if (!base || Buffer.byteLength(secret, "utf8") < 32 || Buffer.byteLength(secret, "utf8") > 1_024
      || !privateVideoMediaConfigured(env)) {
    return { configured: false };
  }
  const fingerprint = createHash("sha256")
    .update(`${base.origin}\0${secret}\0${env.MEDIA_ENDPOINT}\0${env.MEDIA_SOURCE_BUCKET}\0${env.MEDIA_BUCKET}`)
    .digest("hex");
  return { configured: true, base, secret, fingerprint };
}

function endpointFor(config, path) {
  return new URL(path, `${config.base.origin}/`).toString();
}

function combinedSignal(signal, timeoutMs) {
  const signals = [shutdownController.signal, AbortSignal.timeout(timeoutMs)];
  if (signal) signals.push(signal);
  return AbortSignal.any(signals);
}

async function boundedResponseText(response, maxBytes, signal) {
  const declared = Number(response?.headers?.get?.("content-length"));
  if (Number.isFinite(declared) && (declared < 0 || declared > maxBytes)) {
    throw new ApiError(503, "Clip verification returned an invalid response.", "MEDIA_STORAGE_UNAVAILABLE");
  }
  if (!response?.body || typeof response.body.getReader !== "function") {
    const text = await response?.text?.();
    if (typeof text !== "string" || Buffer.byteLength(text, "utf8") > maxBytes) {
      throw new ApiError(503, "Clip verification returned an invalid response.", "MEDIA_STORAGE_UNAVAILABLE");
    }
    return text;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  try {
    while (true) {
      if (signal?.aborted) throw signal.reason || new DOMException("Aborted", "AbortError");
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel("response too large");
        throw new ApiError(503, "Clip verification returned an invalid response.", "MEDIA_STORAGE_UNAVAILABLE");
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, bytes).toString("utf8");
}

function verifierUnavailable(error, message = "Clip decoding is temporarily unavailable. Try again later.") {
  if (error instanceof ApiError) return error;
  return new ApiError(503, message, "MEDIA_STORAGE_UNAVAILABLE", error);
}

function noteHealthy(config, payload, at) {
  runtime.fingerprint = config.fingerprint;
  runtime.lastAttemptAt = at;
  runtime.lastSuccessAt = at;
  runtime.lastErrorCode = null;
  runtime.ffmpegVersion = typeof payload?.decoder?.version === "string"
    ? payload.decoder.version.slice(0, 80)
    : runtime.ffmpegVersion;
}

function noteFailure(config, error, at) {
  runtime.fingerprint = config?.fingerprint || null;
  runtime.lastAttemptAt = at;
  runtime.lastErrorCode = String(error?.code || "VIDEO_VERIFIER_UNAVAILABLE").slice(0, 80);
}

async function verifierRequest({ path, payload, env, fetchImpl, signal, timeoutMs, maxResponseBytes }) {
  const config = getVideoVerifierConfig(env);
  if (!config.configured || typeof fetchImpl !== "function") {
    throw new ApiError(503, "Clip decoding is not configured.", "MEDIA_STORAGE_UNAVAILABLE");
  }
  const signed = signVideoVerifierRequest({ secret: config.secret, path, payload });
  const requestSignal = combinedSignal(signal, timeoutMs);
  let response;
  try {
    response = await fetchImpl(endpointFor(config, path), {
      method: "POST",
      redirect: "error",
      headers: signed.headers,
      body: signed.body,
      signal: requestSignal,
    });
  } catch (error) {
    throw verifierUnavailable(error);
  }
  const type = String(response?.headers?.get?.("content-type") || "").split(";", 1)[0].trim().toLowerCase();
  if (type !== "application/json") {
    throw new ApiError(503, "Clip verification returned an invalid response.", "MEDIA_STORAGE_UNAVAILABLE");
  }
  const raw = await boundedResponseText(response, maxResponseBytes, requestSignal);
  let decoded;
  try {
    decoded = verifyVideoVerifierResponse({
      secret: config.secret,
      path,
      requestNonce: signed.nonce,
      body: raw,
      headers: response.headers,
    });
  } catch (error) {
    throw verifierUnavailable(error, "Clip verification authentication failed.");
  }
  if (!response || response.status < 200 || response.status >= 300 || decoded?.ok !== true) {
    const busy = response?.status === 429 || decoded?.code === "busy";
    if (busy) {
      throw new ApiError(429, "Clip verification is busy. Try again shortly.", "RATE_LIMITED");
    }
    if (response?.status === 422) {
      throw new ApiError(415, "That clip could not pass authoritative decoding.", "MEDIA_TYPE_UNSUPPORTED");
    }
    if (response?.status === 409) {
      throw new ApiError(409, "That clip changed while it was being verified. Try again.", "CONFLICT");
    }
    throw new ApiError(503, "That clip could not pass authoritative decoding.", "MEDIA_STORAGE_UNAVAILABLE");
  }
  return { config, decoded };
}

function exactHealth(payload) {
  return payload?.protocol === VIDEO_VERIFIER_PROTOCOL_VERSION
    && payload?.pipeline === VIDEO_VERIFIER_PIPELINE_VERSION
    && payload?.decoder?.ffmpeg === true
    && payload?.decoder?.ffprobe === true
    && payload?.poster?.generated === true
    && payload?.poster?.decoded === true
    && payload?.storage?.privateInput === true
    && payload?.storage?.sanitizedOutput === true
    && payload?.concurrency === 1;
}

export function videoVerifierRuntimeStatus(env = process.env, at = Date.now()) {
  const config = getVideoVerifierConfig(env);
  const sameRuntime = config.configured && runtime.fingerprint === config.fingerprint;
  const ageMs = sameRuntime && runtime.lastSuccessAt ? Math.max(0, at - runtime.lastSuccessAt) : null;
  return {
    configured: config.configured,
    ready: !!(sameRuntime
      && ageMs !== null
      && ageMs <= VIDEO_VERIFIER_HEALTH_FRESH_MS
      && runtime.lastErrorCode === null
      && runtime.lastSuccessAt >= runtime.lastAttemptAt),
    pipeline: VIDEO_VERIFIER_PIPELINE_VERSION,
    lastSuccessAt: sameRuntime ? runtime.lastSuccessAt || null : null,
    lastAttemptAt: sameRuntime ? runtime.lastAttemptAt || null : null,
    ageMs,
    lastErrorCode: sameRuntime ? runtime.lastErrorCode : null,
    ffmpegVersion: sameRuntime ? runtime.ffmpegVersion : null,
  };
}

export async function refreshVideoVerifierHealth({
  env = process.env,
  fetchImpl = globalThis.fetch,
  signal,
  at = Date.now(),
} = {}) {
  if (activeVerification) return videoVerifierRuntimeStatus(env, at);
  const config = getVideoVerifierConfig(env);
  if (!config.configured) {
    noteFailure(config, { code: "VIDEO_VERIFIER_NOT_CONFIGURED" }, at);
    return videoVerifierRuntimeStatus(env, at);
  }
  try {
    const result = await verifierRequest({
      path: "/v2/health",
      payload: { protocol: VIDEO_VERIFIER_PROTOCOL_VERSION },
      env,
      fetchImpl,
      signal,
      timeoutMs: 3_000,
      maxResponseBytes: 16 * 1024,
    });
    if (!exactHealth(result.decoded)) {
      throw new ApiError(503, "Clip verifier health contract is incompatible.", "MEDIA_STORAGE_UNAVAILABLE");
    }
    noteHealthy(result.config, result.decoded, at);
  } catch (error) {
    if (error instanceof ApiError && error.status === 429) {
      return videoVerifierRuntimeStatus(env, at);
    }
    noteFailure(config, error, at);
  }
  return videoVerifierRuntimeStatus(env, at);
}

function verifiedPoster(value, requestedTimeMs) {
  const byteSize = Number(value?.byteSize);
  const width = Number(value?.width);
  const height = Number(value?.height);
  const timeMs = Number(value?.timeMs);
  if (value?.contentType !== "image/jpeg"
      || !Number.isSafeInteger(byteSize) || byteSize < 4 || byteSize > VIDEO_VERIFIER_MAX_POSTER_BYTES
      || !Number.isSafeInteger(width) || width < 1 || width > VIDEO_VERIFIER_POSTER_MAX_EDGE
      || !Number.isSafeInteger(height) || height < 1 || height > VIDEO_VERIFIER_POSTER_MAX_EDGE
      || !Number.isSafeInteger(timeMs) || timeMs !== requestedTimeMs
      || !SHA256.test(String(value?.sha256 || ""))
      || typeof value?.dataBase64 !== "string" || !BASE64.test(value.dataBase64)) {
    throw new ApiError(503, "Clip verification returned an invalid cover.", "MEDIA_STORAGE_UNAVAILABLE");
  }
  const bytes = Buffer.from(value.dataBase64, "base64");
  const hash = createHash("sha256").update(bytes).digest("hex");
  if (bytes.byteLength !== byteSize || hash !== value.sha256
      || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) {
    throw new ApiError(503, "Clip verification returned an invalid cover.", "MEDIA_STORAGE_UNAVAILABLE");
  }
  return { contentType: "image/jpeg", bytes, byteSize, width, height, timeMs, sha256: hash };
}

function verifiedDecode(payload, { objectKey, expectedBytes, ifMatch, structural, posterTimeMs, outputKey }) {
  const video = payload?.video;
  const delivery = payload?.delivery;
  if (payload?.protocol !== VIDEO_VERIFIER_PROTOCOL_VERSION
      || payload?.pipeline !== VIDEO_VERIFIER_PIPELINE_VERSION
      || payload?.object?.key !== objectKey
      || payload?.object?.etag !== ifMatch
      || Number(payload?.object?.byteSize) !== expectedBytes
      || video?.codec !== "h264"
      || !new Set(["aac", "none"]).has(video?.audioCodec)
      || ![0, 90, 180, 270].includes(Number(video?.rotation))
      || !Number.isSafeInteger(Number(video?.width))
      || !Number.isSafeInteger(Number(video?.height))
      || !Number.isSafeInteger(Number(video?.codedWidth))
      || !Number.isSafeInteger(Number(video?.codedHeight))
      || !Number.isSafeInteger(Number(video?.durationMs))) {
    throw new ApiError(503, "Clip verification returned an invalid result.", "MEDIA_STORAGE_UNAVAILABLE");
  }
  if (Number(video.width) !== Number(structural.width)
      || Number(video.height) !== Number(structural.height)
      || Number(video.codedWidth) !== Number(structural.codedWidth)
      || Number(video.codedHeight) !== Number(structural.codedHeight)
      || Math.abs(Number(video.durationMs) - Number(structural.durationMs)) > 1_500) {
    throw new ApiError(409, "The decoded clip does not match its MP4 metadata.", "CONFLICT");
  }
  if (delivery?.key !== outputKey || delivery?.contentType !== "video/mp4"
      || delivery?.codec !== "h264" || !new Set(["aac", "none"]).has(delivery?.audioCodec)
      || delivery?.rotation !== 0 || !SHA256.test(String(delivery?.sha256 || ""))
      || !Number.isSafeInteger(Number(delivery?.byteSize)) || Number(delivery.byteSize) < 16
      || Number(delivery.byteSize) > 100 * 1024 * 1024
      || !Number.isSafeInteger(Number(delivery?.width)) || Number(delivery.width) < 1 || Number(delivery.width) > 1920
      || !Number.isSafeInteger(Number(delivery?.height)) || Number(delivery.height) < 1 || Number(delivery.height) > 1920
      || !Number.isSafeInteger(Number(delivery?.durationMs))
      || Math.abs(Number(delivery.durationMs) - Number(video.durationMs)) > 1_500
      || !new Set(["created", "existing"]).has(delivery?.uploadStatus)) {
    throw new ApiError(503, "Clip verification returned an invalid delivery.", "MEDIA_STORAGE_UNAVAILABLE");
  }
  return {
    width: Number(video.width),
    height: Number(video.height),
    durationMs: Number(video.durationMs),
    rotation: Number(video.rotation),
    delivery: {
      key: outputKey,
      contentType: "video/mp4",
      byteSize: Number(delivery.byteSize),
      sha256: String(delivery.sha256),
      width: Number(delivery.width),
      height: Number(delivery.height),
      durationMs: Number(delivery.durationMs),
      rotation: 0,
    },
    poster: verifiedPoster(payload.poster, posterTimeMs),
  };
}

function waitWithCallerSignal(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(signal.reason || new DOMException("Aborted", "AbortError"));
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      callback(value);
    };
    const onAbort = () => finish(reject, signal.reason || new DOMException("Aborted", "AbortError"));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then((value) => finish(resolve, value), (error) => finish(reject, error));
  });
}

async function performVerification({
  objectKey,
  expectedBytes,
  ifMatch,
  structural,
  posterTimeMs,
  env,
  fetchImpl,
  signal,
  output,
}) {
  const capability = createMediaDownloadCapability({ objectKey, ifMatch, env, expiresIn: 120, storageScope: "private" });
  const result = await verifierRequest({
    path: "/v2/verify",
    payload: {
      protocol: VIDEO_VERIFIER_PROTOCOL_VERSION,
      object: {
        key: objectKey,
        byteSize: expectedBytes,
        contentType: "video/mp4",
        etag: ifMatch,
        downloadUrl: capability.downloadUrl,
        downloadHeaders: capability.requiredHeaders,
      },
      structural: {
        width: Number(structural.width),
        height: Number(structural.height),
        codedWidth: Number(structural.codedWidth),
        codedHeight: Number(structural.codedHeight),
        sampleCount: Number(structural.sampleCount),
        durationMs: Number(structural.durationMs),
      },
      poster: {
        timeMs: posterTimeMs,
        contentType: "image/jpeg",
        maxBytes: VIDEO_VERIFIER_MAX_POSTER_BYTES,
        maxEdge: VIDEO_VERIFIER_POSTER_MAX_EDGE,
      },
      output: {
        key: output.key,
        contentType: "video/mp4",
        uploadUrl: output.uploadUrl,
        uploadHeaders: output.requiredHeaders,
      },
    },
    env,
    fetchImpl,
    signal,
    timeoutMs: VIDEO_VERIFIER_JOB_TIMEOUT_MS,
    maxResponseBytes: VIDEO_VERIFIER_MAX_RESPONSE_BYTES,
  });
  const decoded = verifiedDecode(result.decoded, {
    objectKey, expectedBytes, ifMatch, structural, posterTimeMs, outputKey: output.key,
  });
  noteHealthy(result.config, result.decoded, Date.now());
  return decoded;
}

export async function verifyVideoObject({
  objectKey,
  expectedBytes,
  ifMatch,
  structural,
  posterTimeMs,
  env = process.env,
  fetchImpl = globalThis.fetch,
  signal,
  beforeStart,
  output,
} = {}) {
  if (signal?.aborted) throw signal.reason || new DOMException("Aborted", "AbortError");
  if (!OBJECT_KEY.test(String(objectKey || ""))
      || !Number.isSafeInteger(Number(expectedBytes)) || Number(expectedBytes) < 1 || Number(expectedBytes) > 100 * 1024 * 1024
      || !STRONG_ETAG.test(String(ifMatch || ""))
      || !Number.isSafeInteger(Number(structural?.codedWidth)) || Number(structural.codedWidth) < Number(structural?.width)
      || !Number.isSafeInteger(Number(structural?.codedHeight)) || Number(structural.codedHeight) < Number(structural?.height)
      || !Number.isSafeInteger(Number(structural?.sampleCount)) || Number(structural.sampleCount) < 1
      || !Number.isSafeInteger(Number(posterTimeMs)) || Number(posterTimeMs) < 0
      || Number(posterTimeMs) >= Number(structural?.durationMs)) {
    throw new ApiError(500, "Clip verification request is invalid.", "INTERNAL_ERROR");
  }
  if (!output || !OBJECT_KEY.test(String(output.key || "")) || output.key === objectKey
      || typeof output.uploadUrl !== "string" || output.uploadUrl.length > 4_096
      || output.requiredHeaders?.["Content-Type"] !== "video/mp4"
      || output.requiredHeaders?.["If-None-Match"] !== "*") {
    throw new ApiError(500, "Clip delivery request is invalid.", "INTERNAL_ERROR");
  }
  if (healthInFlight) {
    await waitWithCallerSignal(healthInFlight, signal);
  }
  if (signal?.aborted) throw signal.reason || new DOMException("Aborted", "AbortError");
  const identity = createHash("sha256").update(JSON.stringify({
    pipeline: VIDEO_VERIFIER_PIPELINE_VERSION,
    objectKey,
    expectedBytes: Number(expectedBytes),
    ifMatch,
    structural: {
      width: Number(structural?.width),
      height: Number(structural?.height),
      codedWidth: Number(structural?.codedWidth),
      codedHeight: Number(structural?.codedHeight),
      sampleCount: Number(structural?.sampleCount),
      durationMs: Number(structural?.durationMs),
    },
    posterTimeMs: Number(posterTimeMs),
    outputKey: output.key,
  })).digest("hex");
  if (activeVerification) {
    if (activeVerification.identity !== identity) {
      throw new ApiError(429, "Clip verification is busy. Try again shortly.", "RATE_LIMITED");
    }
    return waitForActiveVerification(activeVerification, signal);
  }
  // This hook is deliberately synchronous and runs only after the global slot
  // decision. A denied actor therefore cannot poison a same-object follower,
  // while coalesced followers and busy mismatches consume no decoder permit.
  let demandReservation = null;
  if (beforeStart !== undefined) {
    if (typeof beforeStart !== "function") {
      throw new ApiError(500, "Clip verification reservation is invalid.", "INTERNAL_ERROR");
    }
    const reservationResult = beforeStart();
    if (reservationResult && typeof reservationResult.then === "function") {
      throw new ApiError(500, "Clip verification reservation must be synchronous.", "INTERNAL_ERROR");
    }
    if (reservationResult && (typeof reservationResult.commit !== "function"
        || typeof reservationResult.rollback !== "function")) {
      throw new ApiError(500, "Clip verification reservation is invalid.", "INTERNAL_ERROR");
    }
    demandReservation = reservationResult || null;
  }
  const controller = new AbortController();
  const job = {
    identity,
    controller,
    promise: null,
    settled: false,
    waiters: 0,
  };
  const promise = performVerification({
    objectKey,
    expectedBytes: Number(expectedBytes),
    ifMatch,
    structural,
    posterTimeMs: Number(posterTimeMs),
    env,
    fetchImpl,
    signal: controller.signal,
    output,
  }).then(
    (value) => {
      demandReservation?.commit();
      return value;
    },
    (error) => {
      if (error instanceof ApiError && error.status === 429) demandReservation?.rollback();
      else demandReservation?.commit();
      throw error;
    },
  ).finally(() => {
    job.settled = true;
    if (activeVerification === job) activeVerification = null;
  });
  job.promise = promise;
  activeVerification = job;
  try {
    return await waitForActiveVerification(job, signal);
  } catch (error) {
    throw error;
  }
}

function waitForActiveVerification(job, signal) {
  if (signal?.aborted) return Promise.reject(signal.reason || new DOMException("Aborted", "AbortError"));
  job.waiters += 1;
  return new Promise((resolve, reject) => {
    let done = false;
    const release = () => {
      if (done) return false;
      done = true;
      signal?.removeEventListener("abort", onAbort);
      job.waiters = Math.max(0, job.waiters - 1);
      if (!job.settled && job.waiters === 0 && !job.controller.signal.aborted) {
        job.controller.abort(new DOMException("All verifier callers disconnected", "AbortError"));
      }
      return true;
    };
    const onAbort = () => {
      if (!release()) return;
      reject(signal.reason || new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    job.promise.then(
      (value) => {
        if (!release()) return;
        resolve(value);
      },
      (error) => {
        if (!release()) return;
        reject(error);
      },
    );
  });
}

export function startVideoVerifierHealthScheduler({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
  if (healthTimer || !getVideoVerifierConfig(env).configured) return false;
  const run = () => {
    if (healthInFlight) return healthInFlight;
    healthInFlight = refreshVideoVerifierHealth({ env, fetchImpl })
      .finally(() => { healthInFlight = null; });
    return healthInFlight;
  };
  void run();
  healthTimer = setInterval(() => { void run(); }, VIDEO_VERIFIER_HEALTH_INTERVAL_MS);
  healthTimer.unref?.();
  return true;
}

export function stopVideoVerifierHealthScheduler({ abortActive = false } = {}) {
  if (healthTimer) clearInterval(healthTimer);
  healthTimer = null;
  if (abortActive && !shutdownController.signal.aborted) shutdownController.abort(new Error("Video verifier is shutting down."));
}

export function resetVideoVerifierStateForTests() {
  stopVideoVerifierHealthScheduler({ abortActive: true });
  healthInFlight = null;
  activeVerification = null;
  shutdownController = new AbortController();
  runtime.fingerprint = null;
  runtime.lastAttemptAt = 0;
  runtime.lastSuccessAt = 0;
  runtime.lastErrorCode = null;
  runtime.ffmpegVersion = null;
}
