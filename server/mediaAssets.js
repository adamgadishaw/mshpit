import { createHash, randomUUID } from "node:crypto";

import {
  mediaEditHasChanges,
  normalizeMediaEdit,
  PHOTO_MAX_EDGE,
  videoEditRequiresExport,
} from "../src/domain/mediaEdit.mjs";
import {
  MEDIA_POST_MAX_ATTACHMENTS,
  MEDIA_VIDEO_MAX_DURATION_MS,
  MEDIA_VIDEO_SOURCE_MAX_BYTES,
} from "../src/domain/mediaUploadPolicy.mjs";
import { assertSafeAuthoredText } from "./contentSafety.js";
import { withImmediateWrite as withWrite } from "./databaseTransaction.js";
import { ApiError } from "./errors.js";
import {
  IMAGE_FINALIZATION_GENERATION_TOKEN,
  IMAGE_FINALIZATION_PREFLIGHT_TOKEN,
  runImageFinalizationGeneration,
  runImageFinalizationPreflight,
} from "./imageFinalizationAdmission.js";
import { inspectImageBytes, MAX_IMAGE_EDGE } from "./imageInspection.js";
import {
  createMediaDownloadCapability,
  createMediaProcessorImageUploadCapability,
  createMediaProcessorUploadCapability,
  createMediaPresign,
  getMediaConfig,
  mediaBucketForScope,
  presignS3Request,
  validateMediaRequest,
} from "./media.js";
import {
  enqueueOwnedMediaKeys,
  MEDIA_UPLOAD_ACCOUNTING_CLASS,
  MEDIA_UPLOAD_TICKET_MS,
  reserveMediaUploadTicket,
  trustedMediaQueueKey,
} from "./mediaDeletion.js";
import { verifyMp4Compatibility } from "./mp4Probe.js";
import { sanitizeDecodedImage, validateDecodedImage, ImageProcessorError } from "./imageProcessor.js";
import { VIDEO_VERIFIER_SOURCE_CONTENT_TYPES } from "./videoVerifierProtocol.js";

const ASSET_ID = /^ma_[A-Za-z0-9_-]{8,80}$/;
const VARIANT_ID = /^mv_[A-Za-z0-9_-]{8,80}$/;
const CLIENT_ID = /^[A-Za-z0-9._:-]{8,120}$/;
// Stable linkage is implemented for posts (including concert-review posts).
// Venue-review attachments remain a legacy photo-only surface until they have
// their own foreign-key linkage table; do not mint unusable stable descriptors.
const COMPOSER_PURPOSES = new Set(["post"]);
const IMAGE_VARIANT_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const VERIFIED_VIDEO_SOURCE_TYPES = new Set(VIDEO_VERIFIER_SOURCE_CONTENT_TYPES);
const MAX_RECIPE_BYTES = 16 * 1024;
const MAX_VIDEO_DURATION_MS = MEDIA_VIDEO_MAX_DURATION_MS;
const MAX_VIDEO_DURATION_DRIFT_MS = 1_500;
const MAX_VIDEO_BYTES = MEDIA_VIDEO_SOURCE_MAX_BYTES;
const VIDEO_DELIVERY_CAPABILITY_MS = 20 * 60_000;
const MAX_POST_MEDIA = MEDIA_POST_MAX_ATTACHMENTS;
const MAX_ALT_TEXT = 1_000;
// A recovery path may need to attach a server-sanitized derivative to a legacy
// profile reference. Keep that trust claim process-local and identity-bound so
// an internal caller cannot manufacture an equivalent object from a public URL.
const sanitizedPublicImageDeliveryClaims = new WeakMap();

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  }
  return value;
}

function fingerprint(value) {
  return createHash("sha256").update(JSON.stringify(stableValue(value))).digest("hex");
}

function joinedFinalizationResult(value) {
  return value && typeof value === "object" && Object.hasOwn(value, "duplicate")
    ? { ...value, duplicate: true }
    : value;
}

function requireAdmittedStoredGeneration(stored, { expectedBytes, expectedType }) {
  if (!stored?.etag || Number(stored.byteSize) !== Number(expectedBytes)
      || stored.mimeType !== expectedType) {
    throw new ApiError(409, "That photo generation changed while it was waiting to be inspected.", "CONFLICT");
  }
  return stored;
}
function newId(prefix) {
  return `${prefix}_${randomUUID().replaceAll("-", "").slice(0, 24)}`;
}

function cleanClientId(value, label) {
  if (typeof value !== "string" || !CLIENT_ID.test(value.trim())) {
    throw new ApiError(400, `${label} is invalid.`, "VALIDATION_FAILED");
  }
  return value.trim();
}

function contentType(value) {
  return typeof value === "string" ? value.split(";", 1)[0].trim().toLowerCase() : "";
}

function parseJsonObject(value, fallback = {}) {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function assertNoObjectReferences(body) {
  for (const field of ["sourceKey", "sourceUrl", "objectKey", "publicUrl", "posterKey", "posterUrl", "url"]) {
    if (Object.prototype.hasOwnProperty.call(body || {}, field)) {
      throw new ApiError(400, "Media object locations are assigned by PIT.", "VALIDATION_FAILED");
    }
  }
}

function integer(value, { label, min, max, optional = false } = {}) {
  if (optional && (value === undefined || value === null || value === "")) return null;
  const numeric = Number(value);
  if (!Number.isSafeInteger(numeric) || numeric < min || numeric > max) {
    throw new ApiError(400, `${label} is invalid.`, "VALIDATION_FAILED");
  }
  return numeric;
}

function normalizedAltText(value) {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value !== "string") throw new ApiError(400, "Media description is invalid.", "VALIDATION_FAILED");
  const text = value.normalize("NFKC").replace(/\s+/gu, " ").trim();
  if (text.length > MAX_ALT_TEXT) {
    throw new ApiError(400, "Media description must be 1,000 characters or fewer.", "VALIDATION_FAILED");
  }
  if (text) assertSafeAuthoredText(text, { field: "media description" });
  return text;
}

function sameList(a, b) {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function storedUploadBody(row) {
  return {
    purpose: row.purpose,
    contentType: row.mime_type,
    fileSize: row.byte_size,
    name: row.original_name,
  };
}

function expectedObjectKey({ ownerId, purpose, objectId, extension }) {
  const owner = String(ownerId || "").replace(/[^A-Za-z0-9_-]/g, "");
  const safeObjectId = String(objectId || "").replace(/[^A-Za-z0-9_-]/g, "");
  if (!owner || !safeObjectId || !extension) {
    throw new ApiError(500, "Media upload could not be prepared. Try again.", "INTERNAL_ERROR");
  }
  return `users/${owner}/${purpose}/${safeObjectId}.${extension}`;
}

function reserveAndSign(database, {
  ownerId,
  body,
  objectId,
  env,
  at,
  storageScope = "public",
  accountingClass = MEDIA_UPLOAD_ACCOUNTING_CLASS.MEMBER_SOURCE,
} = {}) {
  const file = validateMediaRequest(body);
  const key = expectedObjectKey({ ownerId, purpose: file.purpose, objectId, extension: file.extension });
  reserveMediaUploadTicket(database, {
    ownerId,
    objectKey: key,
    byteSize: file.fileSize,
    at,
    expiresAt: at + MEDIA_UPLOAD_TICKET_MS,
    env,
    storageScope,
    accountingClass,
  });
  const ticket = createMediaPresign({
    userId: ownerId,
    body: file,
    env,
    now: new Date(at),
    objectId,
    storageScope,
  });
  if (ticket.key !== key || ticket.fileSize !== file.fileSize) {
    throw new ApiError(502, "Media upload could not be prepared. Try again.", "MEDIA_UPLOAD_FAILED");
  }
  return ticket;
}

function objectIdFromKey(key) {
  const match = /\/([A-Za-z0-9_-]+)\.[A-Za-z0-9]+$/.exec(String(key || ""));
  if (!match) throw new ApiError(500, "Photo upload could not be prepared. Try again.", "INTERNAL_ERROR");
  return match[1];
}

function assetCreateInput(body) {
  assertNoObjectReferences(body);
  const file = validateMediaRequest(body);
  if (!COMPOSER_PURPOSES.has(file.purpose)) {
    throw new ApiError(400, "Stable media is currently available for posts.", "VALIDATION_FAILED");
  }
  const clientAssetId = cleanClientId(body?.clientAssetId, "Media retry token");
  const kind = file.contentType.startsWith("video/") ? "video" : "image";
  if (kind === "video" && !VERIFIED_VIDEO_SOURCE_TYPES.has(file.contentType)) {
    throw new ApiError(415, "New PIT clips must use MP4 or QuickTime MOV.", "MEDIA_TYPE_UNSUPPORTED");
  }
  const canonical = {
    clientAssetId,
    purpose: file.purpose,
    kind,
    contentType: file.contentType,
    fileSize: file.fileSize,
    name: file.name,
  };
  return { file, canonical, createHash: fingerprint(canonical) };
}

function assetUploadTicket(row, { env, now }) {
  return {
    body: storedUploadBody(row),
    objectId: objectIdFromKey(row.source_key),
    env,
    at: now,
    storageScope: row.source_storage_scope || "public",
    accountingClass: MEDIA_UPLOAD_ACCOUNTING_CLASS.MEMBER_SOURCE,
  };
}

export function createMediaAsset(database, {
  ownerId,
  body,
  env = process.env,
  at = Date.now(),
  assetId = newId("ma"),
  sourceObjectId = newId("ms"),
  suppressDuplicateUpload = false,
} = {}) {
  const owner = String(ownerId || "");
  if (!owner) throw new ApiError(401, "Log in first.", "AUTH_REQUIRED");
  if (!ASSET_ID.test(assetId)) throw new ApiError(500, "Media could not be prepared.", "INTERNAL_ERROR");
  const input = assetCreateInput(body);

  return withWrite(database, () => {
    let row = database.prepare("SELECT * FROM media_assets WHERE owner_id=? AND client_asset_id=?")
      .get(owner, input.canonical.clientAssetId);
    if (row && row.create_hash !== input.createHash) {
      throw new ApiError(409, "That media retry token belongs to a different file.", "CONFLICT");
    }
    const duplicate = !!row;
    if (!row) {
      const ticket = reserveAndSign(database, {
        ownerId: owner,
        body: input.canonical,
        env,
        at,
        // The asset id is projected in public feeds, while the original source
        // remains an owner-only editing capability. Give the object an unrelated
        // random token so readers cannot enumerate camera originals/EXIF by
        // combining a public asset id with the small supported-extension set.
        objectId: sourceObjectId,
        // Originals are editing inputs, not delivery assets. Keeping every
        // stable source in the private bucket prevents camera EXIF/GPS data (or
        // an unsupported source codec) from becoming reachable before PIT has
        // inspected it and a metadata-free render has passed verification.
        storageScope: "private",
      });
      database.prepare(`INSERT INTO media_assets
        (id,owner_id,client_asset_id,create_hash,purpose,kind,source_key,source_url,source_storage_scope,original_name,mime_type,
         byte_size,status,metadata_status,edit_recipe,recipe_version,render_state,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'upload_pending','pending','{}',1,'not_required',?,?)`)
        .run(assetId, owner, input.canonical.clientAssetId, input.createHash, input.canonical.purpose,
          input.canonical.kind, ticket.key, ticket.storageLocator, ticket.storageScope, input.canonical.name,
          input.canonical.contentType, input.canonical.fileSize, at, at);
      row = database.prepare("SELECT * FROM media_assets WHERE id=?").get(assetId);
      return { asset: assetProjection(row, { owner: true }), upload: ticket, duplicate: false };
    }

    if (row.status !== "upload_pending") {
      // Reopening a durable draft is an explicit authenticated lease renewal.
      // Without this touch, an old ready draft could expire while its owner is
      // actively revisiting caption/edits immediately before publication.
      touchLiveLedger(database, owner, row.source_key, at);
      return { asset: assetProjection(loadAsset(database, row.id), { owner: true }), upload: null, duplicate: true };
    }
    if (suppressDuplicateUpload) {
      // A background video verifier may currently be reading this exact object.
      // Renew ownership, but do not mint or expose another writer capability for
      // a cached client's deterministic create retry.
      touchLiveLedger(database, owner, row.source_key, at);
      return { asset: assetProjection(loadAsset(database, row.id), { owner: true }), upload: null, duplicate: true };
    }
    const ticket = reserveAndSign(database, { ownerId: owner, ...assetUploadTicket(row, { env, now: at }) });
    return { asset: assetProjection(row, { owner: true }), upload: ticket, duplicate };
  });
}

function endpointObjectUrl(config, objectKey) {
  const encode = (value) => encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  const prefix = config.endpoint.pathname.replace(/\/+$/, "");
  const suffix = [config.bucket, ...objectKey.split("/")].map(encode).join("/");
  return `${config.endpoint.origin}${prefix}/${suffix}`;
}

export function mediaObjectTransferTimeoutMs(byteSize) {
  const bytes = Number(byteSize);
  if (!Number.isSafeInteger(bytes) || bytes < 1) return 30_000;
  // Storage verification is streamed, not buffered. Budget a conservative
  // 1 MiB/s plus startup time and retain a finite ceiling for stalled peers.
  return Math.min(12 * 60_000, Math.max(30_000, Math.ceil(bytes / (1024 * 1024)) * 1_000 + 15_000));
}

function mediaTransferSignal(signal, byteSize) {
  const timeout = AbortSignal.timeout(mediaObjectTransferTimeoutMs(byteSize));
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

function strongObjectEtag(value) {
  const etag = typeof value === "string" ? value.trim() : "";
  // R2 returns a quoted strong ETag. Reject weak/control-bearing values before
  // copying the opaque tag into a signed If-Match request.
  return /^"[\x21\x23-\x7e]{1,200}"$/u.test(etag) ? etag : null;
}

async function verifyStoredObject({ objectKey, expectedBytes, expectedType, env, fetchImpl, signal, storageScope = "public" }) {
  const config = getMediaConfig(env);
  if (!config.configured) throw new ApiError(503, "Media storage is temporarily unavailable.", "MEDIA_STORAGE_UNAVAILABLE");
  let url;
  try {
    const bucket = mediaBucketForScope(config, storageScope);
    url = presignS3Request({
      method: "HEAD",
      url: endpointObjectUrl({ ...config, bucket }, objectKey),
      region: config.region,
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      expiresIn: 60,
    });
  } catch (error) {
    throw new ApiError(503, "The upload could not be verified yet. Try again.", "MEDIA_STORAGE_UNAVAILABLE", error);
  }
  let response;
  try {
    response = await fetchImpl(url, {
      method: "HEAD",
      redirect: "error",
      signal: mediaTransferSignal(signal, expectedBytes),
    });
  } catch (error) {
    throw new ApiError(503, "The upload could not be verified yet. Try again.", "MEDIA_STORAGE_UNAVAILABLE", error);
  }
  if (response?.status === 404) {
    throw new ApiError(409, "The upload has not reached storage yet. Try again.", "CONFLICT");
  }
  if (!response || response.status < 200 || response.status >= 300) {
    throw new ApiError(503, "The upload could not be verified yet. Try again.", "MEDIA_STORAGE_UNAVAILABLE");
  }
  const actualLength = Number(response.headers?.get?.("content-length"));
  const actualType = contentType(response.headers?.get?.("content-type"));
  if (!Number.isSafeInteger(actualLength) || actualLength !== expectedBytes || actualType !== expectedType) {
    throw new ApiError(409, "The uploaded file does not match its signed upload ticket.", "CONFLICT");
  }
  return {
    byteSize: actualLength,
    mimeType: actualType,
    etag: strongObjectEtag(response.headers?.get?.("etag")),
  };
}

async function downloadStoredObjectBytes({
  objectKey,
  stored,
  expectedBytes,
  expectedType,
  env,
  fetchImpl,
  signal,
  storageScope = "public",
}) {
  if (!stored?.etag) {
    throw new ApiError(503, "The uploaded image could not be generation-bound yet. Try again.", "MEDIA_STORAGE_UNAVAILABLE");
  }
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
      signal: mediaTransferSignal(signal, expectedBytes),
    });
  } catch (error) {
    throw new ApiError(503, "The uploaded image could not be inspected yet. Try again.", "MEDIA_STORAGE_UNAVAILABLE", error);
  }
  const actualBytes = Number(response?.headers?.get?.("content-length"));
  const actualType = contentType(response?.headers?.get?.("content-type"));
  const actualEtag = strongObjectEtag(response?.headers?.get?.("etag"));
  if (response?.status !== 200 || actualBytes !== expectedBytes || actualType !== expectedType
      || actualEtag !== stored.etag || !response.body || typeof response.body.getReader !== "function") {
    throw new ApiError(409, "The uploaded image changed before it could be inspected.", "CONFLICT");
  }
  const reader = response.body.getReader();
  const chunks = [];
  let received = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      received += value?.byteLength || 0;
      if (received > expectedBytes) {
        await reader.cancel("image exceeded signed size");
        throw new ApiError(409, "The uploaded image changed before it could be inspected.", "CONFLICT");
      }
      chunks.push(Buffer.from(value));
    }
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(503, "The uploaded image could not be inspected yet. Try again.", "MEDIA_STORAGE_UNAVAILABLE", error);
  } finally {
    reader.releaseLock();
  }
  if (received !== expectedBytes) {
    throw new ApiError(409, "The uploaded image changed before it could be inspected.", "CONFLICT");
  }
  return Buffer.concat(chunks, received);
}

async function verifyStoredImage({
  objectKey,
  stored,
  expectedBytes,
  expectedType,
  env,
  fetchImpl,
  signal,
  storageScope = "public",
}) {
  const bytes = await downloadStoredObjectBytes({
    objectKey,
    stored,
    expectedBytes,
    expectedType,
    env,
    fetchImpl,
    signal,
    storageScope,
  });
  // Structural inspection and full pixel decoding happen together in the
  // isolated image worker. Keeping them out of this process means a compressed
  // PNG cannot block the HTTP event loop before admission control is acquired.
  return { bytes };
}

const defaultImageProcessor = Object.freeze({
  validate: validateDecodedImage,
  sanitize: sanitizeDecodedImage,
});

async function runImageProcessor(operation, options, { sanitizing = false } = {}) {
  try {
    return await operation(options.bytes, options);
  } catch (error) {
    const code = String(error?.code || "");
    if (new Set(["busy", "timeout", "worker_unavailable", "worker_protocol"]).has(code)) {
      const message = code === "busy"
        ? "Photo verification is at capacity. Your upload is safe; retry shortly."
        : code === "timeout"
          ? "Photo verification timed out. Retry the upload once."
          : "Photo verification is temporarily unavailable. Try again shortly.";
      throw new ApiError(503, message, "MEDIA_STORAGE_UNAVAILABLE", error);
    }
    if (new Set(["resource_limit", "output_size"]).has(code)) {
      throw new ApiError(413,
        "That photo exceeds PIT's safe camera-processing bounds. Choose a smaller export.",
        "MEDIA_TOO_LARGE", error);
    }
    if (new Set(["mime_mismatch", "output_type", "invalid_rendition", "unsupported"]).has(code)) {
      throw new ApiError(415,
        "The photo's actual bytes do not match a supported image type.",
        "MEDIA_TYPE_UNSUPPORTED", error);
    }
    throw new ApiError(400, sanitizing
      ? "PIT could not read and secure the complete rendition. Re-export it and retry."
      : "PIT could not read the complete photo. Re-export it from Photos and retry.",
    "VALIDATION_FAILED", error);
  }
}

function assertVerifiedDimensions(inspection, declaredWidth, declaredHeight, { allowSwap = false } = {}) {
  const exact = inspection.width === Number(declaredWidth) && inspection.height === Number(declaredHeight);
  const swapped = allowSwap && inspection.width === Number(declaredHeight) && inspection.height === Number(declaredWidth);
  if (!exact && !swapped) {
    throw new ApiError(409, "The uploaded image dimensions do not match the selected file.", "CONFLICT");
  }
}

function authoritativePosterInput(poster, { durationMs }) {
  const bytes = Buffer.isBuffer(poster?.bytes) ? poster.bytes : null;
  const byteSize = Number(poster?.byteSize);
  const width = Number(poster?.width);
  const height = Number(poster?.height);
  const timeMs = Number(poster?.timeMs);
  const digest = String(poster?.sha256 || "");
  let inspection = null;
  try {
    if (bytes) inspection = inspectImageBytes(bytes, { expectedType: "image/jpeg", sanitized: true });
  } catch (inspectionError) {
    void inspectionError;
    inspection = null;
  }
  if (poster?.contentType !== "image/jpeg"
      || !bytes || bytes.byteLength !== byteSize || byteSize < 4 || byteSize > 1_500_000
      || !Number.isSafeInteger(width) || width < 1 || width > 1_280
      || !Number.isSafeInteger(height) || height < 1 || height > 1_280
      || !Number.isSafeInteger(timeMs) || timeMs < 0 || timeMs >= durationMs
      || !/^[a-f0-9]{64}$/.test(digest)
      || createHash("sha256").update(bytes).digest("hex") !== digest
      || !inspection || inspection.width !== width || inspection.height !== height) {
    throw new ApiError(503, "Clip decoding returned an invalid cover. Try again later.", "MEDIA_STORAGE_UNAVAILABLE");
  }
  return { bytes, byteSize, width, height, timeMs, digest };
}

function createAuthoritativePosterVariant(database, {
  ownerId,
  assetId,
  input,
  sourceEtag,
  env,
  at,
}) {
  return withWrite(database, () => {
    const asset = database.prepare("SELECT * FROM media_assets WHERE id=? AND owner_id=?").get(assetId, ownerId);
    if (!asset) throw new ApiError(404, "That media item was not found.", "NOT_FOUND");
    if (asset.kind !== "video" || database.prepare("SELECT 1 FROM post_media WHERE asset_id=?").get(asset.id)) {
      throw new ApiError(409, "That clip cover can no longer be generated.", "CONFLICT");
    }
    touchLiveLedger(database, ownerId, asset.source_key, at);
    const clientVariantId = `pit-worker-poster-v2:${input.digest.slice(0, 48)}:${input.timeMs}`;
    const createHash = fingerprint({
      origin: "private_derivative_v1",
      sourceKey: asset.source_key,
      sourceEtag,
      digest: input.digest,
      timeMs: input.timeMs,
      byteSize: input.byteSize,
    });
    const existing = database.prepare("SELECT * FROM media_variants WHERE asset_id=? AND role='poster'").get(asset.id);
    if (existing && existing.client_variant_id === clientVariantId && existing.create_hash === createHash
        && existing.verification_origin === "private_derivative_v1") {
      const upload = existing.status === "upload_pending"
        ? immutableProcessorImageUploadTicket(database, {
          ownerId,
          objectKey: existing.object_key,
          purpose: asset.purpose,
          contentType: "image/jpeg",
          byteSize: input.byteSize,
          env,
          at,
        })
        : null;
      return { row: existing, upload };
    }
    if (existing) {
      const queued = enqueueOwnedMediaKeys(database, { ownerId, keys: [existing.object_key], at });
      if (queued.accepted !== 1) {
        throw new ApiError(409, "A previous clip cover is no longer available. Start the clip again.", "CONFLICT");
      }
      database.prepare("DELETE FROM media_variants WHERE id=? AND asset_id=?").run(existing.id, asset.id);
      database.prepare(`UPDATE media_assets SET poster_variant_id=NULL,poster_key=NULL,poster_url=NULL,poster_time_ms=NULL,updated_at=?
        WHERE id=? AND owner_id=?`).run(at, asset.id, ownerId);
    }
    const variantId = newId("mv");
    const objectId = `${asset.id}_poster_${variantId}`;
    const objectKey = expectedObjectKey({
      ownerId,
      purpose: asset.purpose,
      objectId,
      extension: "jpg",
    });
    const ticket = immutableProcessorImageUploadTicket(database, {
      ownerId,
      objectKey,
      purpose: asset.purpose,
      contentType: "image/jpeg",
      byteSize: input.byteSize,
      env,
      at,
    });
    database.prepare(`INSERT INTO media_variants
      (id,asset_id,client_variant_id,create_hash,role,object_key,public_url,mime_type,byte_size,status,verification_origin,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,'upload_pending','private_derivative_v1',?,?)`)
      .run(variantId, asset.id, clientVariantId, createHash, "poster", ticket.key,
        ticket.publicUrl, "image/jpeg", input.byteSize, at, at);
    return {
      row: database.prepare("SELECT * FROM media_variants WHERE id=? AND asset_id=?").get(variantId, asset.id),
      upload: ticket,
    };
  });
}

async function verifyStoredObjectDigest({ objectKey, stored, expectedBytes, expectedType, expectedDigest, env, fetchImpl, signal }) {
  const capability = createMediaDownloadCapability({ objectKey, ifMatch: stored.etag, env, expiresIn: 90 });
  let response;
  try {
    response = await fetchImpl(capability.downloadUrl, {
      method: "GET",
      redirect: "error",
      headers: capability.requiredHeaders,
      signal: mediaTransferSignal(signal, expectedBytes),
    });
  } catch (error) {
    throw new ApiError(503, "The generated clip cover could not be verified.", "MEDIA_STORAGE_UNAVAILABLE", error);
  }
  const actualBytes = Number(response?.headers?.get?.("content-length"));
  const actualType = contentType(response?.headers?.get?.("content-type"));
  const actualEtag = strongObjectEtag(response?.headers?.get?.("etag"));
  if (response?.status !== 200 || actualBytes !== expectedBytes || actualType !== expectedType
      || actualEtag !== stored.etag || !response.body || typeof response.body.getReader !== "function") {
    throw new ApiError(409, "The generated clip cover changed before publication.", "CONFLICT");
  }
  const reader = response.body.getReader();
  const hash = createHash("sha256");
  let received = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > expectedBytes) {
        await reader.cancel("cover exceeded signed size");
        throw new ApiError(409, "The generated clip cover changed before publication.", "CONFLICT");
      }
      hash.update(value);
    }
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(503, "The generated clip cover could not be verified.", "MEDIA_STORAGE_UNAVAILABLE", error);
  } finally {
    reader.releaseLock();
  }
  if (received !== expectedBytes || hash.digest("hex") !== expectedDigest) {
    throw new ApiError(409, "The generated clip cover bytes do not match the authoritative decoder.", "CONFLICT");
  }
}

async function stageAuthoritativePoster(database, {
  ownerId,
  assetId,
  poster,
  durationMs,
  sourceEtag,
  env,
  at,
  fetchImpl,
  signal,
}) {
  const input = authoritativePosterInput(poster, { durationMs });
  const created = createAuthoritativePosterVariant(database, {
    ownerId,
    assetId,
    input,
    sourceEtag,
    env,
    at,
  });
  const row = created?.row;
  if (!row || row.role !== "poster" || row.verification_origin !== "private_derivative_v1"
      || row.mime_type !== "image/jpeg" || Number(row.byte_size) !== input.byteSize) {
    throw new ApiError(409, "That clip cover changed while it was being prepared.", "CONFLICT");
  }
  if (row.status === "verified") {
    if (Number(row.width) !== input.width || Number(row.height) !== input.height || Number(row.time_ms) !== input.timeMs) {
      throw new ApiError(409, "That clip cover was already finalized differently.", "CONFLICT");
    }
  } else if (row.status !== "upload_pending" || !created.upload) {
    throw new ApiError(409, "That clip cover cannot be finalized.", "CONFLICT");
  }
  let response;
  if (created.upload) {
    try {
      response = await fetchImpl(created.upload.uploadUrl, {
        method: "PUT",
        redirect: "error",
        headers: created.upload.requiredHeaders,
        body: input.bytes,
        signal: mediaTransferSignal(signal, input.byteSize),
      });
    } catch (error) {
      throw new ApiError(503, "Clip cover storage is temporarily unavailable.", "MEDIA_STORAGE_UNAVAILABLE", error);
    }
    // A lost response can leave the deterministic create-only object present.
    // 412 is reconciled only after the exact generation is downloaded and its
    // SHA-256 matches the worker response below.
    if (!response || !((response.status >= 200 && response.status < 300) || response.status === 412)) {
      throw new ApiError(503, "Clip cover storage is temporarily unavailable.", "MEDIA_STORAGE_UNAVAILABLE");
    }
  }
  const stored = await verifyStoredObject({
    objectKey: row.object_key,
    expectedBytes: input.byteSize,
    expectedType: "image/jpeg",
    env,
    fetchImpl,
    signal,
  });
  if (!stored.etag) {
    throw new ApiError(503, "The generated clip cover could not be generation-bound.", "MEDIA_STORAGE_UNAVAILABLE");
  }
  await verifyStoredObjectDigest({
    objectKey: row.object_key,
    stored,
    expectedBytes: input.byteSize,
    expectedType: "image/jpeg",
    expectedDigest: input.digest,
    env,
    fetchImpl,
    signal,
  });
  return { row, input };
}

function commitAuthoritativePoster(database, { ownerId, assetId, staged, at }) {
  if (!staged) return;
  const current = database.prepare("SELECT * FROM media_variants WHERE id=? AND asset_id=?")
    .get(staged.row.id, assetId);
  if (!current || current.role !== "poster" || current.object_key !== staged.row.object_key
      || current.verification_origin !== "private_derivative_v1"
      || current.mime_type !== "image/jpeg" || Number(current.byte_size) !== staged.input.byteSize) {
    throw new ApiError(409, "That clip cover changed while it was finalizing.", "CONFLICT");
  }
  requireLiveLedger(database, ownerId, current.object_key);
  touchLiveLedger(database, ownerId, current.object_key, at);
  const finalizeHash = fingerprint({
    width: staged.input.width,
    height: staged.input.height,
    timeMs: staged.input.timeMs,
  });
  if (current.status === "verified") {
    if (current.finalize_hash !== finalizeHash) {
      throw new ApiError(409, "That clip cover changed while it was finalizing.", "CONFLICT");
    }
  } else {
    const updated = database.prepare(`UPDATE media_variants SET width=?,height=?,time_ms=?,status='verified',
      finalize_hash=?,verified_at=?,updated_at=? WHERE id=? AND asset_id=? AND status='upload_pending'`)
      .run(staged.input.width, staged.input.height, staged.input.timeMs, finalizeHash,
        at, at, current.id, assetId);
    if (Number(updated.changes || 0) !== 1) {
      throw new ApiError(409, "That clip cover changed while it was finalizing.", "CONFLICT");
    }
  }
  database.prepare(`UPDATE media_assets SET poster_variant_id=?,poster_key=?,poster_url=?,poster_time_ms=?,updated_at=?
    WHERE id=? AND owner_id=?`).run(current.id, current.object_key, current.public_url,
    staged.input.timeMs, at, assetId, ownerId);
}

function prepareAuthoritativeDelivery(database, { ownerId, assetId, sourceEtag, editRecipe, env, at }) {
  return withWrite(database, () => {
    const asset = database.prepare("SELECT * FROM media_assets WHERE id=? AND owner_id=?").get(assetId, ownerId);
    if (!asset || asset.kind !== "video" || asset.source_storage_scope !== "private") {
      throw new ApiError(409, "That clip cannot create a private delivery.", "CONFLICT");
    }
    const createHash = fingerprint({
      origin: "private_derivative_v1",
      sourceKey: asset.source_key,
      sourceEtag,
      editRecipe,
    });
    let row = database.prepare("SELECT * FROM media_variants WHERE asset_id=? AND role='render'").get(asset.id);
    if (row && (row.verification_origin !== "private_derivative_v1" || row.create_hash !== createHash)) {
      throw new ApiError(409, "That clip delivery changed while it was being prepared.", "CONFLICT");
    }
    if (!row) {
      const variantId = newId("mv");
      const objectKey = expectedObjectKey({
        ownerId,
        purpose: asset.purpose,
        objectId: `${asset.id}_delivery_${variantId}`,
        extension: "mp4",
      });
      reserveMediaUploadTicket(database, {
        ownerId,
        objectKey,
        storageScope: "public",
        accountingClass: MEDIA_UPLOAD_ACCOUNTING_CLASS.SERVICE_GENERATED,
        byteSize: MAX_VIDEO_BYTES,
        at,
        expiresAt: at + VIDEO_DELIVERY_CAPABILITY_MS,
        env,
      });
      const upload = createMediaProcessorUploadCapability({ objectKey, env, now: new Date(at), expiresIn: VIDEO_DELIVERY_CAPABILITY_MS / 1_000 });
      database.prepare(`INSERT INTO media_variants
        (id,asset_id,client_variant_id,create_hash,role,object_key,public_url,mime_type,byte_size,status,verification_origin,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,'upload_pending','private_derivative_v1',?,?)`)
        .run(variantId, asset.id, `pit-private-delivery-v1:${createHash.slice(0, 64)}`, createHash,
          "render", objectKey, upload.publicUrl, "video/mp4", MAX_VIDEO_BYTES, at, at);
      row = database.prepare("SELECT * FROM media_variants WHERE id=?").get(variantId);
      return { row, upload };
    }
    const upload = createMediaProcessorUploadCapability({ objectKey: row.object_key, env, now: new Date(at), expiresIn: VIDEO_DELIVERY_CAPABILITY_MS / 1_000 });
    return { row, upload };
  });
}

async function stageAuthoritativeDelivery(database, {
  ownerId,
  assetId,
  delivery,
  prepared,
  env,
  fetchImpl,
  signal,
}) {
  if (!prepared?.row || delivery?.key !== prepared.row.object_key
      || delivery?.contentType !== "video/mp4" || !/^[a-f0-9]{64}$/.test(String(delivery?.sha256 || ""))) {
    throw new ApiError(409, "The sanitized clip delivery changed while finalizing.", "CONFLICT");
  }
  const stored = await verifyStoredObject({
    objectKey: delivery.key,
    expectedBytes: Number(delivery.byteSize),
    expectedType: "video/mp4",
    env,
    fetchImpl,
    signal,
    storageScope: "public",
  });
  if (!stored.etag) throw new ApiError(503, "The sanitized clip could not be generation-bound.", "MEDIA_STORAGE_UNAVAILABLE");
  await verifyStoredObjectDigest({
    objectKey: delivery.key,
    stored,
    expectedBytes: Number(delivery.byteSize),
    expectedType: "video/mp4",
    expectedDigest: delivery.sha256,
    env,
    fetchImpl,
    signal,
  });
  return { row: prepared.row, input: delivery, stored };
}

function commitAuthoritativeDelivery(database, { ownerId, assetId, staged, at }) {
  if (!staged) return;
  const current = database.prepare("SELECT * FROM media_variants WHERE id=? AND asset_id=?")
    .get(staged.row.id, assetId);
  if (!current || current.role !== "render" || current.object_key !== staged.input.key
      || current.verification_origin !== "private_derivative_v1"
      || !new Set(["upload_pending", "verified"]).has(current.status)) {
    throw new ApiError(409, "The sanitized clip delivery changed while finalizing.", "CONFLICT");
  }
  requireLiveLedger(database, ownerId, current.object_key);
  const finalizeHash = fingerprint({
    sha256: staged.input.sha256,
    width: staged.input.width,
    height: staged.input.height,
    durationMs: staged.input.durationMs,
    etag: staged.stored.etag,
  });
  if (current.status === "verified") {
    if (Number(current.byte_size) !== Number(staged.input.byteSize)
        || Number(current.width) !== Number(staged.input.width)
        || Number(current.height) !== Number(staged.input.height)
        || current.finalize_hash !== finalizeHash) {
      throw new ApiError(409, "The sanitized clip delivery changed while finalizing.", "CONFLICT");
    }
  } else {
    database.prepare(`UPDATE media_variants SET byte_size=?,width=?,height=?,status='verified',finalize_hash=?,verified_at=?,updated_at=?
      WHERE id=? AND asset_id=? AND status='upload_pending'`)
      .run(staged.input.byteSize, staged.input.width, staged.input.height, finalizeHash, at, at, current.id, assetId);
  }
  database.prepare(`UPDATE media_objects SET byte_size=?,status='issued',updated_at=?
    WHERE owner_id=? AND object_key=? AND storage_scope='public' AND status IN ('issued','associated')`)
    .run(staged.input.byteSize, at, ownerId, current.object_key);
  database.prepare(`UPDATE media_assets SET render_variant_id=?,render_state='ready',status='ready',updated_at=?
    WHERE id=? AND owner_id=?`).run(current.id, at, assetId, ownerId);
}

const IMAGE_DELIVERY_EXTENSIONS = Object.freeze({
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
});

// Processor outputs use deterministic, create-only keys and their PUT
// capabilities never leave the server. A retry after a transient 412/503 must
// therefore reuse the live ledger generation without charging an ordinary
// browser upload issuance a second time.
function reserveImmutableProcessorTicket(database, {
  ownerId,
  objectKey,
  purpose,
  byteSize,
  at,
  env,
}) {
  const existing = database.prepare(`SELECT owner_id,storage_scope,purpose,byte_size,status
    FROM media_objects WHERE object_key=?`).get(objectKey);
  if (!existing) {
    // Recovery uses the same service-generated admission path as an ordinary
    // sanitizer. Its capability never counts as a member-selected source, but
    // it must still fit the global outstanding and rolling incident brakes.
    reserveMediaUploadTicket(database, {
      ownerId,
      objectKey,
      storageScope: "public",
      accountingClass: MEDIA_UPLOAD_ACCOUNTING_CLASS.SERVICE_GENERATED,
      byteSize,
      at,
      expiresAt: at + MEDIA_UPLOAD_TICKET_MS,
      env,
    });
    return;
  }
  if (existing.owner_id !== ownerId || existing.storage_scope !== "public"
      || existing.purpose !== purpose || Number(existing.byte_size) !== Number(byteSize)
      || !new Set(["issued", "associated"]).has(existing.status)) {
    throw new ApiError(409, "That photo rendition changed while it was being sanitized.", "CONFLICT");
  }
}

function immutableProcessorImageUploadTicket(database, {
  ownerId,
  objectKey,
  purpose,
  contentType: outputType,
  byteSize,
  env,
  at,
  serverRecovery = false,
}) {
  reserveImmutableProcessorTicket(database, {
    ownerId,
    objectKey,
    purpose,
    byteSize,
    at,
    env,
  });
  return createMediaProcessorImageUploadCapability({
    objectKey,
    contentType: outputType,
    contentLength: byteSize,
    env,
    now: new Date(at),
    expiresIn: 300,
  });
}

function prepareSanitizedImageDelivery(database, {
  ownerId,
  asset,
  variantId,
  stagingKey,
  output,
  env,
  at,
  serverRecovery,
}) {
  const extension = IMAGE_DELIVERY_EXTENSIONS[output?.mimeType];
  if (!extension || !VARIANT_ID.test(String(variantId || "")) || !trustedMediaQueueKey(stagingKey, ownerId)) {
    throw new ApiError(409, "That photo rendition changed while it was being sanitized.", "CONFLICT");
  }
  const digest = createHash("sha256").update(output.bytes).digest("hex");
  const objectKey = expectedObjectKey({
    ownerId,
    purpose: asset.purpose,
    objectId: `${asset.id}_${variantId}_safe_${digest.slice(0, 16)}`,
    extension,
  });
  return withWrite(database, () => {
    requirePrivateLiveLedger(database, ownerId, stagingKey);
    const upload = immutableProcessorImageUploadTicket(database, {
      ownerId,
      objectKey,
      purpose: asset.purpose,
      contentType: output.mimeType,
      byteSize: output.byteSize,
      at,
      env,
      serverRecovery,
    });
    return { upload, objectKey, digest, stagingKey, output };
  });
}

async function stageSanitizedImageDelivery(database, {
  ownerId,
  asset,
  variantId,
  stagingKey,
  output,
  env,
  at,
  fetchImpl,
  signal,
  serverRecovery,
}) {
  const prepared = prepareSanitizedImageDelivery(database, {
    ownerId,
    asset,
    variantId,
    stagingKey,
    output,
    env,
    at,
    serverRecovery,
  });
  let response;
  try {
    response = await fetchImpl(prepared.upload.uploadUrl, {
      method: "PUT",
      redirect: "error",
      headers: prepared.upload.requiredHeaders,
      body: output.bytes,
      signal: mediaTransferSignal(signal, output.byteSize),
    });
  } catch (error) {
    throw new ApiError(503, "Photo delivery storage is temporarily unavailable.", "MEDIA_STORAGE_UNAVAILABLE", error);
  }
  if (!response || !((response.status >= 200 && response.status < 300) || response.status === 412)) {
    throw new ApiError(503, "Photo delivery storage is temporarily unavailable.", "MEDIA_STORAGE_UNAVAILABLE");
  }
  const stored = await verifyStoredObject({
    objectKey: prepared.objectKey,
    expectedBytes: output.byteSize,
    expectedType: output.mimeType,
    env,
    fetchImpl,
    signal,
    storageScope: "public",
  });
  if (!stored.etag) {
    throw new ApiError(503, "The sanitized photo could not be generation-bound.", "MEDIA_STORAGE_UNAVAILABLE");
  }
  await verifyStoredObjectDigest({
    objectKey: prepared.objectKey,
    stored,
    expectedBytes: output.byteSize,
    expectedType: output.mimeType,
    expectedDigest: prepared.digest,
    env,
    fetchImpl,
    signal,
  });
  return { ...prepared, stored };
}

function serverImageDeliveryType(sourceType) {
  const type = contentType(sourceType);
  if (type === "image/png" || type === "image/webp") return type;
  if (type === "image/gif") return "image/webp";
  // Camera JPEG/HEIC/HEIF/AVIF sources are normalized to ordinary sRGB JPEG.
  return "image/jpeg";
}

function commitAuthoritativeImageDelivery(database, {
  ownerId,
  assetId,
  staged,
  input,
  at,
}) {
  if (!staged) return;
  const current = database.prepare("SELECT * FROM media_assets WHERE id=? AND owner_id=?")
    .get(assetId, ownerId);
  if (!current || current.kind !== "image") {
    throw new ApiError(409, "That photo changed while its safe rendition was being committed.", "CONFLICT");
  }
  requireLiveLedger(database, ownerId, current.source_key);
  requireLiveLedger(database, ownerId, staged.objectKey);
  const createHash = fingerprint({
    origin: "private_derivative_v1",
    sourceKey: current.source_key,
    sourceEtag: staged.sourceEtag,
    editRecipe: input.encodedRecipe,
    sha256: staged.digest,
  });
  const clientVariantId = `pit-server-original:${createHash.slice(0, 64)}`;
  const finalizeHash = fingerprint({
    sha256: staged.digest,
    width: staged.output.width,
    height: staged.output.height,
    etag: staged.stored.etag,
  });
  let variant = database.prepare("SELECT * FROM media_variants WHERE asset_id=? AND role='render'")
    .get(assetId);
  if (variant) {
    if (variant.id !== staged.variantId || variant.client_variant_id !== clientVariantId
        || variant.create_hash !== createHash || variant.object_key !== staged.objectKey
        || variant.finalize_hash !== finalizeHash || variant.status !== "verified"
        || variant.verification_origin !== "private_derivative_v1") {
      throw new ApiError(409, "That photo rendition changed while it was being committed.", "CONFLICT");
    }
  } else {
    database.prepare(`INSERT INTO media_variants
      (id,asset_id,client_variant_id,create_hash,role,object_key,public_url,mime_type,byte_size,
       width,height,time_ms,status,finalize_hash,verified_at,verification_origin,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,NULL,'verified',?,?,'private_derivative_v1',?,?)`)
      .run(staged.variantId, assetId, clientVariantId, createHash, "render",
        staged.objectKey, staged.upload.publicUrl, staged.output.mimeType, staged.output.byteSize,
        staged.output.width, staged.output.height, finalizeHash, at, at, at);
    variant = database.prepare("SELECT * FROM media_variants WHERE id=? AND asset_id=?")
      .get(staged.variantId, assetId);
  }
  const updated = database.prepare(`UPDATE media_assets
    SET render_variant_id=?,render_state='ready',status='ready',updated_at=?
    WHERE id=? AND owner_id=? AND (render_variant_id IS NULL OR render_variant_id=?)`)
    .run(variant.id, at, assetId, ownerId, variant.id);
  if (updated.changes !== 1) {
    throw new ApiError(409, "That photo changed while its safe rendition was being committed.", "CONFLICT");
  }
}

// Shared trust-boundary helpers for legacy avatar/banner/review upload
// migration. They deliberately expose only the private staging -> decoded
// pixels -> server-authored public derivative path; callers never receive a
// public PUT capability.
export async function sanitizePrivateImageStaging(database, {
  ownerId,
  objectKey,
  expectedBytes,
  expectedType,
  outputType = expectedType,
  env = process.env,
  fetchImpl = globalThis.fetch,
  imageProcessor = defaultImageProcessor,
  imageTimeoutMs,
  allowHeicFallback = false,
  allowLegacyJpegTrailer = false,
  profileRendition = null,
  signal,
  imageFinalizationStage = null,
  imageStoredObject = null,
  imageExpectedFingerprint = null,
} = {}) {
  const owner = String(ownerId || "");
  const key = trustedMediaQueueKey(objectKey, owner);
  if (!owner || !key || typeof fetchImpl !== "function") {
    throw new ApiError(400, "That private photo upload is invalid.", "VALIDATION_FAILED");
  }
  requirePrivateLiveLedger(database, owner, key, { expectedBytes });
  const admissionFingerprint = fingerprint({
    key,
    expectedBytes,
    expectedType,
    outputType,
    allowHeicFallback: allowHeicFallback === true,
    allowLegacyJpegTrailer: allowLegacyJpegTrailer === true,
    profileRendition,
  });
  if (imageFinalizationStage !== IMAGE_FINALIZATION_PREFLIGHT_TOKEN
      && imageFinalizationStage !== IMAGE_FINALIZATION_GENERATION_TOKEN) {
    return runImageFinalizationPreflight({
      scope: database,
      ownerId: owner,
      baseKey: `private:${key}`,
      fingerprint: admissionFingerprint,
      byteSize: Number(expectedBytes),
      signal,
      task: ({ signal: sharedSignal }) => sanitizePrivateImageStaging(database, {
        ownerId: owner,
        objectKey: key,
        expectedBytes,
        expectedType,
        outputType,
        env,
        fetchImpl,
        imageProcessor,
        imageTimeoutMs,
        allowHeicFallback,
        allowLegacyJpegTrailer,
        profileRendition,
        signal: sharedSignal,
        imageFinalizationStage: IMAGE_FINALIZATION_PREFLIGHT_TOKEN,
        imageExpectedFingerprint: admissionFingerprint,
      }),
    });
  }
  if (imageExpectedFingerprint && imageExpectedFingerprint !== admissionFingerprint) {
    throw new ApiError(409, "That photo changed while it was waiting to be verified.", "CONFLICT");
  }

  const stored = imageFinalizationStage === IMAGE_FINALIZATION_GENERATION_TOKEN
    ? requireAdmittedStoredGeneration(imageStoredObject, {
      expectedBytes,
      expectedType,
    })
    : await verifyStoredObject({
      objectKey: key,
      expectedBytes,
      expectedType,
      env,
      fetchImpl,
      signal,
      storageScope: "private",
    });
  // A cancellation/expiry pass may win while HEAD is in flight or while this
  // immutable generation waits for the single bounded download/decode lane.
  requirePrivateLiveLedger(database, owner, key, { expectedBytes });
  if (imageFinalizationStage === IMAGE_FINALIZATION_PREFLIGHT_TOKEN) {
    return runImageFinalizationGeneration({
      scope: database,
      ownerId: owner,
      baseKey: `private:${key}:${stored.etag}`,
      fingerprint: admissionFingerprint,
      byteSize: Number(expectedBytes),
      signal,
      task: ({ signal: sharedSignal }) => sanitizePrivateImageStaging(database, {
        ownerId: owner,
        objectKey: key,
        expectedBytes,
        expectedType,
        outputType,
        env,
        fetchImpl,
        imageProcessor,
        imageTimeoutMs,
        allowHeicFallback,
        allowLegacyJpegTrailer,
        profileRendition,
        signal: sharedSignal,
        imageFinalizationStage: IMAGE_FINALIZATION_GENERATION_TOKEN,
        imageStoredObject: stored,
        imageExpectedFingerprint: admissionFingerprint,
      }),
    });
  }

  const verified = await verifyStoredImage({
    objectKey: key,
    stored,
    expectedBytes,
    expectedType,
    env,
    fetchImpl,
    signal,
    storageScope: "private",
  });
  const sanitized = await runImageProcessor(imageProcessor?.sanitize || defaultImageProcessor.sanitize, {
    bytes: verified.bytes,
    expectedType,
    outputType,
    ...(allowHeicFallback === true && Number.isSafeInteger(imageTimeoutMs) && imageTimeoutMs > 0
      ? { timeoutMs: Math.min(imageTimeoutMs, 60_000) }
      : {}),
    allowHeicFallback: allowHeicFallback === true,
    allowLegacyJpegTrailer: allowLegacyJpegTrailer === true,
    profileRendition,
  }, { sanitizing: true });
  return Object.freeze({ sanitized, sourceEtag: stored.etag });
}

export async function stageSanitizedPublicImage(database, {
  ownerId,
  purpose,
  publicIdentity,
  stagingKey,
  sourceBinding,
  output,
  env = process.env,
  at = Date.now(),
  fetchImpl = globalThis.fetch,
  signal,
  serverRecovery = false,
} = {}) {
  const owner = String(ownerId || "");
  const identity = String(publicIdentity || "");
  const sourceObjectKey = trustedMediaQueueKey(sourceBinding?.objectKey, owner);
  const sourceEtag = typeof sourceBinding?.etag === "string" && /^"[\x21\x23-\x7e]{1,200}"$/u.test(sourceBinding.etag)
    ? sourceBinding.etag
    : null;
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(identity)
      || !new Set(["avatar", "banner", "post", "review", "venue"]).has(String(purpose || ""))
      || (sourceBinding != null && (!sourceObjectKey || !sourceEtag))) {
    throw new ApiError(400, "That sanitized photo identity is invalid.", "VALIDATION_FAILED");
  }
  const variantId = `mv_${fingerprint({ ownerId: owner, purpose, identity }).slice(0, 24)}`;
  const staged = await stageSanitizedImageDelivery(database, {
    ownerId: owner,
    asset: { id: identity, purpose },
    variantId,
    stagingKey,
    output,
    env,
    at,
    fetchImpl,
    signal,
    serverRecovery,
  });
  const delivery = Object.freeze({
    objectKey: staged.objectKey,
    publicUrl: staged.upload.publicUrl,
    mimeType: output.mimeType,
    byteSize: output.byteSize,
    width: output.width,
    height: output.height,
    sha256: staged.digest,
    etag: staged.stored.etag,
  });
  sanitizedPublicImageDeliveryClaims.set(delivery, Object.freeze({
    ownerId: owner,
    purpose: String(purpose),
    publicIdentity: identity,
    stagingKey,
    sourceObjectKey,
    sourceEtag,
    serverRecovery: serverRecovery === true,
    ...delivery,
  }));
  return delivery;
}

// This is deliberately an opaque in-process attestation rather than a shape
// check. Recovery workers must pass the exact object minted after decode,
// re-encode, immutable upload and digest verification above; copying its fields
// or supplying an otherwise owner-looking URL does not recreate the claim.
export function verifiedSanitizedPublicImageDelivery(delivery, {
  ownerId,
  purpose,
  sourceObjectKey,
  sourceEtag,
  serverRecovery,
} = {}) {
  const claim = delivery && typeof delivery === "object"
    ? sanitizedPublicImageDeliveryClaims.get(delivery)
    : null;
  if (!claim || claim.ownerId !== String(ownerId || "") || claim.purpose !== String(purpose || "")
      || (sourceObjectKey != null && claim.sourceObjectKey !== String(sourceObjectKey))
      || (sourceEtag != null && claim.sourceEtag !== String(sourceEtag))
      || (serverRecovery != null && claim.serverRecovery !== (serverRecovery === true))) {
    return null;
  }
  return claim;
}

function queuePrivateImageStaging(database, { ownerId, stagingKey, at }) {
  requirePrivateLiveLedger(database, ownerId, stagingKey);
  const queued = enqueueOwnedMediaKeys(database, { ownerId, keys: [stagingKey], at });
  if (queued.accepted !== 1) {
    throw new ApiError(409, "That private photo staging object is no longer available.", "CONFLICT");
  }
}

function deliveryStateForRecipe(row, editRecipe) {
  const needsExport = row.kind === "video"
    ? true
    // Every new stable image gets a delivery rendition. The original remains
    // owner-only editing input, so public posts never expose camera metadata or
    // depend on a phone-specific source format even for an identity edit.
    : true;
  const renderState = needsExport ? "pending" : "not_required";
  const status = renderState === "unavailable" ? "render_unavailable" : renderState === "pending" ? "render_pending" : "ready";
  return { renderState, status };
}

function normalizedAssetFinalize(row, body) {
  assertNoObjectReferences(body);
  const width = integer(body?.width, {
    label: "Media width", min: 1, max: MAX_IMAGE_EDGE, optional: true,
  }) ?? (row.finalize_hash ? Number(row.width) : null);
  const height = integer(body?.height, {
    label: "Media height", min: 1, max: MAX_IMAGE_EDGE, optional: true,
  }) ?? (row.finalize_hash ? Number(row.height) : null);
  const orientation = integer(body?.orientation ?? 0, { label: "Media orientation", min: 0, max: 270 });
  if (![0, 90, 180, 270].includes(orientation)) {
    throw new ApiError(400, "Media orientation is invalid.", "VALIDATION_FAILED");
  }
  const durationMs = row.kind === "video"
    ? integer(body?.durationMs, {
      label: "Clip duration", min: 1, max: Number.MAX_SAFE_INTEGER, optional: true,
    }) ?? (row.finalize_hash ? Number(row.duration_ms) : null)
    : null;
  const altText = normalizedAltText(body?.altText);
  const { editRecipe, encodedRecipe } = normalizedRecipe(row, body?.editRecipe ?? {}, durationMs);
  const deliveryMode = body?.deliveryMode == null ? "client" : String(body.deliveryMode);
  if (!new Set(["client", "server"]).has(deliveryMode)) {
    throw new ApiError(400, "Photo delivery mode is invalid.", "VALIDATION_FAILED");
  }
  const serverOriginalDelivery = row.kind === "image" && deliveryMode === "server"
    && !mediaEditHasChanges(editRecipe, { kind: "image" });
  const { renderState, status } = deliveryStateForRecipe(row, editRecipe);
  const sourceIdentity = { width, height, durationMs, orientation };
  return {
    ...sourceIdentity, altText, editRecipe, encodedRecipe, renderState, status,
    serverOriginalDelivery, finalizeHash: fingerprint(sourceIdentity),
  };
}

function authoritativeVideoFinalize(row, body, declared, probed) {
  const durationMs = Number(probed?.durationMs);
  const encodedWidth = Number(probed?.width);
  const encodedHeight = Number(probed?.height);
  if (!Number.isSafeInteger(durationMs) || durationMs < 1 || durationMs > MAX_VIDEO_DURATION_MS) {
    throw new ApiError(400, "PIT videos must be 10 minutes or shorter.", "VALIDATION_FAILED");
  }
  // Picker duration and dimensions are advisory. iOS and Android may omit them,
  // round them differently, or report display axes for rotated clips. The
  // bounded container probe and isolated full decoder are authoritative.
  const decodedRotation = Number(probed?.rotation);
  const hasDecodedRotation = Number.isSafeInteger(decodedRotation) && [0, 90, 180, 270].includes(decodedRotation);
  const displayRotated = hasDecodedRotation && (decodedRotation === 90 || decodedRotation === 270);
  const displayWidth = displayRotated ? encodedHeight : encodedWidth;
  const displayHeight = displayRotated ? encodedWidth : encodedHeight;

  const submittedRecipe = body?.editRecipe && typeof body.editRecipe === "object" && !Array.isArray(body.editRecipe)
    ? body.editRecipe
    : {};
  // Pickers commonly floor while mvhd/stts math is ceil-rounded. If the client
  // submitted a baseline (cover-only) recipe for its declared duration, rebase
  // that implicit full-length trim to the probed duration. A genuine authored
  // trim/filter remains untouched and therefore still requires an encoder.
  const editRecipe = videoEditRequiresExport(declared.editRecipe)
    ? submittedRecipe
    : { ...submittedRecipe, trimStartMs: 0, trimEndMs: durationMs };
  // Preserve the display-axis order the picker reported, but only when it is an
  // exact permutation of the structurally parsed encoded dimensions. This
  // supports portrait MP4 rotation metadata without trusting arbitrary geometry.
  return normalizedAssetFinalize(row, {
    ...body,
    width: hasDecodedRotation ? displayWidth : encodedWidth,
    height: hasDecodedRotation ? displayHeight : encodedHeight,
    orientation: hasDecodedRotation ? decodedRotation : declared.orientation,
    durationMs,
    editRecipe,
  });
}

function normalizedRecipe(row, sourceRecipe, durationMs = row.duration_ms) {
  let sourceBytes;
  try { sourceBytes = Buffer.byteLength(JSON.stringify(sourceRecipe), "utf8"); }
  catch { throw new ApiError(400, "Media edits are invalid.", "VALIDATION_FAILED"); }
  if (sourceBytes > MAX_RECIPE_BYTES) throw new ApiError(400, "Media edits are too large.", "VALIDATION_FAILED");
  let recipeSource = sourceRecipe;
  if (row.kind === "video" && sourceRecipe && typeof sourceRecipe === "object" && !Array.isArray(sourceRecipe)) {
    const declaredDuration = Number(sourceRecipe.durationMs);
    if (Number.isSafeInteger(declaredDuration) && declaredDuration > 0
        && Math.abs(Number(durationMs) - declaredDuration) <= MAX_VIDEO_DURATION_DRIFT_MS) {
      const declaredRecipe = normalizeMediaEdit(sourceRecipe, { kind: "video", durationMs: declaredDuration });
      if (!videoEditRequiresExport(declaredRecipe)) {
        recipeSource = { ...sourceRecipe, durationMs, trimStartMs: 0, trimEndMs: durationMs };
      }
    }
  }
  const editRecipe = normalizeMediaEdit(recipeSource, { kind: row.kind, durationMs });
  const encodedRecipe = JSON.stringify(editRecipe);
  if (Buffer.byteLength(encodedRecipe, "utf8") > MAX_RECIPE_BYTES) {
    throw new ApiError(400, "Media edits are too large.", "VALIDATION_FAILED");
  }
  return { editRecipe, encodedRecipe };
}

function finalizedSourceMatches(row, input) {
  if (row.finalize_hash === input.finalizeHash) return true;
  // Rows finalized before recipe/alt text became mutable used a broader hash.
  // Compare the persisted source metadata so those retries remain idempotent
  // without letting a stale finalize overwrite newer edits or accessibility.
  const width = Number(row.width);
  const height = Number(row.height);
  const dimensionsMatch = width === input.width && height === input.height;
  const rotatedDimensionsMatch = row.kind === "video" && width === input.height && height === input.width;
  const durationMatches = row.kind !== "video"
    || Math.abs(Number(row.duration_ms) - input.durationMs) <= MAX_VIDEO_DURATION_DRIFT_MS;
  return (dimensionsMatch || rotatedDimensionsMatch)
    && durationMatches
    && Number(row.orientation || 0) === input.orientation;
}

function liveLedger(database, ownerId, objectKey) {
  const key = trustedMediaQueueKey(objectKey, ownerId);
  if (!key) return false;
  const row = database.prepare("SELECT status FROM media_objects WHERE owner_id=? AND object_key=?").get(ownerId, key);
  return !!row && new Set(["issued", "associated"]).has(row.status);
}

function requireLiveLedger(database, ownerId, objectKey) {
  if (!liveLedger(database, ownerId, objectKey)) {
    throw new ApiError(409, "That media upload is no longer available. Start the upload again.", "CONFLICT");
  }
}

function touchLiveLedger(database, ownerId, objectKey, at) {
  const key = trustedMediaQueueKey(objectKey, ownerId);
  const changed = key ? Number(database.prepare(`UPDATE media_objects
    SET updated_at=CASE WHEN updated_at>? THEN updated_at ELSE ? END
    WHERE owner_id=? AND object_key=? AND status IN ('issued','associated')`)
    .run(at, at, ownerId, key).changes || 0) : 0;
  if (changed !== 1) {
    throw new ApiError(409, "That media upload is no longer available. Start the upload again.", "CONFLICT");
  }
}

function requirePrivateLiveLedger(database, ownerId, objectKey, { expectedBytes } = {}) {
  const key = trustedMediaQueueKey(objectKey, ownerId);
  const row = key ? database.prepare(`SELECT storage_scope,byte_size,status FROM media_objects
    WHERE owner_id=? AND object_key=?`).get(ownerId, key) : null;
  if (!row || row.storage_scope !== "private" || !new Set(["issued", "associated"]).has(row.status)
      || (expectedBytes != null && Number(row.byte_size) !== Number(expectedBytes))) {
    throw new ApiError(409, "That private photo upload is no longer available. Start again.", "CONFLICT");
  }
  return row;
}

function terminalVideoSourceFailure(error) {
  if (error instanceof ApiError && error.status === 415) {
    Object.defineProperty(error, "terminalMediaSourceFailure", {
      value: true,
      enumerable: false,
      configurable: false,
    });
  }
  return error;
}

export function isTerminalMediaSourceFailure(error) {
  return error instanceof ApiError
    && error.status === 415
    && error.terminalMediaSourceFailure === true;
}

export async function finalizeMediaAsset(database, {
  ownerId,
  assetId,
  body,
  env = process.env,
  at = Date.now(),
  fetchImpl = globalThis.fetch,
  authoritativeVideoVerifier = null,
  authoritativePosterRequired = false,
  beforeAuthoritativeVerify,
  imageProcessor = defaultImageProcessor,
  signal,
  imageFinalizationStage = null,
  imageStoredObject = null,
  imageExpectedFingerprint = null,
} = {}) {
  const row = database.prepare("SELECT * FROM media_assets WHERE id=? AND owner_id=?").get(assetId, ownerId);
  if (!row) throw new ApiError(404, "That media item was not found.", "NOT_FOUND");
  let input = normalizedAssetFinalize(row, body);
  const needsCodecVerification = row.kind === "video" && row.codec_status !== "verified";
  const authoritativePosterReady = row.kind === "video" && !!row.poster_variant_id && !!database.prepare(`SELECT 1
    FROM media_variants v JOIN media_objects o ON o.owner_id=? AND o.object_key=v.object_key
    WHERE v.id=? AND v.asset_id=? AND v.role='poster' AND v.status='verified'
      AND v.verification_origin='private_derivative_v1' AND v.mime_type='image/jpeg' AND v.time_ms=?
      AND o.status IN ('issued','associated')`).get(ownerId, row.poster_variant_id, row.id,
    Number(input.editRecipe.coverMs));
  const needsAuthoritativePoster = row.kind === "video" && authoritativePosterRequired && !authoritativePosterReady;
  const authoritativeDelivery = row.render_variant_id ? database.prepare(`SELECT v.mime_type
    FROM media_variants v JOIN media_objects o ON o.owner_id=? AND o.object_key=v.object_key
    WHERE v.id=? AND v.asset_id=? AND v.role='render' AND v.status='verified'
      AND v.verification_origin='private_derivative_v1'
      AND o.storage_scope='public' AND o.status IN ('issued','associated')`)
    .get(ownerId, row.render_variant_id, row.id) : null;
  const authoritativeDeliveryReady = row.kind === "image"
    ? (!input.serverOriginalDelivery || (!!authoritativeDelivery
      && IMAGE_VARIANT_TYPES.has(authoritativeDelivery.mime_type)))
    : authoritativeDelivery?.mime_type === "video/mp4";
  if (row.finalize_hash && !finalizedSourceMatches(row, input)) {
    throw new ApiError(409, "That media item was already finalized with different edits.", "CONFLICT");
  }
  if (row.finalize_hash && row.kind === "video") {
    const retryRecipe = normalizedRecipe(row, body?.editRecipe ?? {}, Number(row.duration_ms)).encodedRecipe;
    if (row.edit_recipe !== retryRecipe) {
      throw new ApiError(409, "That clip cover changed after source verification. Start the clip again.", "CONFLICT");
    }
  }
  if (row.finalize_hash && !needsCodecVerification && !needsAuthoritativePoster && authoritativeDeliveryReady) {
    // A lost-response retry is also an authenticated signal that this draft is
    // still in use. Renew the lease instead of merely observing the ledger so a
    // cleanup pass cannot retire it while the owner resumes the workflow.
    touchLiveLedger(database, ownerId, row.source_key, at);
    return { asset: assetProjection(loadAsset(database, row.id), { owner: true }), duplicate: true };
  }
  if (!row.finalize_hash && row.status !== "upload_pending") {
    throw new ApiError(409, "That media item cannot be finalized again.", "CONFLICT");
  }
  if (typeof fetchImpl !== "function") throw new ApiError(503, "Media verification is unavailable.", "MEDIA_STORAGE_UNAVAILABLE");
  const admissionFingerprint = row.kind === "image" ? fingerprint({
    assetId: row.id,
    sourceKey: row.source_key,
    byteSize: row.byte_size,
    mimeType: row.mime_type,
    storageScope: row.source_storage_scope || "public",
    finalizeHash: input.finalizeHash,
    altText: input.altText,
    encodedRecipe: input.encodedRecipe,
    serverOriginalDelivery: input.serverOriginalDelivery,
    renderState: input.renderState,
    status: input.status,
  }) : null;
  if (row.kind === "image"
      && imageFinalizationStage !== IMAGE_FINALIZATION_PREFLIGHT_TOKEN
      && imageFinalizationStage !== IMAGE_FINALIZATION_GENERATION_TOKEN) {
    requireLiveLedger(database, ownerId, row.source_key);
    return runImageFinalizationPreflight({
      scope: database,
      ownerId,
      baseKey: `asset:${row.id}:${row.source_key}`,
      fingerprint: admissionFingerprint,
      byteSize: Number(row.byte_size),
      signal,
      onJoin: joinedFinalizationResult,
      task: ({ signal: sharedSignal }) => finalizeMediaAsset(database, {
        ownerId,
        assetId,
        body,
        env,
        at,
        fetchImpl,
        authoritativeVideoVerifier,
        authoritativePosterRequired,
        beforeAuthoritativeVerify,
        imageProcessor,
        signal: sharedSignal,
        imageFinalizationStage: IMAGE_FINALIZATION_PREFLIGHT_TOKEN,
        imageExpectedFingerprint: admissionFingerprint,
      }),
    });
  }
  if (row.kind === "image" && imageExpectedFingerprint
      && imageExpectedFingerprint !== admissionFingerprint) {
    throw new ApiError(409, "That photo changed while it was waiting to be verified.", "CONFLICT");
  }
  const stored = row.kind === "image" && imageFinalizationStage === IMAGE_FINALIZATION_GENERATION_TOKEN
    ? requireAdmittedStoredGeneration(imageStoredObject, {
      expectedBytes: row.byte_size,
      expectedType: row.mime_type,
    })
    : await verifyStoredObject({
      objectKey: row.source_key,
      expectedBytes: row.byte_size,
      expectedType: row.mime_type,
      env,
      fetchImpl,
      signal,
      storageScope: row.source_storage_scope || "public",
    });
  // Re-check after the asynchronous HEAD. Cancellation/orphan cleanup can win
  // while storage is responding; never spend a second capability or certify
  // bytes for an object whose ledger has already entered deletion.
  requireLiveLedger(database, ownerId, row.source_key);
  if (row.kind === "image" && imageFinalizationStage === IMAGE_FINALIZATION_PREFLIGHT_TOKEN) {
    return runImageFinalizationGeneration({
      scope: database,
      ownerId,
      baseKey: `asset:${row.id}:${row.source_key}:${stored.etag}`,
      fingerprint: admissionFingerprint,
      byteSize: Number(row.byte_size),
      signal,
      onJoin: joinedFinalizationResult,
      task: ({ signal: sharedSignal }) => finalizeMediaAsset(database, {
        ownerId,
        assetId,
        body,
        env,
        at,
        fetchImpl,
        authoritativeVideoVerifier,
        authoritativePosterRequired,
        beforeAuthoritativeVerify,
        imageProcessor,
        signal: sharedSignal,
        imageFinalizationStage: IMAGE_FINALIZATION_GENERATION_TOKEN,
        imageStoredObject: stored,
        imageExpectedFingerprint: admissionFingerprint,
      }),
    });
  }
  let stagedAuthoritativeImage = null;
  if (row.kind === "image") {
    const verifiedImage = await verifyStoredImage({
      objectKey: row.source_key,
      stored,
      expectedBytes: row.byte_size,
      expectedType: row.mime_type,
      env,
      fetchImpl,
      signal,
      storageScope: row.source_storage_scope || "public",
    });
    const decoded = input.serverOriginalDelivery
      ? await runImageProcessor(imageProcessor?.sanitize || defaultImageProcessor.sanitize, {
        bytes: verifiedImage.bytes,
        expectedType: row.mime_type,
        outputType: serverImageDeliveryType(row.mime_type),
        timeoutMs: 60_000,
        maxEdge: PHOTO_MAX_EDGE,
        allowHeicFallback: true,
        allowLegacyJpegTrailer: true,
      }, { sanitizing: true })
      : await runImageProcessor(imageProcessor?.validate || defaultImageProcessor.validate, {
        bytes: verifiedImage.bytes,
        expectedType: row.mime_type,
        timeoutMs: 60_000,
        allowHeicFallback: true,
        allowLegacyJpegTrailer: true,
      });
    input = normalizedAssetFinalize(row, {
      ...body,
      width: decoded.sourceWidth ?? decoded.width,
      height: decoded.sourceHeight ?? decoded.height,
    });
    if (input.serverOriginalDelivery) {
      const variantIdentity = fingerprint({
        origin: "private_derivative_v1",
        assetId: row.id,
        sourceKey: row.source_key,
        sourceEtag: stored.etag,
        editRecipe: input.encodedRecipe,
      });
      const variantId = `mv_${variantIdentity.slice(0, 24)}`;
      const staged = await stageSanitizedImageDelivery(database, {
        ownerId,
        asset: row,
        variantId,
        stagingKey: row.source_key,
        output: decoded,
        env,
        at,
        fetchImpl,
        signal,
      });
      stagedAuthoritativeImage = {
        ...staged,
        variantId,
        sourceEtag: stored.etag,
      };
    }
  }
  let codecVerified = row.kind !== "video";
  let stagedAuthoritativePoster = null;
  let stagedAuthoritativeDelivery = null;
  if (row.kind === "video") {
    if (!stored.etag) {
      throw new ApiError(503, "The clip could not be inspected in storage yet. Try again.", "MEDIA_STORAGE_UNAVAILABLE");
    }
    const declared = input;
    let structural;
    try {
      structural = await verifyMp4Compatibility({
        objectKey: row.source_key,
        expectedBytes: row.byte_size,
        contentType: row.mime_type,
        ifMatch: stored.etag,
        env,
        fetchImpl,
        signal,
        storageScope: row.source_storage_scope || "public",
      });
    } catch (error) {
      throw terminalVideoSourceFailure(error);
    }
    const structurallyNormalized = authoritativeVideoFinalize(row, body, declared, structural);
    if (typeof authoritativeVideoVerifier === "function") {
      const preparedDelivery = prepareAuthoritativeDelivery(database, {
        ownerId,
        assetId: row.id,
        sourceEtag: stored.etag,
        editRecipe: structurallyNormalized.editRecipe,
        env,
        at,
      });
      let decoded;
      try {
        decoded = await authoritativeVideoVerifier({
          objectKey: row.source_key,
          expectedBytes: row.byte_size,
          contentType: row.mime_type,
          ifMatch: stored.etag,
          structural,
          posterTimeMs: Number(structurallyNormalized.editRecipe.coverMs),
          env,
          fetchImpl,
          signal,
          beforeStart: beforeAuthoritativeVerify,
          output: preparedDelivery.upload,
        });
      } catch (error) {
        if (error instanceof ApiError) throw terminalVideoSourceFailure(error);
        throw new ApiError(503, "Clip decoding is unavailable. Try again later.", "MEDIA_STORAGE_UNAVAILABLE", error);
      }
      // A future decoder/transcoder integration must return its own measured
      // duration and dimensions. Re-run the same owner-declared comparison on
      // those results; a truthy flag or the structural probe alone can never
      // elevate a clip to codec-verified/public state.
      if (!decoded || typeof decoded !== "object") {
        throw new ApiError(503, "Clip decoding is unavailable. Try again later.", "MEDIA_STORAGE_UNAVAILABLE");
      }
      if (Number(decoded.width) !== Number(structural.width)
          || Number(decoded.height) !== Number(structural.height)
          || Math.abs(Number(decoded.durationMs) - Number(structural.durationMs)) > MAX_VIDEO_DURATION_DRIFT_MS) {
        throw new ApiError(409, "The decoded clip does not match its container metadata.", "CONFLICT");
      }
      input = authoritativeVideoFinalize(row, body, declared, decoded);
      codecVerified = true;
      stagedAuthoritativeDelivery = await stageAuthoritativeDelivery(database, {
        ownerId,
        assetId: row.id,
        delivery: decoded.delivery,
        prepared: preparedDelivery,
        env,
        fetchImpl,
        signal,
      });
      if (decoded.poster) {
        stagedAuthoritativePoster = await stageAuthoritativePoster(database, {
          ownerId,
          assetId: row.id,
          poster: decoded.poster,
          durationMs: input.durationMs,
          sourceEtag: stored.etag,
          env,
          at,
          fetchImpl,
          signal,
        });
      }
      if (authoritativePosterRequired && !stagedAuthoritativePoster && !authoritativePosterReady) {
        throw new ApiError(503, "Clip decoding did not produce a verified cover. Try again later.", "MEDIA_STORAGE_UNAVAILABLE");
      }
      if (!stagedAuthoritativeDelivery) {
        throw new ApiError(503, "Clip sanitization did not produce a verified delivery. Try again later.", "MEDIA_STORAGE_UNAVAILABLE");
      }
    } else {
      // The bounded ISO-BMFF parser proves container/sample-table coherence, but it
      // is not a full H.264/AAC decode. A caller without the readiness-gated
      // private-derivative-v1 worker therefore cannot elevate or attach the clip. This
      // avoids certifying a black or truncated stream merely because its first
      // structural fields look plausible.
      input = { ...structurallyNormalized, status: "render_unavailable", renderState: "unavailable" };
    }
  }

  return withWrite(database, () => {
    const current = database.prepare("SELECT * FROM media_assets WHERE id=? AND owner_id=?").get(row.id, ownerId);
    if (current?.finalize_hash) {
      if (!finalizedSourceMatches(current, input)) throw new ApiError(409, "That media item changed while it was finalizing.", "CONFLICT");
      touchLiveLedger(database, ownerId, current.source_key, at);
      if (current.kind === "video" && current.codec_status !== "verified" && codecVerified) {
        database.prepare(`UPDATE media_assets SET width=?,height=?,duration_ms=?,codec_status='verified',codec_verified_at=?,
          status=?,render_state=?,source_verified_at=COALESCE(source_verified_at,?),updated_at=?
          WHERE id=? AND owner_id=? AND codec_status!='verified'`)
          .run(input.width, input.height, input.durationMs, at, input.status, input.renderState,
            at, at, row.id, ownerId);
      }
      commitAuthoritativePoster(database, {
        ownerId,
        assetId: row.id,
        staged: stagedAuthoritativePoster,
        at,
      });
      commitAuthoritativeDelivery(database, {
        ownerId,
        assetId: row.id,
        staged: stagedAuthoritativeDelivery,
        at,
      });
      commitAuthoritativeImageDelivery(database, {
        ownerId,
        assetId: row.id,
        staged: stagedAuthoritativeImage,
        input,
        at,
      });
      database.prepare("UPDATE media_assets SET source_etag=? WHERE id=? AND owner_id=?")
        .run(stored.etag, row.id, ownerId);
      return { asset: assetProjection(loadAsset(database, row.id), { owner: true }), duplicate: true };
    }
    if (!current || current.status !== "upload_pending") throw new ApiError(409, "That media item changed while it was finalizing.", "CONFLICT");
    touchLiveLedger(database, ownerId, current.source_key, at);
    database.prepare(`UPDATE media_assets SET width=?,height=?,duration_ms=?,orientation=?,alt_text=?,metadata_status='declared',
      codec_status=?,codec_verified_at=?,status=?,edit_recipe=?,recipe_version=?,finalize_hash=?,source_verified_at=?,render_state=?,updated_at=?
      WHERE id=? AND owner_id=?`)
      .run(input.width, input.height, input.durationMs, input.orientation, input.altText,
        row.kind === "video" && codecVerified ? "verified" : row.kind === "video" ? "pending" : "not_applicable",
        row.kind === "video" && codecVerified ? at : null,
        input.status, input.encodedRecipe, input.editRecipe.version, input.finalizeHash, at,
        input.renderState, at, row.id, ownerId);
    commitAuthoritativePoster(database, {
      ownerId,
      assetId: row.id,
      staged: stagedAuthoritativePoster,
      at,
    });
    commitAuthoritativeDelivery(database, {
      ownerId,
      assetId: row.id,
      staged: stagedAuthoritativeDelivery,
      at,
    });
    commitAuthoritativeImageDelivery(database, {
      ownerId,
      assetId: row.id,
      staged: stagedAuthoritativeImage,
      input,
      at,
    });
    database.prepare("UPDATE media_assets SET source_etag=? WHERE id=? AND owner_id=?")
      .run(stored.etag, row.id, ownerId);
    return { asset: assetProjection(loadAsset(database, row.id), { owner: true }), duplicate: false };
  });
}

function pendingPhotoRevision(database, assetId) {
  return database.prepare("SELECT * FROM media_asset_revisions WHERE asset_id=?").get(assetId);
}

function queuePendingRevisionObject(database, revision, { ownerId, at }) {
  if (!revision?.object_key) return;
  // A completed deletion removes the ledger only after storage confirms the
  // object is gone. Treat that as an already-retired staged upload so an old
  // revision cannot trap its owner in an unrecoverable retry loop.
  const ledger = database.prepare("SELECT status FROM media_objects WHERE owner_id=? AND object_key=?")
    .get(ownerId, revision.object_key);
  if (!ledger) return;
  const queued = enqueueOwnedMediaKeys(database, { ownerId, keys: [revision.object_key], at });
  if (queued.accepted !== 1) {
    throw new ApiError(409, "That pending photo rendition is no longer available. Start the edit again.", "CONFLICT");
  }
}

function cancelPendingPhotoRevision(database, revision, { ownerId, at }) {
  if (!revision) return false;
  queuePendingRevisionObject(database, revision, { ownerId, at });
  database.prepare("DELETE FROM media_asset_revisions WHERE asset_id=?").run(revision.asset_id);
  return true;
}

function stagePhotoRecipeRevision(database, row, { encodedRecipe, recipeVersion, ownerId, at }) {
  const current = pendingPhotoRevision(database, row.id);
  if (current && current.base_render_variant_id !== row.render_variant_id) {
    throw new ApiError(409, "That photo rendition changed while it was being edited. Reopen PIT Studio.", "CONFLICT");
  }
  if (current?.edit_recipe === encodedRecipe) {
    database.prepare("UPDATE media_asset_revisions SET updated_at=? WHERE asset_id=?")
      .run(at, row.id);
    return current;
  }
  if (current) queuePendingRevisionObject(database, current, { ownerId, at });
  database.prepare(`INSERT INTO media_asset_revisions
      (asset_id,edit_recipe,recipe_version,base_render_variant_id,variant_id,client_variant_id,create_hash,
        object_key,public_url,mime_type,byte_size,status,created_at,updated_at)
    VALUES (?,?,?,?,NULL,NULL,NULL,NULL,NULL,NULL,NULL,'recipe_pending',?,?)
    ON CONFLICT(asset_id) DO UPDATE SET
      edit_recipe=excluded.edit_recipe,recipe_version=excluded.recipe_version,
      base_render_variant_id=excluded.base_render_variant_id,variant_id=NULL,client_variant_id=NULL,
      create_hash=NULL,object_key=NULL,public_url=NULL,mime_type=NULL,byte_size=NULL,
      status='recipe_pending',updated_at=excluded.updated_at`)
    .run(row.id, encodedRecipe, recipeVersion, row.render_variant_id, at, at);
  return pendingPhotoRevision(database, row.id);
}

export function updateMediaAsset(database, {
  ownerId,
  assetId,
  body,
  at = Date.now(),
} = {}) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new ApiError(400, "Media changes are invalid.", "VALIDATION_FAILED");
  }
  const allowed = new Set(["altText", "editRecipe"]);
  const fields = Object.keys(body);
  if (!fields.length || fields.some((field) => !allowed.has(field))) {
    throw new ApiError(400, "Only media description and edits can be changed here.", "VALIDATION_FAILED");
  }
  const hasAltText = Object.prototype.hasOwnProperty.call(body, "altText");
  const hasRecipe = Object.prototype.hasOwnProperty.call(body, "editRecipe");

  return withWrite(database, () => {
    const row = database.prepare("SELECT * FROM media_assets WHERE id=? AND owner_id=?").get(assetId, ownerId);
    if (!row) throw new ApiError(404, "That media item was not found.", "NOT_FOUND");
    touchLiveLedger(database, ownerId, row.source_key, at);
    if (!row.finalize_hash || row.status === "upload_pending") {
      throw new ApiError(409, "Finalize the original media before changing its description or edits.", "CONFLICT");
    }
    const altText = hasAltText ? normalizedAltText(body.altText) : row.alt_text || "";
    let recipe = parseJsonObject(row.edit_recipe);
    let encodedRecipe = row.edit_recipe;
    let recipeChanged = false;
    if (hasRecipe) {
      const normalized = normalizedRecipe(row, body.editRecipe, row.duration_ms);
      recipe = normalized.editRecipe;
      encodedRecipe = normalized.encodedRecipe;
      recipeChanged = encodedRecipe !== row.edit_recipe;
      if (recipeChanged && row.kind === "video" && row.codec_status === "verified") {
        // The cover is cryptographically tied to the verifier response and the
        // exact source generation. The current synchronous v1 flow has no
        // server-side re-cover command, so never downgrade a verified clip to a
        // client-declared poster during an unattached re-edit.
        throw new ApiError(409, "Choose the cover before verifying this clip. To change it now, add the clip again.", "CONFLICT");
      }
      if (recipeChanged && database.prepare("SELECT 1 FROM post_media WHERE asset_id=?").get(row.id)) {
        throw new ApiError(409, "Media edits cannot change after this item is published.", "CONFLICT");
      }
    }

    const activePhotoReady = row.kind === "image" && row.status === "ready"
      && row.render_state === "ready" && !!row.render_variant_id;
    let revisionPending = false;
    if (hasRecipe && activePhotoReady) {
      const activeRender = database.prepare(`SELECT v.id,v.status,mo.status ledger_status
        FROM media_variants v LEFT JOIN media_objects mo
          ON mo.owner_id=? AND mo.object_key=v.object_key
        WHERE v.id=? AND v.asset_id=? AND v.role='render'`).get(ownerId, row.render_variant_id, row.id);
      if (!activeRender || activeRender.status !== "verified" || !isLiveLedgerStatus(activeRender.ledger_status)) {
        throw new ApiError(409, "That ready photo rendition is no longer available. Reopen PIT Studio.", "CONFLICT");
      }
      if (recipeChanged) {
        stagePhotoRecipeRevision(database, row, {
          encodedRecipe,
          recipeVersion: recipe.version,
          ownerId,
          at,
        });
        revisionPending = true;
      } else {
        cancelPendingPhotoRevision(database, pendingPhotoRevision(database, row.id), { ownerId, at });
      }
      if (hasAltText && altText !== (row.alt_text || "")) {
        database.prepare("UPDATE media_assets SET alt_text=?,updated_at=? WHERE id=? AND owner_id=?")
          .run(altText, at, row.id, ownerId);
      } else if (recipeChanged) {
        database.prepare("UPDATE media_assets SET updated_at=? WHERE id=? AND owner_id=?")
          .run(at, row.id, ownerId);
      }
    } else if (recipeChanged) {
      // Assets without an active verified photo rendition still use the initial
      // preparation flow. There is no public object to preserve in this branch.
      const variantKeys = database.prepare("SELECT object_key FROM media_variants WHERE asset_id=?").all(row.id)
        .map((variant) => variant.object_key);
      const queued = enqueueOwnedMediaKeys(database, { ownerId, keys: variantKeys, at });
      if (queued.accepted !== new Set(variantKeys).size) {
        throw new ApiError(409, "A previous media rendition is no longer available. Start the edit again.", "CONFLICT");
      }
      database.prepare("DELETE FROM media_variants WHERE asset_id=?").run(row.id);
      let { renderState, status } = deliveryStateForRecipe(row, recipe);
      if (row.kind === "video" && row.codec_status !== "verified") {
        renderState = "unavailable";
        status = "render_unavailable";
      }
      database.prepare(`UPDATE media_assets SET alt_text=?,edit_recipe=?,recipe_version=?,status=?,render_state=?,
        render_variant_id=NULL,poster_variant_id=NULL,poster_key=NULL,poster_url=NULL,poster_time_ms=NULL,updated_at=?
        WHERE id=? AND owner_id=?`).run(altText, encodedRecipe, recipe.version, status, renderState, at, row.id, ownerId);
    } else if (hasAltText && altText !== (row.alt_text || "")) {
      database.prepare("UPDATE media_assets SET alt_text=?,updated_at=? WHERE id=? AND owner_id=?")
        .run(altText, at, row.id, ownerId);
    }
    const asset = assetProjection(loadAsset(database, row.id), { owner: true });
    return {
      asset,
      recipeChanged,
      revisionPending: !!asset.revisionPending,
    };
  });
}

function variantInput(asset, body, { pendingRevision = false } = {}) {
  assertNoObjectReferences(body);
  const role = body?.role === "poster" || body?.role === "render" ? body.role : "";
  if (!role) throw new ApiError(400, "Choose a supported media rendition.", "VALIDATION_FAILED");
  if (role === "poster" && asset.kind !== "video") {
    throw new ApiError(400, "Only clips use a separate cover frame.", "VALIDATION_FAILED");
  }
  if (role === "poster" && asset.kind === "video") {
    throw new ApiError(409, "PIT generates and verifies clip covers with the video decoder.", "CONFLICT");
  }
  if (role === "render" && asset.kind === "video") {
    throw new ApiError(409, "Edited clip export is not available until PIT's video encoder is configured.", "CONFLICT");
  }
  if (asset.status === "upload_pending" || asset.status === "failed") {
    throw new ApiError(409, "Finalize the original media before adding a rendition.", "CONFLICT");
  }
  if (role === "render" && asset.render_state !== "pending" && !pendingRevision) {
    throw new ApiError(409, "This media item does not need an image rendition.", "CONFLICT");
  }
  const type = contentType(body?.contentType);
  if (!IMAGE_VARIANT_TYPES.has(type)) {
    throw new ApiError(415, "Renditions must be JPEG, PNG, or WebP.", "MEDIA_TYPE_UNSUPPORTED");
  }
  const maxBytes = role === "poster" ? 5 * 1024 * 1024 : 12 * 1024 * 1024;
  const fileSize = integer(body?.fileSize, { label: "Rendition size", min: 1, max: maxBytes });
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name || name.length > 180 || /[\u0000-\u001f\u007f/\\]/.test(name)) {
    throw new ApiError(400, "Rendition name is invalid.", "VALIDATION_FAILED");
  }
  const clientVariantId = cleanClientId(body?.clientVariantId, "Rendition retry token");
  if (clientVariantId.startsWith("pit-worker-")) {
    throw new ApiError(400, "That rendition retry token is reserved by PIT.", "VALIDATION_FAILED");
  }
  const canonical = { role, contentType: type, fileSize, name, clientVariantId };
  return { ...canonical, createHash: fingerprint(canonical) };
}

function variantUploadRequest(asset, variant, { env, at }) {
  return {
    ownerId: asset.owner_id,
    body: {
      purpose: asset.purpose,
      contentType: variant.mime_type,
      fileSize: variant.byte_size,
      name: `${variant.role}.${variant.mime_type.split("/")[1] || "jpg"}`,
    },
    env,
    at,
    objectId: objectIdFromKey(variant.object_key),
    storageScope: asset.kind === "image" ? "private" : "public",
    accountingClass: MEDIA_UPLOAD_ACCOUNTING_CLASS.SERVICE_GENERATED,
  };
}

function pendingRevisionVariant(revision) {
  if (!revision?.variant_id) return null;
  return {
    id: revision.variant_id,
    asset_id: revision.asset_id,
    client_variant_id: revision.client_variant_id,
    create_hash: revision.create_hash,
    role: "render",
    object_key: revision.object_key,
    public_url: revision.public_url,
    mime_type: revision.mime_type,
    byte_size: revision.byte_size,
    width: null,
    height: null,
    time_ms: null,
    status: revision.status,
    finalize_hash: null,
    verified_at: null,
    created_at: revision.created_at,
    updated_at: revision.updated_at,
  };
}

function createPendingPhotoRevisionVariant(database, {
  asset,
  revision,
  input,
  ownerId,
  env,
  at,
  variantId,
}) {
  if (input.role !== "render" || asset.kind !== "image") {
    throw new ApiError(409, "That pending revision accepts only a rendered photo.", "CONFLICT");
  }
  if (revision.base_render_variant_id !== asset.render_variant_id
      || database.prepare("SELECT 1 FROM post_media WHERE asset_id=?").get(asset.id)) {
    throw new ApiError(409, "That photo can no longer be replaced. Reopen PIT Studio.", "CONFLICT");
  }

  let staged = pendingRevisionVariant(revision);
  const stagedLedger = staged
    ? database.prepare("SELECT status FROM media_objects WHERE owner_id=? AND object_key=?").get(ownerId, staged.object_key)
    : null;
  if (staged && staged.create_hash === input.createHash && isLiveLedgerStatus(stagedLedger?.status)) {
    const ticket = reserveAndSign(database, variantUploadRequest(asset, staged, { env, at }));
    database.prepare("UPDATE media_asset_revisions SET updated_at=? WHERE asset_id=?")
      .run(at, asset.id);
    return { variant: variantProjection({ ...staged, updated_at: at }), upload: ticket, duplicate: true };
  }
  if (staged && staged.client_variant_id === input.clientVariantId && staged.mime_type !== input.contentType) {
    throw new ApiError(409, "That rendition retry token belongs to a different output format.", "CONFLICT");
  }

  const replaced = !!staged;
  if (staged) queuePendingRevisionObject(database, revision, { ownerId, at });
  let nextVariantId = variantId;
  if (staged?.id === nextVariantId
      || database.prepare("SELECT 1 FROM media_variants WHERE id=?").get(nextVariantId)
      || database.prepare("SELECT 1 FROM media_asset_revisions WHERE variant_id=? AND asset_id!=?").get(nextVariantId, asset.id)) {
    nextVariantId = newId("mv");
  }
  const objectId = `${asset.id}_${input.role}_${nextVariantId}`;
  const ticket = reserveAndSign(database, {
    ownerId,
    body: {
      purpose: asset.purpose,
      contentType: input.contentType,
      fileSize: input.fileSize,
      name: input.name,
    },
    env,
    at,
    objectId,
    storageScope: "private",
    accountingClass: MEDIA_UPLOAD_ACCOUNTING_CLASS.SERVICE_GENERATED,
  });
  database.prepare(`UPDATE media_asset_revisions SET
      variant_id=?,client_variant_id=?,create_hash=?,object_key=?,public_url=?,mime_type=?,byte_size=?,
      status='upload_pending',updated_at=?
    WHERE asset_id=? AND base_render_variant_id=?`)
    .run(nextVariantId, input.clientVariantId, input.createHash, ticket.key, ticket.storageLocator,
      input.contentType, input.fileSize, at, asset.id, asset.render_variant_id);
  const updated = pendingPhotoRevision(database, asset.id);
  if (!updated || updated.variant_id !== nextVariantId) {
    throw new ApiError(409, "That photo revision changed while its upload was being prepared.", "CONFLICT");
  }
  staged = pendingRevisionVariant(updated);
  return { variant: variantProjection(staged), upload: ticket, duplicate: false, replaced };
}

export function createMediaVariant(database, {
  ownerId,
  assetId,
  body,
  env = process.env,
  at = Date.now(),
  variantId = newId("mv"),
} = {}) {
  if (!VARIANT_ID.test(variantId)) throw new ApiError(500, "Media rendition could not be prepared.", "INTERNAL_ERROR");
  return withWrite(database, () => {
    const asset = database.prepare("SELECT * FROM media_assets WHERE id=? AND owner_id=?").get(assetId, ownerId);
    if (!asset) throw new ApiError(404, "That media item was not found.", "NOT_FOUND");
    touchLiveLedger(database, ownerId, asset.source_key, at);
    const revision = pendingPhotoRevision(database, asset.id);
    const input = variantInput(asset, body, { pendingRevision: !!revision });
    if (revision) {
      return createPendingPhotoRevisionVariant(database, {
        asset,
        revision,
        input,
        ownerId,
        env,
        at,
        variantId,
      });
    }
    let variant = database.prepare("SELECT * FROM media_variants WHERE asset_id=? AND client_variant_id=?")
      .get(asset.id, input.clientVariantId);
    if (variant && variant.create_hash === input.createHash) {
      if (variant.status !== "upload_pending") return { variant: variantProjection(variant), upload: null, duplicate: true };
      const ticket = reserveAndSign(database, variantUploadRequest(asset, variant, { env, at }));
      return { variant: variantProjection(variant), upload: ticket, duplicate: true };
    }
    if (variant && (variant.role !== input.role || variant.mime_type !== input.contentType)) {
      throw new ApiError(409, "That rendition retry token belongs to a different output role or format.", "CONFLICT");
    }
    if (variant?.status === "verified") {
      throw new ApiError(409, "That verified rendition is immutable. Change the media edit before replacing it.", "CONFLICT");
    }

    // Encoders can produce a different byte size or filename for the same
    // logical retry token. An unfinished token therefore replaces its pending
    // object with a fresh, non-reused identity; exact-byte retries above keep the
    // existing identity. Verified output is never replaced in place.
    const existingRole = variant || database.prepare("SELECT * FROM media_variants WHERE asset_id=? AND role=?").get(asset.id, input.role);
    if (existingRole?.status === "verified") {
      throw new ApiError(409, "That verified rendition is immutable. Change the media edit before replacing it.", "CONFLICT");
    }
    if (existingRole) {
      const queued = enqueueOwnedMediaKeys(database, { ownerId, keys: [existingRole.object_key], at });
      if (queued.accepted !== 1) {
        throw new ApiError(409, "That previous rendition is no longer available. Start the edit again.", "CONFLICT");
      }
      database.prepare("DELETE FROM media_variants WHERE id=? AND asset_id=?").run(existingRole.id, asset.id);
    }

    {
      const nextVariantId = existingRole?.id === variantId ? newId("mv") : variantId;
      const objectId = `${asset.id}_${input.role}_${nextVariantId}`;
      const ticket = reserveAndSign(database, {
        ownerId,
        body: {
          purpose: asset.purpose,
          contentType: input.contentType,
          fileSize: input.fileSize,
          name: input.name,
        },
        env,
        at,
        objectId,
        storageScope: "private",
        accountingClass: MEDIA_UPLOAD_ACCOUNTING_CLASS.SERVICE_GENERATED,
      });
      database.prepare(`INSERT INTO media_variants
        (id,asset_id,client_variant_id,create_hash,role,object_key,public_url,mime_type,byte_size,status,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,'upload_pending',?,?)`)
        .run(nextVariantId, asset.id, input.clientVariantId, input.createHash, input.role, ticket.key,
          ticket.storageLocator, input.contentType, input.fileSize, at, at);
      variant = database.prepare("SELECT * FROM media_variants WHERE id=?").get(nextVariantId);
      return { variant: variantProjection(variant), upload: ticket, duplicate: false, replaced: !!existingRole };
    }
  });
}

function variantFinalizeInput(asset, variant, body) {
  assertNoObjectReferences(body);
  const width = integer(body?.width, { label: "Rendition width", min: 1, max: MAX_IMAGE_EDGE });
  const height = integer(body?.height, { label: "Rendition height", min: 1, max: MAX_IMAGE_EDGE });
  let timeMs = null;
  if (variant.role === "poster") {
    const upper = Math.max(0, Number(asset.duration_ms || 0) - 1);
    timeMs = integer(body?.timeMs, { label: "Cover frame time", min: 0, max: upper });
    const recipe = parseJsonObject(asset.edit_recipe);
    const trimStart = Number(recipe.trimStartMs || 0);
    const trimEnd = Number(recipe.trimEndMs || asset.duration_ms || 0);
    if (timeMs < trimStart || timeMs >= trimEnd) {
      throw new ApiError(400, "Choose a cover frame inside the published clip.", "VALIDATION_FAILED");
    }
  }
  const canonical = { width, height, timeMs };
  return { ...canonical, finalizeHash: fingerprint(canonical) };
}

function loadPendingPhotoRevisionVariant(database, { ownerId, assetId, variantId }) {
  return database.prepare(`SELECT
      r.variant_id id,r.asset_id,r.client_variant_id,r.create_hash,'render' role,
      r.object_key,r.public_url,r.mime_type,r.byte_size,NULL width,NULL height,NULL time_ms,
      r.status,NULL finalize_hash,NULL verified_at,r.created_at,r.updated_at,
      r.edit_recipe pending_edit_recipe,r.recipe_version pending_recipe_version,r.base_render_variant_id,
      a.render_variant_id,a.owner_id,a.purpose,a.kind,a.duration_ms,a.source_key,a.status asset_status,a.render_state,
      EXISTS (SELECT 1 FROM post_media pm WHERE pm.asset_id=a.id) attached
    FROM media_asset_revisions r JOIN media_assets a ON a.id=r.asset_id
    WHERE r.variant_id=? AND r.asset_id=? AND a.owner_id=?`)
    .get(variantId, assetId, ownerId);
}

async function finalizePendingPhotoRevisionVariant(database, {
  ownerId,
  assetId,
  variantId,
  row,
  body,
  env,
  at,
  fetchImpl,
  imageProcessor,
  signal,
  imageFinalizationStage = null,
  imageStoredObject = null,
  imageExpectedFingerprint = null,
}) {
  if (row.kind !== "image" || row.role !== "render" || row.attached) {
    throw new ApiError(409, "That photo can no longer be replaced. Reopen PIT Studio.", "CONFLICT");
  }
  if (row.base_render_variant_id !== row.render_variant_id) {
    throw new ApiError(409, "That photo rendition changed while it was being edited. Reopen PIT Studio.", "CONFLICT");
  }
  const asset = {
    id: assetId,
    owner_id: row.owner_id,
    purpose: row.purpose,
    kind: row.kind,
    duration_ms: row.duration_ms,
    edit_recipe: row.pending_edit_recipe,
    status: row.asset_status,
    render_state: row.render_state,
  };
  const input = variantFinalizeInput(asset, row, body);
  requireLiveLedger(database, ownerId, row.source_key);
  requireLiveLedger(database, ownerId, row.object_key);
  if (row.status !== "upload_pending") {
    throw new ApiError(409, "That rendition cannot be finalized again.", "CONFLICT");
  }
  if (typeof fetchImpl !== "function") {
    throw new ApiError(503, "Media verification is unavailable.", "MEDIA_STORAGE_UNAVAILABLE");
  }
  const admissionFingerprint = fingerprint({
    assetId,
    variantId,
    objectKey: row.object_key,
    createHash: row.create_hash,
    baseRenderVariantId: row.base_render_variant_id,
    pendingEditRecipe: row.pending_edit_recipe,
    byteSize: row.byte_size,
    mimeType: row.mime_type,
    finalizeHash: input.finalizeHash,
  });
  if (imageFinalizationStage !== IMAGE_FINALIZATION_PREFLIGHT_TOKEN
      && imageFinalizationStage !== IMAGE_FINALIZATION_GENERATION_TOKEN) {
    return runImageFinalizationPreflight({
      scope: database,
      ownerId,
      baseKey: `revision:${assetId}:${variantId}:${row.object_key}`,
      fingerprint: admissionFingerprint,
      byteSize: Number(row.byte_size),
      signal,
      onJoin: joinedFinalizationResult,
      task: ({ signal: sharedSignal }) => finalizePendingPhotoRevisionVariant(database, {
        ownerId,
        assetId,
        variantId,
        row,
        body,
        env,
        at,
        fetchImpl,
        imageProcessor,
        signal: sharedSignal,
        imageFinalizationStage: IMAGE_FINALIZATION_PREFLIGHT_TOKEN,
        imageExpectedFingerprint: admissionFingerprint,
      }),
    });
  }
  if (imageExpectedFingerprint && imageExpectedFingerprint !== admissionFingerprint) {
    throw new ApiError(409, "That photo revision changed while it was waiting to be verified.", "CONFLICT");
  }
  const stored = imageFinalizationStage === IMAGE_FINALIZATION_GENERATION_TOKEN
    ? requireAdmittedStoredGeneration(imageStoredObject, {
      expectedBytes: row.byte_size,
      expectedType: row.mime_type,
    })
    : await verifyStoredObject({
      objectKey: row.object_key,
      expectedBytes: row.byte_size,
      expectedType: row.mime_type,
      env,
      fetchImpl,
      signal,
      storageScope: "private",
    });
  const afterHead = loadPendingPhotoRevisionVariant(database, { ownerId, assetId, variantId });
  if (!afterHead || afterHead.status !== "upload_pending" || afterHead.attached
      || afterHead.object_key !== row.object_key
      || afterHead.create_hash !== row.create_hash
      || afterHead.base_render_variant_id !== row.base_render_variant_id
      || afterHead.render_variant_id !== row.render_variant_id
      || afterHead.pending_edit_recipe !== row.pending_edit_recipe) {
    throw new ApiError(409, "That photo revision changed while it was waiting to be verified.", "CONFLICT");
  }
  requireLiveLedger(database, ownerId, afterHead.source_key);
  requireLiveLedger(database, ownerId, afterHead.object_key);
  if (imageFinalizationStage === IMAGE_FINALIZATION_PREFLIGHT_TOKEN) {
    return runImageFinalizationGeneration({
      scope: database,
      ownerId,
      baseKey: `revision:${assetId}:${variantId}:${row.object_key}:${stored.etag}`,
      fingerprint: admissionFingerprint,
      byteSize: Number(row.byte_size),
      signal,
      onJoin: joinedFinalizationResult,
      task: ({ signal: sharedSignal }) => finalizePendingPhotoRevisionVariant(database, {
        ownerId,
        assetId,
        variantId,
        row: afterHead,
        body,
        env,
        at,
        fetchImpl,
        imageProcessor,
        signal: sharedSignal,
        imageFinalizationStage: IMAGE_FINALIZATION_GENERATION_TOKEN,
        imageStoredObject: stored,
        imageExpectedFingerprint: admissionFingerprint,
      }),
    });
  }
  const verifiedImage = await verifyStoredImage({
    objectKey: row.object_key,
    stored,
    expectedBytes: row.byte_size,
    expectedType: row.mime_type,
    env,
    fetchImpl,
    signal,
    storageScope: "private",
  });
  const sanitized = await runImageProcessor(imageProcessor?.sanitize || defaultImageProcessor.sanitize, {
    bytes: verifiedImage.bytes,
    expectedType: row.mime_type,
  }, { sanitizing: true });
  assertVerifiedDimensions(sanitized, input.width, input.height);
  const stagedDelivery = await stageSanitizedImageDelivery(database, {
    ownerId,
    asset,
    variantId,
    stagingKey: row.object_key,
    output: sanitized,
    env,
    at,
    fetchImpl,
    signal,
  });

  return withWrite(database, () => {
    const current = loadPendingPhotoRevisionVariant(database, { ownerId, assetId, variantId });
    if (!current) {
      const committed = database.prepare(`SELECT v.*,a.source_key,a.owner_id
        FROM media_variants v JOIN media_assets a ON a.id=v.asset_id
        WHERE v.id=? AND v.asset_id=? AND a.owner_id=?`).get(variantId, assetId, ownerId);
      if (!committed?.finalize_hash || committed.finalize_hash !== input.finalizeHash) {
        throw new ApiError(409, "That photo revision changed while it was finalizing.", "CONFLICT");
      }
      touchLiveLedger(database, ownerId, committed.source_key, at);
      touchLiveLedger(database, ownerId, committed.object_key, at);
      return {
        asset: assetProjection(loadAsset(database, assetId), { owner: true }),
        variant: variantProjection(committed),
        duplicate: true,
      };
    }
    if (current.attached || current.status !== "upload_pending"
        || current.base_render_variant_id !== current.render_variant_id
        || current.pending_edit_recipe !== row.pending_edit_recipe
        || current.object_key !== row.object_key
        || current.create_hash !== row.create_hash) {
      throw new ApiError(409, "That photo revision changed while it was finalizing.", "CONFLICT");
    }
    const base = database.prepare(`SELECT v.* FROM media_variants v
      WHERE v.id=? AND v.asset_id=? AND v.role='render' AND v.status='verified'`)
      .get(current.base_render_variant_id, assetId);
    if (!base) {
      throw new ApiError(409, "That ready photo rendition is no longer available. Reopen PIT Studio.", "CONFLICT");
    }
    requireLiveLedger(database, ownerId, current.source_key);
    requireLiveLedger(database, ownerId, current.object_key);
    requireLiveLedger(database, ownerId, base.object_key);
    requireLiveLedger(database, ownerId, stagedDelivery.objectKey);
    touchLiveLedger(database, ownerId, current.source_key, at);
    touchLiveLedger(database, ownerId, current.object_key, at);

    const queued = enqueueOwnedMediaKeys(database, { ownerId, keys: [base.object_key], at });
    if (queued.accepted !== 1) {
      throw new ApiError(409, "That ready photo rendition is no longer available. Reopen PIT Studio.", "CONFLICT");
    }
    queuePrivateImageStaging(database, { ownerId, stagingKey: current.object_key, at });
    database.prepare("DELETE FROM media_variants WHERE id=? AND asset_id=?")
      .run(base.id, assetId);
    database.prepare(`INSERT INTO media_variants
      (id,asset_id,client_variant_id,create_hash,role,object_key,public_url,mime_type,byte_size,
        width,height,time_ms,status,finalize_hash,verified_at,verification_origin,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,NULL,'verified',?,?,'private_derivative_v1',?,?)`)
      .run(variantId, assetId, current.client_variant_id, current.create_hash, "render",
        stagedDelivery.objectKey, stagedDelivery.upload.publicUrl, sanitized.mimeType, sanitized.byteSize,
        sanitized.width, sanitized.height, input.finalizeHash, at, current.created_at, at);
    const swapped = database.prepare(`UPDATE media_assets SET
        edit_recipe=?,recipe_version=?,render_variant_id=?,render_state='ready',status='ready',updated_at=?
      WHERE id=? AND owner_id=? AND render_variant_id=?`)
      .run(current.pending_edit_recipe, current.pending_recipe_version, variantId, at,
        assetId, ownerId, base.id);
    if (swapped.changes !== 1) {
      throw new ApiError(409, "That photo revision changed while it was being committed.", "CONFLICT");
    }
    database.prepare("DELETE FROM media_asset_revisions WHERE asset_id=? AND variant_id=?")
      .run(assetId, variantId);
    const finalVariant = database.prepare("SELECT * FROM media_variants WHERE id=? AND asset_id=?")
      .get(variantId, assetId);
    if (!finalVariant) {
      throw new ApiError(409, "That photo revision could not be committed. Try again.", "CONFLICT");
    }
    return {
      asset: assetProjection(loadAsset(database, assetId), { owner: true }),
      variant: variantProjection(finalVariant),
      duplicate: false,
    };
  });
}

export async function finalizeMediaVariant(database, {
  ownerId,
  assetId,
  variantId,
  body,
  env = process.env,
  at = Date.now(),
  fetchImpl = globalThis.fetch,
  imageProcessor = defaultImageProcessor,
  signal,
  imageFinalizationStage = null,
  imageStoredObject = null,
  imageExpectedFingerprint = null,
} = {}) {
  let row = database.prepare(`SELECT v.*,a.owner_id,a.purpose,a.kind,a.duration_ms,a.edit_recipe,a.source_key,a.status asset_status,
      a.render_state FROM media_variants v JOIN media_assets a ON a.id=v.asset_id
      WHERE v.id=? AND v.asset_id=? AND a.owner_id=?`).get(variantId, assetId, ownerId);
  if (!row) {
    row = loadPendingPhotoRevisionVariant(database, { ownerId, assetId, variantId });
    if (!row) throw new ApiError(404, "That media rendition was not found.", "NOT_FOUND");
    return finalizePendingPhotoRevisionVariant(database, {
      ownerId,
      assetId,
      variantId,
      row,
      body,
      env,
      at,
      fetchImpl,
      imageProcessor,
      signal,
      imageFinalizationStage,
      imageStoredObject,
      imageExpectedFingerprint,
    });
  }
  const asset = {
    id: assetId,
    owner_id: row.owner_id,
    purpose: row.purpose,
    kind: row.kind,
    duration_ms: row.duration_ms,
    edit_recipe: row.edit_recipe,
    status: row.asset_status,
    render_state: row.render_state,
  };
  const input = variantFinalizeInput(asset, row, body);
  requireLiveLedger(database, ownerId, row.source_key);
  requireLiveLedger(database, ownerId, row.object_key);
  if (row.finalize_hash) {
    if (row.finalize_hash !== input.finalizeHash) throw new ApiError(409, "That rendition was already finalized differently.", "CONFLICT");
    touchLiveLedger(database, ownerId, row.source_key, at);
    touchLiveLedger(database, ownerId, row.object_key, at);
    return { asset: assetProjection(loadAsset(database, assetId), { owner: true }), variant: variantProjection(row), duplicate: true };
  }
  if (row.status !== "upload_pending") throw new ApiError(409, "That rendition cannot be finalized again.", "CONFLICT");
  if (typeof fetchImpl !== "function") throw new ApiError(503, "Media verification is unavailable.", "MEDIA_STORAGE_UNAVAILABLE");
  const admissionFingerprint = fingerprint({
    assetId,
    variantId,
    objectKey: row.object_key,
    createHash: row.create_hash,
    role: row.role,
    byteSize: row.byte_size,
    mimeType: row.mime_type,
    finalizeHash: input.finalizeHash,
  });
  if (imageFinalizationStage !== IMAGE_FINALIZATION_PREFLIGHT_TOKEN
      && imageFinalizationStage !== IMAGE_FINALIZATION_GENERATION_TOKEN) {
    return runImageFinalizationPreflight({
      scope: database,
      ownerId,
      baseKey: `variant:${assetId}:${variantId}:${row.object_key}`,
      fingerprint: admissionFingerprint,
      byteSize: Number(row.byte_size),
      signal,
      onJoin: joinedFinalizationResult,
      task: ({ signal: sharedSignal }) => finalizeMediaVariant(database, {
        ownerId,
        assetId,
        variantId,
        body,
        env,
        at,
        fetchImpl,
        imageProcessor,
        signal: sharedSignal,
        imageFinalizationStage: IMAGE_FINALIZATION_PREFLIGHT_TOKEN,
        imageExpectedFingerprint: admissionFingerprint,
      }),
    });
  }
  if (imageExpectedFingerprint && imageExpectedFingerprint !== admissionFingerprint) {
    throw new ApiError(409, "That rendition changed while it was waiting to be verified.", "CONFLICT");
  }
  const stored = imageFinalizationStage === IMAGE_FINALIZATION_GENERATION_TOKEN
    ? requireAdmittedStoredGeneration(imageStoredObject, {
      expectedBytes: row.byte_size,
      expectedType: row.mime_type,
    })
    : await verifyStoredObject({
      objectKey: row.object_key,
      expectedBytes: row.byte_size,
      expectedType: row.mime_type,
      env,
      fetchImpl,
      signal,
      storageScope: "private",
    });
  const afterHead = database.prepare(`SELECT v.object_key,v.status,v.create_hash,v.finalize_hash,a.source_key
    FROM media_variants v JOIN media_assets a ON a.id=v.asset_id
    WHERE v.id=? AND v.asset_id=? AND a.owner_id=?`).get(variantId, assetId, ownerId);
  if (!afterHead || (afterHead.status !== "upload_pending" && !afterHead.finalize_hash)
      || afterHead.object_key !== row.object_key || afterHead.create_hash !== row.create_hash) {
    throw new ApiError(409, "That rendition changed while it was waiting to be verified.", "CONFLICT");
  }
  requireLiveLedger(database, ownerId, afterHead.source_key);
  requireLiveLedger(database, ownerId, afterHead.object_key);
  if (imageFinalizationStage === IMAGE_FINALIZATION_PREFLIGHT_TOKEN) {
    return runImageFinalizationGeneration({
      scope: database,
      ownerId,
      baseKey: `variant:${assetId}:${variantId}:${row.object_key}:${stored.etag}`,
      fingerprint: admissionFingerprint,
      byteSize: Number(row.byte_size),
      signal,
      onJoin: joinedFinalizationResult,
      task: ({ signal: sharedSignal }) => finalizeMediaVariant(database, {
        ownerId,
        assetId,
        variantId,
        body,
        env,
        at,
        fetchImpl,
        imageProcessor,
        signal: sharedSignal,
        imageFinalizationStage: IMAGE_FINALIZATION_GENERATION_TOKEN,
        imageStoredObject: stored,
        imageExpectedFingerprint: admissionFingerprint,
      }),
    });
  }
  const verifiedImage = await verifyStoredImage({
    objectKey: row.object_key,
    stored,
    expectedBytes: row.byte_size,
    expectedType: row.mime_type,
    env,
    fetchImpl,
    signal,
    storageScope: "private",
  });
  const sanitized = await runImageProcessor(imageProcessor?.sanitize || defaultImageProcessor.sanitize, {
    bytes: verifiedImage.bytes,
    expectedType: row.mime_type,
  }, { sanitizing: true });
  assertVerifiedDimensions(sanitized, input.width, input.height);
  const stagedDelivery = await stageSanitizedImageDelivery(database, {
    ownerId,
    asset,
    variantId,
    stagingKey: row.object_key,
    output: sanitized,
    env,
    at,
    fetchImpl,
    signal,
  });

  return withWrite(database, () => {
    const current = database.prepare(`SELECT v.finalize_hash,v.status,v.object_key,a.source_key
      FROM media_variants v JOIN media_assets a ON a.id=v.asset_id
      WHERE v.id=? AND v.asset_id=? AND a.owner_id=?`).get(variantId, assetId, ownerId);
    if (current?.finalize_hash) {
      if (current.finalize_hash !== input.finalizeHash) throw new ApiError(409, "That rendition changed while it was finalizing.", "CONFLICT");
      touchLiveLedger(database, ownerId, current.source_key, at);
      touchLiveLedger(database, ownerId, current.object_key, at);
      const committedVariant = database.prepare("SELECT * FROM media_variants WHERE id=? AND asset_id=?")
        .get(variantId, assetId);
      return {
        asset: assetProjection(loadAsset(database, assetId), { owner: true }),
        variant: variantProjection(committedVariant),
        duplicate: true,
      };
    }
    if (!current || current.status !== "upload_pending") throw new ApiError(409, "That rendition changed while it was finalizing.", "CONFLICT");
    touchLiveLedger(database, ownerId, current.source_key, at);
    touchLiveLedger(database, ownerId, current.object_key, at);
    requireLiveLedger(database, ownerId, stagedDelivery.objectKey);
    queuePrivateImageStaging(database, { ownerId, stagingKey: current.object_key, at });
    database.prepare(`UPDATE media_variants SET object_key=?,public_url=?,mime_type=?,byte_size=?,width=?,height=?,time_ms=?,
      status='verified',finalize_hash=?,verified_at=?,verification_origin='private_derivative_v1',updated_at=?
      WHERE id=? AND asset_id=?`)
      .run(stagedDelivery.objectKey, stagedDelivery.upload.publicUrl, sanitized.mimeType, sanitized.byteSize,
        sanitized.width, sanitized.height, input.timeMs, input.finalizeHash, at, at, variantId, assetId);
    if (row.role === "poster") {
      database.prepare(`UPDATE media_assets SET poster_variant_id=?,poster_key=?,poster_url=?,poster_time_ms=?,updated_at=?
        WHERE id=? AND owner_id=?`).run(variantId, stagedDelivery.objectKey, stagedDelivery.upload.publicUrl, input.timeMs, at, assetId, ownerId);
    } else {
      database.prepare(`UPDATE media_assets SET render_variant_id=?,render_state='ready',status='ready',updated_at=?
        WHERE id=? AND owner_id=? AND render_state='pending'`).run(variantId, at, assetId, ownerId);
    }
    if (database.prepare("SELECT 1 FROM post_media WHERE asset_id=?").get(assetId)) {
      if (!markObjectAssociated(database, ownerId, stagedDelivery.objectKey, at)) {
        throw new ApiError(409, "That media rendition is no longer available. Finish the upload again.", "CONFLICT");
      }
    }
    const finalVariant = database.prepare("SELECT * FROM media_variants WHERE id=?").get(variantId);
    return {
      asset: assetProjection(loadAsset(database, assetId), { owner: true }),
      variant: variantProjection(finalVariant),
      duplicate: false,
    };
  });
}

function markObjectAssociated(database, ownerId, objectKey, at) {
  return Number(database.prepare(`UPDATE media_objects SET status='associated',associated_at=COALESCE(associated_at,?),updated_at=?
    WHERE owner_id=? AND object_key=? AND status IN ('issued','associated')`).run(at, at, ownerId, objectKey).changes || 0) === 1;
}

function loadAsset(database, assetId) {
  return database.prepare(`SELECT a.*,
      revision.edit_recipe pending_edit_recipe,revision.recipe_version pending_recipe_version,
      revision.variant_id pending_variant_id,revision.status pending_revision_status,
      source_ledger.status source_ledger_status,
      rv.object_key render_key,rv.public_url render_url,rv.width render_width,rv.height render_height,rv.mime_type render_mime_type,rv.byte_size render_byte_size,rv.status render_variant_status,
      rv.verification_origin render_verification_origin,
      render_ledger.status render_ledger_status,render_ledger.storage_scope render_ledger_scope,
      pv.object_key durable_poster_key,pv.public_url durable_poster_url,pv.time_ms durable_poster_time_ms,pv.status poster_variant_status,
      pv.verification_origin poster_verification_origin,
      poster_ledger.status poster_ledger_status
    FROM media_assets a
    LEFT JOIN media_asset_revisions revision ON revision.asset_id=a.id
    LEFT JOIN media_objects source_ledger ON source_ledger.owner_id=a.owner_id AND source_ledger.object_key=a.source_key
    LEFT JOIN media_variants rv ON rv.id=a.render_variant_id AND rv.asset_id=a.id
    LEFT JOIN media_objects render_ledger ON render_ledger.owner_id=a.owner_id AND render_ledger.object_key=rv.object_key
    LEFT JOIN media_variants pv ON pv.id=a.poster_variant_id AND pv.asset_id=a.id
    LEFT JOIN media_objects poster_ledger ON poster_ledger.owner_id=a.owner_id AND poster_ledger.object_key=pv.object_key
    WHERE a.id=?`).get(assetId);
}

const isLiveLedgerStatus = (status) => status === "issued" || status === "associated";

function publishUrl(row) {
  if (!row || row.status !== "ready" || !isLiveLedgerStatus(row.source_ledger_status)) return null;
  if (row.kind === "video" && row.codec_status !== "verified") return null;
  if (row.render_state === "ready") {
    const serverAuthoredImage = row.kind !== "image" || row.render_verification_origin === "private_derivative_v1";
    return serverAuthoredImage && row.render_variant_status === "verified" && row.render_ledger_scope === "public"
      && isLiveLedgerStatus(row.render_ledger_status) ? row.render_url : null;
  }
  // Stable images are never allowed to fall back to a browser-authored source.
  // Pre-hardening rows stay owner-visible for recovery but remain quarantined
  // until a backfill creates a verified server-authored derivative.
  return row.kind === "video" && row.render_state === "not_required" ? row.source_url : null;
}

export function assetProjection(row, { owner = false, ownerSourceUrl = null } = {}) {
  if (!row) return null;
  const outputUrl = publishUrl(row);
  const recipe = parseJsonObject(owner && row.pending_edit_recipe ? row.pending_edit_recipe : row.edit_recipe);
  const authoritativePosterTime = Number(parseJsonObject(row.edit_recipe).coverMs);
  const durablePosterLive = row.poster_variant_status === "verified"
    && row.poster_verification_origin === "private_derivative_v1"
    && isLiveLedgerStatus(row.poster_ledger_status)
    && Number.isSafeInteger(Number(row.durable_poster_time_ms))
    && Number(row.durable_poster_time_ms) === authoritativePosterTime;
  const posterUrl = durablePosterLive ? row.durable_poster_url : null;
  const posterTimeMs = durablePosterLive
    ? row.durable_poster_time_ms
    : null;
  return {
    id: row.id,
    kind: row.kind,
    purpose: row.purpose,
    url: outputUrl,
    // Public post projections deliberately map sourceUrl to the publishable
    // rendition. Owners can still reopen the original source reference through the
    // authenticated asset endpoint without leaking it to every feed reader.
    sourceUrl: owner
      ? (row.source_storage_scope === "private" ? ownerSourceUrl : row.source_url)
      : outputUrl,
    posterUrl,
    posterTimeMs,
    width: row.render_state === "ready" && row.render_variant_status === "verified" ? row.render_width : row.width,
    height: row.render_state === "ready" && row.render_variant_status === "verified" ? row.render_height : row.height,
    durationMs: row.duration_ms ?? null,
    orientation: row.orientation ?? 0,
    mimeType: row.render_state === "ready" && row.render_variant_status === "verified" ? row.render_mime_type : row.mime_type,
    byteSize: owner
      ? (row.render_state === "ready" && row.render_variant_status === "verified" ? row.render_byte_size : row.byte_size)
      : undefined,
    status: row.status,
    renderState: row.render_state,
    metadataStatus: row.metadata_status,
    codecStatus: row.codec_status || "pending",
    altText: row.alt_text || "",
    recipeVersion: owner && row.pending_recipe_version ? row.pending_recipe_version : row.recipe_version,
    editRecipe: owner ? recipe : undefined,
    revisionPending: owner ? !!row.pending_edit_recipe : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function variantProjection(row) {
  if (!row) return null;
  return {
    id: row.id,
    role: row.role,
    url: row.status === "verified" ? row.public_url : null,
    mimeType: row.mime_type,
    byteSize: row.byte_size,
    width: row.width ?? null,
    height: row.height ?? null,
    timeMs: row.time_ms ?? null,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function ownedMediaAsset(database, {
  ownerId,
  assetId,
  renew = false,
  at = Date.now(),
  env = process.env,
} = {}) {
  if (!ASSET_ID.test(String(assetId || ""))) return null;
  const read = () => {
    const row = loadAsset(database, assetId);
    if (!row || row.owner_id !== ownerId) return null;
    if (renew && !database.prepare("SELECT 1 FROM post_media WHERE asset_id=?").get(row.id)) {
      // GET /api/media/assets/:id is the explicit owner resume/read boundary.
      // Only unattached drafts need a lease; attached objects are associated and
      // excluded from orphan expiry. Requiring a live source fails closed if a
      // cleanup/delete queue has already won instead of reviving its descriptor.
      touchLiveLedger(database, ownerId, row.source_key, at);
    }
    const current = loadAsset(database, assetId);
    let ownerSourceUrl = null;
    if (current.source_storage_scope === "private" && strongObjectEtag(current.source_etag)) {
      ownerSourceUrl = createMediaDownloadCapability({
        objectKey: current.source_key,
        ifMatch: current.source_etag,
        env,
        expiresIn: 300,
        storageScope: "private",
      }).downloadUrl;
    }
    return assetProjection(current, { owner: true, ownerSourceUrl });
  };
  return renew ? withWrite(database, read) : read();
}

export function cleanMediaAssetIds(value, { optional = true } = {}) {
  if (value === undefined && optional) return null;
  if (!Array.isArray(value) || value.length > MAX_POST_MEDIA) {
    throw new ApiError(400, "Media selection is invalid.", "VALIDATION_FAILED");
  }
  const ids = [];
  for (const raw of value) {
    if (typeof raw !== "string" || !ASSET_ID.test(raw) || ids.includes(raw)) {
      throw new ApiError(400, "Media selection is invalid.", "VALIDATION_FAILED");
    }
    ids.push(raw);
  }
  return ids;
}

export function mediaSelection(database, { ownerId, assetIds, currentPostId = null } = {}) {
  const ids = cleanMediaAssetIds(assetIds, { optional: false });
  const rows = [];
  for (const id of ids) {
    const row = loadAsset(database, id);
    const url = publishUrl(row);
    if (!row || row.owner_id !== ownerId || row.purpose !== "post" || row.status !== "ready" || !url) {
      throw new ApiError(409, "Finish every media upload before publishing.", "CONFLICT");
    }
    if (row.pending_edit_recipe) {
      throw new ApiError(409, "Finish or discard the pending photo edit before publishing.", "CONFLICT");
    }
    // Stable video assets are stricter than legacy URL-only posts: every new
    // clip must carry a durable, verified cover object before it can enter any
    // feed. This makes black frame-zero/decoder placeholders a fallback for old
    // content, never a valid state produced by the new contract.
    const expectedPosterTime = row.kind === "video"
      ? Number(parseJsonObject(row.edit_recipe).coverMs)
      : null;
    if (row.kind === "video" && (row.poster_variant_status !== "verified"
        || row.poster_verification_origin !== "private_derivative_v1"
        || !isLiveLedgerStatus(row.poster_ledger_status) || !row.durable_poster_url
        || !Number.isSafeInteger(Number(row.durable_poster_time_ms))
        || Number(row.durable_poster_time_ms) !== expectedPosterTime)) {
      throw new ApiError(409, "Choose and finish uploading a cover frame before publishing this clip.", "CONFLICT");
    }
    const link = database.prepare("SELECT post_id FROM post_media WHERE asset_id=?").get(id);
    if (link && link.post_id !== currentPostId) {
      throw new ApiError(409, "That media item is already attached to another post.", "CONFLICT");
    }
    rows.push({ row, url });
  }
  // Pre-publish selection is deliberately read-only. A request may still fail
  // content validation or rate limiting after this point, and such a rejection
  // must not extend an unattached draft's cleanup lease. attachPostMedia reloads
  // the same rows under the post writer transaction and associates every object
  // only when the post itself can commit.
  return { ids, rows, photos: rows.map((entry) => entry.url) };
}

export function attachPostMedia(database, { postId, ownerId, selection, at = Date.now() } = {}) {
  const post = database.prepare("SELECT user_id FROM posts WHERE id=?").get(postId);
  if (!post || post.user_id !== ownerId) throw new ApiError(403, "Only the post owner can attach media.", "FORBIDDEN");
  // Selection normally occurs before the post transaction begins. Reload every
  // descriptor and ledger here under the writer lock so an orphan cleanup or
  // deletion queue cannot win between validation and association.
  const fresh = mediaSelection(database, { ownerId, assetIds: selection?.ids || [], currentPostId: postId });
  for (let position = 0; position < fresh.rows.length; position += 1) {
    const asset = fresh.rows[position].row;
    database.prepare("INSERT INTO post_media (post_id,asset_id,position,created_at) VALUES (?,?,?,?)")
      .run(postId, asset.id, position, at);
    if (!markObjectAssociated(database, ownerId, asset.source_key, at)) {
      throw new ApiError(409, "That media upload is no longer available. Start the upload again.", "CONFLICT");
    }
    const variants = database.prepare("SELECT object_key FROM media_variants WHERE asset_id=? AND status='verified'").all(asset.id);
    for (const variant of variants) {
      if (!markObjectAssociated(database, ownerId, variant.object_key, at)) {
        throw new ApiError(409, "That media rendition is no longer available. Finish the upload again.", "CONFLICT");
      }
    }
  }
}

function postMediaRowsForPosts(database, postIds) {
  const ids = [...new Set((Array.isArray(postIds) ? postIds : []).filter((id) => typeof id === "string" && id))].slice(0, 100);
  if (!ids.length) return [];
  const placeholders = ids.map(() => "?").join(",");
  return database.prepare(`SELECT pm.post_id,a.*,
      source_ledger.status source_ledger_status,
      rv.object_key render_key,rv.public_url render_url,rv.width render_width,rv.height render_height,rv.mime_type render_mime_type,rv.byte_size render_byte_size,rv.status render_variant_status,
      rv.verification_origin render_verification_origin,
      render_ledger.status render_ledger_status,render_ledger.storage_scope render_ledger_scope,
      pv.object_key durable_poster_key,pv.public_url durable_poster_url,pv.time_ms durable_poster_time_ms,pv.status poster_variant_status,
      pv.verification_origin poster_verification_origin,
      poster_ledger.status poster_ledger_status
    FROM post_media pm
    JOIN media_assets a ON a.id=pm.asset_id
    LEFT JOIN media_objects source_ledger ON source_ledger.owner_id=a.owner_id AND source_ledger.object_key=a.source_key
    LEFT JOIN media_variants rv ON rv.id=a.render_variant_id AND rv.asset_id=a.id
    LEFT JOIN media_objects render_ledger ON render_ledger.owner_id=a.owner_id AND render_ledger.object_key=rv.object_key
    LEFT JOIN media_variants pv ON pv.id=a.poster_variant_id AND pv.asset_id=a.id
    LEFT JOIN media_objects poster_ledger ON poster_ledger.owner_id=a.owner_id AND poster_ledger.object_key=pv.object_key
    WHERE pm.post_id IN (${placeholders}) ORDER BY pm.post_id,pm.position`).all(...ids);
}

function postMediaRows(database, postId) {
  return postMediaRowsForPosts(database, [postId]);
}

export function postMediaAssetIds(database, postId) {
  return database.prepare("SELECT asset_id FROM post_media WHERE post_id=? ORDER BY position")
    .all(postId).map((row) => row.asset_id);
}

export function postMediaState(database, postId, { ownerId = null } = {}) {
  const rows = postMediaRows(database, postId);
  return {
    linkedAssetIds: rows.map((row) => row.id),
    assets: rows
      .map((row) => assetProjection(row, { owner: ownerId === row.owner_id }))
      .filter((asset) => asset.status === "ready" && asset.url),
  };
}

export function postMediaProjection(database, postId, options = {}) {
  return postMediaState(database, postId, options).assets;
}

export function postMediaStateByPost(database, postIds, { ownerId = null } = {}) {
  const assetsByPost = new Map();
  const linkedPostIds = new Set();
  for (const row of postMediaRowsForPosts(database, postIds)) {
    linkedPostIds.add(row.post_id);
    const asset = assetProjection(row, { owner: ownerId === row.owner_id });
    if (asset.status !== "ready" || !asset.url) continue;
    const list = assetsByPost.get(row.post_id) || [];
    list.push(asset);
    assetsByPost.set(row.post_id, list);
  }
  return { assetsByPost, linkedPostIds };
}

export function postMediaProjectionByPost(database, postIds, options = {}) {
  return postMediaStateByPost(database, postIds, options).assetsByPost;
}

export function assetIdsMatchingPostPhotos(database, { postId, photos } = {}) {
  const ordered = Array.isArray(photos) ? photos : [];
  const rows = postMediaRows(database, postId);
  const byUrl = new Map(rows.map((row) => [publishUrl(row), row.id]));
  return ordered.map((url) => byUrl.get(url)).filter(Boolean);
}

export function assetObjectRecords(database, assetIds) {
  const records = new Map();
  for (const id of assetIds || []) {
    const asset = database.prepare("SELECT owner_id,source_key,source_url FROM media_assets WHERE id=?").get(id);
    if (asset?.source_key && asset?.source_url) {
      records.set(asset.source_key, { ownerId: asset.owner_id, objectKey: asset.source_key, publicUrl: asset.source_url });
    }
    for (const variant of database.prepare("SELECT object_key,public_url FROM media_variants WHERE asset_id=?").all(id)) {
      if (asset?.owner_id && variant.object_key && variant.public_url) {
        records.set(variant.object_key, { ownerId: asset.owner_id, objectKey: variant.object_key, publicUrl: variant.public_url });
      }
    }
    const pending = database.prepare("SELECT object_key,public_url FROM media_asset_revisions WHERE asset_id=?").get(id);
    if (asset?.owner_id && pending?.object_key && pending?.public_url) {
      records.set(pending.object_key, { ownerId: asset.owner_id, objectKey: pending.object_key, publicUrl: pending.public_url });
    }
  }
  return [...records.values()];
}

export function assetObjectUrls(database, assetIds) {
  return assetObjectRecords(database, assetIds).map((record) => record.publicUrl);
}

export function replacePostMedia(database, { postId, ownerId, selection, at = Date.now() } = {}) {
  const previousIds = postMediaAssetIds(database, postId);
  const nextIds = selection.ids;
  database.prepare("DELETE FROM post_media WHERE post_id=?").run(postId);
  attachPostMedia(database, { postId, ownerId, selection, at });
  return previousIds.filter((id) => !nextIds.includes(id));
}

export function deleteMediaAssets(database, assetIds) {
  const remove = database.prepare("DELETE FROM media_assets WHERE id=?");
  let changed = 0;
  for (const id of assetIds || []) changed += Number(remove.run(id).changes || 0);
  return changed;
}

/**
 * Atomically retire one unattached owner draft and every object capability it
 * minted. Queueing happens before the descriptor is removed, and the deletion
 * ledger preserves each active PUT's expiry + settle barrier. A lost-response
 * retry is intentionally idempotent; an absent (or foreign) id reveals nothing.
 */
export function cancelMediaAsset(database, {
  ownerId,
  assetId,
  at = Date.now(),
} = {}) {
  const owner = String(ownerId || "");
  const id = String(assetId || "");
  if (!owner || !ASSET_ID.test(id)) return { removed: false, queuedObjects: 0 };

  return withWrite(database, () => {
    const asset = database.prepare("SELECT id,source_key FROM media_assets WHERE id=? AND owner_id=?")
      .get(id, owner);
    if (!asset) return { removed: false, queuedObjects: 0 };
    if (database.prepare("SELECT 1 FROM post_media WHERE asset_id=?").get(asset.id)) {
      throw new ApiError(409, "Published media must be removed from its post first.", "CONFLICT");
    }

    const keys = [asset.source_key,
      ...database.prepare("SELECT object_key FROM media_variants WHERE asset_id=? AND object_key IS NOT NULL ORDER BY id")
        .all(asset.id).map((row) => row.object_key),
      ...database.prepare("SELECT object_key FROM media_asset_revisions WHERE asset_id=? AND object_key IS NOT NULL")
        .all(asset.id).map((row) => row.object_key),
    ].filter(Boolean);
    const uniqueKeys = [...new Set(keys)];
    const queued = enqueueOwnedMediaKeys(database, { ownerId: owner, keys: uniqueKeys, at });
    if (queued.accepted !== uniqueKeys.length) {
      // Never discard the only stable descriptor for bytes that could not be
      // bound to the owner's deletion ledger.
      throw new ApiError(409, "That media item changed while it was being removed. Try again.", "CONFLICT");
    }
    const removed = Number(database.prepare("DELETE FROM media_assets WHERE id=? AND owner_id=?")
      .run(asset.id, owner).changes || 0) === 1;
    if (!removed) throw new ApiError(409, "That media item changed while it was being removed. Try again.", "CONFLICT");
    return { removed: true, queuedObjects: queued.accepted };
  });
}

export function assertPhotosMatchSelection(photos, selection) {
  if (!sameList(photos, selection.photos)) {
    throw new ApiError(400, "Media URLs must match the selected PIT media items.", "VALIDATION_FAILED");
  }
}
