import { createHash, createHmac, randomUUID } from "node:crypto";
import { ApiError } from "./errors.js";

const MEBIBYTE = 1024 * 1024;
const PURPOSES = Object.freeze({
  avatar: { maxBytes: 5 * MEBIBYTE },
  banner: { maxBytes: 12 * MEBIBYTE },
  post: { maxBytes: 12 * MEBIBYTE },
  review: { maxBytes: 12 * MEBIBYTE },
  venue: { maxBytes: 12 * MEBIBYTE },
});
const TYPES = Object.freeze({
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/heic": "heic",
  "image/heif": "heif",
});

const REQUIRED_ENV = [
  "MEDIA_ENDPOINT",
  "MEDIA_BUCKET",
  "MEDIA_REGION",
  "MEDIA_ACCESS_KEY_ID",
  "MEDIA_SECRET_ACCESS_KEY",
  "MEDIA_PUBLIC_BASE_URL",
];

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
  const region = String(env.MEDIA_REGION).trim();
  const accessKeyId = String(env.MEDIA_ACCESS_KEY_ID).trim();
  const secretAccessKey = String(env.MEDIA_SECRET_ACCESS_KEY);
  if (!/^[A-Za-z0-9._-]{3,255}$/.test(bucket) || !/^[A-Za-z0-9._-]{1,100}$/.test(region)
      || !accessKeyId || !secretAccessKey) {
    return { configured: false, missing: ["invalid media storage configuration"] };
  }
  return { configured: true, endpoint, publicBase, bucket, region, accessKeyId, secretAccessKey };
}

export function mediaConfigured(env = process.env) {
  try { return getMediaConfig(env).configured; }
  catch { return false; }
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
  const extension = TYPES[contentType];
  if (!extension) {
    throw new ApiError(415, "That photo format is not supported. Use JPEG, PNG, WebP, GIF, HEIC, or HEIF.", "MEDIA_TYPE_UNSUPPORTED");
  }
  const fileSize = Number(body?.fileSize);
  if (!Number.isSafeInteger(fileSize) || fileSize < 1) {
    throw new ApiError(400, "Photo size is missing or invalid.", "VALIDATION_FAILED");
  }
  if (fileSize > PURPOSES[purpose].maxBytes) {
    throw new ApiError(413, `That photo is too large. ${Math.floor(PURPOSES[purpose].maxBytes / MEBIBYTE)} MB is the limit.`, "MEDIA_TOO_LARGE");
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

export function createMediaPresign({ userId, body, env = process.env, now = new Date(), objectId = randomUUID() }) {
  const file = validateMediaRequest(body);
  const config = getMediaConfig(env);
  if (!config.configured) {
    throw new ApiError(503, "Photo storage is warming up. Try again soon.", "MEDIA_STORAGE_UNAVAILABLE");
  }
  const owner = String(userId || "").replace(/[^A-Za-z0-9_-]/g, "");
  if (!owner) throw new ApiError(401, "Log in first.", "AUTH_REQUIRED");
  const safeId = String(objectId).replace(/[^A-Za-z0-9_-]/g, "");
  const key = `users/${owner}/${file.purpose}/${safeId}.${file.extension}`;
  const objectUrl = joinObjectUrl(config.endpoint, [config.bucket, ...key.split("/")]);
  const publicUrl = joinObjectUrl(config.publicBase, key.split("/"));
  const requiredHeaders = { "Content-Type": file.contentType };
  const expiresIn = 600;
  let uploadUrl;
  try {
    uploadUrl = presignS3Request({
      method: "PUT",
      url: objectUrl,
      region: config.region,
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      headers: requiredHeaders,
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
    key,
    requiredHeaders,
    expiresAt: now.getTime() + expiresIn * 1000,
    fileSize: file.fileSize,
  };
}
