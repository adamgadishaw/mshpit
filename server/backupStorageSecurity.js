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

async function anonymousStatus(url, { fetchImpl, timeoutMs }) {
  const response = await fetchImpl(url, {
    method: "GET",
    redirect: "manual",
    signal: AbortSignal.timeout(timeoutMs),
    headers: { Accept: "application/xml,application/json;q=0.9,*/*;q=0.1" },
  });
  try { await response.body?.cancel?.(); }
  catch { /* architecture: allow-empty-catch -- response cleanup is best-effort after the status is captured */ }
  return Number(response.status) || 0;
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
  const [listStatus, objectStatus] = await Promise.all([
    anonymousStatus(listUrl, { fetchImpl, timeoutMs: boundedTimeout }),
    anonymousStatus(objectUrl(config.endpoint, config.bucket, objectKey), { fetchImpl, timeoutMs: boundedTimeout }),
  ]);
  if (!PRIVATE_RESPONSE_STATUSES.has(listStatus) || !PRIVATE_RESPONSE_STATUSES.has(objectStatus)) {
    throw new Error("Off-host backup privacy probe failed closed.");
  }
  return { private: true };
}
