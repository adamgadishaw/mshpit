import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

import { withImmediateWrite as withWrite } from "./databaseTransaction.js";
import { isProduction } from "./environment.js";
import {
  createMediaDownloadCapability,
  getMediaConfig,
  mediaBucketForScope,
  presignS3Request,
  verifyPrivateMediaBucketIsolation,
} from "./media.js";
import {
  createMediaAsset,
  finalizeMediaAsset,
} from "./mediaAssets.js";
import {
  enqueueOwnedMediaKeys,
  recordMediaObjectTicket,
  trustedMediaQueueKey,
  trustedOwnedMediaKey,
} from "./mediaDeletion.js";
import { verifyMp4Compatibility } from "./mp4Probe.js";
import {
  LEGACY_VIDEO_POSTER_PUBLIC_BASE,
  LEGACY_VIDEO_POSTER_RELEASE,
  LEGACY_VIDEO_POSTER_RELEASE_ID,
} from "./legacyVideoPosterRelease.js";
import {
  refreshVideoVerifierHealth,
  verifyVideoObject,
} from "./videoVerifier.js";

const SOURCE_TYPES = new Set(["video/mp4", "video/quicktime"]);
const REQUIRED_SOURCE_CODECS = Object.freeze(["h264", "hevc"]);
const STRONG_ETAG = /^"([a-f0-9]{32})"$/u;
const LIVE_OBJECT_STATUSES = new Set(["issued", "associated"]);
const MAX_ITEMS = 5;
const MAX_SOURCE_BYTES = 100 * 1024 * 1024;

function migrationError(message, code = "CONFLICT", status = 409, cause) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.code = code;
  error.status = status;
  return error;
}

function normalizedBase(value) {
  try {
    const url = new URL(String(value || ""));
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) return null;
    return `${url.origin}${url.pathname.replace(/\/+$/u, "")}`;
  } catch {
    return null;
  }
}

function parsePhotos(value) {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function cleanType(value) {
  return String(value || "").split(";", 1)[0].trim().toLowerCase();
}

function encodePathPart(value) {
  return encodeURIComponent(value).replace(/[!'()*]/gu,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

function endpointObjectUrl(config, bucket, objectKey) {
  const prefix = config.endpoint.pathname.replace(/\/+$/u, "");
  const suffix = [bucket, ...objectKey.split("/")].map(encodePathPart).join("/");
  return `${config.endpoint.origin}${prefix}/${suffix}`;
}

function signedObjectHead(objectKey, { env, storageScope = "public", at = Date.now() } = {}) {
  const config = getMediaConfig(env);
  if (!config.configured) {
    throw migrationError("Media storage is unavailable for the historical clip migration.",
      "MEDIA_STORAGE_UNAVAILABLE", 503);
  }
  const bucket = mediaBucketForScope(config, storageScope);
  return presignS3Request({
    method: "HEAD",
    url: endpointObjectUrl(config, bucket, objectKey),
    region: config.region,
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    expiresIn: 60,
    now: new Date(at),
  });
}

async function inspectStoredObject(objectKey, {
  env,
  fetchImpl,
  signal,
  storageScope = "public",
  at = Date.now(),
} = {}) {
  let response;
  try {
    response = await fetchImpl(signedObjectHead(objectKey, { env, storageScope, at }), {
      method: "HEAD",
      redirect: "error",
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(8_000)])
        : AbortSignal.timeout(8_000),
    });
  } catch (error) {
    throw migrationError("Historical clip storage could not be inspected.",
      "MEDIA_STORAGE_UNAVAILABLE", 503, error);
  }
  if (response?.status === 404 || response?.status === 412) {
    throw migrationError("The exact historical clip generation is no longer in storage.");
  }
  if (!response || response.status < 200 || response.status >= 300) {
    throw migrationError("Historical clip storage could not be inspected.", "MEDIA_STORAGE_UNAVAILABLE", 503);
  }
  const byteSize = Number(response.headers?.get?.("content-length"));
  const mimeType = cleanType(response.headers?.get?.("content-type"));
  const etag = String(response.headers?.get?.("etag") || "").trim().toLowerCase();
  if (!Number.isSafeInteger(byteSize) || byteSize < 1 || byteSize > MAX_SOURCE_BYTES
      || !SOURCE_TYPES.has(mimeType) || !STRONG_ETAG.test(etag)) {
    throw migrationError("Historical clip storage metadata is invalid.");
  }
  return { byteSize, mimeType, etag };
}

function validateRelease(entries, env, allowNonProduction) {
  const injected = entries !== LEGACY_VIDEO_POSTER_RELEASE;
  const defaultRuntime = String(env?.NODE_ENV || "").trim().toLowerCase() === "production"
    && isProduction(env)
    && normalizedBase(env?.MEDIA_PUBLIC_BASE_URL) === normalizedBase(LEGACY_VIDEO_POSTER_PUBLIC_BASE)
    && String(env?.PIT_LEGACY_VIDEO_POSTER_RELEASE || "").trim() === LEGACY_VIDEO_POSTER_RELEASE_ID;
  if (!defaultRuntime && !(injected && allowNonProduction === true)) {
    throw migrationError("The historical clip migration is not authorized for this deployment.", "FORBIDDEN", 403);
  }
  if (!Array.isArray(entries) || entries.length < 1 || entries.length > MAX_ITEMS
      || (!injected && entries.length !== MAX_ITEMS)) {
    throw migrationError("The historical clip migration manifest is invalid.");
  }
  const identities = new Set();
  return entries.map((source) => {
    const entry = {
      ...source,
      postId: String(source?.postId || ""),
      ownerId: String(source?.ownerId || ""),
      position: Number(source?.position),
      sourceUrl: String(source?.sourceUrl || ""),
      sourceByteSize: Number(source?.sourceByteSize),
      sourceMimeType: cleanType(source?.sourceMimeType),
      sourceEtag: String(source?.sourceEtag || "").trim().toLowerCase(),
      posterKey: String(source?.posterKey || ""),
      posterUrl: String(source?.posterUrl || ""),
      byteSize: Number(source?.byteSize),
      width: Number(source?.width),
      height: Number(source?.height),
      timeMs: Number(source?.timeMs),
      contentSha256: String(source?.contentSha256 || "").toLowerCase(),
      contentMd5: String(source?.contentMd5 || "").toLowerCase(),
    };
    const sourceKey = trustedOwnedMediaKey(entry.sourceUrl, { ownerId: entry.ownerId, env });
    const posterKey = trustedOwnedMediaKey(entry.posterUrl, { ownerId: entry.ownerId, env });
    const identity = `${entry.postId}\0${entry.ownerId}\0${entry.sourceUrl}`;
    const expectedExtension = entry.sourceMimeType === "video/quicktime" ? ".mov" : ".mp4";
    if (!/^p_[A-Za-z0-9_-]{4,80}$/u.test(entry.postId)
        || !/^u_[A-Za-z0-9_-]{4,80}$/u.test(entry.ownerId)
        || !Number.isSafeInteger(entry.position) || entry.position < 0 || entry.position > 7
        || !sourceKey || !sourceKey.endsWith(expectedExtension)
        || !SOURCE_TYPES.has(entry.sourceMimeType)
        || !Number.isSafeInteger(entry.sourceByteSize) || entry.sourceByteSize < 16
        || entry.sourceByteSize > MAX_SOURCE_BYTES || !STRONG_ETAG.test(entry.sourceEtag)
        || !posterKey || posterKey !== entry.posterKey || !entry.posterKey.endsWith(".jpg")
        || !Number.isSafeInteger(entry.byteSize) || entry.byteSize < 1
        || !Number.isSafeInteger(entry.width) || entry.width < 1
        || !Number.isSafeInteger(entry.height) || entry.height < 1
        || !Number.isSafeInteger(entry.timeMs) || entry.timeMs < 0 || entry.timeMs > 60_000
        || !/^[a-f0-9]{64}$/u.test(entry.contentSha256)
        || !/^[a-f0-9]{32}$/u.test(entry.contentMd5)
        || identities.has(identity)) {
      throw migrationError(`The historical clip migration manifest entry for ${entry.postId || "unknown"} is invalid.`);
    }
    identities.add(identity);
    return { ...entry, sourceKey };
  });
}

export function legacyVideoMigrationIdentity(entry) {
  const digest = createHash("sha256").update(JSON.stringify({
    release: LEGACY_VIDEO_POSTER_RELEASE_ID,
    postId: entry.postId,
    ownerId: entry.ownerId,
    position: entry.position,
    sourceUrl: entry.sourceUrl,
    sourceByteSize: entry.sourceByteSize,
    sourceMimeType: entry.sourceMimeType,
    sourceEtag: entry.sourceEtag,
  })).digest("hex");
  return Object.freeze({
    digest,
    assetId: `ma_legacy_video_${digest.slice(0, 40)}`,
    sourceObjectId: `legacy_video_source_${digest.slice(0, 40)}`,
    clientAssetId: `legacy-video-migration:${LEGACY_VIDEO_POSTER_RELEASE_ID}:${digest.slice(0, 32)}`,
  });
}

function legacyMappingMatches(row, entry) {
  return row
    && row.owner_id === entry.ownerId
    && Number(row.position) === entry.position
    && row.media_url === entry.sourceUrl
    && row.poster_key === entry.posterKey
    && row.poster_url === entry.posterUrl
    && row.mime_type === "image/jpeg"
    && Number(row.byte_size) === entry.byteSize
    && Number(row.width) === entry.width
    && Number(row.height) === entry.height
    && Number(row.time_ms) === entry.timeMs
    && row.content_sha256 === entry.contentSha256
    && row.content_md5 === entry.contentMd5
    && row.status === "verified";
}

function stableAssetRow(database, assetId) {
  return database.prepare(`SELECT a.*,
      source_object.status source_object_status,source_object.storage_scope source_object_scope,
      render.id render_id,render.object_key render_key,render.public_url render_url,
      render.mime_type render_mime_type,render.status render_status,
      render.verification_origin render_origin,
      render_object.status render_object_status,render_object.storage_scope render_object_scope,
      poster.id poster_id,poster.object_key poster_object_key,poster.public_url stable_poster_url,
      poster.mime_type poster_mime_type,poster.status poster_status,poster.time_ms stable_poster_time_ms,
      poster.verification_origin poster_origin,
      poster_object.status poster_object_status,poster_object.storage_scope poster_object_scope
    FROM media_assets a
    LEFT JOIN media_objects source_object
      ON source_object.owner_id=a.owner_id AND source_object.object_key=a.source_key
    LEFT JOIN media_variants render ON render.id=a.render_variant_id AND render.asset_id=a.id
    LEFT JOIN media_objects render_object
      ON render_object.owner_id=a.owner_id AND render_object.object_key=render.object_key
    LEFT JOIN media_variants poster ON poster.id=a.poster_variant_id AND poster.asset_id=a.id
    LEFT JOIN media_objects poster_object
      ON poster_object.owner_id=a.owner_id AND poster_object.object_key=poster.object_key
    WHERE a.id=?`).get(assetId);
}

function readyStableAsset(database, entry, identity) {
  const row = stableAssetRow(database, identity.assetId);
  const expectedSourceKey = `users/${entry.ownerId}/post/${identity.sourceObjectId}.${
    entry.sourceMimeType === "video/quicktime" ? "mov" : "mp4"}`;
  const valid = row
    && row.owner_id === entry.ownerId
    && row.client_asset_id === identity.clientAssetId
    && row.purpose === "post" && row.kind === "video"
    && row.source_storage_scope === "private" && row.source_object_scope === "private"
    && row.source_key === expectedSourceKey && row.source_etag === entry.sourceEtag
    && row.mime_type === entry.sourceMimeType && Number(row.byte_size) === entry.sourceByteSize
    && row.status === "ready" && row.codec_status === "verified" && row.render_state === "ready"
    && LIVE_OBJECT_STATUSES.has(row.source_object_status)
    && row.render_status === "verified" && row.render_origin === "private_derivative_v1"
    && row.render_mime_type === "video/mp4" && row.render_object_scope === "public"
    && LIVE_OBJECT_STATUSES.has(row.render_object_status) && typeof row.render_url === "string"
    && row.poster_status === "verified" && row.poster_origin === "private_derivative_v1"
    && row.poster_mime_type === "image/jpeg" && row.poster_object_scope === "public"
    && LIVE_OBJECT_STATUSES.has(row.poster_object_status)
    && Number(row.stable_poster_time_ms) === entry.timeMs
    && typeof row.stable_poster_url === "string";
  return valid ? row : null;
}

function alreadyCommitted(database, entry, identity) {
  const asset = readyStableAsset(database, entry, identity);
  if (!asset) return null;
  const post = database.prepare("SELECT id,user_id,photos,removed FROM posts WHERE id=?").get(entry.postId);
  const photos = parsePhotos(post?.photos);
  const photoPosition = photos.indexOf(asset.render_url);
  const link = database.prepare("SELECT position FROM post_media WHERE post_id=? AND asset_id=?")
    .get(entry.postId, identity.assetId);
  const mapping = database.prepare("SELECT 1 FROM legacy_video_posters WHERE post_id=? AND media_url=?")
    .get(entry.postId, entry.sourceUrl);
  if (post && !post.removed && post.user_id === entry.ownerId
      && photoPosition === entry.position
      && photos.filter((url) => url === asset.render_url).length === 1
      && photos.indexOf(entry.sourceUrl) < 0
      && Number(link?.position) === photoPosition && !mapping
      && !globallyReferencedMediaUrl(database, entry.sourceUrl)
      && !globallyReferencedMediaUrl(database, entry.posterUrl)) {
    return { asset, position: photoPosition };
  }
  return null;
}

function currentManifestAttachment(database, entry) {
  const post = database.prepare("SELECT id,user_id,photos,removed FROM posts WHERE id=?").get(entry.postId);
  const photos = parsePhotos(post?.photos);
  if (!post || post.removed || post.user_id !== entry.ownerId
      || photos[entry.position] !== entry.sourceUrl
      || photos.filter((url) => url === entry.sourceUrl).length !== 1) {
    throw migrationError(`Post ${entry.postId} no longer has the exact reviewed clip attachment.`);
  }
  const mapping = database.prepare("SELECT * FROM legacy_video_posters WHERE post_id=? AND media_url=?")
    .get(entry.postId, entry.sourceUrl);
  if (!legacyMappingMatches(mapping, entry)) {
    throw migrationError(`Post ${entry.postId} no longer has the exact verified legacy cover mapping.`);
  }
  const posterObject = database.prepare(`SELECT owner_id,storage_scope,purpose,byte_size,status
    FROM media_objects WHERE object_key=?`).get(entry.posterKey);
  if (!posterObject || posterObject.owner_id !== entry.ownerId || posterObject.storage_scope !== "public"
      || posterObject.purpose !== "post" || Number(posterObject.byte_size) !== entry.byteSize
      || !LIVE_OBJECT_STATUSES.has(posterObject.status)) {
    throw migrationError(`Post ${entry.postId} no longer has the exact live legacy cover object.`);
  }
  return { post, photos, mapping };
}

function publicStableLinks(database, postId, ownerId, photos) {
  const rows = database.prepare(`SELECT pm.asset_id,pm.position,a.owner_id,a.status,a.kind,a.codec_status,a.render_state,
      so.status source_object_status,so.storage_scope source_object_scope,
      rv.public_url,rv.status variant_status,rv.verification_origin,
      ro.status object_status,ro.storage_scope
    FROM post_media pm
    JOIN media_assets a ON a.id=pm.asset_id
    LEFT JOIN media_objects so ON so.owner_id=a.owner_id AND so.object_key=a.source_key
    LEFT JOIN media_variants rv ON rv.id=a.render_variant_id AND rv.asset_id=a.id
    LEFT JOIN media_objects ro ON ro.owner_id=a.owner_id AND ro.object_key=rv.object_key
    WHERE pm.post_id=? ORDER BY pm.position`).all(postId);
  const byUrl = new Map();
  const positions = new Set();
  for (const row of rows) {
    const valid = row.owner_id === ownerId && row.status === "ready" && row.render_state === "ready"
      && row.source_object_scope === "private" && LIVE_OBJECT_STATUSES.has(row.source_object_status)
      && row.variant_status === "verified" && row.storage_scope === "public"
      && LIVE_OBJECT_STATUSES.has(row.object_status)
      && (row.kind !== "image" || row.verification_origin === "private_derivative_v1")
      && (row.kind !== "video" || (row.codec_status === "verified"
        && row.verification_origin === "private_derivative_v1"))
      && Number.isSafeInteger(Number(row.position)) && Number(row.position) >= 0
      && Number(row.position) < photos.length && photos[Number(row.position)] === row.public_url
      && typeof row.public_url === "string" && !positions.has(Number(row.position))
      && !byUrl.has(row.public_url);
    if (!valid) throw migrationError(`Post ${postId} has a stable media link that cannot be preserved safely.`);
    positions.add(Number(row.position));
    byUrl.set(row.public_url, row.asset_id);
  }
  return { byUrl, linkedIds: new Set(rows.map((row) => row.asset_id)) };
}

function globallyReferencedMediaUrl(database, url) {
  return !!database.prepare(`SELECT 1 FROM (
      SELECT avatar_uri value FROM users
      UNION ALL SELECT banner FROM users
      UNION ALL SELECT avatar_uri FROM artist_profiles
      UNION ALL SELECT banner FROM artist_profiles
      UNION ALL SELECT j.value FROM posts p,
        json_each(CASE WHEN json_valid(p.photos) THEN p.photos ELSE '[]' END) j
      UNION ALL SELECT j.value FROM venue_reviews r,
        json_each(CASE WHEN json_valid(r.photos) THEN r.photos ELSE '[]' END) j
      UNION ALL SELECT source_url FROM media_assets
      UNION ALL SELECT public_url FROM media_variants
      UNION ALL SELECT media_url FROM media_reactions
      UNION ALL SELECT media_url FROM legacy_video_posters
      UNION ALL SELECT poster_url FROM legacy_video_posters
    ) WHERE value=? LIMIT 1`).get(url);
}

function ensureExactLegacySourceLedger(database, entry, at) {
  let row = database.prepare(`SELECT owner_id,storage_scope,purpose,byte_size,status
    FROM media_objects WHERE object_key=?`).get(entry.sourceKey);
  if (!row) {
    const inserted = recordMediaObjectTicket(database, {
      ownerId: entry.ownerId,
      objectKey: entry.sourceKey,
      storageScope: "public",
      byteSize: entry.sourceByteSize,
      at,
      expiresAt: null,
    });
    if (!inserted) throw migrationError("The historical source deletion ledger could not be created.");
    database.prepare(`UPDATE media_objects SET status='associated',associated_at=?,updated_at=?
      WHERE owner_id=? AND object_key=? AND status='issued'`).run(at, at, entry.ownerId, entry.sourceKey);
    row = database.prepare(`SELECT owner_id,storage_scope,purpose,byte_size,status
      FROM media_objects WHERE object_key=?`).get(entry.sourceKey);
  } else if (Number(row.byte_size) === 0 && row.owner_id === entry.ownerId
      && row.storage_scope === "public" && row.purpose === "post"
      && LIVE_OBJECT_STATUSES.has(row.status)) {
    database.prepare("UPDATE media_objects SET byte_size=?,updated_at=? WHERE object_key=? AND byte_size=0")
      .run(entry.sourceByteSize, at, entry.sourceKey);
    row = database.prepare(`SELECT owner_id,storage_scope,purpose,byte_size,status
      FROM media_objects WHERE object_key=?`).get(entry.sourceKey);
  }
  if (!row || row.owner_id !== entry.ownerId || row.storage_scope !== "public" || row.purpose !== "post"
      || Number(row.byte_size) !== entry.sourceByteSize || !LIVE_OBJECT_STATUSES.has(row.status)) {
    throw migrationError("The historical source deletion ledger conflicts with the reviewed object.");
  }
}

function associateStableObjects(database, asset, entry, at) {
  const keys = [asset.source_key, asset.render_key, asset.poster_object_key];
  for (const key of keys) {
    const changed = Number(database.prepare(`UPDATE media_objects SET status='associated',
        associated_at=COALESCE(associated_at,?),updated_at=?
      WHERE owner_id=? AND object_key=? AND status IN ('issued','associated')`)
      .run(at, at, entry.ownerId, key).changes || 0);
    if (changed !== 1) throw migrationError("The stable clip object changed before publication.");
  }
}

function assertPostMigrationCoverage(database, items) {
  if (!Array.isArray(items) || !items.length) {
    throw migrationError("The historical clip migration post group is invalid.");
  }
  const postId = items[0].entry.postId;
  const ownerId = items[0].entry.ownerId;
  if (items.some((item) => item.entry.postId !== postId || item.entry.ownerId !== ownerId)) {
    throw migrationError("The historical clip migration post group is invalid.");
  }
  const positions = new Set();
  const sourceUrls = new Set();
  const sourceKeys = new Set();
  const posterKeys = new Set();
  const posterUrls = new Set();
  const assetIds = new Set();
  for (const item of items) {
    const { entry, identity } = item;
    if (!identity?.assetId || positions.has(entry.position) || sourceUrls.has(entry.sourceUrl)
        || sourceKeys.has(entry.sourceKey) || posterKeys.has(entry.posterKey)
        || posterUrls.has(entry.posterUrl) || assetIds.has(identity.assetId)) {
      throw migrationError(`Post ${postId} has conflicting historical clip migration targets.`);
    }
    positions.add(entry.position);
    sourceUrls.add(entry.sourceUrl);
    sourceKeys.add(entry.sourceKey);
    posterKeys.add(entry.posterKey);
    posterUrls.add(entry.posterUrl);
    assetIds.add(identity.assetId);
  }
  const post = database.prepare("SELECT id,user_id,photos,removed FROM posts WHERE id=?").get(postId);
  const photos = parsePhotos(post?.photos);
  if (!post || post.removed || post.user_id !== ownerId || photos.length < 1 || photos.length > 8) {
    throw migrationError(`Post ${postId} is not ready for its historical clip migration.`);
  }
  const existing = publicStableLinks(database, postId, ownerId, photos);
  const pendingItems = items.filter((item) => item.status !== "already_migrated");
  const pendingByPosition = new Map();
  const pendingSources = new Set();
  for (const item of pendingItems) {
    if (pendingByPosition.has(item.entry.position) || pendingSources.has(item.entry.sourceUrl)) {
      throw migrationError(`Post ${postId} has conflicting historical clip migration targets.`);
    }
    pendingByPosition.set(item.entry.position, item.entry.sourceUrl);
    pendingSources.add(item.entry.sourceUrl);
  }
  const representedAssets = new Set();
  const missing = [];
  for (let position = 0; position < photos.length; position += 1) {
    const url = photos[position];
    const assetId = existing.byUrl.get(url);
    if (assetId) {
      if (representedAssets.has(assetId)) missing.push(position);
      representedAssets.add(assetId);
      continue;
    }
    if (pendingByPosition.get(position) !== url) missing.push(position);
  }
  if (missing.length) {
    throw migrationError(
      `Post ${postId} has companion media that must be recovered before migrating its historical clips (positions ${missing.map((position) => position + 1).join(", ")}).`,
    );
  }
  const mappings = database.prepare("SELECT media_url FROM legacy_video_posters WHERE post_id=? ORDER BY media_url")
    .all(postId).map((row) => row.media_url);
  if (mappings.length !== pendingSources.size || mappings.some((url) => !pendingSources.has(url))) {
    throw migrationError(`Post ${postId} has an unreviewed historical clip cover mapping.`);
  }
  return { post, photos, existing };
}

function commitStablePostClips(database, items, { at }) {
  return withWrite(database, () => {
    const group = items.map((item) => ({ ...item }));
    const first = group[0];
    if (!first) throw migrationError("The historical clip migration post group is invalid.");
    const postId = first.entry.postId;
    const ownerId = first.entry.ownerId;
    const results = new Map();
    const pending = [];
    const classified = [];
    for (const item of group) {
      const { entry, identity } = item;
      if (entry.postId !== postId || entry.ownerId !== ownerId) {
        throw migrationError("The historical clip migration post group is invalid.");
      }
      const committed = alreadyCommitted(database, entry, identity);
      if (committed) {
        classified.push({ ...item, status: "already_migrated" });
        results.set(identity.assetId, {
          status: "already_migrated",
          assetId: identity.assetId,
          position: committed.position,
        });
        continue;
      }
      classified.push({ ...item, status: "ready" });
      currentManifestAttachment(database, entry);
      const asset = readyStableAsset(database, entry, identity);
      if (!asset) throw migrationError("The sanitized historical clip is not ready for publication.");
      if (asset.source_key !== `users/${entry.ownerId}/post/${identity.sourceObjectId}.${
        entry.sourceMimeType === "video/quicktime" ? "mov" : "mp4"}`) {
        throw migrationError("The sanitized clip source identity does not match the deterministic migration.");
      }
      pending.push({ entry, identity, asset });
    }
    const { photos, existing } = assertPostMigrationCoverage(database, classified);
    if (!pending.length) return group.map((item) => results.get(item.identity.assetId));
    const nextPhotos = [...photos];
    const nextLinks = new Map(existing.byUrl);
    for (const { entry, identity, asset } of pending) {
      if (existing.linkedIds.has(identity.assetId)) {
        throw migrationError("The migration asset is linked without its canonical delivery URL.");
      }
      const linked = database.prepare("SELECT post_id FROM post_media WHERE asset_id=?").get(identity.assetId);
      if (linked) throw migrationError("The migration asset is already linked outside its reviewed position.");
      nextPhotos[entry.position] = asset.render_url;
      nextLinks.set(asset.render_url, identity.assetId);
    }
    for (const url of existing.byUrl.keys()) {
      if (!nextPhotos.includes(url)) throw migrationError("A current stable post item would be lost during migration.");
    }
    const orderedLinks = [];
    for (let position = 0; position < nextPhotos.length; position += 1) {
      const assetId = nextLinks.get(nextPhotos[position]);
      if (!assetId || position > 7 || orderedLinks.some((item) => item.assetId === assetId)) {
        throw migrationError("The historical post media order cannot be represented safely.");
      }
      orderedLinks.push({ position, assetId });
    }
    if (orderedLinks.length !== nextPhotos.length || orderedLinks.length !== nextLinks.size) {
      throw migrationError("A current stable post item would be lost during migration.");
    }

    for (const { entry } of pending) ensureExactLegacySourceLedger(database, entry, at);
    // This single write activates the legacy-poster cleanup trigger. Its poster
    // queue entries and mapping removals roll back if any later invariant fails.
    // Every reviewed clip on this post swaps in the same transaction, so the
    // public projector never observes a mixed stable/URL-only intermediate.
    const updated = database.prepare("UPDATE posts SET photos=?,updated_at=? WHERE id=? AND user_id=? AND removed=0")
      .run(JSON.stringify(nextPhotos), at, postId, ownerId);
    if (Number(updated.changes || 0) !== 1) {
      throw migrationError("The historical post changed during the stable media swap.");
    }
    database.prepare("DELETE FROM post_media WHERE post_id=?").run(postId);
    const insert = database.prepare(`INSERT INTO post_media (post_id,asset_id,position,created_at)
      VALUES (?,?,?,?)`);
    for (const link of orderedLinks) insert.run(postId, link.assetId, link.position, at);
    for (const { entry, asset } of pending) associateStableObjects(database, asset, entry, at);

    // A reaction's post_id is nullable context, not part of its identity. Move
    // every reaction bound to these exact historical bytes, including rows left
    // with stale/null context by older post editing. If the same member already
    // reacted to the sanitized URL, keep one reaction, retain its live context,
    // and preserve the earliest interaction time before retiring the raw URL.
    const migrateReaction = database.prepare(`INSERT INTO media_reactions (media_url,user_id,post_id,created_at)
        SELECT ?,user_id,post_id,created_at FROM media_reactions WHERE media_url=?
        ON CONFLICT(media_url,user_id) DO UPDATE SET
          post_id=COALESCE(media_reactions.post_id,excluded.post_id),
          created_at=MIN(media_reactions.created_at,excluded.created_at)`);
    const removeReaction = database.prepare("DELETE FROM media_reactions WHERE media_url=?");
    for (const { entry, asset } of pending) {
      migrateReaction.run(asset.render_url, entry.sourceUrl);
      removeReaction.run(entry.sourceUrl);
      if (globallyReferencedMediaUrl(database, entry.sourceUrl)) {
        throw migrationError("A raw historical clip still has a database reference after the stable swap.");
      }
    }
    const sourceQueue = enqueueOwnedMediaKeys(database, {
      ownerId,
      keys: pending.map(({ entry }) => entry.sourceKey),
      at,
    });
    if (sourceQueue.accepted !== pending.length) {
      throw migrationError("The raw historical clips could not all be durably queued for deletion.");
    }
    const legacyMapping = database.prepare("SELECT 1 FROM legacy_video_posters WHERE post_id=? AND media_url=?");
    const posterQueue = database.prepare(`SELECT mo.status object_status,q.status queue_status
      FROM media_objects mo LEFT JOIN media_deletion_queue q
        ON q.owner_id=mo.owner_id AND q.object_key=mo.object_key
      WHERE mo.owner_id=? AND mo.object_key=?`);
    for (const { entry, identity, asset } of pending) {
      const mapping = legacyMapping.get(postId, entry.sourceUrl);
      const queuedPoster = posterQueue.get(ownerId, entry.posterKey);
      if (mapping || queuedPoster?.object_status !== "delete_queued" || !queuedPoster?.queue_status) {
        throw migrationError("A temporary historical clip cover was not retired atomically.");
      }
      if (globallyReferencedMediaUrl(database, entry.posterUrl)) {
        throw migrationError("A temporary historical clip cover is still referenced after the stable swap.");
      }
      if (globallyReferencedMediaUrl(database, entry.sourceUrl)) {
        throw migrationError("A raw historical clip regained a database reference during migration.");
      }
      results.set(identity.assetId, {
        status: "migrated",
        assetId: identity.assetId,
        position: entry.position,
        deliveryUrl: asset.render_url,
        retiredSourceKey: entry.sourceKey,
        retiredPosterKey: entry.posterKey,
      });
    }
    const finalLinks = publicStableLinks(database, postId, ownerId, nextPhotos);
    if (finalLinks.byUrl.size !== nextPhotos.length || finalLinks.linkedIds.size !== nextPhotos.length) {
      throw migrationError("The historical post media swap did not preserve every attachment.");
    }
    return group.map((item) => results.get(item.identity.assetId));
  });
}

async function copyExactSourceToPrivate(entry, upload, {
  env,
  fetchImpl,
  signal,
  at,
  clock = Date.now,
} = {}) {
  const capability = createMediaDownloadCapability({
    objectKey: entry.sourceKey,
    ifMatch: entry.sourceEtag,
    env,
    now: new Date(at),
    expiresIn: 300,
    storageScope: "public",
  });
  let response;
  const downloadSignal = signal
    ? AbortSignal.any([signal, AbortSignal.timeout(180_000)])
    : AbortSignal.timeout(180_000);
  try {
    response = await fetchImpl(capability.downloadUrl, {
      method: "GET",
      redirect: "error",
      headers: capability.requiredHeaders,
      signal: downloadSignal,
    });
  } catch (error) {
    throw migrationError("The exact historical clip could not be downloaded.",
      "MEDIA_STORAGE_UNAVAILABLE", 503, error);
  }
  const responseType = cleanType(response?.headers?.get?.("content-type"));
  const responseBytes = Number(response?.headers?.get?.("content-length"));
  const responseEtag = String(response?.headers?.get?.("etag") || "").trim().toLowerCase();
  if (response?.status !== 200 || responseType !== entry.sourceMimeType
      || responseBytes !== entry.sourceByteSize || responseEtag !== entry.sourceEtag
      || !response.body || typeof response.body.getReader !== "function") {
    throw migrationError("The downloaded historical clip no longer matches its reviewed generation.");
  }

  const directory = await mkdtemp(join(tmpdir(), "pit-legacy-video-"));
  const path = join(directory, "source.bin");
  try {
    const hash = createHash("md5");
    let received = 0;
    const exactBytes = new Transform({
      transform(chunk, _encoding, callback) {
        received += chunk.length;
        if (received > entry.sourceByteSize) {
          callback(migrationError("The historical clip exceeded its reviewed byte size."));
          return;
        }
        hash.update(chunk);
        callback(null, chunk);
      },
    });
    await pipeline(Readable.fromWeb(response.body), exactBytes, createWriteStream(path, { flags: "wx" }), {
      signal: downloadSignal,
    });
    const storedFile = await stat(path);
    const expectedMd5 = STRONG_ETAG.exec(entry.sourceEtag)?.[1];
    if (received !== entry.sourceByteSize || storedFile.size !== entry.sourceByteSize
        || hash.digest("hex") !== expectedMd5) {
      throw migrationError("The historical clip bytes no longer match the reviewed ETag.");
    }

    let uploadFailure = null;
    let uploaded = null;
    const uploadSignal = signal
      ? AbortSignal.any([signal, AbortSignal.timeout(180_000)])
      : AbortSignal.timeout(180_000);
    try {
      uploaded = await fetchImpl(upload.uploadUrl, {
        method: "PUT",
        redirect: "error",
        headers: { ...upload.requiredHeaders, "Content-Length": String(entry.sourceByteSize) },
        body: createReadStream(path),
        duplex: "half",
        signal: uploadSignal,
      });
    } catch (error) {
      uploadFailure = error;
    }
    const accepted = uploaded && ((uploaded.status >= 200 && uploaded.status < 300) || uploaded.status === 412);
    let privateObject = null;
    try {
      const headAt = Number(clock());
      if (!Number.isSafeInteger(headAt) || headAt < 1) {
        throw migrationError("The historical clip migration clock is invalid.", "VALIDATION_FAILED", 400);
      }
      privateObject = await inspectStoredObject(upload.key, {
        env, fetchImpl, signal, storageScope: "private", at: headAt,
      });
    } catch (error) {
      if (uploadFailure) throw migrationError("The private historical clip copy could not be confirmed.",
        "MEDIA_STORAGE_UNAVAILABLE", 503, uploadFailure);
      throw error;
    }
    if (!accepted && !uploadFailure) {
      throw migrationError("The private historical clip copy was rejected by storage.",
        "MEDIA_STORAGE_UNAVAILABLE", 503);
    }
    if (privateObject.byteSize !== entry.sourceByteSize
        || privateObject.mimeType !== entry.sourceMimeType
        || privateObject.etag !== entry.sourceEtag) {
      throw migrationError("The deterministic private clip key contains different bytes.");
    }
    return privateObject;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function declaredDimensions(structural, entry) {
  const sourcePortrait = Number(structural.height) > Number(structural.width);
  const posterPortrait = entry.height > entry.width;
  return sourcePortrait === posterPortrait
    ? { width: Number(structural.width), height: Number(structural.height) }
    : { width: Number(structural.height), height: Number(structural.width) };
}

async function preflightEntry(database, entry, {
  env,
  fetchImpl,
  signal,
  at,
  structuralProbe,
} = {}) {
  const identity = legacyVideoMigrationIdentity(entry);
  const committed = alreadyCommitted(database, entry, identity);
  if (committed) {
    return { entry, identity, status: "already_migrated", structural: null };
  }
  if (database.prepare("SELECT 1 FROM post_media WHERE asset_id=?").get(identity.assetId)) {
    throw migrationError(`Post ${entry.postId} has a migration asset linked outside its reviewed position.`);
  }
  currentManifestAttachment(database, entry);
  const source = await inspectStoredObject(entry.sourceKey, {
    env, fetchImpl, signal, storageScope: "public", at,
  });
  if (source.byteSize !== entry.sourceByteSize || source.mimeType !== entry.sourceMimeType
      || source.etag !== entry.sourceEtag) {
    throw migrationError(`Post ${entry.postId} source storage no longer matches the reviewed manifest.`);
  }
  const structural = await structuralProbe({
    objectKey: entry.sourceKey,
    expectedBytes: entry.sourceByteSize,
    contentType: entry.sourceMimeType,
    ifMatch: entry.sourceEtag,
    env,
    fetchImpl,
    signal,
    storageScope: "public",
  });
  if (!structural || !Number.isSafeInteger(Number(structural.durationMs))
      || entry.timeMs >= Number(structural.durationMs)) {
    throw migrationError(`Post ${entry.postId} source cannot produce its reviewed cover time.`);
  }
  return { entry, identity, status: "ready", structural };
}

async function prepareEntry(database, preflight, {
  env,
  fetchImpl,
  signal,
  clock,
  structuralProbe,
  assetCreator,
  sourceCopier,
  assetFinalizer,
  authoritativeVideoVerifier,
} = {}) {
  const { entry, identity } = preflight;
  const phaseNow = () => {
    const value = Number(clock());
    if (!Number.isSafeInteger(value) || value < 1) {
      throw migrationError("The historical clip migration clock is invalid.", "VALIDATION_FAILED", 400);
    }
    return value;
  };
  const committed = alreadyCommitted(database, entry, identity);
  if (committed) return preflight;
  if (database.prepare("SELECT 1 FROM post_media WHERE asset_id=?").get(identity.assetId)) {
    throw migrationError(`Post ${entry.postId} has a migration asset linked outside its reviewed position.`);
  }
  currentManifestAttachment(database, entry);
  const createAt = phaseNow();
  const created = assetCreator(database, {
    ownerId: entry.ownerId,
    body: {
      clientAssetId: identity.clientAssetId,
      purpose: "post",
      contentType: entry.sourceMimeType,
      fileSize: entry.sourceByteSize,
      name: `historical-clip.${entry.sourceMimeType === "video/quicktime" ? "mov" : "mp4"}`,
    },
    env,
    at: createAt,
    assetId: identity.assetId,
    sourceObjectId: identity.sourceObjectId,
  });
  if (created?.upload) {
    await sourceCopier(entry, created.upload, { env, fetchImpl, signal, at: createAt, clock: phaseNow });
  } else {
    const current = stableAssetRow(database, identity.assetId);
    const stored = current ? await inspectStoredObject(current.source_key, {
      env, fetchImpl, signal, storageScope: "private", at: phaseNow(),
    }) : null;
    if (!current || current.owner_id !== entry.ownerId || current.client_asset_id !== identity.clientAssetId
        || current.source_storage_scope !== "private" || current.mime_type !== entry.sourceMimeType
        || Number(current.byte_size) !== entry.sourceByteSize || stored?.etag !== entry.sourceEtag
        || stored?.byteSize !== entry.sourceByteSize || stored?.mimeType !== entry.sourceMimeType) {
      throw migrationError("The deterministic historical clip draft contains different bytes.");
    }
  }
  // A prior apply can finish one deterministic private asset and then stop on
  // a later clip before any post is swapped. Once its exact source generation,
  // owner, release identity, delivery, poster, and ledgers all pass the same
  // readyStableAsset predicate used below, reuse it instead of replaying the
  // immutable finalize recipe against an already-finalized row.
  if (readyStableAsset(database, entry, identity)) return preflight;
  const asset = stableAssetRow(database, identity.assetId);
  const structural = await structuralProbe({
    objectKey: asset.source_key,
    expectedBytes: entry.sourceByteSize,
    contentType: entry.sourceMimeType,
    ifMatch: entry.sourceEtag,
    env,
    fetchImpl,
    signal,
    storageScope: "private",
    at: phaseNow(),
  });
  const dimensions = declaredDimensions(structural, entry);
  await assetFinalizer(database, {
    ownerId: entry.ownerId,
    assetId: identity.assetId,
    body: {
      ...dimensions,
      durationMs: Number(structural.durationMs),
      orientation: 0,
      altText: "",
      editRecipe: {
        kind: "video",
        durationMs: Number(structural.durationMs),
        trimStartMs: 0,
        trimEndMs: Number(structural.durationMs),
        coverMode: "manual",
        coverMs: entry.timeMs,
      },
    },
    env,
    at: phaseNow(),
    fetchImpl,
    authoritativeVideoVerifier,
    authoritativePosterRequired: true,
    signal,
  });
  if (!readyStableAsset(database, entry, identity)) {
    throw migrationError("The sanitized historical clip is not ready for publication.");
  }
  return preflight;
}

function migrationPostGroups(items) {
  const groups = new Map();
  for (const item of items) {
    const current = groups.get(item.entry.postId) || [];
    current.push(item);
    groups.set(item.entry.postId, current);
  }
  return [...groups.values()];
}

/**
 * One-time operator migration for the five code-reviewed URL-only clips.
 *
 * Dry-run is the default. Preparation is explicit and sequential because the
 * private verifier intentionally owns one bounded decoder slot. Each item is
 * independently restartable; all reviewed clips on the same post swap together
 * only after every deterministic private source and derivative is verified.
 */
export async function migrateLegacyVideoRelease(database, {
  apply = false,
  entries = LEGACY_VIDEO_POSTER_RELEASE,
  env = process.env,
  fetchImpl = globalThis.fetch,
  signal,
  // Tests/operator rehearsals may pin `at`; production intentionally samples
  // the clock for each clip so later presigned capabilities cannot inherit the
  // first clip's already-aged timestamp.
  at = null,
  clock = Date.now,
  allowNonProduction = false,
  structuralProbe = verifyMp4Compatibility,
  assetCreator = createMediaAsset,
  sourceCopier = copyExactSourceToPrivate,
  assetFinalizer = finalizeMediaAsset,
  authoritativeVideoVerifier = verifyVideoObject,
  privacyProbe = verifyPrivateMediaBucketIsolation,
  verifierHealthCheck = refreshVideoVerifierHealth,
} = {}) {
  if (!database?.prepare || typeof fetchImpl !== "function" || typeof structuralProbe !== "function"
      || (at == null && typeof clock !== "function")) {
    throw migrationError("The historical clip migration runtime is invalid.", "VALIDATION_FAILED", 400);
  }
  const release = validateRelease(entries, env, allowNonProduction);
  const now = () => {
    const value = at == null ? Number(clock()) : Number(at);
    if (!Number.isSafeInteger(value) || value < 1) {
      throw migrationError("The historical clip migration clock is invalid.", "VALIDATION_FAILED", 400);
    }
    return value;
  };
  const privacy = await privacyProbe({ env, fetchImpl, signal });
  if (!privacy?.ready) {
    throw migrationError("Private media storage has not passed its isolation check.",
      "MEDIA_STORAGE_UNAVAILABLE", 503);
  }
  const health = await verifierHealthCheck({ env, fetchImpl, signal, at: now() });
  const requiredSourceTypes = new Set(release.map((entry) => entry.sourceMimeType));
  const healthySourceTypes = new Set(Array.isArray(health?.sourceTypes) ? health.sourceTypes : []);
  const missingCapability = [...requiredSourceTypes].some((type) => {
    const codecs = new Set(Array.isArray(health?.sourceCodecs?.[type]) ? health.sourceCodecs[type] : []);
    return !healthySourceTypes.has(type)
      || REQUIRED_SOURCE_CODECS.some((codec) => !codecs.has(codec));
  });
  if (!health?.ready || missingCapability) {
    throw migrationError("The exact private video verifier release is not healthy yet.",
      "MEDIA_STORAGE_UNAVAILABLE", 503);
  }

  const preflight = [];
  for (const entry of release) {
    preflight.push(await preflightEntry(database, entry, {
      env, fetchImpl, signal, at: now(), structuralProbe,
    }));
  }
  const postGroups = migrationPostGroups(preflight);
  // Once a post has any stable link, the public projector intentionally ignores
  // URL-only fallbacks. Require every companion slot to be an existing verified
  // stable item or another reviewed target in this exact release before doing
  // any copy/finalize work, and repeat this invariant inside the commit writer.
  for (const group of postGroups) assertPostMigrationCoverage(database, group);
  if (!apply) {
    return {
      releaseId: LEGACY_VIDEO_POSTER_RELEASE_ID,
      mode: "dry-run",
      checked: preflight.length,
      ready: preflight.filter((item) => item.status === "ready").length,
      alreadyMigrated: preflight.filter((item) => item.status === "already_migrated").length,
      items: preflight.map((item) => ({
        postId: item.entry.postId,
        position: item.entry.position,
        status: item.status,
        assetId: item.identity.assetId,
      })),
    };
  }

  const prepared = [];
  for (const item of preflight) {
    prepared.push(await prepareEntry(database, item, {
      env,
      fetchImpl,
      signal,
      clock: now,
      structuralProbe,
      assetCreator,
      sourceCopier,
      assetFinalizer,
      authoritativeVideoVerifier,
    }));
  }
  const resultByAsset = new Map();
  for (const group of migrationPostGroups(prepared)) {
    const committed = commitStablePostClips(database, group, { at: now() });
    for (const item of committed) resultByAsset.set(item.assetId, item);
  }
  const results = preflight.map((item) => resultByAsset.get(item.identity.assetId));
  return {
    releaseId: LEGACY_VIDEO_POSTER_RELEASE_ID,
    mode: "apply",
    checked: preflight.length,
    migrated: results.filter((item) => item.status === "migrated").length,
    alreadyMigrated: results.filter((item) => item.status === "already_migrated").length,
    items: results.map((item) => ({
      postId: release.find((entry) => legacyVideoMigrationIdentity(entry).assetId === item.assetId)?.postId,
      position: item.position,
      status: item.status,
      assetId: item.assetId,
    })),
  };
}

export const legacyVideoMigrationInternals = Object.freeze({
  inspectStoredObject,
  copyExactSourceToPrivate,
  assertPostMigrationCoverage,
  commitStablePostClips,
});
