import { createHash } from "node:crypto";

import {
  MEDIA_PHOTO_SOURCE_MAX_BYTES,
  MEDIA_POST_MAX_ATTACHMENTS,
} from "../src/domain/mediaUploadPolicy.mjs";
import { withImmediateWrite as withWrite } from "./databaseTransaction.js";
import { ApiError } from "./errors.js";
import { sanitizeDecodedImage } from "./imageProcessor.js";
import {
  sanitizePrivateImageStaging,
  stageSanitizedPublicImage,
} from "./mediaAssets.js";
import {
  ensureLegacyMediaFinalizeSchema,
  recoverProfileImageReference,
  verifiedFinalizedLegacyMedia,
} from "./mediaLegacyFinalize.js";
import {
  createMediaDownloadCapability,
  createMediaPresign,
  createMediaProcessorImageUploadCapability,
  getMediaConfig,
  mediaBucketForScope,
  presignS3Request,
} from "./media.js";
import {
  enqueueOwnedMediaKeys,
  MEDIA_UPLOAD_ACCOUNTING_CLASS,
  recordMediaObjectTicket,
  reserveMediaUploadTicket,
  trustedMediaQueueKey,
  trustedOwnedMediaKey,
} from "./mediaDeletion.js";

const MAX_SOURCE_BYTES = MEDIA_PHOTO_SOURCE_MAX_BYTES;
const MAX_RECOVERY_BATCH = 2;
const RETRY_BASE_MS = 5 * 60_000;
const IMAGE_EXT = /\.(?:jpe?g|png|webp|gif|heic|heif|avif)$/iu;
const IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif",
  "image/avif",
]);
const OUTPUT_TYPE = Object.freeze({
  "image/jpeg": "image/jpeg",
  "image/png": "image/png",
  "image/webp": "image/webp",
  "image/gif": "image/webp",
  "image/heic": "image/jpeg",
  "image/heif": "image/jpeg",
  "image/avif": "image/jpeg",
});
const OUTPUT_EXTENSION = Object.freeze({
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
});
const LEGACY_IMAGE_RECOVERY_TIMEOUT_MS = 60_000;

const activeRuns = new WeakMap();
const retryState = new WeakMap();
const aggregateRuns = new WeakMap();

const PROFILE_REFERENCE = Object.freeze({
  "user.avatar": Object.freeze({ purpose: "avatar" }),
  "user.banner": Object.freeze({ purpose: "banner" }),
  "artist_profile.avatar": Object.freeze({ purpose: "avatar" }),
  "artist_profile.banner": Object.freeze({ purpose: "banner" }),
});

function cleanType(value) {
  return String(value || "").split(";", 1)[0].trim().toLowerCase();
}

function strongEtag(value) {
  const etag = String(value || "").trim();
  return /^"[\x21\x23-\x7e]{1,200}"$/u.test(etag) ? etag : null;
}

function imageTypeMatchesKey(objectKey, mimeType) {
  const extension = /\.([A-Za-z0-9]+)$/u.exec(String(objectKey || ""))?.[1]?.toLowerCase();
  if (extension === "jpg" || extension === "jpeg") return mimeType === "image/jpeg";
  if (extension === "png") return mimeType === "image/png";
  if (extension === "webp") return mimeType === "image/webp";
  if (extension === "gif") return mimeType === "image/gif";
  if (extension === "heic" || extension === "heif") return mimeType === "image/heic" || mimeType === "image/heif";
  if (extension === "avif") return mimeType === "image/avif";
  return false;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function reserveDeterministicRecoveryTicket(database, {
  ownerId,
  objectKey,
  storageScope,
  purpose,
  byteSize,
  at,
  env = process.env,
}) {
  const existing = database.prepare(`SELECT owner_id,storage_scope,purpose,byte_size,status
    FROM media_objects WHERE object_key=?`).get(objectKey);
  if (!existing) {
    reserveMediaUploadTicket(database, {
      ownerId,
      objectKey,
      storageScope,
      accountingClass: MEDIA_UPLOAD_ACCOUNTING_CLASS.SERVICE_GENERATED,
      byteSize,
      at,
      env,
    });
    return;
  }
  if (existing.owner_id !== ownerId || existing.storage_scope !== storageScope
      || existing.purpose !== purpose || Number(existing.byte_size) !== Number(byteSize)
      || !new Set(["issued", "associated"]).has(existing.status)) {
    throw new ApiError(409, "Recovered photo storage changed before retry.", "CONFLICT");
  }
}

function parsePhotos(value) {
  try {
    const parsed = JSON.parse(value || "[]");
    // Some pre-limit clients stored more than eight compatibility URLs. Stable
    // attachments remain capped elsewhere, but a recovery CAS must never erase
    // untouched trailing history while replacing one of the supported slots.
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function endpointObjectUrl(config, bucket, objectKey) {
  const encode = (value) => encodeURIComponent(value).replace(/[!'()*]/gu,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  const prefix = config.endpoint.pathname.replace(/\/+$/, "");
  return `${config.endpoint.origin}${prefix}/${[bucket, ...objectKey.split("/")].map(encode).join("/")}`;
}

async function headStoredObject(objectKey, {
  env,
  fetchImpl,
  signal,
  storageScope = "public",
  expectedBytes = null,
  expectedType = null,
} = {}) {
  const config = getMediaConfig(env);
  if (!config.configured) {
    throw new ApiError(503, "Photo recovery storage is unavailable.", "MEDIA_STORAGE_UNAVAILABLE");
  }
  const bucket = mediaBucketForScope(config, storageScope);
  const url = presignS3Request({
    method: "HEAD",
    url: endpointObjectUrl(config, bucket, objectKey),
    region: config.region,
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    expiresIn: 60,
  });
  let response;
  try {
    response = await fetchImpl(url, {
      method: "HEAD",
      redirect: "error",
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(8_000)]) : AbortSignal.timeout(8_000),
    });
  } catch (error) {
    throw new ApiError(503, "The historical photo could not be inspected.", "MEDIA_STORAGE_UNAVAILABLE", error);
  }
  const byteSize = Number(response?.headers?.get?.("content-length"));
  const mimeType = cleanType(response?.headers?.get?.("content-type"));
  const etag = strongEtag(response?.headers?.get?.("etag"));
  if (response?.status !== 200 || !Number.isSafeInteger(byteSize) || byteSize < 12
      || byteSize > MAX_SOURCE_BYTES || !IMAGE_TYPES.has(mimeType) || !imageTypeMatchesKey(objectKey, mimeType) || !etag
      || (expectedBytes != null && Number(expectedBytes) !== byteSize)
      || (expectedType && cleanType(expectedType) !== mimeType)) {
    throw new ApiError(409, "The historical photo no longer matches its recorded object.", "CONFLICT");
  }
  return { byteSize, mimeType, etag };
}

async function downloadStoredObject(objectKey, stored, {
  env,
  fetchImpl,
  signal,
  storageScope = "public",
} = {}) {
  const capability = createMediaDownloadCapability({
    objectKey,
    ifMatch: stored.etag,
    env,
    expiresIn: 90,
    storageScope,
  });
  let response;
  try {
    response = await fetchImpl(capability.downloadUrl, {
      method: "GET",
      redirect: "error",
      headers: capability.requiredHeaders,
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(12_000)]) : AbortSignal.timeout(12_000),
    });
  } catch (error) {
    throw new ApiError(503, "The historical photo could not be read.", "MEDIA_STORAGE_UNAVAILABLE", error);
  }
  const bytes = Number(response?.headers?.get?.("content-length"));
  const type = cleanType(response?.headers?.get?.("content-type"));
  const etag = strongEtag(response?.headers?.get?.("etag"));
  if (response?.status !== 200 || bytes !== stored.byteSize || type !== stored.mimeType
      || etag !== stored.etag || !response.body || typeof response.body.getReader !== "function") {
    throw new ApiError(409, "The historical photo changed during recovery.", "CONFLICT");
  }
  const reader = response.body.getReader();
  const chunks = [];
  let received = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      received += value?.byteLength || 0;
      if (received > stored.byteSize || received > MAX_SOURCE_BYTES) {
        await reader.cancel("historical image exceeded its measured size");
        throw new ApiError(409, "The historical photo changed during recovery.", "CONFLICT");
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  if (received !== stored.byteSize) {
    throw new ApiError(409, "The historical photo changed during recovery.", "CONFLICT");
  }
  return Buffer.concat(chunks, received);
}

async function verifyStoredDigest(objectKey, expected, options) {
  const stored = await headStoredObject(objectKey, {
    ...options,
    expectedBytes: expected.byteSize,
    expectedType: expected.mimeType,
  });
  const bytes = await downloadStoredObject(objectKey, stored, options);
  if (sha256(bytes) !== expected.sha256) {
    throw new ApiError(409, "The recovered photo failed its storage digest check.", "CONFLICT");
  }
  return stored;
}

function deterministicIdentity(candidate, digest) {
  const identity = sha256(`${candidate.postId}\0${candidate.ownerId}\0${candidate.position}\0${candidate.sourceUrl}`);
  const assetId = candidate.assetId || `ma_legacy_${identity.slice(0, 24)}`;
  const variantId = candidate.variantId || `mv_legacy_${identity.slice(0, 24)}`;
  const safe = digest.slice(0, 16);
  return {
    identity,
    assetId,
    variantId,
    sourceObjectId: `${assetId}_recovered_source_${safe}`,
    renderObjectId: `${assetId}_recovered_render_${safe}`,
  };
}

async function stageOutput(database, candidate, output, identity, {
  env,
  fetchImpl,
  signal,
  at,
} = {}) {
  const extension = OUTPUT_EXTENSION[output.mimeType];
  if (!extension) throw new ApiError(415, "The recovered photo format is unsupported.", "MEDIA_TYPE_UNSUPPORTED");
  const request = {
    purpose: "post",
    contentType: output.mimeType,
    fileSize: output.byteSize,
    name: `recovered.${extension}`,
  };
  const privateUpload = createMediaPresign({
    userId: candidate.ownerId,
    body: request,
    env,
    now: new Date(at),
    objectId: identity.sourceObjectId,
    storageScope: "private",
  });
  const publicUpload = createMediaProcessorImageUploadCapability({
    objectKey: `users/${candidate.ownerId}/post/${identity.renderObjectId}.${extension}`,
    contentType: output.mimeType,
    contentLength: output.byteSize,
    env,
    now: new Date(at),
    expiresIn: 300,
  });
  reserveDeterministicRecoveryTicket(database, {
    ownerId: candidate.ownerId,
    objectKey: privateUpload.key,
    byteSize: output.byteSize,
    storageScope: "private",
    purpose: "post",
    at,
    env,
  });
  reserveDeterministicRecoveryTicket(database, {
    ownerId: candidate.ownerId,
    objectKey: publicUpload.key,
    byteSize: output.byteSize,
    storageScope: "public",
    purpose: "post",
    at,
    env,
  });
  for (const upload of [privateUpload, publicUpload]) {
    let response;
    try {
      response = await fetchImpl(upload.uploadUrl, {
        method: "PUT",
        redirect: "error",
        headers: { ...upload.requiredHeaders, "Content-Length": String(output.byteSize) },
        body: output.bytes,
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(12_000)]) : AbortSignal.timeout(12_000),
      });
    } catch (error) {
      throw new ApiError(503, "Recovered photo storage is temporarily unavailable.", "MEDIA_STORAGE_UNAVAILABLE", error);
    }
    if (!response || !((response.status >= 200 && response.status < 300) || response.status === 412)) {
      throw new ApiError(503, "Recovered photo storage is temporarily unavailable.", "MEDIA_STORAGE_UNAVAILABLE");
    }
  }
  const expected = { byteSize: output.byteSize, mimeType: output.mimeType, sha256: output.sha256 };
  const privateStored = await verifyStoredDigest(privateUpload.key, expected, {
    env, fetchImpl, signal, storageScope: "private",
  });
  const publicStored = await verifyStoredDigest(publicUpload.key, expected, {
    env, fetchImpl, signal, storageScope: "public",
  });
  return { privateUpload, publicUpload, privateStored, publicStored };
}

function recoveryRows(database) {
  return database.prepare(`SELECT p.id post_id,p.user_id owner_id,p.photos,j.key position,j.value source_url,
      pm.asset_id,a.kind asset_kind,a.status asset_status,a.render_state,a.source_key,a.source_url asset_source_url,
      a.source_storage_scope,a.byte_size asset_source_byte_size,a.render_variant_id,
      rv.id variant_id,rv.object_key variant_key,rv.public_url variant_url,rv.byte_size variant_byte_size,
      rv.status variant_status,rv.verification_origin,
      source_ledger.status source_ledger_status,
      render_ledger.storage_scope render_ledger_scope,render_ledger.status render_ledger_status
    FROM posts p
    JOIN json_each(CASE WHEN json_valid(p.photos) THEN p.photos ELSE '[]' END) j
    LEFT JOIN post_media pm ON pm.post_id=p.id AND pm.position=CAST(j.key AS INTEGER)
    LEFT JOIN media_assets a ON a.id=pm.asset_id
    LEFT JOIN media_variants rv ON rv.id=a.render_variant_id AND rv.asset_id=a.id AND rv.role='render'
    LEFT JOIN media_objects source_ledger
      ON source_ledger.owner_id=a.owner_id AND source_ledger.object_key=a.source_key
    LEFT JOIN media_objects render_ledger
      ON render_ledger.owner_id=a.owner_id AND render_ledger.object_key=rv.object_key
    WHERE p.removed=0 AND j.type='text'
    ORDER BY p.created_at,p.id,CAST(j.key AS INTEGER)`).iterate();
}

export function legacyPostImageRecoveryCandidates(database, {
  env = process.env,
  limit = MAX_RECOVERY_BATCH,
  at = Date.now(),
  ignoreRetry = false,
} = {}) {
  const bounded = Math.max(1, Math.min(MAX_RECOVERY_BATCH, Math.trunc(Number(limit) || MAX_RECOVERY_BATCH)));
  const retries = retryState.get(database) || new Map();
  retryState.set(database, retries);
  const candidates = [];
  for (const row of recoveryRows(database)) {
    const position = Number(row.position);
    const sourceUrl = String(row.source_url || "");
    const ownerId = String(row.owner_id || "");
    const sourceKey = trustedOwnedMediaKey(sourceUrl, { ownerId, env });
    if (!Number.isSafeInteger(position) || position < 0 || position >= MEDIA_POST_MAX_ATTACHMENTS || !sourceKey || !IMAGE_EXT.test(sourceKey)) continue;
    const liveLedger = (status) => status === "issued" || status === "associated";
    const alreadyPublishable = row.asset_id && row.asset_kind === "image"
      && row.asset_status === "ready" && liveLedger(row.source_ledger_status)
      && row.render_state === "ready" && row.variant_status === "verified"
      && row.verification_origin === "private_derivative_v1"
      && row.render_ledger_scope === "public" && liveLedger(row.render_ledger_status)
      && typeof row.variant_url === "string" && row.variant_url.length > 0;
    if (alreadyPublishable) continue;
    const retryKey = `${row.post_id}\0${position}\0${sourceUrl}`;
    if (!ignoreRetry && Number(retries.get(retryKey)?.nextAt || 0) > at) continue;
    candidates.push({
      postId: row.post_id,
      ownerId,
      position,
      sourceUrl,
      sourceKey,
      assetId: row.asset_id || null,
      assetKind: row.asset_kind || null,
      assetStatus: row.asset_status || null,
      assetSourceKey: row.source_key || null,
      assetSourceUrl: row.asset_source_url || null,
      assetSourceStorageScope: row.source_storage_scope || null,
      assetSourceByteSize: Number(row.asset_source_byte_size) || null,
      variantId: row.variant_id || row.render_variant_id || null,
      variantKey: row.variant_key || null,
      variantUrl: row.variant_url || null,
      variantByteSize: Number(row.variant_byte_size) || null,
      retryKey,
    });
    if (candidates.length >= bounded) break;
  }
  return candidates;
}

function profileRecoveryRows(database) {
  return database.prepare(`SELECT reference,owner_id,artist_key,source_url,sort_at FROM (
      SELECT 'user.avatar' reference,u.id owner_id,NULL artist_key,u.avatar_uri source_url,u.created_at sort_at
        FROM users u WHERE u.avatar_uri IS NOT NULL AND u.avatar_uri<>''
      UNION ALL
      SELECT 'user.banner',u.id,NULL,u.banner,u.created_at
        FROM users u WHERE u.banner IS NOT NULL AND u.banner<>''
      UNION ALL
      SELECT 'artist_profile.avatar',a.owner_id,a.artist_key,a.avatar_uri,COALESCE(a.updated_at,0)
        FROM artist_profiles a WHERE a.owner_id IS NOT NULL AND a.avatar_uri IS NOT NULL AND a.avatar_uri<>''
      UNION ALL
      SELECT 'artist_profile.banner',a.owner_id,a.artist_key,a.banner,COALESCE(a.updated_at,0)
        FROM artist_profiles a WHERE a.owner_id IS NOT NULL AND a.banner IS NOT NULL AND a.banner<>''
    ) ORDER BY sort_at,owner_id,reference,COALESCE(artist_key,'')`).iterate();
}

export function legacyProfileImageRecoveryCandidates(database, {
  env = process.env,
  limit = MAX_RECOVERY_BATCH,
  at = Date.now(),
  ignoreRetry = false,
} = {}) {
  ensureLegacyMediaFinalizeSchema(database);
  const bounded = Math.max(1, Math.min(MAX_RECOVERY_BATCH, Math.trunc(Number(limit) || MAX_RECOVERY_BATCH)));
  const retries = retryState.get(database) || new Map();
  retryState.set(database, retries);
  const grouped = new Map();
  for (const row of profileRecoveryRows(database)) {
    const reference = String(row.reference || "");
    const target = PROFILE_REFERENCE[reference];
    const ownerId = String(row.owner_id || "");
    const sourceUrl = String(row.source_url || "");
    const sourceKey = trustedOwnedMediaKey(sourceUrl, { ownerId, env });
    if (!target || !sourceKey || sourceKey.split("/")[2] !== target.purpose || !IMAGE_EXT.test(sourceKey)) continue;
    const retryKey = `profile\0${ownerId}\0${target.purpose}\0${sourceUrl}`;
    if (!ignoreRetry && Number(retries.get(retryKey)?.nextAt || 0) > at) continue;
    const groupKey = `${ownerId}\0${target.purpose}\0${sourceUrl}`;
    let candidate = grouped.get(groupKey);
    if (!candidate) {
      if (grouped.size >= bounded) continue;
      if (verifiedFinalizedLegacyMedia(database, {
        ownerId,
        publicUrl: sourceUrl,
        purpose: target.purpose,
      })) continue;
      candidate = {
        ownerId,
        purpose: target.purpose,
        sourceUrl,
        sourceKey,
        references: [],
        retryKey,
      };
      grouped.set(groupKey, candidate);
    }
    const exactReference = {
      reference,
      artistKey: reference.startsWith("artist_profile.") ? String(row.artist_key || "") : null,
    };
    if (!candidate.references.some((item) => item.reference === exactReference.reference
        && item.artistKey === exactReference.artistKey)) {
      candidate.references.push(exactReference);
    }
  }
  return [...grouped.values()];
}

function updatePhotoSlot(database, candidate, safeUrl, at) {
  const post = database.prepare("SELECT id,user_id,photos,removed FROM posts WHERE id=?").get(candidate.postId);
  const photos = parsePhotos(post?.photos);
  if (!post || post.removed || post.user_id !== candidate.ownerId
      || photos[candidate.position] !== candidate.sourceUrl) {
    throw new ApiError(409, "The historical post changed during photo recovery.", "CONFLICT");
  }
  photos[candidate.position] = safeUrl;
  database.prepare("UPDATE posts SET photos=?,updated_at=? WHERE id=? AND user_id=?")
    .run(JSON.stringify(photos), at, candidate.postId, candidate.ownerId);
}

function associateObject(database, ownerId, key, at) {
  const changed = Number(database.prepare(`UPDATE media_objects SET status='associated',
      associated_at=COALESCE(associated_at,?),updated_at=?
    WHERE owner_id=? AND object_key=? AND status IN ('issued','associated')`)
    .run(at, at, ownerId, key).changes || 0);
  if (changed !== 1) throw new ApiError(409, "Recovered photo storage changed before publication.", "CONFLICT");
}

function migrateReactions(database, candidate, safeUrl) {
  database.prepare(`INSERT OR IGNORE INTO media_reactions (media_url,user_id,post_id,created_at)
    SELECT ?,user_id,post_id,created_at FROM media_reactions WHERE media_url=? AND post_id=?`)
    .run(safeUrl, candidate.sourceUrl, candidate.postId);
  database.prepare("DELETE FROM media_reactions WHERE media_url=? AND post_id=?")
    .run(candidate.sourceUrl, candidate.postId);
}

function canonicalPublicObjectUrl(objectKey, env) {
  const config = getMediaConfig(env);
  if (!config.configured || !trustedMediaQueueKey(objectKey, objectKey.split("/")[1])) return null;
  const encode = (value) => encodeURIComponent(value).replace(/[!'()*]/gu,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  const prefix = config.publicBase.pathname.replace(/\/+$/, "");
  return `${config.publicBase.origin}${prefix}/${objectKey.split("/").map(encode).join("/")}`;
}

function stableMediaKeyStillReferenced(database, ownerId, objectKey) {
  return !!database.prepare(`SELECT 1 FROM (
      SELECT source_key object_key FROM media_assets WHERE owner_id=?
      UNION ALL SELECT v.object_key FROM media_variants v JOIN media_assets a ON a.id=v.asset_id WHERE a.owner_id=?
      UNION ALL SELECT r.object_key FROM media_asset_revisions r JOIN media_assets a ON a.id=r.asset_id WHERE a.owner_id=?
      UNION ALL SELECT poster_key object_key FROM legacy_video_posters WHERE owner_id=?
    ) WHERE object_key=? LIMIT 1`).get(ownerId, ownerId, ownerId, ownerId, objectKey);
}

function exactMediaUrlStillReferenced(database, ownerId, url) {
  return !!database.prepare(`SELECT 1 FROM (
      SELECT avatar_uri value FROM users WHERE id=?
      UNION ALL SELECT banner FROM users WHERE id=?
      UNION ALL SELECT avatar_uri FROM artist_profiles WHERE owner_id=?
      UNION ALL SELECT banner FROM artist_profiles WHERE owner_id=?
      UNION ALL SELECT j.value FROM posts p, json_each(CASE WHEN json_valid(p.photos) THEN p.photos ELSE '[]' END) j
        WHERE p.user_id=?
      UNION ALL SELECT j.value FROM venue_reviews r,
        json_each(CASE WHEN json_valid(r.photos) THEN r.photos ELSE '[]' END) j WHERE r.user_id=?
      UNION ALL SELECT source_url FROM media_assets WHERE owner_id=?
      UNION ALL SELECT v.public_url FROM media_variants v JOIN media_assets a ON a.id=v.asset_id WHERE a.owner_id=?
      UNION ALL SELECT poster_url FROM legacy_video_posters WHERE owner_id=?
    ) WHERE value=? LIMIT 1`).get(ownerId, ownerId, ownerId, ownerId, ownerId, ownerId,
    ownerId, ownerId, ownerId, url);
}

function retireReplacedMediaObjects(database, candidate, {
  pendingRevisionKey,
  recoveredPrivateKey,
  recoveredPublicKey,
  at,
  env,
}) {
  const intended = new Map();
  const capture = (rawKey, storageScope, byteSize, verified = false, actualUrl = null) => {
    const key = trustedMediaQueueKey(rawKey, candidate.ownerId);
    if (!key || key === recoveredPrivateKey || key === recoveredPublicKey) return;
    const previous = intended.get(key);
    const urls = new Set(previous?.urls || []);
    if (typeof actualUrl === "string" && actualUrl) urls.add(actualUrl);
    const incomingBytes = Number.isSafeInteger(Number(byteSize)) && Number(byteSize) > 0
      ? Number(byteSize)
      : null;
    const keepVerified = !!previous?.verified && !verified;
    intended.set(key, {
      key,
      // A strong-ETag HEAD/If-Match read outranks client-authored legacy hints
      // when the same raw key also happens to be the linked rendition key.
      storageScope: keepVerified ? previous.storageScope : storageScope || previous?.storageScope || null,
      byteSize: keepVerified ? previous.byteSize : incomingBytes || previous?.byteSize || null,
      verified: verified || !!previous?.verified,
      urls,
    });
  };
  capture(candidate.sourceKey, "public", candidate.sourceByteSize, true, candidate.sourceUrl);
  capture(candidate.assetSourceKey, candidate.assetSourceStorageScope, candidate.assetSourceByteSize,
    false, candidate.assetSourceUrl);
  capture(candidate.variantKey, "public", candidate.variantByteSize, false, candidate.variantUrl);
  capture(pendingRevisionKey, null, null);

  const queueable = [];
  for (const item of intended.values()) {
    let ledger = database.prepare(`SELECT owner_id,storage_scope,purpose,byte_size,status
      FROM media_objects WHERE object_key=?`).get(item.key);
    if (!ledger && item.storageScope && item.byteSize) {
      recordMediaObjectTicket(database, {
        ownerId: candidate.ownerId,
        objectKey: item.key,
        storageScope: item.storageScope,
        byteSize: item.byteSize,
        at,
        expiresAt: null,
      });
      ledger = database.prepare(`SELECT owner_id,storage_scope,purpose,byte_size,status
        FROM media_objects WHERE object_key=?`).get(item.key);
    }
    if (!ledger) continue;
    if (item.verified && Number(ledger.byte_size) === 0
        && ledger.owner_id === candidate.ownerId && ledger.purpose === "post"
        && ledger.storage_scope === item.storageScope
        && new Set(["issued", "associated"]).has(ledger.status)) {
      database.prepare(`UPDATE media_objects SET byte_size=?,updated_at=?
        WHERE owner_id=? AND object_key=? AND byte_size=0 AND status IN ('issued','associated')`)
        .run(item.byteSize, at, candidate.ownerId, item.key);
      ledger = database.prepare(`SELECT owner_id,storage_scope,purpose,byte_size,status
        FROM media_objects WHERE object_key=?`).get(item.key);
    }
    if (ledger.owner_id !== candidate.ownerId || ledger.purpose !== "post"
        || (item.storageScope && ledger.storage_scope !== item.storageScope)
        || (item.verified && Number(ledger.byte_size) !== Number(item.byteSize))) {
      throw new ApiError(409, "Historical photo retirement metadata changed.", "CONFLICT");
    }
    if (stableMediaKeyStillReferenced(database, candidate.ownerId, item.key)) continue;
    if (ledger.storage_scope === "public") {
      const publicUrl = canonicalPublicObjectUrl(item.key, env);
      if (!publicUrl) continue;
      item.urls.add(publicUrl);
      if ([...item.urls].some((url) => exactMediaUrlStillReferenced(database, candidate.ownerId, url))) continue;
    }
    queueable.push(item.key);
  }
  if (!queueable.length) return 0;
  const queued = enqueueOwnedMediaKeys(database, {
    ownerId: candidate.ownerId,
    keys: queueable,
    at,
  });
  if (queued.accepted !== queueable.length) {
    throw new ApiError(409, "Historical photo objects could not all be retired.", "CONFLICT");
  }
  return queueable.length;
}

function commitRecovery(database, candidate, output, identity, staged, { at, env }) {
  return withWrite(database, () => {
    let pendingRevisionKey = null;
    const currentLink = database.prepare("SELECT asset_id FROM post_media WHERE post_id=? AND position=?")
      .get(candidate.postId, candidate.position);
    if (candidate.assetId) {
      if (currentLink?.asset_id !== candidate.assetId) {
        throw new ApiError(409, "The historical media link changed during recovery.", "CONFLICT");
      }
      const asset = database.prepare("SELECT * FROM media_assets WHERE id=? AND owner_id=?")
        .get(candidate.assetId, candidate.ownerId);
      if (!asset || asset.kind !== "image") {
        throw new ApiError(409, "The historical media item changed during recovery.", "CONFLICT");
      }
      const variantId = candidate.variantId || identity.variantId;
      const pendingRevision = database.prepare("SELECT object_key FROM media_asset_revisions WHERE asset_id=?")
        .get(candidate.assetId);
      const existingVariant = database.prepare("SELECT * FROM media_variants WHERE asset_id=? AND role='render'")
        .get(candidate.assetId);
      if (existingVariant && existingVariant.id !== variantId) {
        throw new ApiError(409, "The historical photo rendition changed during recovery.", "CONFLICT");
      }
      if (existingVariant) {
        database.prepare(`UPDATE media_variants SET client_variant_id=?,create_hash=?,object_key=?,public_url=?,
          mime_type=?,byte_size=?,width=?,height=?,time_ms=NULL,status='verified',finalize_hash=?,verified_at=?,
          verification_origin='private_derivative_v1',updated_at=? WHERE id=? AND asset_id=?`)
          .run(`legacy-recovery:${identity.identity.slice(0, 48)}`, identity.identity, staged.publicUpload.key,
            staged.publicUpload.publicUrl, output.mimeType, output.byteSize, output.width, output.height,
            output.sha256, at, at, existingVariant.id, candidate.assetId);
      } else {
        database.prepare(`INSERT INTO media_variants
          (id,asset_id,client_variant_id,create_hash,role,object_key,public_url,mime_type,byte_size,width,height,
           status,finalize_hash,verified_at,verification_origin,created_at,updated_at)
          VALUES (?,?,?,?,'render',?,?,?,?,?,?,'verified',?,?,'private_derivative_v1',?,?)`)
          .run(variantId, candidate.assetId, `legacy-recovery:${identity.identity.slice(0, 48)}`,
            identity.identity, staged.publicUpload.key, staged.publicUpload.publicUrl, output.mimeType,
            output.byteSize, output.width, output.height, output.sha256, at, at, at);
      }
      database.prepare(`UPDATE media_assets SET source_key=?,source_url=?,source_storage_scope='private',
        original_name=?,mime_type=?,byte_size=?,width=?,height=?,orientation=0,metadata_status='declared',
        codec_status='not_applicable',status='ready',edit_recipe='{}',recipe_version=1,finalize_hash=?,
        source_verified_at=?,source_etag=?,render_state='ready',
        render_variant_id=?,updated_at=? WHERE id=? AND owner_id=?`)
        .run(staged.privateUpload.key, staged.privateUpload.storageLocator, `recovered.${OUTPUT_EXTENSION[output.mimeType]}`,
          output.mimeType, output.byteSize, output.width, output.height, identity.identity, at,
          staged.privateStored.etag, existingVariant?.id || variantId, at, candidate.assetId, candidate.ownerId);
      database.prepare("DELETE FROM media_asset_revisions WHERE asset_id=?").run(candidate.assetId);
      pendingRevisionKey = pendingRevision?.object_key || null;
    } else {
      if (currentLink) {
        throw new ApiError(409, "The historical post gained a media link during recovery.", "CONFLICT");
      }
      database.prepare(`INSERT INTO media_assets
        (id,owner_id,client_asset_id,create_hash,purpose,kind,source_key,source_url,source_storage_scope,
         original_name,mime_type,byte_size,width,height,orientation,metadata_status,codec_status,status,
         edit_recipe,finalize_hash,source_verified_at,source_etag,render_state,render_variant_id,created_at,updated_at)
        VALUES (?,?,?,?, 'post','image',?,?,'private',?,?,?,?,?,0,'declared','not_applicable','ready','{}',?,?,?,'ready',?,?,?)`)
        .run(identity.assetId, candidate.ownerId, `legacy-recovery:${identity.identity.slice(0, 48)}`,
          identity.identity, staged.privateUpload.key, staged.privateUpload.storageLocator,
          `recovered.${OUTPUT_EXTENSION[output.mimeType]}`, output.mimeType, output.byteSize, output.width,
          output.height, identity.identity, at, staged.privateStored.etag, identity.variantId, at, at);
      database.prepare(`INSERT INTO media_variants
        (id,asset_id,client_variant_id,create_hash,role,object_key,public_url,mime_type,byte_size,width,height,
         status,finalize_hash,verified_at,verification_origin,created_at,updated_at)
        VALUES (?,?,?,?,'render',?,?,?,?,?,?,'verified',?,?,'private_derivative_v1',?,?)`)
        .run(identity.variantId, identity.assetId, `legacy-recovery:${identity.identity.slice(0, 48)}`,
          identity.identity, staged.publicUpload.key, staged.publicUpload.publicUrl, output.mimeType,
          output.byteSize, output.width, output.height, output.sha256, at, at, at);
      database.prepare("INSERT INTO post_media (post_id,asset_id,position,created_at) VALUES (?,?,?,?)")
        .run(candidate.postId, identity.assetId, candidate.position, at);
    }
    updatePhotoSlot(database, candidate, staged.publicUpload.publicUrl, at);
    migrateReactions(database, candidate, staged.publicUpload.publicUrl);
    associateObject(database, candidate.ownerId, staged.privateUpload.key, at);
    associateObject(database, candidate.ownerId, staged.publicUpload.key, at);
    const retired = retireReplacedMediaObjects(database, candidate, {
      pendingRevisionKey,
      recoveredPrivateKey: staged.privateUpload.key,
      recoveredPublicKey: staged.publicUpload.key,
      at,
      env,
    });
    return {
      postId: candidate.postId,
      position: candidate.position,
      assetId: candidate.assetId || identity.assetId,
      url: staged.publicUpload.publicUrl,
      retired,
    };
  });
}

export async function recoverLegacyPostImage(database, candidate, {
  env = process.env,
  fetchImpl = globalThis.fetch,
  imageProcessor = sanitizeDecodedImage,
  signal,
  at = Date.now(),
} = {}) {
  if (!database?.prepare || !candidate || typeof fetchImpl !== "function" || typeof imageProcessor !== "function") {
    throw new ApiError(400, "Historical photo recovery input is invalid.", "VALIDATION_FAILED");
  }
  const verifiedKey = trustedOwnedMediaKey(candidate.sourceUrl, { ownerId: candidate.ownerId, env });
  if (!verifiedKey || verifiedKey !== candidate.sourceKey || !IMAGE_EXT.test(verifiedKey)) {
    throw new ApiError(409, "Historical photo ownership could not be verified.", "CONFLICT");
  }
  let staged = null;
  try {
    const source = await headStoredObject(verifiedKey, { env, fetchImpl, signal, storageScope: "public" });
    candidate.sourceByteSize = source.byteSize;
    const bytes = await downloadStoredObject(verifiedKey, source, { env, fetchImpl, signal, storageScope: "public" });
    const outputType = OUTPUT_TYPE[source.mimeType];
    const sanitized = await imageProcessor(bytes, {
      expectedType: source.mimeType,
      outputType,
      timeoutMs: LEGACY_IMAGE_RECOVERY_TIMEOUT_MS,
      allowHeicFallback: true,
      allowLegacyJpegTrailer: true,
    });
    const output = {
      bytes: Buffer.from(sanitized?.bytes || []),
      byteSize: Number(sanitized?.byteSize),
      mimeType: cleanType(sanitized?.mimeType),
      width: Number(sanitized?.width),
      height: Number(sanitized?.height),
    };
    if (!OUTPUT_EXTENSION[output.mimeType] || output.bytes.length !== output.byteSize
        || !Number.isSafeInteger(output.byteSize) || output.byteSize < 1 || output.byteSize > MAX_SOURCE_BYTES
        || !Number.isSafeInteger(output.width) || output.width < 1
        || !Number.isSafeInteger(output.height) || output.height < 1) {
      throw new ApiError(415, "The historical photo could not be sanitized.", "MEDIA_TYPE_UNSUPPORTED");
    }
    output.sha256 = sha256(output.bytes);
    const identity = deterministicIdentity(candidate, output.sha256);
    staged = await stageOutput(database, candidate, output, identity, { env, fetchImpl, signal, at });
    return commitRecovery(database, candidate, output, identity, staged, { at, env });
  } catch (error) {
    // Deterministic create-only objects intentionally remain in the issued
    // ledger until the next bounded retry. The ordinary stale-upload sweep
    // retires them if recovery never commits; queueing here would make the same
    // deterministic generation impossible to retry safely.
    throw error;
  }
}

function profileRecoveryIdentity(candidate, stored) {
  return sha256(`${candidate.ownerId}\0${candidate.purpose}\0${candidate.sourceKey}\0${stored.etag}\0${stored.byteSize}`);
}

async function stageProfilePrivateSource(database, candidate, stored, bytes, identity, {
  env,
  fetchImpl,
  signal,
  at,
}) {
  const extension = candidate.sourceKey.split(".").pop()?.toLowerCase() || "jpg";
  const upload = createMediaPresign({
    userId: candidate.ownerId,
    body: {
      purpose: candidate.purpose,
      contentType: stored.mimeType,
      fileSize: stored.byteSize,
      name: `historical.${extension}`,
    },
    env,
    now: new Date(at),
    objectId: `lpr_${identity.slice(0, 48)}_raw`,
    storageScope: "private",
  });
  reserveDeterministicRecoveryTicket(database, {
    ownerId: candidate.ownerId,
    objectKey: upload.key,
    storageScope: "private",
    purpose: candidate.purpose,
    byteSize: stored.byteSize,
    at,
    env,
  });
  let response;
  try {
    response = await fetchImpl(upload.uploadUrl, {
      method: "PUT",
      redirect: "error",
      headers: { ...upload.requiredHeaders, "Content-Length": String(stored.byteSize) },
      body: bytes,
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(12_000)]) : AbortSignal.timeout(12_000),
    });
  } catch (error) {
    throw new ApiError(503, "Recovered profile photo storage is temporarily unavailable.", "MEDIA_STORAGE_UNAVAILABLE", error);
  }
  if (!response || !((response.status >= 200 && response.status < 300) || response.status === 412)) {
    throw new ApiError(503, "Recovered profile photo storage is temporarily unavailable.", "MEDIA_STORAGE_UNAVAILABLE");
  }
  await verifyStoredDigest(upload.key, {
    byteSize: stored.byteSize,
    mimeType: stored.mimeType,
    sha256: sha256(bytes),
  }, {
    env,
    fetchImpl,
    signal,
    storageScope: "private",
  });
  return upload;
}

export async function recoverLegacyProfileImage(database, candidate, {
  env = process.env,
  fetchImpl = globalThis.fetch,
  imageProcessor = sanitizeDecodedImage,
  signal,
  at = Date.now(),
} = {}) {
  if (!database?.prepare || !candidate || typeof fetchImpl !== "function"
      || (typeof imageProcessor !== "function" && typeof imageProcessor?.sanitize !== "function")) {
    throw new ApiError(400, "Historical profile photo recovery input is invalid.", "VALIDATION_FAILED");
  }
  const verifiedKey = trustedOwnedMediaKey(candidate.sourceUrl, { ownerId: candidate.ownerId, env });
  if (!verifiedKey || verifiedKey !== candidate.sourceKey
      || verifiedKey.split("/")[2] !== candidate.purpose || !IMAGE_EXT.test(verifiedKey)) {
    throw new ApiError(409, "Historical profile photo ownership could not be verified.", "CONFLICT");
  }
  const source = await headStoredObject(verifiedKey, {
    env,
    fetchImpl,
    signal,
    storageScope: "public",
  });
  const bytes = await downloadStoredObject(verifiedKey, source, {
    env,
    fetchImpl,
    signal,
    storageScope: "public",
  });
  const identity = profileRecoveryIdentity(candidate, source);
  const privateUpload = await stageProfilePrivateSource(database, candidate, source, bytes, identity, {
    env,
    fetchImpl,
    signal,
    at,
  });
  const { sanitized } = await sanitizePrivateImageStaging(database, {
    ownerId: candidate.ownerId,
    objectKey: privateUpload.key,
    expectedBytes: source.byteSize,
    expectedType: source.mimeType,
    outputType: OUTPUT_TYPE[source.mimeType],
    env,
    fetchImpl,
    imageProcessor: typeof imageProcessor === "function" ? { sanitize: imageProcessor } : imageProcessor,
    imageTimeoutMs: LEGACY_IMAGE_RECOVERY_TIMEOUT_MS,
    allowHeicFallback: true,
    allowLegacyJpegTrailer: true,
    signal,
  });
  const delivery = await stageSanitizedPublicImage(database, {
    ownerId: candidate.ownerId,
    purpose: candidate.purpose,
    publicIdentity: `lpr_${identity.slice(0, 48)}`,
    stagingKey: privateUpload.key,
    sourceBinding: { objectKey: candidate.sourceKey, etag: source.etag },
    output: sanitized,
    env,
    at,
    fetchImpl,
    signal,
    serverRecovery: true,
  });
  const repaired = [];
  for (const target of candidate.references) {
    repaired.push(recoverProfileImageReference(database, {
      ownerId: candidate.ownerId,
      reference: target.reference,
      artistKey: target.artistKey,
      expectedCurrentUrl: candidate.sourceUrl,
      sourceByteSize: source.byteSize,
      sourceEtag: source.etag,
      delivery,
      env,
      at,
    }));
  }
  if (!repaired.length) {
    throw new ApiError(409, "Historical profile photo references changed before recovery.", "CONFLICT");
  }
  return {
    purpose: candidate.purpose,
    references: repaired.length,
    publicUrl: delivery.publicUrl,
    sourceRetired: repaired.some((item) => item.sourceRetired),
  };
}

export async function recoverLegacyPostImages(database, options = {}) {
  const active = activeRuns.get(database);
  if (active) return active;
  const promise = (async () => {
    const at = Number(options.at) || Date.now();
    const candidates = legacyPostImageRecoveryCandidates(database, { ...options, at });
    const recovered = [];
    const failed = [];
    const retries = retryState.get(database) || new Map();
    retryState.set(database, retries);
    for (const candidate of candidates) {
      if (options.signal?.aborted) break;
      try {
        recovered.push(await recoverLegacyPostImage(database, candidate, { ...options, at }));
        retries.delete(candidate.retryKey);
      } catch (error) {
        const attempt = Math.min(5, Number(retries.get(candidate.retryKey)?.attempt || 0) + 1);
        retries.set(candidate.retryKey, { attempt, nextAt: at + RETRY_BASE_MS * (2 ** (attempt - 1)) });
        failed.push({ postId: candidate.postId, position: candidate.position, code: String(error?.code || "recovery_failed") });
      }
    }
    return { scanned: candidates.length, recovered, failed };
  })();
  activeRuns.set(database, promise);
  try { return await promise; }
  finally {
    if (activeRuns.get(database) === promise) activeRuns.delete(database);
  }
}

// Release/operations entry point: drain successful work immediately instead of
// making a small historical collection wait one scheduler interval per batch.
// Failed entries enter the per-item backoff above, so a bad object cannot turn
// this loop into a hot retry or block healthy photos behind it.
export async function drainLegacyPostImageRecovery(database, {
  maxItems = 32,
  ...options
} = {}) {
  const boundedMax = Math.max(1, Math.min(64, Math.trunc(Number(maxItems) || 32)));
  const recovered = [];
  const failed = [];
  let scanned = 0;
  while (scanned < boundedMax && !options.signal?.aborted) {
    const remaining = boundedMax - scanned;
    const result = await recoverLegacyPostImages(database, {
      ...options,
      at: Date.now(),
      limit: Math.min(MAX_RECOVERY_BATCH, remaining),
    });
    scanned += result.scanned;
    recovered.push(...result.recovered);
    failed.push(...result.failed);
    // Failed identities are now backoff-filtered, so continue immediately to
    // healthy rows behind them. The next pass returns zero if nothing remains.
    if (!result.scanned) break;
  }
  return { scanned, recovered, failed };
}

function deferRecoveryCandidate(database, candidate, at) {
  const retries = retryState.get(database) || new Map();
  retryState.set(database, retries);
  const attempt = Math.min(5, Number(retries.get(candidate.retryKey)?.attempt || 0) + 1);
  retries.set(candidate.retryKey, { attempt, nextAt: at + RETRY_BASE_MS * (2 ** (attempt - 1)) });
}

function clearRecoveryCandidateRetry(database, candidate) {
  retryState.get(database)?.delete(candidate.retryKey);
}

// Explicit release/operations drain. Post and profile sources are alternated,
// processed serially through the isolated image worker, and share one hard cap.
// `exhausted` is computed with retry backoff disabled so the CLI cannot mistake
// a deferred failure for an empty candidate set.
export async function drainLegacyImageRecovery(database, {
  maxItems = 32,
  ...options
} = {}) {
  const active = aggregateRuns.get(database);
  if (active) return active;
  const promise = (async () => {
    const boundedMax = Math.max(1, Math.min(64, Math.trunc(Number(maxItems) || 32)));
    const recovered = [];
    const failed = [];
    const posts = { scanned: 0, recovered: 0, failed: 0 };
    const profiles = { scanned: 0, recovered: 0, failed: 0 };
    let scanned = 0;
    let nextKind = "post";
    while (scanned < boundedMax && !options.signal?.aborted) {
      const at = Date.now();
      const order = nextKind === "post" ? ["post", "profile"] : ["profile", "post"];
      let selected = null;
      for (const kind of order) {
        const candidates = kind === "post"
          ? legacyPostImageRecoveryCandidates(database, { ...options, at, limit: 1 })
          : legacyProfileImageRecoveryCandidates(database, { ...options, at, limit: 1 });
        if (candidates.length) {
          selected = { kind, candidate: candidates[0], at };
          break;
        }
      }
      if (!selected) break;
      scanned += 1;
      const bucket = selected.kind === "post" ? posts : profiles;
      bucket.scanned += 1;
      try {
        const result = selected.kind === "post"
          ? await recoverLegacyPostImage(database, selected.candidate, { ...options, at: selected.at })
          : await recoverLegacyProfileImage(database, selected.candidate, { ...options, at: selected.at });
        clearRecoveryCandidateRetry(database, selected.candidate);
        bucket.recovered += 1;
        recovered.push({ kind: selected.kind, result });
      } catch (error) {
        deferRecoveryCandidate(database, selected.candidate, selected.at);
        bucket.failed += 1;
        failed.push({ kind: selected.kind, code: String(error?.code || "recovery_failed") });
      }
      nextKind = selected.kind === "post" ? "profile" : "post";
    }
    const proofAt = Date.now();
    const postPending = legacyPostImageRecoveryCandidates(database, {
      ...options,
      at: proofAt,
      limit: 1,
      ignoreRetry: true,
    }).length > 0;
    const profilePending = legacyProfileImageRecoveryCandidates(database, {
      ...options,
      at: proofAt,
      limit: 1,
      ignoreRetry: true,
    }).length > 0;
    const exhausted = !postPending && !profilePending;
    return {
      scanned,
      recovered,
      failed,
      posts,
      profiles,
      exhausted,
      limitReached: scanned >= boundedMax && !exhausted,
    };
  })();
  aggregateRuns.set(database, promise);
  try { return await promise; }
  finally {
    if (aggregateRuns.get(database) === promise) aggregateRuns.delete(database);
  }
}

const RECOVERY_DISABLED_VALUES = new Set(["0", "false", "no", "off", "disabled"]);

export function legacyImageRecoveryEnabled(env = process.env) {
  return !RECOVERY_DISABLED_VALUES.has(String(env?.MEDIA_LEGACY_RECOVERY_ENABLED || "").trim().toLowerCase());
}
const recoverySchedulers = new WeakMap();
const recoverySchedulerHealth = new WeakMap();

function freshRecoveryHealth() {
  return {
    enabled: false,
    running: false,
    lastStartedAt: 0,
    lastFinishedAt: 0,
    lastSuccessAt: 0,
    lastErrorCode: null,
    scanned: 0,
    recovered: 0,
    failed: 0,
    exhausted: false,
    limitReached: false,
  };
}

export function legacyImageRecoveryHealth(database) {
  return { ...(recoverySchedulerHealth.get(database) || freshRecoveryHealth()) };
}

// Old URL-only photos remain private/fail-closed until this worker copies their
// exact owned generation through the same decoder/sanitizer used by new camera
// uploads. Each turn is serial and tiny; a backlog continues after a short yield
// while idle/deferred failures wait for the normal interval and per-item backoff.
export function startLegacyImageRecoveryScheduler({
  database,
  env = process.env,
  maxItems = 2,
  intervalMs = 5 * 60_000,
  continuationDelayMs = 1_000,
  initialDelayMs = 0,
  drain = drainLegacyImageRecovery,
} = {}) {
  if (!database?.prepare || typeof drain !== "function") {
    throw new TypeError("Legacy image recovery scheduler requires a database and drain function.");
  }
  const existing = recoverySchedulers.get(database);
  if (existing) return existing;
  const batchSize = Math.max(1, Math.min(8, Math.trunc(Number(maxItems) || 2)));
  const idleDelay = Math.max(1_000, Math.min(60 * 60_000, Math.trunc(Number(intervalMs) || 5 * 60_000)));
  const continuationDelay = Math.max(100, Math.min(60_000, Math.trunc(Number(continuationDelayMs) || 1_000)));
  const startupDelay = Math.max(0, Math.min(idleDelay, Math.trunc(Number(initialDelayMs) || 0)));
  const health = freshRecoveryHealth();
  health.enabled = true;
  recoverySchedulerHealth.set(database, health);

  let stopped = false;
  let timer = null;
  let active = null;
  let controller = null;

  const runResult = (status, value = null, errorCode = null) => Object.freeze({
    status,
    value,
    errorCode,
  });

  const schedule = (delay) => {
    if (stopped || timer) return;
    timer = setTimeout(() => {
      timer = null;
      void run(true);
    }, delay);
    timer.unref?.();
  };

  const run = async (reschedule = false) => {
    if (stopped) return runResult("stopped");
    if (active) return active;
    controller = new AbortController();
    health.running = true;
    health.lastStartedAt = Date.now();
    active = (async () => {
      try {
        const result = await drain(database, {
          env,
          maxItems: batchSize,
          signal: controller.signal,
        });
        health.scanned += Number(result?.scanned) || 0;
        health.recovered += Array.isArray(result?.recovered) ? result.recovered.length : 0;
        health.failed += Array.isArray(result?.failed) ? result.failed.length : 0;
        health.exhausted = result?.exhausted === true;
        health.backlog = result?.exhausted === true ? false : true;
        health.limitReached = result?.limitReached === true;
        health.lastErrorCode = null;
        health.lastSuccessAt = Date.now();
        return runResult("completed", result);
      } catch (error) {
        const errorCode = String(error?.code || "recovery_failed").slice(0, 64);
        health.lastErrorCode = errorCode;
        return runResult("failed", null, errorCode);
      } finally {
        health.running = false;
        health.lastFinishedAt = Date.now();
        active = null;
        controller = null;
        if (reschedule && !stopped) schedule(health.limitReached ? continuationDelay : idleDelay);
      }
    })();
    return active;
  };

  const handle = Object.freeze({
    runOnce: () => run(false),
    stop: async () => {
      if (stopped) return;
      stopped = true;
      health.enabled = false;
      if (timer) clearTimeout(timer);
      timer = null;
      controller?.abort();
      try { await active; } catch { /* drain errors are reflected in health */ }
      recoverySchedulers.delete(database);
    },
  });
  recoverySchedulers.set(database, handle);
  schedule(startupDelay);
  return handle;
}
