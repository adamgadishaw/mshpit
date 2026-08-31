import { Readable, Transform, pipeline } from "node:stream";

import { landingCommunityMediaSource } from "./landingMedia.js";

const LANDING_MEDIA_PATH = /^\/media\/landing\/([A-Za-z0-9_-]{1,180})$/;
const LANDING_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const LANDING_IMAGE_MAX_BYTES = 12 * 1024 * 1024;

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

  const requestHeaders = { Accept: "image/webp,image/png,image/jpeg" };
  const ifNoneMatch = req?.headers?.["if-none-match"];
  if (typeof ifNoneMatch === "string" && ifNoneMatch.length <= 200) requestHeaders["If-None-Match"] = ifNoneMatch;
  let upstream;
  try {
    upstream = await fetchImpl(source.url, {
      method,
      headers: requestHeaders,
      redirect: "error",
      signal,
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    return endResponse(res, 502, {
      ...securityHeaders,
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    }, "Photo unavailable.");
  }
  if (upstream.status === 304) {
    return endResponse(res, 304, {
      ...securityHeaders,
      "Cache-Control": "private, max-age=300, must-revalidate",
      Vary: "Cookie",
    });
  }
  if (!upstream.ok) {
    return endResponse(res, upstream.status === 404 ? 404 : 502, {
      ...securityHeaders,
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    }, "Photo unavailable.");
  }

  const contentType = cleanContentType(upstream.headers?.get?.("content-type"));
  const contentLength = cleanContentLength(upstream.headers?.get?.("content-length"));
  if (!LANDING_IMAGE_TYPES.has(contentType)
    || (upstream.headers?.get?.("content-length") != null && contentLength == null)) {
    return endResponse(res, 502, {
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
  if (method === "HEAD") return endResponse(res, 200, responseHeaders);
  if (!upstream.body) {
    return endResponse(res, 502, {
      ...securityHeaders,
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    }, "Photo unavailable.");
  }

  res.writeHead(200, responseHeaders);
  const stream = Readable.fromWeb(upstream.body);
  let streamedBytes = 0;
  const byteLimit = new Transform({
    transform(chunk, _encoding, callback) {
      streamedBytes += chunk.length;
      callback(streamedBytes <= LANDING_IMAGE_MAX_BYTES ? null : new Error("Landing image exceeded its byte budget."), chunk);
    },
  });
  pipeline(stream, byteLimit, res, (error) => {
    if (error && !res.destroyed) res.destroy(error);
  });
  return true;
}
