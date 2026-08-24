import { createHash, createHmac, randomUUID } from "node:crypto";
import { ApiError } from "./errors.js";

const MEBIBYTE = 1024 * 1024;
// Video is allowed only where motion makes sense (concert clips on posts and
// reviews, venue walkthroughs); avatars and banners stay image-only. Clips get
// their own, larger cap because a minute of 1080p is nothing like a photo.
const PURPOSES = Object.freeze({
  avatar: { maxBytes: 5 * MEBIBYTE },
  banner: { maxBytes: 12 * MEBIBYTE },
  post: { maxBytes: 12 * MEBIBYTE, videoMaxBytes: 100 * MEBIBYTE },
  review: { maxBytes: 12 * MEBIBYTE, videoMaxBytes: 100 * MEBIBYTE },
  venue: { maxBytes: 12 * MEBIBYTE, videoMaxBytes: 100 * MEBIBYTE },
});
const TYPES = Object.freeze({
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/heic": "heic",
  "image/heif": "heif",
});
const VIDEO_TYPES = Object.freeze({
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
});
const PROCESSOR_IMAGE_TYPES = Object.freeze({
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
});
const MAX_PROCESSOR_IMAGE_BYTES = 12 * MEBIBYTE;

const REQUIRED_ENV = [
  "MEDIA_ENDPOINT",
  "MEDIA_BUCKET",
  "MEDIA_REGION",
  "MEDIA_ACCESS_KEY_ID",
  "MEDIA_SECRET_ACCESS_KEY",
  "MEDIA_PUBLIC_BASE_URL",
];
const OWNED_OBJECT_KEY = /^users\/[A-Za-z0-9_-]{1,128}\/(?:avatar|banner|post|review|venue)\/[A-Za-z0-9_-]{1,240}\.(?:jpg|png|webp|gif|heic|heif|mp4|webm|mov)$/;
const STRONG_ETAG = /^"[\x21\x23-\x7e]{1,200}"$/u;

let privateIsolationState = Object.freeze({
  configured: false,
  ready: false,
  checkedAt: null,
  listStatus: null,
  objectStatus: null,
  errorCode: "not_checked",
  identity: null,
});

function checkedUrl(value, label, env) {
  let url;
  try { url = new URL(value); }
  catch { throw new ApiError(503, `${label} is not configured correctly.`, "MEDIA_STORAGE_UNAVAILABLE"); }
  const localHttp = env.NODE_ENV !== "production" && url.protocol === "http:";
  if (url.protocol !== "https:" && !localHttp) {
    throw new ApiError(503, `${label} must use HTTPS.`, "MEDIA_STORAGE_UNAVAILABLE");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new ApiError(503, `${label} contains unsupported URL parts.`, "MEDIA_STORAGE_UNAVAILABLE");
  }
  return url;
}

export function getMediaConfig(env = process.env) {
  const missing = REQUIRED_ENV.filter((key) => !String(env[key] || "").trim());
  if (missing.length) return { configured: false, missing };
  const endpoint = checkedUrl(env.MEDIA_ENDPOINT, "MEDIA_ENDPOINT", env);
  const publicBase = checkedUrl(env.MEDIA_PUBLIC_BASE_URL, "MEDIA_PUBLIC_BASE_URL", env);
  const bucket = String(env.MEDIA_BUCKET).trim();
  const sourceBucket = String(env.MEDIA_SOURCE_BUCKET || "").trim();
  const region = String(env.MEDIA_REGION).trim();
  const accessKeyId = String(env.MEDIA_ACCESS_KEY_ID).trim();
  const secretAccessKey = String(env.MEDIA_SECRET_ACCESS_KEY);
  if (!/^[A-Za-z0-9._-]{3,255}$/.test(bucket) || !/^[A-Za-z0-9._-]{1,100}$/.test(region)
      || !accessKeyId || !secretAccessKey) {
    return { configured: false, missing: ["invalid media storage configuration"] };
  }
  return { configured: true, endpoint, publicBase, bucket, sourceBucket, region, accessKeyId, secretAccessKey };
}

export function mediaConfigured(env = process.env) {
  try { return getMediaConfig(env).configured; }
  catch { return false; }
}

export function privateVideoMediaConfigured(env = process.env) {
  try {
    const config = getMediaConfig(env);
    return config.configured
      && /^[A-Za-z0-9._-]{3,255}$/.test(config.sourceBucket)
      && config.sourceBucket !== config.bucket;
  } catch {
    return false;
  }
}

function privateIsolationIdentity(config) {
  if (!config?.configured || !/^[A-Za-z0-9._-]{3,255}$/.test(String(config.sourceBucket || ""))
      || config.sourceBucket === config.bucket) return null;
  return sha256(`${config.endpoint.origin}${config.endpoint.pathname}|${config.sourceBucket}`);
}

export function privateMediaIsolationStatus(env = process.env) {
  let config;
  try { config = getMediaConfig(env); } catch { config = null; }
  const identity = privateIsolationIdentity(config);
  const current = identity && identity === privateIsolationState.identity
    ? privateIsolationState
    : { configured: !!identity, ready: false, checkedAt: null, listStatus: null, objectStatus: null, errorCode: "not_checked" };
  return Object.freeze({
    configured: !!current.configured,
    ready: !!current.ready,
    checkedAt: current.checkedAt || null,
    listStatus: current.listStatus || null,
    objectStatus: current.objectStatus || null,
    errorCode: current.errorCode || null,
  });
}

export function requirePrivateMediaIsolationReady(env = process.env) {
  const status = privateMediaIsolationStatus(env);
  if (!status.ready) {
    throw new ApiError(503, "Private media storage has not passed its privacy check.", "MEDIA_STORAGE_UNAVAILABLE");
  }
  return status;
}

function privacyProbeStatus(value) {
  const status = Number(value);
  return Number.isInteger(status) && status >= 100 && status <= 599 ? status : null;
}

export async function verifyPrivateMediaBucketIsolation({
  env = process.env,
  fetchImpl = globalThis.fetch,
  clock = () => Date.now(),
  timeoutMs = 5_000,
} = {}) {
  let config;
  try { config = getMediaConfig(env); }
  catch {
    privateIsolationState = Object.freeze({ configured: false, ready: false, checkedAt: clock(), listStatus: null,
      objectStatus: null, errorCode: "storage_unconfigured", identity: null });
    return privateMediaIsolationStatus(env);
  }
  const identity = privateIsolationIdentity(config);
  if (!config.configured || !identity || config.sourceBucket === config.bucket || typeof fetchImpl !== "function") {
    privateIsolationState = Object.freeze({ configured: !!identity, ready: false, checkedAt: clock(), listStatus: null,
      objectStatus: null, errorCode: "storage_unconfigured", identity });
    return privateMediaIsolationStatus(env);
  }
  const root = new URL(joinObjectUrl(config.endpoint, [config.sourceBucket]));
  root.searchParams.set("list-type", "2");
  root.searchParams.set("max-keys", "1");
  const randomObject = joinObjectUrl(config.endpoint, [config.sourceBucket, "__pit_privacy_probe__", randomUUID()]);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(500, Math.min(15_000, Math.trunc(Number(timeoutMs) || 5_000))));
  timeout.unref?.();
  let listStatus = null;
  let objectStatus = null;
  let errorCode = null;
  try {
    const [list, object] = await Promise.all([
      fetchImpl(root.toString(), { method: "GET", redirect: "error", signal: controller.signal }),
      fetchImpl(randomObject, { method: "GET", redirect: "error", signal: controller.signal }),
    ]);
    listStatus = privacyProbeStatus(list?.status);
    objectStatus = privacyProbeStatus(object?.status);
    if (![401, 403].includes(listStatus) || ![401, 403].includes(objectStatus)) errorCode = "anonymous_access_not_denied";
  } catch {
    errorCode = controller.signal.aborted ? "probe_timeout" : "probe_failed";
  } finally {
    clearTimeout(timeout);
  }
  privateIsolationState = Object.freeze({
    configured: true,
    ready: !errorCode,
    checkedAt: clock(),
    listStatus,
    objectStatus,
    errorCode,
    identity,
  });
  return privateMediaIsolationStatus(env);
}

function storageBucket(config, storageScope) {
  if (storageScope === "private") {
    if (!config.sourceBucket || config.sourceBucket === config.bucket) {
      throw new ApiError(503, "Private clip storage is not configured.", "MEDIA_STORAGE_UNAVAILABLE");
    }
    return config.sourceBucket;
  }
  if (storageScope !== "public") {
    throw new ApiError(500, "Media storage scope is invalid.", "INTERNAL_ERROR");
  }
  return config.bucket;
}

export function mediaBucketForScope(config, storageScope = "public") {
  return storageBucket(config, storageScope);
}

export function privateMediaLocator(objectKey) {
  const key = String(objectKey || "");
  if (!OWNED_OBJECT_KEY.test(key)) {
    throw new ApiError(500, "Private media identity is invalid.", "INTERNAL_ERROR");
  }
  return `pit-private:${key}`;
}

function rfc3986(value) {
  return encodeURIComponent(String(value)).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

function canonicalPath(pathname) {
  const segments = pathname.split("/").map((segment) => {
    try { return rfc3986(decodeURIComponent(segment)); }
    catch { return rfc3986(segment); }
  });
  const path = segments.join("/");
  return path.startsWith("/") ? path : `/${path}`;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function hmac(key, value, encoding) {
  return createHmac("sha256", key).update(value).digest(encoding);
}

function amzTimestamp(value) {
  return value.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

// Dependency-free AWS Signature V4 query authentication. This intentionally
// accepts a complete object URL so it also works with S3-compatible path-style
// endpoints such as Cloudflare R2 and Backblaze B2.
export function presignS3Request({
  method = "PUT",
  url,
  region,
  accessKeyId,
  secretAccessKey,
  headers = {},
  expiresIn = 600,
  now = new Date(),
}) {
  const target = new URL(url);
  const timestamp = amzTimestamp(now);
  const date = timestamp.slice(0, 8);
  const scope = `${date}/${region}/s3/aws4_request`;
  const normalizedHeaders = { host: target.host.toLowerCase() };
  for (const [name, value] of Object.entries(headers)) {
    normalizedHeaders[name.toLowerCase()] = String(value).trim().replace(/\s+/g, " ");
  }
  const headerNames = Object.keys(normalizedHeaders).sort();
  const signedHeaders = headerNames.join(";");
  const canonicalHeaders = headerNames.map((name) => `${name}:${normalizedHeaders[name]}\n`).join("");

  const query = [...target.searchParams.entries(),
    ["X-Amz-Algorithm", "AWS4-HMAC-SHA256"],
    ["X-Amz-Credential", `${accessKeyId}/${scope}`],
    ["X-Amz-Date", timestamp],
    ["X-Amz-Expires", String(expiresIn)],
    ["X-Amz-SignedHeaders", signedHeaders],
  ].sort(([a, av], [b, bv]) => a === b ? (av < bv ? -1 : av > bv ? 1 : 0) : (a < b ? -1 : 1));
  const canonicalQuery = query.map(([name, value]) => `${rfc3986(name)}=${rfc3986(value)}`).join("&");
  const path = canonicalPath(target.pathname);
  const canonicalRequest = `${method.toUpperCase()}\n${path}\n${canonicalQuery}\n${canonicalHeaders}\n${signedHeaders}\nUNSIGNED-PAYLOAD`;
  const stringToSign = `AWS4-HMAC-SHA256\n${timestamp}\n${scope}\n${sha256(canonicalRequest)}`;
  const dateKey = hmac(`AWS4${secretAccessKey}`, date);
  const regionKey = hmac(dateKey, region);
  const serviceKey = hmac(regionKey, "s3");
  const signingKey = hmac(serviceKey, "aws4_request");
  const signature = hmac(signingKey, stringToSign, "hex");
  return `${target.origin}${path}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

export function validateMediaRequest(body) {
  const purpose = typeof body?.purpose === "string" ? body.purpose.trim().toLowerCase() : "";
  if (!PURPOSES[purpose]) {
    throw new ApiError(400, "Choose a supported photo destination.", "VALIDATION_FAILED");
  }
  const contentType = typeof body?.contentType === "string" ? body.contentType.split(";", 1)[0].trim().toLowerCase() : "";
  const isVideo = !!VIDEO_TYPES[contentType];
  const videoAllowed = !!PURPOSES[purpose].videoMaxBytes;
  const extension = TYPES[contentType] || (videoAllowed ? VIDEO_TYPES[contentType] : undefined);
  if (!extension) {
    if (isVideo) throw new ApiError(415, "Video isn't supported here. Clips can be attached to posts and reviews.", "MEDIA_TYPE_UNSUPPORTED");
    throw new ApiError(415, "That format is not supported. Photos: JPEG, PNG, WebP, GIF, HEIC. Clips: MP4, WebM, MOV.", "MEDIA_TYPE_UNSUPPORTED");
  }
  const fileSize = Number(body?.fileSize);
  if (!Number.isSafeInteger(fileSize) || fileSize < 1) {
    throw new ApiError(400, "Photo size is missing or invalid.", "VALIDATION_FAILED");
  }
  const maxBytes = isVideo ? PURPOSES[purpose].videoMaxBytes : PURPOSES[purpose].maxBytes;
  if (fileSize > maxBytes) {
    throw new ApiError(413, `That ${isVideo ? "clip" : "photo"} is too large. ${Math.floor(maxBytes / MEBIBYTE)} MB is the limit.`, "MEDIA_TOO_LARGE");
  }
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name || name.length > 180 || /[\u0000-\u001f\u007f/\\]/.test(name)) {
    throw new ApiError(400, "Photo name is missing or invalid.", "VALIDATION_FAILED");
  }
  return { purpose, contentType, extension, fileSize, name };
}

function joinObjectUrl(base, segments) {
  const prefix = base.pathname.replace(/\/+$/, "");
  const suffix = segments.map(rfc3986).join("/");
  return `${base.origin}${prefix}/${suffix}`;
}

export function createMediaPresign({
  userId,
  body,
  env = process.env,
  now = new Date(),
  objectId = randomUUID(),
  storageScope = "public",
} = {}) {
  const file = validateMediaRequest(body);
  const config = getMediaConfig(env);
  if (!config.configured) {
    throw new ApiError(503, "Photo storage is warming up. Try again soon.", "MEDIA_STORAGE_UNAVAILABLE");
  }
  if (storageScope === "private" && String(env.NODE_ENV || "").toLowerCase() === "production") {
    // Do not mint a capability that could place an original camera file into a
    // bucket whose anonymous-read policy has not been proven closed. Checking
    // again at signed-GET time protects publication, while this earlier gate
    // also prevents the upload itself from becoming an exposure window.
    requirePrivateMediaIsolationReady(env);
  }
  const owner = String(userId || "").replace(/[^A-Za-z0-9_-]/g, "");
  if (!owner) throw new ApiError(401, "Log in first.", "AUTH_REQUIRED");
  const safeId = String(objectId).replace(/[^A-Za-z0-9_-]/g, "");
  const key = `users/${owner}/${file.purpose}/${safeId}.${file.extension}`;
  const objectUrl = joinObjectUrl(config.endpoint, [storageBucket(config, storageScope), ...key.split("/")]);
  const publicUrl = storageScope === "public" ? joinObjectUrl(config.publicBase, key.split("/")) : null;
  // R2 implements conditional PutObject. Binding every public object key to a
  // create-only PUT prevents a still-valid signed URL from overwriting bytes
  // after finalization/moderation. The browser is allowed to author this header;
  // the bucket CORS policy must list If-None-Match alongside Content-Type.
  const requiredHeaders = { "Content-Type": file.contentType, "If-None-Match": "*" };
  // Content-Length is a forbidden browser-authored header, so it is not
  // returned to the client. Fetch/URLSession/OkHttp compute it from the actual
  // Blob/file. Signing that transport header binds the ticket to the measured
  // byte count instead of trusting the JSON declaration alone.
  const signingHeaders = { ...requiredHeaders, "Content-Length": String(file.fileSize) };
  const expiresIn = 600;
  let uploadUrl;
  try {
    uploadUrl = presignS3Request({
      method: "PUT",
      url: objectUrl,
      region: config.region,
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      headers: signingHeaders,
      expiresIn,
      now,
    });
  } catch (error) {
    throw new ApiError(502, "Photo upload could not be prepared. Try again.", "MEDIA_UPLOAD_FAILED", error);
  }
  return {
    method: "PUT",
    uploadUrl,
    publicUrl,
    storageLocator: storageScope === "private" ? privateMediaLocator(key) : publicUrl,
    storageScope,
    key,
    requiredHeaders,
    expiresAt: now.getTime() + expiresIn * 1000,
    fileSize: file.fileSize,
  };
}

// Internal processors never receive the bucket credential. Instead, the web
// control plane grants one short-lived, immutable-generation GET capability.
// Binding If-Match prevents a delete/recreate race from making a verifier read
// bytes other than the exact object generation that HEAD inspection approved.
export function createMediaDownloadCapability({
  objectKey,
  ifMatch,
  env = process.env,
  now = new Date(),
  expiresIn = 120,
  storageScope = "public",
} = {}) {
  const key = String(objectKey || "");
  const etag = String(ifMatch || "").trim();
  const ttl = Number(expiresIn);
  if (!OWNED_OBJECT_KEY.test(key) || !STRONG_ETAG.test(etag)) {
    throw new ApiError(500, "Clip verification could not be prepared.", "INTERNAL_ERROR");
  }
  if (!Number.isSafeInteger(ttl) || ttl < 30 || ttl > 300) {
    throw new ApiError(500, "Clip verification could not be prepared.", "INTERNAL_ERROR");
  }
  const config = getMediaConfig(env);
  if (!config.configured) {
    throw new ApiError(503, "Media storage is temporarily unavailable.", "MEDIA_STORAGE_UNAVAILABLE");
  }
  if (storageScope === "private" && String(env.NODE_ENV || "").toLowerCase() === "production") {
    requirePrivateMediaIsolationReady(env);
  }
  const objectUrl = joinObjectUrl(config.endpoint, [storageBucket(config, storageScope), ...key.split("/")]);
  const headers = { "If-Match": etag };
  let downloadUrl;
  try {
    downloadUrl = presignS3Request({
      method: "GET",
      url: objectUrl,
      region: config.region,
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      headers,
      expiresIn: ttl,
      now,
    });
  } catch (error) {
    throw new ApiError(503, "Clip verification could not be prepared. Try again.", "MEDIA_STORAGE_UNAVAILABLE", error);
  }
  return {
    method: "GET",
    downloadUrl,
    requiredHeaders: headers,
    expiresAt: now.getTime() + ttl * 1_000,
  };
}

// The isolated verifier receives a single create-only public-output
// capability, never the bucket credential. Content-Length is deliberately not
// signed because the sanitized derivative size exists only after transcoding;
// the worker sends its measured length and the control plane independently
// HEADs and hashes the finished object before publication.
export function createMediaProcessorUploadCapability({
  objectKey,
  env = process.env,
  now = new Date(),
  expiresIn = 120,
} = {}) {
  const key = String(objectKey || "");
  const ttl = Number(expiresIn);
  if (!OWNED_OBJECT_KEY.test(key) || !key.endsWith(".mp4")
      || !Number.isSafeInteger(ttl) || ttl < 30 || ttl > 300) {
    throw new ApiError(500, "Clip delivery upload could not be prepared.", "INTERNAL_ERROR");
  }
  const config = getMediaConfig(env);
  if (!config.configured) {
    throw new ApiError(503, "Media storage is temporarily unavailable.", "MEDIA_STORAGE_UNAVAILABLE");
  }
  const objectUrl = joinObjectUrl(config.endpoint, [config.bucket, ...key.split("/")]);
  const headers = { "Content-Type": "video/mp4", "If-None-Match": "*" };
  let uploadUrl;
  try {
    uploadUrl = presignS3Request({
      method: "PUT",
      url: objectUrl,
      region: config.region,
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      headers,
      expiresIn: ttl,
      now,
    });
  } catch (error) {
    throw new ApiError(503, "Clip delivery upload could not be prepared.", "MEDIA_STORAGE_UNAVAILABLE", error);
  }
  return {
    method: "PUT",
    uploadUrl,
    requiredHeaders: headers,
    publicUrl: joinObjectUrl(config.publicBase, key.split("/")),
    key,
    storageScope: "public",
    expiresAt: now.getTime() + ttl * 1_000,
  };
}

export function createMediaProcessorImageUploadCapability({
  objectKey,
  contentType,
  contentLength,
  env = process.env,
  now = new Date(),
  expiresIn = 120,
} = {}) {
  const key = String(objectKey || "");
  const type = String(contentType || "").toLowerCase();
  const bytes = Number(contentLength);
  const extension = PROCESSOR_IMAGE_TYPES[type];
  const ttl = Number(expiresIn);
  if (!OWNED_OBJECT_KEY.test(key) || !extension || !key.endsWith(`.${extension}`)
      || !Number.isSafeInteger(bytes) || bytes < 1 || bytes > MAX_PROCESSOR_IMAGE_BYTES
      || !Number.isSafeInteger(ttl) || ttl < 30 || ttl > 300) {
    throw new ApiError(500, "Photo delivery upload could not be prepared.", "INTERNAL_ERROR");
  }
  const config = getMediaConfig(env);
  if (!config.configured) {
    throw new ApiError(503, "Media storage is temporarily unavailable.", "MEDIA_STORAGE_UNAVAILABLE");
  }
  const objectUrl = joinObjectUrl(config.endpoint, [config.bucket, ...key.split("/")]);
  const headers = { "Content-Type": type, "Content-Length": String(bytes), "If-None-Match": "*" };
  let uploadUrl;
  try {
    uploadUrl = presignS3Request({
      method: "PUT",
      url: objectUrl,
      region: config.region,
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      headers,
      expiresIn: ttl,
      now,
    });
  } catch (error) {
    throw new ApiError(503, "Photo delivery upload could not be prepared.", "MEDIA_STORAGE_UNAVAILABLE", error);
  }
  return {
    method: "PUT",
    uploadUrl,
    requiredHeaders: headers,
    publicUrl: joinObjectUrl(config.publicBase, key.split("/")),
    key,
    storageScope: "public",
    expiresAt: now.getTime() + ttl * 1_000,
    fileSize: bytes,
  };
}
