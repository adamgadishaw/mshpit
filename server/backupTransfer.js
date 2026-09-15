import { createHash } from "node:crypto";
import { createReadStream, statSync } from "node:fs";
import { basename } from "node:path";
import { presignS3Request } from "./media.js";
import { privateBackupStorageConfig, verifyPrivateBackupBucket } from "./backupStorageSecurity.js";

const SNAPSHOT_NAME = /^pit-\d{8}-\d{6}\.db$/u;
const CHUNK_BYTES = 64 * 1024;

async function discardResponse(response) {
  try { await response?.body?.cancel?.(); }
  catch { /* architecture: allow-empty-catch -- release response without logging private object/credential details */ }
}

function transferError(code) {
  return Object.assign(new Error("Private off-host backup transfer could not be verified."), { code });
}

export async function backupFileDigests(path, { signal } = {}) {
  const stats = statSync(path);
  if (!stats.isFile() || !Number.isSafeInteger(stats.size) || stats.size <= 0) {
    throw transferError("BACKUP_INVALID_FILE");
  }
  const md5 = createHash("md5");
  const sha256 = createHash("sha256");
  let size = 0;
  // Hash and PUT sequentially, without retaining database-sized buffers. MD5 is
  // the S3 transport checksum; SHA-256 metadata supports independent restores.
  const stream = createReadStream(path, { highWaterMark: CHUNK_BYTES, signal });
  for await (const chunk of stream) {
    size += chunk.length;
    md5.update(chunk);
    sha256.update(chunk);
  }
  if (size !== stats.size) throw transferError("BACKUP_FILE_CHANGED");
  return { size, md5: md5.digest("base64"), sha256: sha256.digest("hex") };
}

/** Upload only a locally verified immutable snapshot, never a live database. */
export async function uploadPrivateBackup(path, {
  env = process.env,
  publishedName = basename(path),
  fetchImpl = fetch,
  timeoutMs = 120_000,
} = {}) {
  const config = privateBackupStorageConfig(env);
  if (!config || !SNAPSHOT_NAME.test(publishedName)) throw transferError("BACKUP_CONFIG_INVALID");
  const signal = AbortSignal.timeout(Math.max(1_000, Math.min(30 * 60_000, Number(timeoutMs) || 120_000)));
  const key = `db/${publishedName}`;
  const objectUrl = `${config.endpoint.origin}${config.endpoint.pathname.replace(/\/+$/u, "")}/${config.bucket}/${key}`;
  const signed = (method, headers = {}) => presignS3Request({
    method, url: objectUrl, headers,
    region: String(env.BACKUP_S3_REGION || "auto").trim(),
    accessKeyId: String(env.BACKUP_S3_ACCESS_KEY_ID).trim(),
    secretAccessKey: String(env.BACKUP_S3_SECRET_ACCESS_KEY).trim(),
    expiresIn: 1800,
  });
  // Prove privacy before reading account data, then again on the uploaded key.
  // Redirects must never carry database bytes or signed URLs to another host.
  await verifyPrivateBackupBucket({ env, objectKey: key, fetchImpl });
  const digests = await backupFileDigests(path, { signal });
  const headers = {
    "Content-Length": String(digests.size),
    "Content-MD5": digests.md5,
    "Content-Type": "application/vnd.sqlite3",
    "x-amz-meta-sha256": digests.sha256,
  };
  const body = createReadStream(path, { highWaterMark: CHUNK_BYTES, signal });
  let response;
  try {
    response = await fetchImpl(signed("PUT", headers), {
      method: "PUT", headers, body, duplex: "half", redirect: "manual", signal,
    });
    if (!response.ok) throw transferError(`HTTP_${Number(response.status) || 0}`);
  } finally {
    body.destroy();
    await discardResponse(response);
  }
  try {
    await verifyPrivateBackupBucket({ env, objectKey: key, fetchImpl });
  } catch (privacyError) {
    // Best effort removal only of this exact just-uploaded object. A failed
    // privacy check never produces a successful backup receipt.
    try {
      const removed = await fetchImpl(signed("DELETE"), {
        method: "DELETE", redirect: "manual", signal: AbortSignal.timeout(10_000),
      });
      await discardResponse(removed);
    } catch { /* architecture: allow-empty-catch -- preserve privacy failure; deletion is not claimed successful */ }
    throw privacyError;
  }
  const stored = await fetchImpl(signed("HEAD"), { method: "HEAD", redirect: "manual", signal });
  try {
    if (!stored.ok) throw transferError(`BACKUP_HEAD_HTTP_${Number(stored.status) || 0}`);
    const length = stored.headers.get("content-length");
    if (length === null || Number(length) !== digests.size
      || stored.headers.get("x-amz-meta-sha256") !== digests.sha256) {
      throw transferError("BACKUP_REMOTE_MISMATCH");
    }
  } finally { await discardResponse(stored); }
  return { key, ...digests };
}
