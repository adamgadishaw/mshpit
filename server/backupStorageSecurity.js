import { randomUUID } from "node:crypto";

const PRIVATE_RESPONSE_STATUSES = new Set([401, 403]);
const BUCKET_NAME = /^[a-z0-9](?:[a-z0-9.-]{1,61}[a-z0-9])?$/u;

export function privateBackupStorageConfig(env = process.env) {
  const required = [
    "BACKUP_S3_ENDPOINT",
    "BACKUP_S3_BUCKET",
    "BACKUP_S3_ACCESS_KEY_ID",
    "BACKUP_S3_SECRET_ACCESS_KEY",
  ];
  if (!required.every((key) => String(env?.[key] || "").trim())) return null;
  const bucket = String(env.BACKUP_S3_BUCKET).trim();
  const mediaBucket = String(env.MEDIA_BUCKET || "").trim();
  const mediaSourceBucket = String(env.MEDIA_SOURCE_BUCKET || "").trim();
  const backupAccessKeyId = String(env.BACKUP_S3_ACCESS_KEY_ID || "").trim();
  const mediaAccessKeyId = String(env.MEDIA_ACCESS_KEY_ID || "").trim();
  if (!BUCKET_NAME.test(bucket)
    || (mediaBucket && bucket === mediaBucket)
    || (mediaSourceBucket && bucket === mediaSourceBucket)
    || (mediaAccessKeyId && backupAccessKeyId === mediaAccessKeyId)) return null;
  let endpoint;
  try { endpoint = new URL(String(env.BACKUP_S3_ENDPOINT).trim()); }
  catch { return null; }
  if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) return null;
  return { endpoint, bucket };
}

function objectUrl(endpoint, bucket, key = "") {
  const prefix = endpoint.pathname.replace(/\/+$/u, "");
  const encodedKey = String(key).split("/").map(encodeURIComponent).join("/");
  return `${endpoint.origin}${prefix}/${encodeURIComponent(bucket)}${encodedKey ? `/${encodedKey}` : ""}`;
}

// Cloudflare R2's S3 API answers an unsigned request with this exact 400
// instead of 401/403 (the media privacy probe accepts it the same way). Only
// an R2 account endpoint and only this exact body count: a generic 400, a 404,
// or a lookalike host never proves privacy.
const R2_ENDPOINT_HOST = /^[a-f0-9]{32}\.(?:(?:eu|fedramp)\.)?r2\.cloudflarestorage\.com$/u;
const R2_UNSIGNED_REJECTIONS = new Set([
  '<?xml version="1.0" encoding="UTF-8"?><Error><Code>InvalidArgument</Code><Message>Authorization</Message></Error>',
  "<Error><Code>InvalidArgument</Code><Message>Authorization</Message></Error>",
]);

async function boundedText(response, maxBytes = 4096) {
  const reader = response.body?.getReader?.();
  if (!reader) return "";
  const chunks = [];
  let total = 0;
  try {
    while (total <= maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value?.byteLength || 0;
      chunks.push(value);
    }
  } finally {
    try { await reader.cancel(); }
    catch { /* architecture: allow-empty-catch -- response cleanup is best-effort after the body is captured */ }
  }
  return total > maxBytes ? "" : Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8");
}

// True only when an unauthenticated request was refused.
async function anonymousDenied(url, endpoint, { fetchImpl, timeoutMs }) {
  const response = await fetchImpl(url, {
    method: "GET",
    redirect: "manual",
    signal: AbortSignal.timeout(timeoutMs),
    headers: { Accept: "application/xml,application/json;q=0.9,*/*;q=0.1" },
  });
  const status = Number(response.status) || 0;
  if (status === 400 && R2_ENDPOINT_HOST.test(endpoint.hostname.toLowerCase())) {
    const body = (await boundedText(response)).trim().replace(/>\s+</gu, "><");
    return R2_UNSIGNED_REJECTIONS.has(body);
  }
  try { await response.body?.cancel?.(); }
  catch { /* architecture: allow-empty-catch -- response cleanup is best-effort after the status is captured */ }
  return PRIVATE_RESPONSE_STATUSES.has(status);
}

/**
 * Prove that neither bucket listing nor the database object prefix is readable
 * without credentials. A 404 is not accepted: it can indicate a public bucket
 * that merely lacks the random key and therefore does not prove privacy.
 */
export async function verifyPrivateBackupBucket({
  env = process.env,
  fetchImpl = fetch,
  objectKey = `db/privacy-probe-${randomUUID()}`,
  timeoutMs = 10_000,
} = {}) {
  const config = privateBackupStorageConfig(env);
  if (!config) throw new Error("Private off-host backup storage is not safely configured.");
  const boundedTimeout = Math.max(1_000, Math.min(30_000, Number(timeoutMs) || 10_000));
  const listUrl = `${objectUrl(config.endpoint, config.bucket)}?list-type=2&max-keys=1`;
  const [listDenied, objectDenied] = await Promise.all([
    anonymousDenied(listUrl, config.endpoint, { fetchImpl, timeoutMs: boundedTimeout }),
    anonymousDenied(objectUrl(config.endpoint, config.bucket, objectKey), config.endpoint, { fetchImpl, timeoutMs: boundedTimeout }),
  ]);
  if (!listDenied || !objectDenied) {
    throw new Error("Off-host backup privacy probe failed closed.");
  }
  return { private: true };
}
