import { createHash } from "node:crypto";

import { withImmediateWrite as withWrite } from "./databaseTransaction.js";
import { isProduction } from "./environment.js";
import { ApiError } from "./errors.js";
import { getMediaConfig, presignS3Request } from "./media.js";
import {
  enqueueOwnedMediaKeys,
  recordMediaObjectTicket,
  trustedMediaQueueKey,
  trustedOwnedMediaKey,
} from "./mediaDeletion.js";
import {
  LEGACY_VIDEO_POSTER_PUBLIC_BASE,
  LEGACY_VIDEO_POSTER_RELEASE,
  LEGACY_VIDEO_POSTER_RELEASE_ID,
} from "./legacyVideoPosterRelease.js";

const MAX_RELEASE_POSTERS = 8;
const MAX_POSTER_BYTES = 5 * 1024 * 1024;
const MAX_SOURCE_BYTES = 100 * 1024 * 1024;
const RETRY_DELAYS_MS = Object.freeze([60_000, 5 * 60_000, 30 * 60_000, 2 * 60 * 60_000]);
const VERIFICATION_LEASE_MS = 30_000;
const RECONCILE_INTERVAL_MS = 60_000;
const LIVE_OBJECT_STATUSES = new Set(["issued", "associated"]);
const VIDEO_URL = /\.(?:mp4|mov|m4v|webm)(?:[?#]|$)/iu;
const HEX_64 = /^[a-f0-9]{64}$/u;
const HEX_32 = /^[a-f0-9]{32}$/u;
const QUOTED_MD5 = /^"([a-f0-9]{32})"$/u;

function releaseSourceIndex(entries) {
  const grouped = new Map();
  for (const entry of entries) {
    const sources = grouped.get(entry.postId) || [];
    sources.push(entry.sourceUrl);
    grouped.set(entry.postId, sources);
  }
  return new Map([...grouped].map(([postId, sources]) => [postId, Object.freeze([...sources])]));
}

// The public API fast path is guarded by the exact, code-reviewed release
// identities before it prepares any SQL. Four post ids (five source URLs) can
// reach the mapping table; ordinary feed/profile rows pay no second lookup.
const EXACT_RELEASE_SOURCES = releaseSourceIndex(LEGACY_VIDEO_POSTER_RELEASE);
// Unit tests and a future explicitly supplied trusted release can exercise the
// same generic machinery without broadening the production manifest. The map
// is private, replaced as one immutable snapshot only after validation and a
// successful registration transaction, and cannot be written by a client.
const REGISTERED_RELEASE_SOURCES = new WeakMap();

function guardedSources(database, postId) {
  const exact = PROCESS_DEFAULT_RELEASE_ACTIVE ? EXACT_RELEASE_SOURCES.get(postId) || [] : [];
  const registered = REGISTERED_RELEASE_SOURCES.get(database)?.get(postId) || [];
  return exact.length || registered.length ? new Set([...exact, ...registered]) : null;
}

function guardedReleasePost(database, postId, photos = null) {
  if (typeof postId !== "string" || !postId) return false;
  const sources = guardedSources(database, postId);
  if (!sources) return false;
  return !Array.isArray(photos) || photos.some((url) => sources.has(url));
}

function parsePhotos(value) {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function normalizedBase(value) {
  try {
    const url = new URL(String(value || ""));
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) return null;
    return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
  } catch {
    return null;
  }
}

function defaultReleaseRuntime(env) {
  return String(env?.NODE_ENV || "").trim().toLowerCase() === "production"
    && isProduction(env)
    && normalizedBase(env?.MEDIA_PUBLIC_BASE_URL) === normalizedBase(LEGACY_VIDEO_POSTER_PUBLIC_BASE)
    && String(env?.PIT_LEGACY_VIDEO_POSTER_RELEASE || "").trim() === LEGACY_VIDEO_POSTER_RELEASE_ID;
}

const PROCESS_DEFAULT_RELEASE_ACTIVE = defaultReleaseRuntime(process.env);

function releaseEnvironment(entries, env) {
  const base = normalizedBase(env?.MEDIA_PUBLIC_BASE_URL);
  if (!base) return null;
  for (const entry of entries) {
    if (!String(entry?.sourceUrl || "").startsWith(`${base}/`)
        || !String(entry?.posterUrl || "").startsWith(`${base}/`)) return null;
  }
  return base;
}

function releaseEntries(entries, env) {
  if (!Array.isArray(entries) || entries.length < 1 || entries.length > MAX_RELEASE_POSTERS) {
    throw new Error("Legacy video poster release exceeds its bounded manifest.");
  }
  if (!releaseEnvironment(entries, env)) return { active: false, entries: [] };
  const identities = new Set();
  const posterKeys = new Set();
  const posterUrls = new Set();
  const sourceUrls = new Set();
  const checked = entries.map((entry) => {
    const postId = String(entry?.postId || "");
    const ownerId = String(entry?.ownerId || "");
    const position = Number(entry?.position);
    const byteSize = Number(entry?.byteSize);
    const width = Number(entry?.width);
    const height = Number(entry?.height);
    const timeMs = Number(entry?.timeMs);
    const sourceByteSize = Number(entry?.sourceByteSize);
    const sourceMimeType = String(entry?.sourceMimeType || "").toLowerCase();
    const sourceEtag = String(entry?.sourceEtag || "").toLowerCase();
    const sourceUrl = String(entry?.sourceUrl || "");
    const posterUrl = String(entry?.posterUrl || "");
    const posterKey = String(entry?.posterKey || "");
    const contentSha256 = String(entry?.contentSha256 || "").toLowerCase();
    const contentMd5 = String(entry?.contentMd5 || "").toLowerCase();
    const sourceKey = trustedOwnedMediaKey(sourceUrl, { ownerId, env });
    const projectedPosterKey = trustedOwnedMediaKey(posterUrl, { ownerId, env });
    if (!/^p_[A-Za-z0-9_-]{4,80}$/u.test(postId) || !/^u_[A-Za-z0-9_-]{4,80}$/u.test(ownerId)
        || !Number.isSafeInteger(position) || position < 0 || position > 7
        || !VIDEO_URL.test(sourceUrl) || !sourceKey
        || !["video/mp4", "video/quicktime", "video/webm"].includes(sourceMimeType)
        || !Number.isSafeInteger(sourceByteSize) || sourceByteSize < 1 || sourceByteSize > MAX_SOURCE_BYTES
        || !QUOTED_MD5.test(sourceEtag)
        || !trustedMediaQueueKey(posterKey, ownerId) || projectedPosterKey !== posterKey
        || !posterKey.endsWith(".jpg") || !HEX_64.test(contentSha256) || !HEX_32.test(contentMd5)
        || !posterKey.includes(contentSha256.slice(0, 16))
        || !Number.isSafeInteger(byteSize) || byteSize < 1024 || byteSize > MAX_POSTER_BYTES
        || !Number.isSafeInteger(width) || width < 1 || width > 1920
        || !Number.isSafeInteger(height) || height < 1 || height > 1920
        || !Number.isSafeInteger(timeMs) || timeMs < 0 || timeMs > 60_000) {
      throw new Error(`Invalid legacy video poster release entry for ${postId || "unknown post"}.`);
    }
    const identity = `${postId}\0${sourceUrl}`;
    if (identities.has(identity) || sourceUrls.has(sourceUrl) || posterKeys.has(posterKey) || posterUrls.has(posterUrl)) {
      throw new Error("Legacy video poster release contains a duplicate identity.");
    }
    identities.add(identity);
    sourceUrls.add(sourceUrl);
    posterKeys.add(posterKey);
    posterUrls.add(posterUrl);
    return {
      ...entry,
      postId,
      ownerId,
      position,
      sourceUrl,
      sourceKey,
      sourceByteSize,
      sourceMimeType,
      sourceEtag,
      posterKey,
      posterUrl,
      byteSize,
      width,
      height,
      timeMs,
      contentSha256,
      contentMd5,
    };
  });
  return { active: true, entries: checked };
}

function immutableRowMatches(row, entry) {
  return row
    && row.owner_id === entry.ownerId
    && row.poster_key === entry.posterKey
    && row.poster_url === entry.posterUrl
    && row.mime_type === "image/jpeg"
    && Number(row.byte_size) === entry.byteSize
    && Number(row.width) === entry.width
    && Number(row.height) === entry.height
    && Number(row.time_ms) === entry.timeMs
    && row.content_sha256 === entry.contentSha256
    && row.content_md5 === entry.contentMd5;
}

function registerPosterLedger(database, entry, at) {
  recordMediaObjectTicket(database, {
    ownerId: entry.ownerId,
    objectKey: entry.posterKey,
    byteSize: entry.byteSize,
    at,
    expiresAt: null,
  });
  const ledger = database.prepare("SELECT owner_id,purpose,byte_size,status FROM media_objects WHERE object_key=?")
    .get(entry.posterKey);
  if (!ledger || ledger.owner_id !== entry.ownerId || ledger.purpose !== "post"
      || Number(ledger.byte_size) !== entry.byteSize) {
    throw new Error(`Legacy poster ledger conflict for ${entry.posterKey}.`);
  }
  return ledger;
}

export function registerLegacyVideoPosterRelease(database, {
  entries = LEGACY_VIDEO_POSTER_RELEASE,
  env = process.env,
  at = Date.now(),
  allowNonProduction = false,
} = {}) {
  const injectedRelease = entries !== LEGACY_VIDEO_POSTER_RELEASE;
  if (!defaultReleaseRuntime(env) && !(injectedRelease && allowNonProduction === true)) {
    REGISTERED_RELEASE_SOURCES.delete(database);
    return { active: false, registered: 0, retained: 0, retired: 0 };
  }
  const release = releaseEntries(entries, env);
  if (!release.active) {
    REGISTERED_RELEASE_SOURCES.delete(database);
    return { active: false, registered: 0, retained: 0, retired: 0 };
  }
  const result = withWrite(database, () => {
    let registered = 0;
    let retained = 0;
    let retired = 0;
    for (const entry of release.entries) {
      const post = database.prepare("SELECT id,user_id,photos,removed FROM posts WHERE id=?").get(entry.postId);
      const photos = parsePhotos(post?.photos);
      const currentPosition = photos.indexOf(entry.sourceUrl);
      const attaches = !!post && !post.removed && post.user_id === entry.ownerId && currentPosition >= 0;
      const existing = database.prepare("SELECT * FROM legacy_video_posters WHERE post_id=? AND media_url=?")
        .get(entry.postId, entry.sourceUrl);
      if (existing && !immutableRowMatches(existing, entry)) {
        throw new Error(`Legacy poster mapping conflict for ${entry.postId}.`);
      }
      if (!attaches) {
        // The default manifest names five objects the operator already
        // published, so an active production deployment owns their cleanup even
        // if a post disappeared between upload and first boot. Injected/custom
        // releases do not get that authority from absence alone.
        let ledger = database.prepare("SELECT owner_id,purpose,byte_size,status FROM media_objects WHERE object_key=?")
          .get(entry.posterKey);
        if (!existing && !ledger && injectedRelease) continue;
        if (!ledger) ledger = registerPosterLedger(database, entry, at);
        if (!ledger || ledger.owner_id !== entry.ownerId || ledger.purpose !== "post"
            || Number(ledger.byte_size) !== entry.byteSize) {
          throw new Error(`Legacy poster ledger conflict for ${entry.posterKey}.`);
        }
        if (existing) database.prepare("DELETE FROM legacy_video_posters WHERE post_id=? AND media_url=?")
          .run(entry.postId, entry.sourceUrl);
        const queued = enqueueOwnedMediaKeys(database, { ownerId: entry.ownerId, keys: [entry.posterKey], at });
        if (queued.accepted !== 1) throw new Error(`Legacy poster retirement failed for ${entry.posterKey}.`);
        if (existing || queued.enqueued) retired += 1;
        continue;
      }
      const ledger = registerPosterLedger(database, entry, at);
      if (existing && !LIVE_OBJECT_STATUSES.has(ledger.status)) {
        database.prepare("DELETE FROM legacy_video_posters WHERE post_id=? AND media_url=?")
          .run(entry.postId, entry.sourceUrl);
        const queued = enqueueOwnedMediaKeys(database, { ownerId: entry.ownerId, keys: [entry.posterKey], at });
        if (queued.accepted !== 1) throw new Error(`Legacy poster retirement failed for ${entry.posterKey}.`);
        retired += 1;
        continue;
      }
      if (existing) {
        if (Number(existing.position) !== currentPosition) {
          database.prepare("UPDATE legacy_video_posters SET position=?,updated_at=? WHERE post_id=? AND media_url=?")
            .run(currentPosition, at, entry.postId, entry.sourceUrl);
        }
        retained += 1;
        continue;
      }
      database.prepare(`INSERT INTO legacy_video_posters
        (post_id,media_url,position,owner_id,poster_key,poster_url,mime_type,byte_size,width,height,time_ms,
         content_sha256,content_md5,status,attempts,next_attempt_at,last_error_code,verified_at,created_at,updated_at)
        VALUES (?,?,?,?,?,?,'image/jpeg',?,?,?,?,?,?,'pending',0,0,NULL,NULL,?,?)`)
        .run(entry.postId, entry.sourceUrl, currentPosition, entry.ownerId, entry.posterKey, entry.posterUrl,
          entry.byteSize, entry.width, entry.height, entry.timeMs, entry.contentSha256, entry.contentMd5, at, at);
      if (!LIVE_OBJECT_STATUSES.has(ledger.status)) {
        throw new Error(`Legacy poster object is already retiring: ${entry.posterKey}.`);
      }
      database.prepare(`UPDATE media_objects SET status='associated',associated_at=COALESCE(associated_at,?),updated_at=?
        WHERE owner_id=? AND object_key=? AND status IN ('issued','associated')`)
        .run(at, at, entry.ownerId, entry.posterKey);
      registered += 1;
    }
    return { active: true, registered, retained, retired };
  });
  REGISTERED_RELEASE_SOURCES.set(database, releaseSourceIndex(release.entries));
  return result;
}

function endpointObjectUrl(config, objectKey) {
  const encode = (value) => encodeURIComponent(value).replace(/[!'()*]/gu,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  const prefix = config.endpoint.pathname.replace(/\/+$/, "");
  return `${config.endpoint.origin}${prefix}/${[config.bucket, ...objectKey.split("/")].map(encode).join("/")}`;
}

function cleanContentType(value) {
  return String(value || "").split(";", 1)[0].trim().toLowerCase();
}

async function inspectPosterObject(row, { env, fetchImpl }) {
  const config = getMediaConfig(env);
  if (!config.configured) return { ok: false, code: "STORAGE_UNAVAILABLE", retry: true };
  const objectKey = trustedMediaQueueKey(row.poster_key, row.owner_id);
  if (!objectKey) return { ok: false, code: "INVALID_OBJECT_KEY", retry: false };
  let signed;
  try {
    signed = presignS3Request({
      method: "HEAD",
      url: endpointObjectUrl(config, objectKey),
      region: config.region,
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      expiresIn: 60,
    });
  } catch {
    return { ok: false, code: "STORAGE_UNAVAILABLE", retry: true };
  }
  let response;
  try {
    response = await fetchImpl(signed, {
      method: "HEAD",
      redirect: "error",
      signal: AbortSignal.timeout(8_000),
    });
  } catch {
    return { ok: false, code: "STORAGE_UNAVAILABLE", retry: true };
  }
  if (response?.status === 404) return { ok: false, code: "OBJECT_NOT_FOUND", retry: true };
  if (!response || response.status < 200 || response.status >= 300) {
    return { ok: false, code: "STORAGE_UNAVAILABLE", retry: true };
  }
  const bytes = Number(response.headers?.get?.("content-length"));
  const type = cleanContentType(response.headers?.get?.("content-type"));
  const etag = String(response.headers?.get?.("etag") || "").trim().toLowerCase();
  if (bytes !== Number(row.byte_size) || type !== "image/jpeg") {
    return { ok: false, code: "OBJECT_METADATA_MISMATCH", retry: false };
  }
  if (etag !== `"${row.content_md5}"`) {
    return { ok: false, code: "OBJECT_HASH_MISMATCH", retry: false };
  }
  return { ok: true };
}

export async function verifyLegacyVideoPosterBatch(database, {
  env = process.env,
  fetchImpl = globalThis.fetch,
  at = Date.now(),
  limit = 5,
  allowNonProduction = false,
} = {}) {
  if (!defaultReleaseRuntime(env) && allowNonProduction !== true) {
    return { processed: 0, verified: 0, failed: 0, retrying: 0 };
  }
  if (typeof fetchImpl !== "function" || !normalizedBase(env?.MEDIA_PUBLIC_BASE_URL)) {
    return { processed: 0, verified: 0, failed: 0, retrying: 0 };
  }
  const verificationAt = Number.isSafeInteger(at) ? at : Date.now();
  const boundedLimit = Math.max(1, Math.min(MAX_RELEASE_POSTERS, Math.trunc(Number(limit) || 5)));
  const rows = database.prepare(`SELECT p.*,mo.status object_status FROM legacy_video_posters p
    LEFT JOIN media_objects mo ON mo.owner_id=p.owner_id AND mo.object_key=p.poster_key
    WHERE p.status IN ('pending','retry') AND p.next_attempt_at<=?
    ORDER BY p.next_attempt_at,p.post_id,p.position LIMIT ?`).all(verificationAt, boundedLimit);
  const outcome = { processed: 0, verified: 0, failed: 0, retrying: 0 };
  for (const row of rows) {
    // Claim through a compare-and-swap before awaiting the network. The lease
    // is stored in the existing due timestamp, so it is additive for deployed
    // databases and a crashed worker becomes eligible again without consuming
    // a retry. Concurrent/rolling workers that selected the same snapshot see
    // zero changed rows and cannot turn one outage into five failed attempts.
    const claimUntil = verificationAt + VERIFICATION_LEASE_MS;
    const claimed = withWrite(database, () => Number(database.prepare(`UPDATE legacy_video_posters
      SET next_attempt_at=?,updated_at=?
      WHERE post_id=? AND media_url=? AND status=? AND attempts=? AND next_attempt_at=?`)
      .run(claimUntil, verificationAt, row.post_id, row.media_url, row.status,
        Number(row.attempts || 0), Number(row.next_attempt_at || 0)).changes || 0) === 1);
    if (!claimed) continue;
    outcome.processed += 1;
    const inspection = LIVE_OBJECT_STATUSES.has(row.object_status)
      ? await inspectPosterObject(row, { env, fetchImpl })
      : { ok: false, code: "OBJECT_RETIRED", retry: false };
    const finalState = withWrite(database, () => {
      if (inspection.ok) {
        const verified = database.prepare(`UPDATE legacy_video_posters
          SET status='verified',attempts=attempts+1,next_attempt_at=0,
            last_error_code=NULL,verified_at=?,updated_at=?
          WHERE post_id=? AND media_url=? AND status=? AND attempts=? AND next_attempt_at=?
            AND EXISTS (
              SELECT 1 FROM media_objects mo
              WHERE mo.owner_id=legacy_video_posters.owner_id
                AND mo.object_key=legacy_video_posters.poster_key
                AND mo.status IN ('issued','associated')
            )`)
          .run(verificationAt, verificationAt, row.post_id, row.media_url, row.status,
            Number(row.attempts || 0), claimUntil);
        return Number(verified.changes || 0) === 1 ? "verified" : null;
      }
      const attempts = Math.min(5, Number(row.attempts || 0) + 1);
      const terminal = !inspection.retry || attempts >= 5;
      const delay = RETRY_DELAYS_MS[Math.min(attempts - 1, RETRY_DELAYS_MS.length - 1)];
      const updated = database.prepare(`UPDATE legacy_video_posters
        SET status=?,attempts=?,next_attempt_at=?,last_error_code=?,updated_at=?
        WHERE post_id=? AND media_url=? AND status=? AND attempts=? AND next_attempt_at=?`)
        .run(terminal ? "failed" : "retry", attempts,
          terminal ? 0 : verificationAt + delay, inspection.code, verificationAt,
          row.post_id, row.media_url, row.status, Number(row.attempts || 0), claimUntil);
      if (Number(updated.changes || 0) !== 1) return null;
      if (terminal) {
        const queued = enqueueOwnedMediaKeys(database, {
          ownerId: row.owner_id,
          keys: [row.poster_key],
          at: verificationAt,
        });
        if (queued.accepted !== 1) {
          throw new Error(`Legacy poster retirement failed for ${row.poster_key}.`);
        }
        return "failed";
      }
      return "retrying";
    });
    if (finalState) outcome[finalState] += 1;
  }
  return outcome;
}

export function reconcileLegacyVideoPosters(database, {
  at = Date.now(),
  limit = MAX_RELEASE_POSTERS,
} = {}) {
  const reconciliationAt = Number.isSafeInteger(at) ? at : Date.now();
  const boundedLimit = Math.max(1, Math.min(MAX_RELEASE_POSTERS, Math.trunc(Number(limit) || MAX_RELEASE_POSTERS)));
  const rows = database.prepare(`SELECT lp.*,p.user_id post_owner_id,p.photos post_photos,
      p.removed post_removed,mo.status object_status
    FROM legacy_video_posters lp
    LEFT JOIN posts p ON p.id=lp.post_id
    LEFT JOIN media_objects mo ON mo.owner_id=lp.owner_id AND mo.object_key=lp.poster_key
    WHERE lp.status='verified'
    ORDER BY lp.updated_at,lp.post_id,lp.position LIMIT ?`).all(boundedLimit);
  const outcome = { checked: 0, retired: 0, repositioned: 0 };
  for (const snapshot of rows) {
    const result = withWrite(database, () => {
      const row = database.prepare(`SELECT lp.*,p.user_id post_owner_id,p.photos post_photos,
          p.removed post_removed,mo.status object_status
        FROM legacy_video_posters lp
        LEFT JOIN posts p ON p.id=lp.post_id
        LEFT JOIN media_objects mo ON mo.owner_id=lp.owner_id AND mo.object_key=lp.poster_key
        WHERE lp.post_id=? AND lp.media_url=? AND lp.status='verified'`)
        .get(snapshot.post_id, snapshot.media_url);
      if (!row) return null;
      const photos = parsePhotos(row.post_photos);
      const position = photos.indexOf(row.media_url);
      const attached = row.post_owner_id === row.owner_id
        && !row.post_removed
        && position >= 0
        && LIVE_OBJECT_STATUSES.has(row.object_status);
      if (!attached) {
        const queued = enqueueOwnedMediaKeys(database, {
          ownerId: row.owner_id,
          keys: [row.poster_key],
          at: reconciliationAt,
        });
        if (queued.accepted !== 1) {
          throw new Error(`Legacy poster reconciliation could not queue ${row.poster_key}.`);
        }
        database.prepare("DELETE FROM legacy_video_posters WHERE post_id=? AND media_url=?")
          .run(row.post_id, row.media_url);
        return "retired";
      }
      if (Number(row.position) !== position) {
        database.prepare(`UPDATE legacy_video_posters SET position=?,updated_at=?
          WHERE post_id=? AND media_url=? AND status='verified'`)
          .run(position, reconciliationAt, row.post_id, row.media_url);
        return "repositioned";
      }
      return "checked";
    });
    if (result) {
      outcome.checked += 1;
      if (result !== "checked") outcome[result] += 1;
    }
  }
  return outcome;
}

export function startLegacyVideoPosterVerificationScheduler({
  database,
  env = process.env,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (!defaultReleaseRuntime(env)) return { stop() {} };
  let stopped = false;
  let timer = null;
  const schedule = (delay) => {
    if (stopped) return;
    timer = setTimeout(run, Math.max(1_000, Math.min(15 * 60_000, delay)));
    timer.unref?.();
  };
  const run = async () => {
    if (stopped) return;
    try {
      reconcileLegacyVideoPosters(database);
      await verifyLegacyVideoPosterBatch(database, { env, fetchImpl });
    } catch (error) {
      console.error(`[media] legacy poster verification failed safely: ${String(error?.name || "Error")}`);
    }
    if (stopped) return;
    const due = database.prepare(`SELECT MIN(next_attempt_at) next_at FROM legacy_video_posters
      WHERE status IN ('pending','retry')`).get()?.next_at;
    const untilDue = due == null ? RECONCILE_INTERVAL_MS : Math.max(1_000, Number(due) - Date.now());
    schedule(Math.min(RECONCILE_INTERVAL_MS, untilDue));
  };
  schedule(1_000);
  return {
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}

function descriptor(row) {
  const id = createHash("sha256").update(`${row.post_id}\0${row.media_url}`, "utf8").digest("hex").slice(0, 24);
  return {
    id: `legacy_video_${id}`,
    kind: "video",
    url: row.media_url,
    sourceUrl: row.media_url,
    posterUrl: row.poster_url,
    posterTimeMs: row.time_ms,
    altText: "",
  };
}

export function legacyVideoPosterDescriptorsByPost(database, postIds) {
  const ids = [...new Set((Array.isArray(postIds) ? postIds : []).filter((id) => typeof id === "string" && id))]
    .filter((postId) => guardedReleasePost(database, postId))
    .slice(0, 100);
  const result = new Map();
  if (!ids.length) return result;
  const placeholders = ids.map(() => "?").join(",");
  const rows = database.prepare(`SELECT p.* FROM legacy_video_posters p
    JOIN media_objects mo ON mo.owner_id=p.owner_id AND mo.object_key=p.poster_key
    WHERE p.post_id IN (${placeholders}) AND p.status='verified' AND mo.status IN ('issued','associated')
    ORDER BY p.post_id,p.position`).all(...ids);
  for (const row of rows) {
    if (!guardedSources(database, row.post_id)?.has(row.media_url)) continue;
    const list = result.get(row.post_id) || [];
    list.push(descriptor(row));
    result.set(row.post_id, list);
  }
  return result;
}

export function legacyVideoPosterDescriptors(database, { postId, photos } = {}) {
  const ordered = Array.isArray(photos) ? photos : [];
  if (!guardedReleasePost(database, postId, ordered)) return [];
  const byUrl = new Map((legacyVideoPosterDescriptorsByPost(database, [postId]).get(postId) || [])
    .map((item) => [item.url, item]));
  return ordered.map((url) => byUrl.get(url)).filter(Boolean);
}

export function legacyVideoPosterObjectRecords(database, postId) {
  return database.prepare(`SELECT owner_id ownerId,poster_key objectKey,poster_url publicUrl,media_url mediaUrl
    FROM legacy_video_posters WHERE post_id=? ORDER BY position`).all(postId);
}

export function deleteLegacyVideoPosterMappings(database, postId) {
  return Number(database.prepare("DELETE FROM legacy_video_posters WHERE post_id=?").run(postId).changes || 0);
}

export function retireLegacyVideoPosters(database, {
  postId,
  ownerId,
  mediaUrls = null,
  at = Date.now(),
} = {}) {
  const selected = mediaUrls == null ? null : new Set(Array.isArray(mediaUrls) ? mediaUrls : []);
  const rows = legacyVideoPosterObjectRecords(database, postId)
    .filter((row) => row.ownerId === ownerId && (!selected || selected.has(row.mediaUrl)));
  if (!rows.length) return { accepted: 0, enqueued: 0, records: [] };
  const keys = rows.map((row) => row.objectKey);
  const queued = enqueueOwnedMediaKeys(database, { ownerId, keys, at });
  if (queued.accepted !== new Set(keys).size) {
    throw new ApiError(409, "That video cover changed while it was being removed. Refresh and try again.", "CONFLICT");
  }
  const remove = database.prepare("DELETE FROM legacy_video_posters WHERE post_id=? AND media_url=? AND owner_id=?");
  for (const row of rows) remove.run(postId, row.mediaUrl, ownerId);
  return { ...queued, records: rows };
}
