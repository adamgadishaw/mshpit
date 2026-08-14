import { getMediaConfig, mediaConfigured, presignS3Request } from "./media.js";

const OWNER = /^[A-Za-z0-9_-]{1,128}$/;
const OBJECT_KEY = /^users\/([A-Za-z0-9_-]{1,128})\/(avatar|banner|post|review|venue)\/([A-Za-z0-9_-]{1,180})\.(jpg|png|webp|gif|heic|heif|mp4|webm|mov)$/;
const TRUE_VALUES = new Set(["1", "true", "yes", "on", "enabled"]);
const FALSE_VALUES = new Set(["0", "false", "no", "off", "disabled"]);
const RETRY_DELAYS_MS = Object.freeze([60_000, 5 * 60_000, 30 * 60_000, 2 * 60 * 60_000]);
const DAY_MS = 24 * 60 * 60_000;
const MEDIA_UPLOAD_TICKET_MS = 10 * 60_000;

export const MEDIA_DELETION_MAX_ATTEMPTS = 5;
export const MEDIA_DELETION_LEASE_MS = 2 * 60_000;
// The app bounds a video PUT at five minutes. Waiting ten minutes beyond the
// signature expiry also covers clock skew and a request that began just before
// expiry but completed after account erasure.
export const MEDIA_UPLOAD_SETTLE_BUFFER_MS = 10 * 60_000;
// S3-style providers check a presigned request when it begins, not necessarily
// again when the body finishes. Re-list the deleted owner's exact prefix for
// three days after the normal ticket barrier so a deliberately slow upload is
// caught without relying on one optimistic empty listing. The provider still
// needs to evidence a maximum accepted request duration before this can be
// described as an absolute erasure bound.
export const MEDIA_OWNER_SWEEP_QUIET_WINDOW_MS = 3 * DAY_MS;
export const MEDIA_OWNER_SWEEP_RECHECK_MS = 6 * 60 * 60_000;

const schedulerState = {
  running: false,
  startedAt: 0,
  lastRunAt: 0,
  lastSuccessAt: 0,
  lastErrorCode: null,
};

function safeOwnerId(value) {
  const owner = String(value || "");
  return OWNER.test(owner) ? owner : null;
}

function checkedPublicBase(env) {
  const raw = String(env?.MEDIA_PUBLIC_BASE_URL || "").trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    const localHttp = String(env?.NODE_ENV || "").toLowerCase() !== "production" && url.protocol === "http:";
    if (url.protocol !== "https:" && !localHttp) return null;
    if (url.username || url.password || url.search || url.hash) return null;
    return url;
  } catch {
    return null;
  }
}

function rawUrlHasTraversal(value) {
  const raw = String(value || "");
  // Generated object URLs contain only literal safe key characters. Rejecting
  // encoded path control characters keeps URL normalization from turning a
  // hostile spelling into a seemingly valid owner path.
  if (/%(?:2e|2f|5c)/i.test(raw) || raw.includes("\\")) return true;
  const path = raw.replace(/^[A-Za-z][A-Za-z0-9+.-]*:\/\/[^/]+/, "").split(/[?#]/, 1)[0];
  return path.split("/").some((segment) => segment === "." || segment === "..");
}

export function trustedOwnedMediaKey(value, { ownerId, env = process.env } = {}) {
  const owner = safeOwnerId(ownerId);
  const base = checkedPublicBase(env);
  if (!owner || !base || typeof value !== "string" || value.length > 2000 || rawUrlHasTraversal(value)) return null;
  let target;
  try { target = new URL(value); }
  catch { return null; }
  if (target.protocol !== base.protocol || target.origin !== base.origin) return null;
  if (target.username || target.password || target.search || target.hash) return null;
  const prefix = `${base.pathname.replace(/\/+$/, "")}/`;
  if (!target.pathname.startsWith(prefix)) return null;
  const key = target.pathname.slice(prefix.length);
  const match = OBJECT_KEY.exec(key);
  if (!match || match[1] !== owner) return null;
  return key;
}

export function trustedMediaQueueKey(value, ownerId) {
  const owner = safeOwnerId(ownerId);
  if (!owner || typeof value !== "string") return null;
  const match = OBJECT_KEY.exec(value);
  return match && match[1] === owner ? value : null;
}

export function ownedMediaKeys(values, options) {
  const keys = new Set();
  for (const value of Array.isArray(values) ? values : []) {
    const key = trustedOwnedMediaKey(value, options);
    if (key) keys.add(key);
  }
  return [...keys];
}

export function recordMediaObjectTicket(database, {
  ownerId,
  objectKey,
  at = Date.now(),
  expiresAt,
} = {}) {
  const owner = safeOwnerId(ownerId);
  const key = trustedMediaQueueKey(objectKey, owner);
  const match = key ? OBJECT_KEY.exec(key) : null;
  if (!owner || !match) return false;
  let uploadExpiresAt = null;
  if (expiresAt !== null) {
    const requested = Number(expiresAt);
    uploadExpiresAt = Number.isSafeInteger(requested) && requested >= at && requested <= at + 15 * 60_000
      ? requested
      : at + MEDIA_UPLOAD_TICKET_MS;
  }
  return Number(database.prepare(`INSERT OR IGNORE INTO media_objects
    (object_key,owner_id,purpose,status,created_at,upload_expires_at,updated_at)
    VALUES (?,?,?,'issued',?,?,?)`).run(key, owner, match[2], at, uploadExpiresAt, at).changes || 0) === 1;
}

export function markOwnedMediaAssociated(database, {
  ownerId,
  urls,
  env = process.env,
  at = Date.now(),
} = {}) {
  const owner = safeOwnerId(ownerId);
  if (!owner) return 0;
  const update = database.prepare(`UPDATE media_objects
    SET status='associated',associated_at=COALESCE(associated_at,?),updated_at=?
    WHERE owner_id=? AND object_key=? AND status IN ('issued','associated')`);
  let changed = 0;
  for (const key of ownedMediaKeys(urls, { ownerId: owner, env })) {
    changed += Number(update.run(at, at, owner, key).changes || 0);
  }
  return changed;
}

export function unreferencedOwnedMediaUrls(database, {
  ownerId,
  urls,
  env = process.env,
} = {}) {
  const owner = safeOwnerId(ownerId);
  if (!owner) return [];
  const candidates = new Map();
  for (const value of Array.isArray(urls) ? urls : []) {
    const key = trustedOwnedMediaKey(value, { ownerId: owner, env });
    if (key && !candidates.has(key)) candidates.set(key, value);
  }
  if (!candidates.size) return [];
  const stillUsed = database.prepare(`SELECT 1 FROM (
      SELECT avatar_uri value FROM users WHERE id=?
      UNION ALL SELECT banner FROM users WHERE id=?
      UNION ALL SELECT avatar_uri FROM artist_profiles WHERE owner_id=?
      UNION ALL SELECT banner FROM artist_profiles WHERE owner_id=?
      UNION ALL SELECT j.value FROM posts p, json_each(CASE WHEN json_valid(p.photos) THEN p.photos ELSE '[]' END) j WHERE p.user_id=?
      UNION ALL SELECT j.value FROM venue_reviews r, json_each(CASE WHEN json_valid(r.photos) THEN r.photos ELSE '[]' END) j WHERE r.user_id=?
    ) WHERE value=? LIMIT 1`);
  const result = [];
  for (const value of candidates.values()) {
    if (!stillUsed.get(owner, owner, owner, owner, owner, owner, value)) result.push(value);
  }
  return result;
}

function ensureLegacyAssociation(database, owner, key, at) {
  const match = OBJECT_KEY.exec(key);
  if (!match) return;
  // Pre-ledger uploads can only enter here while they are still explicitly
  // associated with an owner-authored database row and their public URL passed
  // the exact origin/path/owner checks above.
  database.prepare(`INSERT OR IGNORE INTO media_objects
    (object_key,owner_id,purpose,status,created_at,associated_at,updated_at)
    VALUES (?,?,?,'associated',?,?,?)`).run(key, owner, match[2], at, at, at);
}

function enqueueLedgerKeys(database, owner, keys, at) {
  const insert = database.prepare(`INSERT OR IGNORE INTO media_deletion_queue
    (owner_id,object_key,status,attempts,next_attempt_at,last_error_code,created_at,updated_at,dead_at)
    SELECT owner_id,object_key,'pending',0,?,NULL,?,?,NULL FROM media_objects
    WHERE owner_id=? AND object_key=?`);
  const queued = database.prepare(`UPDATE media_objects SET status='delete_queued',updated_at=?
    WHERE owner_id=? AND object_key=? AND EXISTS (
      SELECT 1 FROM media_deletion_queue q WHERE q.owner_id=? AND q.object_key=media_objects.object_key
    )`);
  let enqueued = 0;
  for (const key of keys) {
    enqueued += Number(insert.run(at, at, at, owner, key).changes || 0);
    queued.run(at, owner, key, owner);
  }
  return enqueued;
}

// This helper deliberately does not open or commit a transaction. Destructive
// callers invoke it after BEGIN IMMEDIATE and before changing the association,
// so either both the queue entry and the content change commit or neither does.
export function enqueueOwnedMediaUrls(database, {
  ownerId,
  urls,
  env = process.env,
  at = Date.now(),
} = {}) {
  const owner = safeOwnerId(ownerId);
  if (!owner) return { accepted: 0, enqueued: 0, keys: [] };
  const keys = ownedMediaKeys(urls, { ownerId: owner, env });
  for (const key of keys) ensureLegacyAssociation(database, owner, key, at);
  const enqueued = enqueueLedgerKeys(database, owner, keys, at);
  return { accepted: keys.length, enqueued, keys };
}

export function enqueueAllOwnedMedia(database, { ownerId, at = Date.now() } = {}) {
  const owner = safeOwnerId(ownerId);
  if (!owner) return { accepted: 0, enqueued: 0, keys: [] };
  const keys = database.prepare("SELECT object_key FROM media_objects WHERE owner_id=? ORDER BY object_key")
    .all(owner).map((row) => row.object_key).filter((key) => trustedMediaQueueKey(key, owner));
  return { accepted: keys.length, enqueued: enqueueLedgerKeys(database, owner, keys, at), keys };
}

export function enqueueOwnerMediaSweep(database, { ownerId, at = Date.now() } = {}) {
  const owner = safeOwnerId(ownerId);
  if (!owner) return false;
  const storedExpiry = Number(database.prepare("SELECT MAX(upload_expires_at) expires_at FROM media_objects WHERE owner_id=?").get(owner)?.expires_at);
  const latestExpiry = Number.isSafeInteger(storedExpiry) && storedExpiry > 0 && storedExpiry <= at + 15 * 60_000
    ? storedExpiry
    : 0;
  const notBeforeAt = latestExpiry ? Math.max(at, latestExpiry + MEDIA_UPLOAD_SETTLE_BUFFER_MS) : at;
  const finalizeAfterAt = notBeforeAt + MEDIA_OWNER_SWEEP_QUIET_WINDOW_MS;
  const result = database.prepare(`INSERT OR IGNORE INTO media_owner_sweeps
    (owner_id,status,attempts,continuation_token,not_before_at,finalize_after_at,verification_passes,
      next_attempt_at,discovered_count,last_error_code,created_at,updated_at,dead_at)
    VALUES (?,'pending',0,NULL,?,?,0,?,0,NULL,?,?,NULL)`)
    .run(owner, notBeforeAt, finalizeAfterAt, notBeforeAt, at, at);
  return Number(result.changes || 0) === 1;
}

export function mediaOrphanTtlMs(env = process.env) {
  const requested = Number(env?.MEDIA_ORPHAN_TTL_MS);
  if (!Number.isFinite(requested)) return 7 * DAY_MS;
  return Math.max(DAY_MS, Math.min(30 * DAY_MS, Math.trunc(requested)));
}

export function enqueueExpiredMediaTickets(database, {
  env = process.env,
  at = Date.now(),
  limit = 100,
} = {}) {
  const boundedLimit = Math.max(1, Math.min(500, Math.trunc(Number(limit) || 100)));
  const cutoff = at - mediaOrphanTtlMs(env);
  return atomic(database, () => {
    const rows = database.prepare(`SELECT owner_id,object_key FROM media_objects
      WHERE status='issued' AND created_at<=? ORDER BY created_at ASC,object_key ASC LIMIT ?`).all(cutoff, boundedLimit);
    let enqueued = 0;
    for (const row of rows) {
      if (!trustedMediaQueueKey(row.object_key, row.owner_id)) continue;
      enqueued += enqueueLedgerKeys(database, row.owner_id, [row.object_key], at);
    }
    return enqueued;
  });
}

function joinObjectUrl(base, segments) {
  const prefix = base.pathname.replace(/\/+$/, "");
  const suffix = segments.map((segment) => encodeURIComponent(String(segment))).join("/");
  return `${base.origin}${prefix}/${suffix}`;
}

export function createMediaDeleteRequest({ objectKey, ownerId, env = process.env, now = new Date() } = {}) {
  const key = trustedMediaQueueKey(objectKey, ownerId);
  if (!key) return { ok: false, errorCode: "invalid_key" };
  let config;
  try { config = getMediaConfig(env); }
  catch { return { ok: false, errorCode: "storage_unconfigured" }; }
  if (!config.configured) return { ok: false, errorCode: "storage_unconfigured" };
  const objectUrl = joinObjectUrl(config.endpoint, [config.bucket, ...key.split("/")]);
  try {
    return {
      ok: true,
      method: "DELETE",
      url: presignS3Request({
        method: "DELETE",
        url: objectUrl,
        region: config.region,
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
        expiresIn: 60,
        now,
      }),
    };
  } catch {
    return { ok: false, errorCode: "signing_failed" };
  }
}

export function createMediaListRequest({ ownerId, continuationToken, env = process.env, now = new Date() } = {}) {
  const owner = safeOwnerId(ownerId);
  if (!owner) return { ok: false, errorCode: "invalid_owner" };
  if (continuationToken != null && (typeof continuationToken !== "string" || continuationToken.length < 1 || continuationToken.length > 4096)) {
    return { ok: false, errorCode: "invalid_cursor" };
  }
  let config;
  try { config = getMediaConfig(env); }
  catch { return { ok: false, errorCode: "storage_unconfigured" }; }
  if (!config.configured) return { ok: false, errorCode: "storage_unconfigured" };
  try {
    const target = new URL(joinObjectUrl(config.endpoint, [config.bucket]));
    target.searchParams.set("list-type", "2");
    target.searchParams.set("encoding-type", "url");
    target.searchParams.set("max-keys", "1000");
    target.searchParams.set("prefix", `users/${owner}/`);
    if (continuationToken) target.searchParams.set("continuation-token", continuationToken);
    return {
      ok: true,
      method: "GET",
      url: presignS3Request({
        method: "GET",
        url: target.toString(),
        region: config.region,
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
        expiresIn: 60,
        now,
      }),
    };
  } catch {
    return { ok: false, errorCode: "signing_failed" };
  }
}

function atomic(database, work) {
  database.exec("BEGIN IMMEDIATE");
  try {
    const result = work();
    database.exec("COMMIT");
    return result;
  } catch (error) {
    try { database.exec("ROLLBACK"); } catch {}
    throw error;
  }
}

function claimNext(database, at) {
  return atomic(database, () => {
    database.prepare(`UPDATE media_objects SET status='deletion_dead',updated_at=?
      WHERE EXISTS (SELECT 1 FROM media_deletion_queue q
        WHERE q.owner_id=media_objects.owner_id AND q.object_key=media_objects.object_key
          AND q.status='processing' AND q.next_attempt_at<=? AND q.attempts>=?)`)
      .run(at, at, MEDIA_DELETION_MAX_ATTEMPTS);
    database.prepare(`UPDATE media_deletion_queue
      SET status='dead',last_error_code='worker_interrupted',dead_at=?,updated_at=?
      WHERE status='processing' AND next_attempt_at<=? AND attempts>=?`)
      .run(at, at, at, MEDIA_DELETION_MAX_ATTEMPTS);
    const row = database.prepare(`SELECT id,owner_id,object_key,status,attempts
      FROM media_deletion_queue
      WHERE status IN ('pending','retry','processing')
        AND next_attempt_at<=? AND attempts<?
      ORDER BY next_attempt_at ASC,id ASC LIMIT 1`)
      .get(at, MEDIA_DELETION_MAX_ATTEMPTS);
    if (!row) return null;
    const attempts = Number(row.attempts || 0) + 1;
    database.prepare(`UPDATE media_deletion_queue
      SET status='processing',attempts=?,next_attempt_at=?,last_error_code=NULL,updated_at=?,dead_at=NULL
      WHERE id=?`).run(attempts, at + MEDIA_DELETION_LEASE_MS, at, row.id);
    return { ...row, attempts };
  });
}

function finishSuccess(database, id) {
  atomic(database, () => {
    const row = database.prepare("SELECT owner_id,object_key FROM media_deletion_queue WHERE id=? AND status='processing'").get(id);
    if (!row) return;
    database.prepare("DELETE FROM media_deletion_queue WHERE id=?").run(id);
    // Successful deletion also erases the now-unneeded owner/key ledger row.
    // Failed/dead work remains visible until an operator can remediate it.
    database.prepare("DELETE FROM media_objects WHERE owner_id=? AND object_key=?").run(row.owner_id, row.object_key);
  });
}

function finishFailure(database, job, errorCode, at, { terminal = false } = {}) {
  const dead = terminal || job.attempts >= MEDIA_DELETION_MAX_ATTEMPTS;
  if (dead) {
    atomic(database, () => {
      database.prepare(`UPDATE media_deletion_queue
        SET status='dead',next_attempt_at=0,last_error_code=?,dead_at=?,updated_at=? WHERE id=?`)
        .run(errorCode, at, at, job.id);
      database.prepare(`UPDATE media_objects SET status='deletion_dead',updated_at=?
        WHERE owner_id=? AND object_key=?`).run(at, job.owner_id, job.object_key);
    });
    return "dead";
  }
  const delay = RETRY_DELAYS_MS[Math.min(job.attempts - 1, RETRY_DELAYS_MS.length - 1)];
  database.prepare(`UPDATE media_deletion_queue
    SET status='retry',next_attempt_at=?,last_error_code=?,updated_at=?,dead_at=NULL WHERE id=?`)
    .run(at + delay, errorCode, at, job.id);
  return "retry";
}

function claimOwnerSweep(database, at) {
  return atomic(database, () => {
    database.prepare(`UPDATE media_owner_sweeps
      SET status='dead',last_error_code='worker_interrupted',dead_at=?,updated_at=?
      WHERE status='processing' AND next_attempt_at<=? AND attempts>=?`)
      .run(at, at, at, MEDIA_DELETION_MAX_ATTEMPTS);
    const row = database.prepare(`SELECT owner_id,continuation_token,status,attempts,discovered_count,
        not_before_at,finalize_after_at,verification_passes
      FROM media_owner_sweeps
      WHERE status IN ('pending','retry','processing') AND not_before_at<=? AND next_attempt_at<=? AND attempts<?
      ORDER BY next_attempt_at ASC,owner_id ASC LIMIT 1`).get(at, at, MEDIA_DELETION_MAX_ATTEMPTS);
    if (!row) return null;
    const attempts = Number(row.attempts || 0) + 1;
    database.prepare(`UPDATE media_owner_sweeps SET status='processing',attempts=?,next_attempt_at=?,
      last_error_code=NULL,updated_at=?,dead_at=NULL WHERE owner_id=?`)
      .run(attempts, at + MEDIA_DELETION_LEASE_MS, at, row.owner_id);
    return { ...row, attempts };
  });
}

function xmlText(value) {
  return String(value || "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

export function parseMediaListResponse(xml) {
  const source = String(xml || "");
  if (!source.includes("<ListBucketResult") || /<!DOCTYPE/i.test(source)) return null;
  const truncatedMatch = /<IsTruncated>\s*(true|false)\s*<\/IsTruncated>/i.exec(source);
  if (!truncatedMatch) return null;
  const encodedKeys = [...source.matchAll(/<Key>([\s\S]*?)<\/Key>/gi)];
  if (encodedKeys.length > 1000) return null;
  const keys = [];
  try {
    for (const match of encodedKeys) keys.push(decodeURIComponent(xmlText(match[1])));
  } catch {
    return null;
  }
  const truncated = truncatedMatch[1].toLowerCase() === "true";
  const tokenMatch = /<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/i.exec(source);
  const continuationToken = tokenMatch ? xmlText(tokenMatch[1]).trim() : null;
  if (truncated && (!continuationToken || continuationToken.length > 4096)) return null;
  return { keys, truncated, continuationToken: truncated ? continuationToken : null };
}

async function boundedResponseText(response, maxBytes = 2 * 1024 * 1024) {
  const announced = Number(response?.headers?.get?.("content-length"));
  if (Number.isFinite(announced) && announced > maxBytes) throw new Error("body_too_large");
  if (!response?.body?.getReader) {
    const text = await response.text();
    if (Buffer.byteLength(text) > maxBytes) throw new Error("body_too_large");
    return text;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value?.byteLength || 0;
      if (size > maxBytes) throw new Error("body_too_large");
      chunks.push(value);
    }
  } catch (error) {
    try { await reader.cancel(); } catch {}
    throw error;
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(bytes);
}

function finishSweepFailure(database, job, errorCode, at, { terminal = false } = {}) {
  const dead = terminal || job.attempts >= MEDIA_DELETION_MAX_ATTEMPTS;
  if (dead) {
    database.prepare(`UPDATE media_owner_sweeps SET status='dead',next_attempt_at=0,
      last_error_code=?,dead_at=?,updated_at=? WHERE owner_id=?`).run(errorCode, at, at, job.owner_id);
    return "dead";
  }
  const delay = RETRY_DELAYS_MS[Math.min(job.attempts - 1, RETRY_DELAYS_MS.length - 1)];
  database.prepare(`UPDATE media_owner_sweeps SET status='retry',next_attempt_at=?,
    last_error_code=?,updated_at=?,dead_at=NULL WHERE owner_id=?`).run(at + delay, errorCode, at, job.owner_id);
  return "retry";
}

export async function runMediaOwnerSweepOnce({
  database,
  env = process.env,
  fetchImpl = globalThis.fetch,
  clock = () => Date.now(),
  timeoutMs = 8_000,
} = {}) {
  if (!database || typeof fetchImpl !== "function") return { processed: 0, errorCode: "worker_unavailable" };
  if (!mediaConfigured(env)) return { processed: 0, errorCode: "storage_unconfigured" };
  const job = claimOwnerSweep(database, clock());
  if (!job) return { processed: 0, errorCode: null };
  const prepared = createMediaListRequest({
    ownerId: job.owner_id,
    continuationToken: job.continuation_token,
    env,
    now: new Date(clock()),
  });
  if (!prepared.ok) {
    const state = finishSweepFailure(database, job, prepared.errorCode, clock(), {
      terminal: ["invalid_owner", "invalid_cursor"].includes(prepared.errorCode),
    });
    return { processed: 1, errorCode: prepared.errorCode, deadLettered: state === "dead" ? 1 : 0, retried: state === "retry" ? 1 : 0 };
  }
  const controller = new AbortController();
  const boundedTimeout = Math.max(50, Math.min(30_000, Math.trunc(Number(timeoutMs) || 8_000)));
  const timeout = setTimeout(() => controller.abort(), boundedTimeout);
  timeout.unref?.();
  let page;
  let errorCode = null;
  try {
    const response = await fetchImpl(prepared.url, { method: "GET", signal: controller.signal, redirect: "error" });
    if (!(response.status >= 200 && response.status < 300)) {
      const status = Number.isInteger(response.status) && response.status >= 100 && response.status <= 599 ? response.status : 0;
      errorCode = status ? `list_http_${status}` : "list_http_invalid";
    } else {
      let body;
      try { body = await boundedResponseText(response); }
      catch (error) { errorCode = error?.message === "body_too_large" ? "list_body_too_large" : "list_response_failed"; }
      if (!errorCode) {
        page = parseMediaListResponse(body);
        if (!page) errorCode = "list_response_invalid";
      }
    }
  } catch {
    errorCode = controller.signal.aborted ? "list_timeout" : "list_network";
  } finally {
    clearTimeout(timeout);
  }
  if (errorCode) {
    const state = finishSweepFailure(database, job, errorCode, clock());
    return { processed: 1, errorCode, deadLettered: state === "dead" ? 1 : 0, retried: state === "retry" ? 1 : 0 };
  }

  const at = clock();
  let discovered = 0;
  let verificationPending = false;
  atomic(database, () => {
    const valid = [];
    for (const key of page.keys) {
      if (!trustedMediaQueueKey(key, job.owner_id)) continue;
      const before = database.prepare("SELECT 1 FROM media_objects WHERE owner_id=? AND object_key=?").get(job.owner_id, key);
      recordMediaObjectTicket(database, { ownerId: job.owner_id, objectKey: key, at, expiresAt: null });
      if (!before) discovered += 1;
      valid.push(key);
    }
    enqueueLedgerKeys(database, job.owner_id, valid, at);
    if (page.truncated) {
      database.prepare(`UPDATE media_owner_sweeps SET status='pending',attempts=0,continuation_token=?,
        next_attempt_at=?,discovered_count=discovered_count+?,last_error_code=NULL,updated_at=?,dead_at=NULL
        WHERE owner_id=?`).run(page.continuationToken, at, discovered, at, job.owner_id);
    } else if (at < Number(job.finalize_after_at || 0)) {
      verificationPending = true;
      const nextVerificationAt = Math.min(
        at + MEDIA_OWNER_SWEEP_RECHECK_MS,
        Number(job.finalize_after_at),
      );
      database.prepare(`UPDATE media_owner_sweeps SET status='pending',attempts=0,continuation_token=NULL,
        verification_passes=verification_passes+1,next_attempt_at=?,
        discovered_count=discovered_count+?,last_error_code=NULL,updated_at=?,dead_at=NULL
        WHERE owner_id=?`).run(nextVerificationAt, discovered, at, job.owner_id);
    } else {
      database.prepare("DELETE FROM media_owner_sweeps WHERE owner_id=?").run(job.owner_id);
    }
  });
  return { processed: 1, discovered, hasMore: page.truncated, verificationPending, errorCode: null };
}

async function deleteOne(job, { env, fetchImpl, timeoutMs, clock }) {
  const prepared = createMediaDeleteRequest({
    objectKey: job.object_key,
    ownerId: job.owner_id,
    env,
    now: new Date(clock()),
  });
  if (!prepared.ok) return { ok: false, errorCode: prepared.errorCode, terminal: prepared.errorCode === "invalid_key" };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  timeout.unref?.();
  try {
    const response = await fetchImpl(prepared.url, {
      method: prepared.method,
      signal: controller.signal,
      redirect: "error",
    });
    if ((response.status >= 200 && response.status < 300) || response.status === 404) return { ok: true };
    const status = Number.isInteger(response.status) && response.status >= 100 && response.status <= 599
      ? response.status
      : 0;
    return { ok: false, errorCode: status ? `http_${status}` : "http_invalid" };
  } catch {
    return { ok: false, errorCode: controller.signal.aborted ? "timeout" : "network" };
  } finally {
    clearTimeout(timeout);
  }
}

export async function runMediaDeletionBatch({
  database,
  env = process.env,
  fetchImpl = globalThis.fetch,
  clock = () => Date.now(),
  batchSize = 8,
  timeoutMs = 8_000,
} = {}) {
  const result = {
    configured: mediaConfigured(env),
    orphanTicketsQueued: 0,
    sweepPages: 0,
    sweepKeysDiscovered: 0,
    processed: 0,
    deleted: 0,
    retried: 0,
    deadLettered: 0,
    lastErrorCode: null,
  };
  if (database) result.orphanTicketsQueued = enqueueExpiredMediaTickets(database, { env, at: clock() });
  if (!result.configured) {
    result.lastErrorCode = "storage_unconfigured";
    return result;
  }
  if (!database || typeof fetchImpl !== "function") {
    result.lastErrorCode = "worker_unavailable";
    return result;
  }
  const sweep = await runMediaOwnerSweepOnce({ database, env, fetchImpl, clock, timeoutMs });
  result.sweepPages = sweep.processed || 0;
  result.sweepKeysDiscovered = sweep.discovered || 0;
  result.retried += sweep.retried || 0;
  result.deadLettered += sweep.deadLettered || 0;
  if (sweep.errorCode) result.lastErrorCode = sweep.errorCode;
  const limit = Math.max(1, Math.min(50, Math.trunc(Number(batchSize) || 8)));
  const boundedTimeout = Math.max(50, Math.min(30_000, Math.trunc(Number(timeoutMs) || 8_000)));
  for (let index = 0; index < limit; index++) {
    const job = claimNext(database, clock());
    if (!job) break;
    result.processed += 1;
    const outcome = await deleteOne(job, { env, fetchImpl, timeoutMs: boundedTimeout, clock });
    if (outcome.ok) {
      finishSuccess(database, job.id);
      result.deleted += 1;
      continue;
    }
    const state = finishFailure(database, job, outcome.errorCode, clock(), { terminal: outcome.terminal });
    result.lastErrorCode = outcome.errorCode;
    if (state === "dead") result.deadLettered += 1;
    else result.retried += 1;
  }
  return result;
}

export function mediaDeletionSchedulerEnabled(env = process.env) {
  const value = String(env?.MEDIA_CLEANUP_ENABLED || "").trim().toLowerCase();
  if (value) {
    if (TRUE_VALUES.has(value)) return true;
    if (FALSE_VALUES.has(value)) return false;
    return false;
  }
  return String(env?.NODE_ENV || "").trim().toLowerCase() === "production";
}

export function mediaDeletionHealth(database, { env = process.env, at = Date.now() } = {}) {
  const counts = Object.fromEntries(database.prepare(`SELECT status,COUNT(*) count
    FROM media_deletion_queue GROUP BY status`).all().map((row) => [row.status, Number(row.count || 0)]));
  const oldest = database.prepare(`SELECT MIN(created_at) created_at FROM media_deletion_queue
    WHERE status IN ('pending','retry','processing')`).get()?.created_at;
  const due = Number(database.prepare(`SELECT COUNT(*) count FROM media_deletion_queue
    WHERE status IN ('pending','retry','processing') AND next_attempt_at<=?`).get(at)?.count || 0);
  const sweepCounts = Object.fromEntries(database.prepare(`SELECT status,COUNT(*) count
    FROM media_owner_sweeps GROUP BY status`).all().map((row) => [row.status, Number(row.count || 0)]));
  const sweepsDue = Number(database.prepare(`SELECT COUNT(*) count FROM media_owner_sweeps
    WHERE status IN ('pending','retry','processing') AND next_attempt_at<=?`).get(at)?.count || 0);
  return {
    enabled: mediaDeletionSchedulerEnabled(env),
    storageConfigured: mediaConfigured(env),
    running: schedulerState.running,
    pending: counts.pending || 0,
    retrying: counts.retry || 0,
    processing: counts.processing || 0,
    deadLetter: counts.dead || 0,
    due,
    ownerSweeps: {
      pending: sweepCounts.pending || 0,
      retrying: sweepCounts.retry || 0,
      processing: sweepCounts.processing || 0,
      deadLetter: sweepCounts.dead || 0,
      due: sweepsDue,
    },
    oldestActiveAgeSeconds: oldest ? Math.max(0, Math.floor((at - oldest) / 1000)) : 0,
    startedAt: schedulerState.startedAt || null,
    lastRunAt: schedulerState.lastRunAt || null,
    lastSuccessAt: schedulerState.lastSuccessAt || null,
    lastErrorCode: schedulerState.lastErrorCode,
  };
}

export function startMediaDeletionScheduler({
  database,
  env = process.env,
  fetchImpl = globalThis.fetch,
  initialDelayMs = 15_000,
  intervalMs = 60_000,
} = {}) {
  if (!mediaDeletionSchedulerEnabled(env)) {
    console.log("[pit] active-media cleanup scheduler disabled.");
    return null;
  }
  schedulerState.startedAt ||= Date.now();
  console.log(`[pit] active-media cleanup scheduled (${mediaConfigured(env) ? "storage ready" : "waiting for media storage configuration"}).`);
  const trigger = async () => {
    if (schedulerState.running) return;
    schedulerState.running = true;
    schedulerState.lastRunAt = Date.now();
    try {
      const result = await runMediaDeletionBatch({ database, env, fetchImpl });
      schedulerState.lastErrorCode = result.lastErrorCode;
      if (result.configured && !result.lastErrorCode) schedulerState.lastSuccessAt = Date.now();
      if (result.deadLettered) console.error(`[pit] active-media cleanup moved ${result.deadLettered} item(s) to dead-letter.`);
    } catch {
      schedulerState.lastErrorCode = "worker_failed";
      console.error("[pit] active-media cleanup worker failed safely.");
    } finally {
      schedulerState.running = false;
    }
  };
  const initial = setTimeout(() => { void trigger(); }, Math.max(1_000, Number(initialDelayMs) || 15_000));
  const interval = setInterval(() => { void trigger(); }, Math.max(10_000, Number(intervalMs) || 60_000));
  initial.unref?.();
  interval.unref?.();
  return { trigger, stop: () => { clearTimeout(initial); clearInterval(interval); } };
}
