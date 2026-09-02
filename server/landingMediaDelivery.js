import { Readable, Transform, pipeline } from "node:stream";

import { landingCommunityMediaSource } from "./landingMedia.js";

const LANDING_MEDIA_PATH = /^\/media\/landing\/([A-Za-z0-9_-]{1,180})$/;
const LANDING_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const LANDING_IMAGE_MAX_BYTES = 12 * 1024 * 1024;
const LANDING_MEDIA_TIMEOUT_MS = 10_000;
const LANDING_MEDIA_BREAKER_WINDOW_MS = 60_000;
const DEFAULT_LANDING_MEDIA_MAX_IN_FLIGHT = 24;
const DEFAULT_LANDING_MEDIA_WINDOW_BYTES = 256 * 1024 * 1024;

function boundedInteger(value, fallback, minimum, maximum) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(minimum, Math.min(maximum, Math.trunc(number))) : fallback;
}

export function landingMediaCircuitBreakerLimits(env = process.env) {
  return {
    maxInFlight: boundedInteger(env?.LANDING_MEDIA_MAX_IN_FLIGHT,
      DEFAULT_LANDING_MEDIA_MAX_IN_FLIGHT, 1, 1_000),
    rollingBytes: boundedInteger(env?.LANDING_MEDIA_60S_BYTES,
      DEFAULT_LANDING_MEDIA_WINDOW_BYTES, LANDING_IMAGE_MAX_BYTES, 64 * 1024 * 1024 * 1024),
  };
}

export function createLandingMediaCircuitBreaker() {
  let inFlight = 0;
  let lastObservedAt = 0;
  let streamedBytes = 0;
  let reservedBytes = 0;
  const byteEvents = [];
  const observe = (instant) => {
    const parsed = Number(instant);
    const candidate = Number.isFinite(parsed) && parsed >= 0 ? parsed : Date.now();
    lastObservedAt = Math.max(lastObservedAt, candidate);
    const cutoff = lastObservedAt - LANDING_MEDIA_BREAKER_WINDOW_MS;
    while (byteEvents.length && byteEvents[0].at <= cutoff) {
      streamedBytes = Math.max(0, streamedBytes - byteEvents.shift().bytes);
    }
    return lastObservedAt;
  };
  return {
    reserve({ at = Date.now(), env = process.env } = {}) {
      const limits = landingMediaCircuitBreakerLimits(env);
      observe(at);
      if (inFlight >= limits.maxInFlight
        || streamedBytes + reservedBytes >= limits.rollingBytes) return null;
      inFlight += 1;
      let released = false;
      let leaseReservedBytes = 0;
      return {
        canFit(byteCount, instant = Date.now()) {
          if (released) return false;
          observe(instant);
          const bytes = Number(byteCount);
          return Number.isSafeInteger(bytes) && bytes >= 0
            && streamedBytes + reservedBytes + bytes <= limits.rollingBytes;
        },
        reserveBytes(byteCount, instant = Date.now()) {
          if (!this.canFit(byteCount, instant)) return false;
          const bytes = Number(byteCount);
          leaseReservedBytes += bytes;
          reservedBytes += bytes;
          return true;
        },
        record(byteCount, instant = Date.now()) {
          if (released) return false;
          const bytes = Number(byteCount);
          if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > leaseReservedBytes) return false;
          const observedAt = observe(instant);
          leaseReservedBytes -= bytes;
          reservedBytes = Math.max(0, reservedBytes - bytes);
          if (bytes > 0) {
            streamedBytes += bytes;
            byteEvents.push({ at: observedAt, bytes });
          }
          return true;
        },
        release() {
          if (released) return;
          released = true;
          reservedBytes = Math.max(0, reservedBytes - leaseReservedBytes);
          leaseReservedBytes = 0;
          inFlight = Math.max(0, inFlight - 1);
        },
      };
    },
    snapshot(at = Date.now()) {
      observe(at);
      return { inFlight, streamedBytes, reservedBytes, byteEvents: byteEvents.length };
    },
  };
}

const sharedLandingMediaCircuitBreaker = createLandingMediaCircuitBreaker();

export function landingMediaPostIdFromPath(pathname) {
  const match = LANDING_MEDIA_PATH.exec(typeof pathname === "string" ? pathname : "");
  return match ? match[1] : null;
}

function cleanContentType(value) {
  return String(value || "").split(";", 1)[0].trim().toLowerCase();
}

function cleanContentLength(value) {
  const size = Number(value);
  return Number.isSafeInteger(size) && size >= 0 && size <= LANDING_IMAGE_MAX_BYTES ? size : null;
}

function endResponse(res, status, headers, body = "") {
  res.writeHead(status, headers);
  res.end(body);
  return true;
}

export async function serveLandingMediaRequest({
  req,
  res,
  pathname,
  viewerId = null,
  at = Date.now(),
  signal,
  securityHeaders = {},
  fetchImpl = globalThis.fetch,
  resolveSource = landingCommunityMediaSource,
  timeoutMs = LANDING_MEDIA_TIMEOUT_MS,
  env = process.env,
  clock = Date.now,
  circuitBreaker = sharedLandingMediaCircuitBreaker,
} = {}) {
  const method = String(req?.method || "GET").toUpperCase();
  const postId = landingMediaPostIdFromPath(pathname);
  if (!postId) return false;
  if (method !== "GET" && method !== "HEAD") {
    return endResponse(res, 405, {
      ...securityHeaders,
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      Allow: "GET, HEAD",
    }, "Method not allowed.");
  }

  const source = resolveSource({ postId, viewerId, at });
  if (!source?.url) {
    return endResponse(res, 404, {
      ...securityHeaders,
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    }, "Photo not found.");
  }

  const lease = circuitBreaker.reserve({ at: clock(), env });
  if (!lease) {
    return endResponse(res, 503, {
      ...securityHeaders,
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "Retry-After": "5",
    }, "Photo service is busy. Try again shortly.");
  }
  const endLeasedResponse = (status, headers, body = "") => {
    lease.release();
    return endResponse(res, status, headers, body);
  };

  const requestHeaders = { Accept: "image/webp,image/png,image/jpeg" };
  const ifNoneMatch = req?.headers?.["if-none-match"];
  if (typeof ifNoneMatch === "string" && ifNoneMatch.length <= 200) requestHeaders["If-None-Match"] = ifNoneMatch;
  let upstream;
  const boundedTimeoutMs = Math.max(10, Math.min(LANDING_MEDIA_TIMEOUT_MS, Number(timeoutMs) || LANDING_MEDIA_TIMEOUT_MS));
  const timeoutSignal = AbortSignal.timeout(boundedTimeoutMs);
  const requestSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
  try {
    upstream = await fetchImpl(source.url, {
      method,
      headers: requestHeaders,
      redirect: "error",
      signal: requestSignal,
    });
  } catch (error) {
    lease.release();
    if (signal?.aborted) throw error;
    return endResponse(res, 502, {
      ...securityHeaders,
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    }, "Photo unavailable.");
  }
  if (upstream.status === 304) {
    return endLeasedResponse(304, {
      ...securityHeaders,
      "Cache-Control": "private, max-age=300, must-revalidate",
      Vary: "Cookie",
    });
  }
  if (!upstream.ok) {
    return endLeasedResponse(upstream.status === 404 ? 404 : 502, {
      ...securityHeaders,
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    }, "Photo unavailable.");
  }

  const contentType = cleanContentType(upstream.headers?.get?.("content-type"));
  const contentLength = cleanContentLength(upstream.headers?.get?.("content-length"));
  if (!LANDING_IMAGE_TYPES.has(contentType)
    || (upstream.headers?.get?.("content-length") != null && contentLength == null)) {
    return endLeasedResponse(502, {
      ...securityHeaders,
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    }, "Photo unavailable.");
  }

  const responseHeaders = {
    ...securityHeaders,
    "Content-Type": contentType,
    "Cache-Control": "private, max-age=300, must-revalidate",
    Vary: "Cookie",
    ...(contentLength == null ? {} : { "Content-Length": String(contentLength) }),
  };
  const etag = upstream.headers?.get?.("etag");
  if (etag && etag.length <= 200) responseHeaders.ETag = etag;
  if (method === "HEAD") return endLeasedResponse(200, responseHeaders);
  if (!upstream.body) {
    return endLeasedResponse(502, {
      ...securityHeaders,
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    }, "Photo unavailable.");
  }

  // Reserve the full known response before sending a 200. For a chunked
  // response reserve the per-image maximum. That makes concurrent admissions
  // atomic and prevents the service-wide breaker from truncating an image only
  // after successful response headers have reached the browser.
  const responseReservation = contentLength ?? LANDING_IMAGE_MAX_BYTES;
  if (!lease.reserveBytes(responseReservation, clock())) {
    try { await upstream.body.cancel(); }
    catch { /* architecture: allow-empty-catch -- cancellation is best-effort after admission is safely rejected */ }
    return endLeasedResponse(503, {
      ...securityHeaders,
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "Retry-After": "5",
    }, "Photo service is busy. Try again shortly.");
  }

  res.writeHead(200, responseHeaders);
  const stream = Readable.fromWeb(upstream.body, { signal: requestSignal });
  let streamedBytes = 0;
  const byteLimit = new Transform({
    transform(chunk, _encoding, callback) {
      streamedBytes += chunk.length;
      const withinImageLimit = streamedBytes <= LANDING_IMAGE_MAX_BYTES;
      const withinServiceBudget = withinImageLimit && lease.record(chunk.length, clock());
      callback(withinServiceBudget ? null : new Error("Landing image exceeded its byte budget."), chunk);
    },
  });
  pipeline(stream, byteLimit, res, (error) => {
    lease.release();
    if (error && !res.destroyed) res.destroy(error);
  });
  return true;
}
