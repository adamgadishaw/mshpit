import { getMediaConfig, mediaBucketForScope, mediaConfigured, presignS3Request } from "./media.js";
import { withImmediateWrite as withWrite } from "./databaseTransaction.js";
import { ApiError } from "./errors.js";

const OWNER = /^[A-Za-z0-9_-]{1,128}$/;
const OBJECT_KEY = /^users\/([A-Za-z0-9_-]{1,128})\/(avatar|banner|post|review|venue)\/([A-Za-z0-9_-]{1,180})\.(jpg|png|webp|gif|heic|heif|avif|mp4|webm|mov)$/;
const TRUE_VALUES = new Set(["1", "true", "yes", "on", "enabled"]);
const FALSE_VALUES = new Set(["0", "false", "no", "off", "disabled"]);
const RETRY_DELAYS_MS = Object.freeze([60_000, 5 * 60_000, 30 * 60_000, 2 * 60 * 60_000]);
const DAY_MS = 24 * 60 * 60_000;
const MEBIBYTE = 1024 * 1024;
const TEBIBYTE = 1024 * 1024 * MEBIBYTE;
const PEBIBYTE = 1024 * TEBIBYTE;

export const MEDIA_UPLOAD_TICKET_MS = 10 * 60_000;
export const MEDIA_UPLOAD_ROLLING_WINDOW_MS = DAY_MS;
export const MEDIA_UPLOAD_ACCOUNTING_CLASS = Object.freeze({
  MEMBER_SOURCE: "member_source",
  SERVICE_GENERATED: "service_generated",
});
const MEDIA_UPLOAD_ACCOUNTING_CLASSES = new Set(Object.values(MEDIA_UPLOAD_ACCOUNTING_CLASS));
const DEFAULT_UPLOAD_QUOTAS = Object.freeze({
  // Transparent limits apply only to original files selected by a member.
  // Server-generated safe copies, covers, and delivery objects are accounted
  // below by the service-wide breakers instead of charging the member twice.
  outstandingObjects: 40,
  outstandingBytes: 6 * 1024 * MEBIBYTE,
  rollingBytes: 6 * 1024 * MEBIBYTE,
  rollingTickets: 120,
});

const DEFAULT_UPLOAD_GLOBAL_CIRCUIT_BREAKERS = Object.freeze({
  // Service-wide incident brakes protect the shared storage budget if many
  // accounts or credentials are compromised at once.
  outstandingObjects: 10_000,
  outstandingBytes: 128 * 1024 * MEBIBYTE,
  rollingBytes: 512 * 1024 * MEBIBYTE,
  rollingTickets: 100_000,
});

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
export const MEDIA_DELETION_DEAD_REDRIVE_MS = DAY_MS;

const schedulerState = {
  running: false,
  startedAt: 0,
  lastRunAt: 0,
  lastSuccessAt: 0,
  lastErrorCode: null,
};

function boundedQuota(value, fallback, minimum, maximum) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.trunc(numeric)));
}

export function mediaUploadQuotaLimits(env = process.env) {
  return {
    outstandingObjects: boundedQuota(env?.MEDIA_UPLOAD_OUTSTANDING_OBJECTS, DEFAULT_UPLOAD_QUOTAS.outstandingObjects, 1, 10_000),
    outstandingBytes: boundedQuota(env?.MEDIA_UPLOAD_OUTSTANDING_BYTES, DEFAULT_UPLOAD_QUOTAS.outstandingBytes, MEBIBYTE, 1024 * 1024 * MEBIBYTE),
    rollingBytes: boundedQuota(env?.MEDIA_UPLOAD_24H_BYTES, DEFAULT_UPLOAD_QUOTAS.rollingBytes, MEBIBYTE, 1024 * 1024 * MEBIBYTE),
    rollingTickets: boundedQuota(env?.MEDIA_UPLOAD_24H_TICKETS, DEFAULT_UPLOAD_QUOTAS.rollingTickets, 1, 100_000),
  };
}

export function mediaUploadGlobalCircuitBreakerLimits(env = process.env) {
  return {
    outstandingObjects: boundedQuota(env?.MEDIA_UPLOAD_GLOBAL_OUTSTANDING_OBJECTS,
      DEFAULT_UPLOAD_GLOBAL_CIRCUIT_BREAKERS.outstandingObjects, 1, 10_000_000),
    outstandingBytes: boundedQuota(env?.MEDIA_UPLOAD_GLOBAL_OUTSTANDING_BYTES,
      DEFAULT_UPLOAD_GLOBAL_CIRCUIT_BREAKERS.outstandingBytes, MEBIBYTE, PEBIBYTE),
    rollingBytes: boundedQuota(env?.MEDIA_UPLOAD_GLOBAL_24H_BYTES,
      DEFAULT_UPLOAD_GLOBAL_CIRCUIT_BREAKERS.rollingBytes, MEBIBYTE, 4 * PEBIBYTE),
    rollingTickets: boundedQuota(env?.MEDIA_UPLOAD_GLOBAL_24H_TICKETS,
      DEFAULT_UPLOAD_GLOBAL_CIRCUIT_BREAKERS.rollingTickets, 1, 100_000_000),
  };
}

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

function storedOwnedMediaKey(database, value, owner) {
  if (!database || typeof value !== "string" || value.length > 2000) return null;
  const row = database.prepare(`SELECT object_key FROM (
      SELECT source_key object_key FROM media_assets WHERE owner_id=? AND source_url=?
      UNION ALL
      SELECT v.object_key FROM media_variants v
        JOIN media_assets a ON a.id=v.asset_id
        WHERE a.owner_id=? AND v.public_url=?
      UNION ALL
      SELECT poster_key object_key FROM legacy_video_posters WHERE owner_id=? AND poster_url=?
    ) LIMIT 1`).get(owner, value, owner, value, owner, value);
  return trustedMediaQueueKey(row?.object_key, owner);
}

function resolvedOwnedMediaKey(database, value, { ownerId, env = process.env } = {}) {
  const owner = safeOwnerId(ownerId);
  if (!owner) return { key: null, stable: false };
  const stored = storedOwnedMediaKey(database, value, owner);
  if (stored) return { key: stored, stable: true };
  return { key: trustedOwnedMediaKey(value, { ownerId: owner, env }), stable: false };
}

export function ownedMediaKeys(values, options) {
  const keys = new Set();
  for (const value of Array.isArray(values) ? values : []) {
    const key = trustedOwnedMediaKey(value, options);
    if (key) keys.add(key);
  }
  return [...keys];
}

function normalizedTicketExpiry(expiresAt, at) {
  if (expiresAt === null) return null;
  const requested = Number(expiresAt);
  return Number.isSafeInteger(requested) && requested >= at && requested <= at + 15 * 60_000
    ? requested
    : at + MEDIA_UPLOAD_TICKET_MS;
}

export function recordMediaObjectTicket(database, {
  ownerId,
  objectKey,
  storageScope = "public",
  accountingClass = MEDIA_UPLOAD_ACCOUNTING_CLASS.MEMBER_SOURCE,
  byteSize = 0,
  at = Date.now(),
  expiresAt,
} = {}) {
  const owner = safeOwnerId(ownerId);
  const key = trustedMediaQueueKey(objectKey, owner);
  const match = key ? OBJECT_KEY.exec(key) : null;
  if (!owner || !match) return false;
  const bytes = Number(byteSize);
  if (!Number.isSafeInteger(bytes) || bytes < 0 || !new Set(["public", "private"]).has(storageScope)
      || !MEDIA_UPLOAD_ACCOUNTING_CLASSES.has(accountingClass)) return false;
  const uploadExpiresAt = normalizedTicketExpiry(expiresAt, at);
  return Number(database.prepare(`INSERT OR IGNORE INTO media_objects
    (object_key,owner_id,storage_scope,accounting_class,purpose,byte_size,status,created_at,upload_expires_at,updated_at)
    VALUES (?,?,?,?,?,?,'issued',?,?,?)`).run(key, owner, storageScope, accountingClass,
    match[2], bytes, at, uploadExpiresAt, at).changes || 0) === 1;
}

/**
 * Atomically reserve one returned PUT ticket. Every ticket is covered by the
 * service-wide outstanding/rolling circuit breakers. Only member_source work
 * also consumes the disclosed per-account outstanding and rolling allowance.
 * Reissuing the same owner/key preserves its original accounting class, does
 * not consume another outstanding object, and does consume another applicable
 * rolling ticket/byte reservation because its body can be uploaded again.
 * Callers must not return or expose a ticket unless this reservation commits.
 */
export function reserveMediaUploadTicket(database, {
  ownerId,
  objectKey,
  byteSize,
  storageScope = "public",
  accountingClass = MEDIA_UPLOAD_ACCOUNTING_CLASS.MEMBER_SOURCE,
  at = Date.now(),
  expiresAt = at + MEDIA_UPLOAD_TICKET_MS,
  env = process.env,
} = {}) {
  const owner = safeOwnerId(ownerId);
  const key = trustedMediaQueueKey(objectKey, owner);
  const match = key ? OBJECT_KEY.exec(key) : null;
  const bytes = Number(byteSize);
  if (!owner || !match || !Number.isSafeInteger(bytes) || bytes < 1
      || !MEDIA_UPLOAD_ACCOUNTING_CLASSES.has(accountingClass)) {
    throw new ApiError(400, "Media upload reservation is invalid.", "VALIDATION_FAILED");
  }
  const uploadExpiresAt = normalizedTicketExpiry(expiresAt, at);
  const limits = mediaUploadQuotaLimits(env);
  const globalLimits = mediaUploadGlobalCircuitBreakerLimits(env);
  const rollingCutoff = at - MEDIA_UPLOAD_ROLLING_WINDOW_MS;

  return withWrite(database, () => {
    // Keep enough history for clock jitter/debugging while bounding table size.
    database.prepare("DELETE FROM media_upload_issuances WHERE issued_at<=?")
      .run(at - (2 * MEDIA_UPLOAD_ROLLING_WINDOW_MS));

    const existing = database.prepare(`SELECT owner_id,storage_scope,accounting_class,purpose,byte_size,status
      FROM media_objects WHERE object_key=?`).get(key);
    if (!new Set(["public", "private"]).has(storageScope)
        || (existing && (existing.owner_id !== owner || existing.storage_scope !== storageScope || existing.purpose !== match[2]
        || (Number(existing.byte_size || 0) > 0 && Number(existing.byte_size) !== bytes)))) {
      throw new ApiError(409, "That media upload ticket belongs to different bytes.", "CONFLICT");
    }

    // An existing row owns its accounting class. A reissue cannot relabel a
    // source as a derivative to evade the member limit; pre-migration rows keep
    // their conservative member_source default as documented by the schema.
    const effectiveAccountingClass = existing?.accounting_class || accountingClass;
    const memberSource = effectiveAccountingClass === MEDIA_UPLOAD_ACCOUNTING_CLASS.MEMBER_SOURCE;
    const outstanding = memberSource
      ? database.prepare(`SELECT COUNT(*) object_count,COALESCE(SUM(byte_size),0) byte_count
        FROM media_objects WHERE owner_id=? AND accounting_class='member_source'
          AND status IN ('issued','delete_queued','deletion_dead')`).get(owner)
      : { object_count: 0, byte_count: 0 };
    const rolling = memberSource
      ? database.prepare(`SELECT COUNT(*) ticket_count,COALESCE(SUM(byte_size),0) byte_count
        FROM media_upload_issuances WHERE owner_id=? AND accounting_class='member_source' AND issued_at>?`)
        .get(owner, rollingCutoff)
      : { ticket_count: 0, byte_count: 0 };
    const newObject = !existing;
    const existingOutstanding = !!existing && new Set(["issued", "delete_queued", "deletion_dead"]).has(existing.status);
    const globalOutstandingByteDelta = newObject
      ? bytes
      : existingOutstanding ? Math.max(0, bytes - Number(existing.byte_size || 0)) : 0;
    const nextObjectCount = Number(outstanding?.object_count || 0) + (newObject && memberSource ? 1 : 0);
    const nextOutstandingBytes = Number(outstanding?.byte_count || 0)
      + (memberSource ? globalOutstandingByteDelta : 0);
    const nextRollingTickets = Number(rolling?.ticket_count || 0) + 1;
    const nextRollingBytes = Number(rolling?.byte_count || 0) + bytes;
    if (memberSource && (nextObjectCount > limits.outstandingObjects || nextOutstandingBytes > limits.outstandingBytes
        || nextRollingTickets > limits.rollingTickets || nextRollingBytes > limits.rollingBytes)) {
      throw new ApiError(429, "You reached the rolling 24-hour original upload limit or still have unfinished originals. Remove unfinished media or try again later.", "MEDIA_UPLOAD_QUOTA_EXCEEDED");
    }

    const globalOutstanding = database.prepare(`SELECT COUNT(*) object_count,COALESCE(SUM(byte_size),0) byte_count
      FROM media_objects WHERE status IN ('issued','delete_queued','deletion_dead')`).get();
    const globalRolling = database.prepare(`SELECT COUNT(*) ticket_count,COALESCE(SUM(byte_size),0) byte_count
      FROM media_upload_issuances WHERE issued_at>?`).get(rollingCutoff);
    const nextGlobalObjectCount = Number(globalOutstanding?.object_count || 0) + (newObject ? 1 : 0);
    const nextGlobalOutstandingBytes = Number(globalOutstanding?.byte_count || 0) + globalOutstandingByteDelta;
    const nextGlobalRollingTickets = Number(globalRolling?.ticket_count || 0) + 1;
    const nextGlobalRollingBytes = Number(globalRolling?.byte_count || 0) + bytes;
    if (nextGlobalObjectCount > globalLimits.outstandingObjects
        || nextGlobalOutstandingBytes > globalLimits.outstandingBytes
        || nextGlobalRollingTickets > globalLimits.rollingTickets
        || nextGlobalRollingBytes > globalLimits.rollingBytes) {
      throw new ApiError(503, "Media uploads are temporarily at service capacity. Please try again later.",
        "MEDIA_STORAGE_UNAVAILABLE");
    }

    if (!existing) {
      const inserted = recordMediaObjectTicket(database, {
        ownerId: owner,
        objectKey: key,
        storageScope,
        accountingClass,
        byteSize: bytes,
        at,
        expiresAt: uploadExpiresAt,
      });
      if (!inserted) throw new ApiError(409, "That media upload changed while it was being prepared.", "CONFLICT");
    } else {
      database.prepare(`UPDATE media_objects SET byte_size=CASE WHEN byte_size=0 THEN ? ELSE byte_size END,
        upload_expires_at=CASE WHEN COALESCE(upload_expires_at,0)>? THEN upload_expires_at ELSE ? END,
        updated_at=? WHERE owner_id=? AND object_key=? AND status IN ('issued','associated')`)
        .run(bytes, uploadExpiresAt, uploadExpiresAt, at, owner, key);
      const refreshed = database.prepare("SELECT status FROM media_objects WHERE owner_id=? AND object_key=?").get(owner, key);
      if (!refreshed || !new Set(["issued", "associated"]).has(refreshed.status)) {
        throw new ApiError(409, "That upload is already being removed. Start again.", "CONFLICT");
      }
    }
    database.prepare(`INSERT INTO media_upload_issuances
      (owner_id,object_key,accounting_class,byte_size,issued_at)
      VALUES (?,?,?,?,?)`).run(owner, key, effectiveAccountingClass, bytes, at);
    return { key, duplicate: !!existing, expiresAt: uploadExpiresAt, accountingClass: effectiveAccountingClass };
  });
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
  const keys = new Set();
  for (const value of Array.isArray(urls) ? urls : []) {
    const { key } = resolvedOwnedMediaKey(database, value, { ownerId: owner, env });
    if (key) keys.add(key);
  }
  for (const key of keys) {
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
    const { key } = resolvedOwnedMediaKey(database, value, { ownerId: owner, env });
    if (key && !candidates.has(key)) candidates.set(key, value);
  }
  if (!candidates.size) return [];
  const stillUsed = database.prepare(`SELECT 1 FROM (
      SELECT avatar_uri value FROM users WHERE id=?
      UNION ALL SELECT banner FROM users WHERE id=?
      UNION ALL SELECT avatar_uri FROM artist_profiles WHERE COALESCE(avatar_owner_id,owner_id)=?
      UNION ALL SELECT banner FROM artist_profiles WHERE COALESCE(banner_owner_id,owner_id)=?
      UNION ALL SELECT j.value FROM posts p, json_each(CASE WHEN json_valid(p.photos) THEN p.photos ELSE '[]' END) j WHERE p.user_id=?
      UNION ALL SELECT j.value FROM venue_reviews r, json_each(CASE WHEN json_valid(r.photos) THEN r.photos ELSE '[]' END) j WHERE r.user_id=?
      UNION ALL SELECT poster_url FROM legacy_video_posters WHERE owner_id=?
    ) WHERE value=? LIMIT 1`);
  const result = [];
  for (const value of candidates.values()) {
    if (!stillUsed.get(owner, owner, owner, owner, owner, owner, owner, value)) result.push(value);
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
    SELECT owner_id,object_key,'pending',0,
      CASE WHEN COALESCE(upload_expires_at,0)>? THEN upload_expires_at+? ELSE ? END,
      NULL,?,?,NULL FROM media_objects
    WHERE owner_id=? AND object_key=?`);
  const queued = database.prepare(`UPDATE media_objects SET status='delete_queued',updated_at=?
    WHERE owner_id=? AND object_key=? AND EXISTS (
      SELECT 1 FROM media_deletion_queue q WHERE q.owner_id=? AND q.object_key=media_objects.object_key
    )`);
  let enqueued = 0;
  for (const key of keys) {
    enqueued += Number(insert.run(at, MEDIA_UPLOAD_SETTLE_BUFFER_MS, at, at, at, owner, key).changes || 0);
    queued.run(at, owner, key, owner);
  }
  return enqueued;
}

// Stable descriptors already store their authoritative object keys. This path
// never reparses a public URL and therefore remains correct after a CDN origin
// or base-path migration. Missing/foreign ledger keys fail closed.
export function enqueueOwnedMediaKeys(database, {
  ownerId,
  keys,
  at = Date.now(),
} = {}) {
  const owner = safeOwnerId(ownerId);
  if (!owner) return { accepted: 0, enqueued: 0, keys: [] };
  const accepted = [];
  const exists = database.prepare("SELECT 1 FROM media_objects WHERE owner_id=? AND object_key=?");
  for (const raw of Array.isArray(keys) ? keys : []) {
    const key = trustedMediaQueueKey(raw, owner);
    if (key && !accepted.includes(key) && exists.get(owner, key)) accepted.push(key);
  }
  return { accepted: accepted.length, enqueued: enqueueLedgerKeys(database, owner, accepted, at), keys: accepted };
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
  const keys = [];
  for (const value of Array.isArray(urls) ? urls : []) {
    const resolved = resolvedOwnedMediaKey(database, value, { ownerId: owner, env });
    if (!resolved.key || keys.includes(resolved.key)) continue;
    if (!resolved.stable) ensureLegacyAssociation(database, owner, resolved.key, at);
    keys.push(resolved.key);
  }
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
    (owner_id,storage_scope,status,attempts,continuation_token,not_before_at,finalize_after_at,verification_passes,
      next_attempt_at,discovered_count,last_error_code,created_at,updated_at,dead_at)
    VALUES (?,'public','pending',0,NULL,?,?,0,?,0,NULL,?,?,NULL)`)
    .run(owner, notBeforeAt, finalizeAfterAt, notBeforeAt, at, at);
  return Number(result.changes || 0) === 1;
}

export function mediaOrphanTtlMs(env = process.env) {
  const requested = Number(env?.MEDIA_ORPHAN_TTL_MS);
  if (!Number.isFinite(requested)) return 2 * DAY_MS;
  return Math.max(DAY_MS, Math.min(30 * DAY_MS, Math.trunc(requested)));
}

export function enqueueExpiredMediaTickets(database, {
  env = process.env,
  at = Date.now(),
  limit = 100,
} = {}) {
  const boundedLimit = Math.max(1, Math.min(500, Math.trunc(Number(limit) || 100)));
  const cutoff = at - mediaOrphanTtlMs(env);
  const settledBefore = at - MEDIA_UPLOAD_SETTLE_BUFFER_MS;
  return atomic(database, () => {
    const rows = database.prepare(`SELECT owner_id,object_key FROM media_objects
      WHERE status='issued' AND updated_at<=? AND COALESCE(upload_expires_at,0)<=?
      ORDER BY updated_at ASC,object_key ASC LIMIT ?`).all(cutoff, settledBefore, boundedLimit);
    let enqueued = 0;
    for (const row of rows) {
      if (!trustedMediaQueueKey(row.object_key, row.owner_id)) continue;
      // A stable descriptor may own several objects. Treat its most recent
      // object activity/ticket as the draft's activity, so a stale poster can
      // never delete a freshly retried source (or vice versa).
      const asset = database.prepare(`SELECT a.id,
          EXISTS (SELECT 1 FROM post_media pm WHERE pm.asset_id=a.id) attached
        FROM media_assets a LEFT JOIN media_variants v ON v.asset_id=a.id
        WHERE a.owner_id=? AND (a.source_key=? OR v.object_key=?) LIMIT 1`)
        .get(row.owner_id, row.object_key, row.object_key);
      if (!asset) {
        enqueued += enqueueLedgerKeys(database, row.owner_id, [row.object_key], at);
        continue;
      }
      const objectRows = database.prepare(`SELECT mo.object_key,mo.status,mo.updated_at,mo.upload_expires_at
        FROM media_objects mo JOIN (
          SELECT source_key object_key FROM media_assets WHERE id=?
          UNION ALL SELECT object_key FROM media_variants WHERE asset_id=?
        ) owned ON owned.object_key=mo.object_key
        WHERE mo.owner_id=?`).all(asset.id, asset.id, row.owner_id);
      const keys = objectRows.map((entry) => entry.object_key)
        .filter((key) => trustedMediaQueueKey(key, row.owner_id));
      if (asset.attached) {
        if (keys.length) {
          const placeholders = keys.map(() => "?").join(",");
          database.prepare(`UPDATE media_objects SET status='associated',associated_at=COALESCE(associated_at,?),updated_at=?
            WHERE owner_id=? AND status='issued' AND object_key IN (${placeholders})`)
            .run(at, at, row.owner_id, ...keys);
        }
        continue;
      }
      const latestActivity = objectRows.reduce((latest, entry) => Math.max(latest, Number(entry.updated_at || 0)), 0);
      const latestExpiry = objectRows.reduce((latest, entry) => Math.max(latest, Number(entry.upload_expires_at || 0)), 0);
      const aggregateActivity = Math.max(latestActivity, latestExpiry ? latestExpiry - MEDIA_UPLOAD_TICKET_MS : 0);
      if (aggregateActivity > cutoff || latestExpiry > settledBefore) {
        // Keep every ledger in one active draft on the same activity horizon.
        // Otherwise one old source can occupy the bounded candidate window on
        // every pass while a freshly retried variant correctly keeps the asset.
        if (keys.length && aggregateActivity > 0) {
          const placeholders = keys.map(() => "?").join(",");
          database.prepare(`UPDATE media_objects
            SET updated_at=CASE WHEN updated_at>? THEN updated_at ELSE ? END
            WHERE owner_id=? AND status='issued' AND object_key IN (${placeholders})`)
            .run(aggregateActivity, aggregateActivity, row.owner_id, ...keys);
        }
        continue;
      }
      enqueued += enqueueLedgerKeys(database, row.owner_id, keys, at);
      // Queue first, then invalidate identity and retry tokens in the same
      // transaction. The object ledger deliberately survives the cascade until
      // the worker confirms storage deletion.
      database.prepare("DELETE FROM media_assets WHERE id=? AND owner_id=?").run(asset.id, row.owner_id);
    }
    return enqueued;
  });
}

function joinObjectUrl(base, segments) {
  const prefix = base.pathname.replace(/\/+$/, "");
  const suffix = segments.map((segment) => encodeURIComponent(String(segment))).join("/");
  return `${base.origin}${prefix}/${suffix}`;
}

export function createMediaDeleteRequest({
  objectKey,
  ownerId,
  storageScope = "public",
  env = process.env,
  now = new Date(),
} = {}) {
  const key = trustedMediaQueueKey(objectKey, ownerId);
  if (!key) return { ok: false, errorCode: "invalid_key" };
  let config;
  try { config = getMediaConfig(env); }
  catch { return { ok: false, errorCode: "storage_unconfigured" }; }
  if (!config.configured) return { ok: false, errorCode: "storage_unconfigured" };
  let bucket;
  try { bucket = mediaBucketForScope(config, storageScope); }
  catch { return { ok: false, errorCode: "storage_unconfigured" }; }
  const objectUrl = joinObjectUrl(config.endpoint, [bucket, ...key.split("/")]);
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

export function createMediaListRequest({
  ownerId,
  continuationToken,
  storageScope = "public",
  env = process.env,
  now = new Date(),
} = {}) {
  const owner = safeOwnerId(ownerId);
  if (!owner) return { ok: false, errorCode: "invalid_owner" };
  if (continuationToken != null && (typeof continuationToken !== "string" || continuationToken.length < 1 || continuationToken.length > 4096)) {
    return { ok: false, errorCode: "invalid_cursor" };
  }
  let config;
  try { config = getMediaConfig(env); }
  catch { return { ok: false, errorCode: "storage_unconfigured" }; }
  if (!config.configured) return { ok: false, errorCode: "storage_unconfigured" };
  let bucket;
  try { bucket = mediaBucketForScope(config, storageScope); }
  catch { return { ok: false, errorCode: "storage_unconfigured" }; }
  try {
    const target = new URL(joinObjectUrl(config.endpoint, [bucket]));
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
    const row = database.prepare(`SELECT q.id,q.owner_id,q.object_key,q.status,q.attempts,
        COALESCE(mo.storage_scope,'public') storage_scope
      FROM media_deletion_queue q JOIN media_objects mo
        ON mo.owner_id=q.owner_id AND mo.object_key=q.object_key
      WHERE q.status IN ('pending','retry','processing')
        AND q.next_attempt_at<=? AND q.attempts<?
      ORDER BY q.next_attempt_at ASC,q.id ASC LIMIT 1`)
      .get(at, MEDIA_DELETION_MAX_ATTEMPTS);
    if (!row) return null;
    const attempts = Number(row.attempts || 0) + 1;
    database.prepare(`UPDATE media_deletion_queue
      SET status='processing',attempts=?,next_attempt_at=?,last_error_code=NULL,updated_at=?,dead_at=NULL
      WHERE id=?`).run(attempts, at + MEDIA_DELETION_LEASE_MS, at, row.id);
    return { ...row, attempts };
  });
}

function finishSuccess(database, id, at) {
  return atomic(database, () => {
    const row = database.prepare(`SELECT q.owner_id,q.object_key,mo.upload_expires_at
      FROM media_deletion_queue q JOIN media_objects mo
        ON mo.owner_id=q.owner_id AND mo.object_key=q.object_key
      WHERE q.id=? AND q.status='processing'`).get(id);
    if (!row) return "missing";
    const uploadExpiry = Number(row.upload_expires_at || 0);
    const finalizeAfter = uploadExpiry > 0
      ? uploadExpiry + MEDIA_UPLOAD_SETTLE_BUFFER_MS + MEDIA_OWNER_SWEEP_QUIET_WINDOW_MS
      : 0;
    if (finalizeAfter > at) {
      // A provider can authenticate a PUT before ticket expiry and commit it
      // after this DELETE. Keep both the queue identity and owner ledger, then
      // repeat exact-key deletion throughout the same quiet window used by
      // account erasure instead of treating one optimistic 2xx/404 as final.
      const nextAttempt = Math.min(at + MEDIA_OWNER_SWEEP_RECHECK_MS, finalizeAfter);
      database.prepare(`UPDATE media_deletion_queue SET status='pending',attempts=0,next_attempt_at=?,
        last_error_code=NULL,updated_at=?,dead_at=NULL WHERE id=?`)
        .run(nextAttempt, at, id);
      database.prepare(`UPDATE media_objects SET status='delete_queued',updated_at=?
        WHERE owner_id=? AND object_key=?`).run(at, row.owner_id, row.object_key);
      return "recheck";
    }
    database.prepare("DELETE FROM media_deletion_queue WHERE id=?").run(id);
    // Successful deletion also erases the now-unneeded owner/key ledger row.
    // Failed/dead work remains visible until an operator can remediate it.
    database.prepare("DELETE FROM media_objects WHERE owner_id=? AND object_key=?").run(row.owner_id, row.object_key);
    return "finalized";
  });
}

function pauseDeletionForConfiguration(database, job, at) {
  database.prepare(`UPDATE media_deletion_queue SET status='pending',attempts=CASE WHEN attempts>0 THEN attempts-1 ELSE 0 END,
    next_attempt_at=?,last_error_code='storage_unconfigured',updated_at=?,dead_at=NULL WHERE id=?`)
    .run(at + MEDIA_OWNER_SWEEP_RECHECK_MS, at, job.id);
}

function releaseDeletionForShutdown(database, job, at) {
  database.prepare(`UPDATE media_deletion_queue SET status='pending',attempts=CASE WHEN attempts>0 THEN attempts-1 ELSE 0 END,
    next_attempt_at=?,last_error_code=NULL,updated_at=?,dead_at=NULL WHERE id=?`)
    .run(at, at, job.id);
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
    const row = database.prepare(`SELECT owner_id,storage_scope,continuation_token,status,attempts,discovered_count,
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

function linkedRequestController(signal) {
  const controller = new AbortController();
  const abort = () => controller.abort(signal.reason);
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  return {
    controller,
    detach: () => signal?.removeEventListener("abort", abort),
  };
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

function pauseSweepForConfiguration(database, job, at) {
  database.prepare(`UPDATE media_owner_sweeps SET status='pending',attempts=CASE WHEN attempts>0 THEN attempts-1 ELSE 0 END,
    next_attempt_at=?,last_error_code='storage_unconfigured',updated_at=?,dead_at=NULL WHERE owner_id=?`)
    .run(at + MEDIA_OWNER_SWEEP_RECHECK_MS, at, job.owner_id);
}

function releaseSweepForShutdown(database, job, at) {
  database.prepare(`UPDATE media_owner_sweeps SET status='pending',attempts=CASE WHEN attempts>0 THEN attempts-1 ELSE 0 END,
    next_attempt_at=?,last_error_code=NULL,updated_at=?,dead_at=NULL WHERE owner_id=?`)
    .run(at, at, job.owner_id);
}

export function redriveMediaDeletionDeadLetters(database, {
  at = Date.now(),
  limit = 100,
  minAgeMs = MEDIA_DELETION_DEAD_REDRIVE_MS,
} = {}) {
  if (!database) return { objects: 0, ownerSweeps: 0 };
  const boundedLimit = Math.max(1, Math.min(1_000, Math.trunc(Number(limit) || 100)));
  const age = Math.max(60_000, Math.min(30 * DAY_MS, Math.trunc(Number(minAgeMs) || MEDIA_DELETION_DEAD_REDRIVE_MS)));
  const cutoff = at - age;
  return atomic(database, () => {
    const objectRows = database.prepare(`SELECT id,owner_id,object_key FROM media_deletion_queue
      WHERE status='dead' AND COALESCE(dead_at,updated_at)<=?
        AND COALESCE(last_error_code,'') NOT IN ('invalid_key')
      ORDER BY COALESCE(dead_at,updated_at),id LIMIT ?`).all(cutoff, boundedLimit);
    for (const row of objectRows) {
      database.prepare(`UPDATE media_deletion_queue SET status='retry',attempts=0,next_attempt_at=?,
        last_error_code='operator_redrive',updated_at=?,dead_at=NULL WHERE id=? AND status='dead'`)
        .run(at, at, row.id);
      database.prepare(`UPDATE media_objects SET status='delete_queued',updated_at=?
        WHERE owner_id=? AND object_key=? AND status='deletion_dead'`)
        .run(at, row.owner_id, row.object_key);
    }
    const remaining = Math.max(0, boundedLimit - objectRows.length);
    const sweepRows = remaining ? database.prepare(`SELECT owner_id FROM media_owner_sweeps
      WHERE status='dead' AND COALESCE(dead_at,updated_at)<=?
        AND COALESCE(last_error_code,'') NOT IN ('invalid_owner','invalid_cursor')
      ORDER BY COALESCE(dead_at,updated_at),owner_id LIMIT ?`).all(cutoff, remaining) : [];
    for (const row of sweepRows) {
      database.prepare(`UPDATE media_owner_sweeps SET status='retry',attempts=0,next_attempt_at=?,
        last_error_code='operator_redrive',updated_at=?,dead_at=NULL WHERE owner_id=? AND status='dead'`)
        .run(at, at, row.owner_id);
    }
    return { objects: objectRows.length, ownerSweeps: sweepRows.length };
  });
}

export async function runMediaOwnerSweepOnce({
  database,
  env = process.env,
  fetchImpl = globalThis.fetch,
  clock = () => Date.now(),
  timeoutMs = 8_000,
  signal,
} = {}) {
  if (signal?.aborted) return { processed: 0, errorCode: "worker_aborted" };
  if (!database || typeof fetchImpl !== "function") return { processed: 0, errorCode: "worker_unavailable" };
  if (!mediaConfigured(env)) return { processed: 0, errorCode: "storage_unconfigured" };
  const job = claimOwnerSweep(database, clock());
  if (!job) return { processed: 0, errorCode: null };
  const prepared = createMediaListRequest({
    ownerId: job.owner_id,
    continuationToken: job.continuation_token,
    storageScope: job.storage_scope,
    env,
    now: new Date(clock()),
  });
  if (!prepared.ok) {
    if (prepared.errorCode === "storage_unconfigured") {
      pauseSweepForConfiguration(database, job, clock());
      return { processed: 1, errorCode: prepared.errorCode, retried: 1, configurationPaused: true };
    }
    const state = finishSweepFailure(database, job, prepared.errorCode, clock(), {
      terminal: ["invalid_owner", "invalid_cursor"].includes(prepared.errorCode),
    });
    return { processed: 1, errorCode: prepared.errorCode, deadLettered: state === "dead" ? 1 : 0, retried: state === "retry" ? 1 : 0 };
  }
  const linked = linkedRequestController(signal);
  const { controller } = linked;
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
    errorCode = signal?.aborted ? "list_aborted" : controller.signal.aborted ? "list_timeout" : "list_network";
  } finally {
    clearTimeout(timeout);
    linked.detach();
  }
  if (errorCode) {
    if (signal?.aborted) {
      releaseSweepForShutdown(database, job, clock());
      return { processed: 1, errorCode: "worker_aborted", cancelled: 1 };
    }
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
      recordMediaObjectTicket(database, {
        ownerId: job.owner_id,
        objectKey: key,
        storageScope: job.storage_scope,
        at,
        expiresAt: null,
      });
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
    } else if (job.storage_scope === "public") {
      // Always retain the private phase. If the private bucket setting is
      // temporarily absent, the next pass pauses without consuming retries and
      // resumes when configuration returns; it must never silently certify
      // account erasure from the public bucket alone.
      database.prepare(`UPDATE media_owner_sweeps SET storage_scope='private',status='pending',attempts=0,
        continuation_token=NULL,verification_passes=0,next_attempt_at=?,last_error_code=NULL,updated_at=?,dead_at=NULL
        WHERE owner_id=?`).run(at, at, job.owner_id);
    } else {
      database.prepare("DELETE FROM media_owner_sweeps WHERE owner_id=?").run(job.owner_id);
    }
  });
  return { processed: 1, discovered, hasMore: page.truncated, verificationPending, errorCode: null };
}

async function deleteOne(job, { env, fetchImpl, timeoutMs, clock, signal }) {
  const prepared = createMediaDeleteRequest({
    objectKey: job.object_key,
    ownerId: job.owner_id,
    storageScope: job.storage_scope,
    env,
    now: new Date(clock()),
  });
  if (!prepared.ok) return { ok: false, errorCode: prepared.errorCode, terminal: prepared.errorCode === "invalid_key" };
  const linked = linkedRequestController(signal);
  const { controller } = linked;
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
    return { ok: false, errorCode: signal?.aborted ? "aborted" : controller.signal.aborted ? "timeout" : "network" };
  } finally {
    clearTimeout(timeout);
    linked.detach();
  }
}

export async function runMediaDeletionBatch({
  database,
  env = process.env,
  fetchImpl = globalThis.fetch,
  clock = () => Date.now(),
  batchSize = 8,
  timeoutMs = 8_000,
  signal,
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
    deadLettersRedriven: 0,
    deletionRechecks: 0,
    lastErrorCode: null,
  };
  if (signal?.aborted) {
    result.lastErrorCode = "worker_aborted";
    return result;
  }
  if (database) {
    const at = clock();
    const redriven = redriveMediaDeletionDeadLetters(database, { at });
    result.deadLettersRedriven = redriven.objects + redriven.ownerSweeps;
    database.prepare("DELETE FROM media_upload_issuances WHERE issued_at<=?")
      .run(at - (2 * MEDIA_UPLOAD_ROLLING_WINDOW_MS));
    result.orphanTicketsQueued = enqueueExpiredMediaTickets(database, { env, at });
  }
  if (!result.configured) {
    result.lastErrorCode = "storage_unconfigured";
    return result;
  }
  if (!database || typeof fetchImpl !== "function") {
    result.lastErrorCode = "worker_unavailable";
    return result;
  }
  const sweep = await runMediaOwnerSweepOnce({ database, env, fetchImpl, clock, timeoutMs, signal });
  result.sweepPages = sweep.processed || 0;
  result.sweepKeysDiscovered = sweep.discovered || 0;
  result.retried += sweep.retried || 0;
  result.deadLettered += sweep.deadLettered || 0;
  if (sweep.errorCode) result.lastErrorCode = sweep.errorCode;
  if (signal?.aborted) return result;
  const limit = Math.max(1, Math.min(50, Math.trunc(Number(batchSize) || 8)));
  const boundedTimeout = Math.max(50, Math.min(30_000, Math.trunc(Number(timeoutMs) || 8_000)));
  for (let index = 0; index < limit; index++) {
    if (signal?.aborted) {
      result.lastErrorCode = "worker_aborted";
      break;
    }
    const job = claimNext(database, clock());
    if (!job) break;
    result.processed += 1;
    const outcome = await deleteOne(job, { env, fetchImpl, timeoutMs: boundedTimeout, clock, signal });
    if (outcome.ok) {
      const state = finishSuccess(database, job.id, clock());
      result.deleted += 1;
      if (state === "recheck") result.deletionRechecks += 1;
      continue;
    }
    if (outcome.errorCode === "storage_unconfigured") {
      pauseDeletionForConfiguration(database, job, clock());
      result.retried += 1;
      result.lastErrorCode = outcome.errorCode;
      continue;
    }
    if (outcome.errorCode === "aborted" && signal?.aborted) {
      releaseDeletionForShutdown(database, job, clock());
      result.lastErrorCode = "worker_aborted";
      break;
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
  const redriveEligible = Number(database.prepare(`SELECT COUNT(*) count FROM media_deletion_queue
    WHERE status='dead' AND COALESCE(dead_at,updated_at)<=?
      AND COALESCE(last_error_code,'') NOT IN ('invalid_key')`).get(at - MEDIA_DELETION_DEAD_REDRIVE_MS)?.count || 0);
  const sweepRedriveEligible = Number(database.prepare(`SELECT COUNT(*) count FROM media_owner_sweeps
    WHERE status='dead' AND COALESCE(dead_at,updated_at)<=?
      AND COALESCE(last_error_code,'') NOT IN ('invalid_owner','invalid_cursor')`).get(at - MEDIA_DELETION_DEAD_REDRIVE_MS)?.count || 0);
  return {
    enabled: mediaDeletionSchedulerEnabled(env),
    storageConfigured: mediaConfigured(env),
    running: schedulerState.running,
    pending: counts.pending || 0,
    retrying: counts.retry || 0,
    processing: counts.processing || 0,
    deadLetter: counts.dead || 0,
    redriveEligible,
    due,
    ownerSweeps: {
      pending: sweepCounts.pending || 0,
      retrying: sweepCounts.retry || 0,
      processing: sweepCounts.processing || 0,
      deadLetter: sweepCounts.dead || 0,
      redriveEligible: sweepRedriveEligible,
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
  runBatch = runMediaDeletionBatch,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  setRepeatingTimer = setInterval,
  clearRepeatingTimer = clearInterval,
  logger = console,
} = {}) {
  if (!mediaDeletionSchedulerEnabled(env)) {
    logger.log?.("[pit] active-media cleanup scheduler disabled.");
    return null;
  }
  schedulerState.startedAt ||= Date.now();
  logger.log?.(`[pit] active-media cleanup scheduled (${mediaConfigured(env) ? "storage ready" : "waiting for media storage configuration"}).`);
  let stopped = false;
  let active = null;
  let activeController = null;
  const trigger = () => {
    if (stopped) return Promise.resolve(null);
    if (active) return active;
    const controller = new AbortController();
    activeController = controller;
    schedulerState.running = true;
    schedulerState.lastRunAt = Date.now();
    active = Promise.resolve()
      .then(() => runBatch({ database, env, fetchImpl, signal: controller.signal }))
      .then((result) => {
        schedulerState.lastErrorCode = result.lastErrorCode;
        if (result.configured && !result.lastErrorCode) schedulerState.lastSuccessAt = Date.now();
        if (result.deadLettered) logger.error?.(`[pit] active-media cleanup moved ${result.deadLettered} item(s) to dead-letter.`);
        return result;
      })
      .catch(() => {
        schedulerState.lastErrorCode = "worker_failed";
        logger.error?.("[pit] active-media cleanup worker failed safely.");
        return null;
      })
      .finally(() => {
        schedulerState.running = false;
        if (activeController === controller) activeController = null;
        active = null;
      });
    return active;
  };
  const initial = setTimer(() => { void trigger(); }, Math.max(1_000, Number(initialDelayMs) || 15_000));
  const interval = setRepeatingTimer(() => { void trigger(); }, Math.max(10_000, Number(intervalMs) || 60_000));
  initial.unref?.();
  interval.unref?.();
  return {
    trigger,
    stop: ({ abortActive = false } = {}) => {
      stopped = true;
      clearTimer(initial);
      clearRepeatingTimer(interval);
      if (abortActive && activeController && !activeController.signal.aborted) {
        activeController.abort(new DOMException("Media deletion scheduler stopped.", "AbortError"));
      }
      return active || Promise.resolve();
    },
  };
}
