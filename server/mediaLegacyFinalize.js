import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";

import { withImmediateWrite as withWrite } from "./databaseTransaction.js";
import { ApiError } from "./errors.js";
import {
  IMAGE_FINALIZATION_PREFLIGHT_TOKEN,
  runImageFinalizationPreflight,
} from "./imageFinalizationAdmission.js";
import {
  createMediaPresign,
  validateMediaRequest,
} from "./media.js";
import {
  sanitizePrivateImageStaging,
  stageSanitizedPublicImage,
  verifiedSanitizedPublicImageDelivery,
} from "./mediaAssets.js";
import {
  enqueueOwnedMediaKeys,
  enqueueOwnedMediaUrls,
  markOwnedMediaAssociated,
  MEDIA_UPLOAD_TICKET_MS,
  recordMediaObjectTicket,
  reserveMediaUploadTicket,
  trustedMediaQueueKey,
  trustedOwnedMediaKey,
  unreferencedOwnedMediaUrls,
} from "./mediaDeletion.js";

export const LEGACY_MEDIA_FINALIZE_TTL_MS = 15 * 60_000;
export const LEGACY_MEDIA_PROCESSING_LEASE_MS = 2 * 60_000;

const DESCRIPTOR_ID = /^lm_[A-Za-z0-9_-]{24,80}$/;
const TOKEN_SECRET = /^[A-Za-z0-9_-]{43}$/;
const IMAGE_OUTPUT_TYPE = Object.freeze({
  "image/jpeg": "image/jpeg",
  "image/png": "image/png",
  "image/webp": "image/webp",
  "image/gif": "image/webp",
  "image/heic": "image/jpeg",
  "image/avif": "image/jpeg",
  "image/heif": "image/jpeg",
});
const DUMMY_TOKEN_HASH = createHash("sha256").update("pit-invalid-legacy-media-token").digest("hex");
const initializedSchemas = new WeakSet();
const RECOVERABLE_PROFILE_REFERENCES = Object.freeze({
  "user.avatar": Object.freeze({ purpose: "avatar", scope: "user", field: "avatar_uri" }),
  "user.banner": Object.freeze({ purpose: "banner", scope: "user", field: "banner" }),
  "artist_profile.avatar": Object.freeze({ purpose: "avatar", scope: "artist_profile", field: "avatar_uri" }),
  "artist_profile.banner": Object.freeze({ purpose: "banner", scope: "artist_profile", field: "banner" }),
});
const SANITIZED_PROFILE_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const PROFILE_IMAGE_RENDITIONS = new Set(["avatar", "banner"]);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function newDescriptorId() {
  return `lm_${randomUUID().replaceAll("-", "")}`;
}

function outputProjection(row, { duplicate = false } = {}) {
  return Object.freeze({
    descriptorId: row.id,
    status: row.status,
    publicUrl: row.output_url,
    key: row.output_object_key,
    contentType: row.output_mime_type,
    fileSize: row.output_byte_size,
    width: row.width,
    height: row.height,
    duplicate,
  });
}

function normalizedOwner(ownerId) {
  const owner = String(ownerId || "");
  if (!owner) throw new ApiError(401, "Log in first.", "AUTH_REQUIRED");
  return owner;
}

function parseFinalizeToken(value) {
  const token = String(value || "");
  const separator = token.indexOf(".");
  const id = separator > 0 ? token.slice(0, separator) : "";
  const secret = separator > 0 ? token.slice(separator + 1) : "";
  return DESCRIPTOR_ID.test(id) && TOKEN_SECRET.test(secret) ? { id, token } : null;
}

function authenticatedDescriptor(database, { ownerId, finalizeToken }) {
  const parsed = parseFinalizeToken(finalizeToken);
  const row = parsed
    ? database.prepare("SELECT * FROM legacy_media_finalize_descriptors WHERE id=? AND owner_id=?")
      .get(parsed.id, ownerId)
    : null;
  const actual = Buffer.from(sha256(parsed?.token || ""), "hex");
  const expectedHash = /^[a-f0-9]{64}$/u.test(String(row?.token_hash || ""))
    ? row.token_hash
    : DUMMY_TOKEN_HASH;
  const authenticated = timingSafeEqual(actual, Buffer.from(expectedHash, "hex"));
  if (!row || !authenticated) {
    throw new ApiError(404, "That photo finalization was not found.", "NOT_FOUND");
  }
  return row;
}

export function ensureLegacyMediaFinalizeSchema(database) {
  if (initializedSchemas.has(database)) return;
  database.exec(`
    CREATE TABLE IF NOT EXISTS legacy_media_finalize_descriptors (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      token_hash TEXT NOT NULL,
      purpose TEXT NOT NULL,
      staging_object_key TEXT NOT NULL UNIQUE,
      staging_mime_type TEXT NOT NULL,
      staging_byte_size INTEGER NOT NULL,
      output_mime_type TEXT NOT NULL,
      output_object_key TEXT,
      output_url TEXT,
      output_byte_size INTEGER,
      width INTEGER,
      height INTEGER,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','processing','finalized','failed','expired')),
      processing_claim TEXT,
      processing_started_at INTEGER,
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error_code TEXT,
      expires_at INTEGER NOT NULL,
      consumed_at INTEGER,
      finalized_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_legacy_media_finalize_owner
      ON legacy_media_finalize_descriptors(owner_id,status,expires_at,id);
    CREATE INDEX IF NOT EXISTS idx_legacy_media_finalize_output
      ON legacy_media_finalize_descriptors(owner_id,output_url,status);
  `);
  initializedSchemas.add(database);
}

export function createLegacyMediaUpload(database, {
  ownerId,
  body,
  env = process.env,
  at = Date.now(),
  descriptorId = newDescriptorId(),
  stagingObjectId = `ls_${randomUUID().replaceAll("-", "")}`,
} = {}) {
  ensureLegacyMediaFinalizeSchema(database);
  const owner = normalizedOwner(ownerId);
  if (!DESCRIPTOR_ID.test(String(descriptorId || ""))) {
    throw new ApiError(500, "Photo upload could not be prepared.", "INTERNAL_ERROR");
  }
  const file = validateMediaRequest(body);
  const outputType = IMAGE_OUTPUT_TYPE[file.contentType];
  if (!outputType) {
    throw new ApiError(415, "This legacy surface accepts photos only.", "MEDIA_TYPE_UNSUPPORTED");
  }
  const secret = randomBytes(32).toString("base64url");
  const finalizeToken = `${descriptorId}.${secret}`;
  const tokenHash = sha256(finalizeToken);
  const expiresAt = at + LEGACY_MEDIA_FINALIZE_TTL_MS;

  const result = withWrite(database, () => {
    const upload = createMediaPresign({
      userId: owner,
      body: file,
      env,
      now: new Date(at),
      objectId: stagingObjectId,
      storageScope: "private",
    });
    reserveMediaUploadTicket(database, {
      ownerId: owner,
      objectKey: upload.key,
      storageScope: "private",
      byteSize: file.fileSize,
      at,
      expiresAt: at + MEDIA_UPLOAD_TICKET_MS,
      env,
    });
    database.prepare(`INSERT INTO legacy_media_finalize_descriptors
      (id,owner_id,token_hash,purpose,staging_object_key,staging_mime_type,staging_byte_size,
       output_mime_type,status,expires_at,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,'pending',?,?,?)`)
      .run(descriptorId, owner, tokenHash, file.purpose, upload.key, file.contentType,
        file.fileSize, outputType, expiresAt, at, at);
    return { upload };
  });

  return Object.freeze({
    descriptorId,
    finalizeToken,
    finalizeExpiresAt: expiresAt,
    upload: result.upload,
  });
}

function claimDescriptor(database, { ownerId, finalizeToken, at, claimId }) {
  return withWrite(database, () => {
    const row = authenticatedDescriptor(database, { ownerId, finalizeToken });
    if (Number(row.expires_at) <= at) {
      if (row.status !== "finalized") {
        enqueueOwnedMediaKeys(database, { ownerId, keys: [row.staging_object_key], at });
      }
      database.prepare(`UPDATE legacy_media_finalize_descriptors SET status='expired',processing_claim=NULL,
        processing_started_at=NULL,updated_at=? WHERE id=? AND owner_id=? AND status!='finalized'`)
        .run(at, row.id, ownerId);
      return { outcome: "expired" };
    }
    if (row.status === "finalized") return { outcome: "finalized", row };
    if (row.status === "failed" || row.status === "expired") return { outcome: row.status };
    if (row.status === "processing"
        && Number(row.processing_started_at || 0) > at - LEGACY_MEDIA_PROCESSING_LEASE_MS) {
      return { outcome: "processing" };
    }
    database.prepare(`UPDATE legacy_media_finalize_descriptors SET status='processing',processing_claim=?,
      processing_started_at=?,attempts=attempts+1,last_error_code=NULL,updated_at=? WHERE id=? AND owner_id=?`)
      .run(claimId, at, at, row.id, ownerId);
    return {
      outcome: "claimed",
      row: database.prepare("SELECT * FROM legacy_media_finalize_descriptors WHERE id=?").get(row.id),
    };
  });
}

function claimOutcomeError(outcome) {
  if (outcome === "processing") {
    return new ApiError(409, "That photo is already being finalized. Try again shortly.", "CONFLICT");
  }
  return new ApiError(409, "That photo finalization is no longer available.", "CONFLICT");
}

const TERMINAL_LEGACY_IMAGE_ERRORS = new Map([
  ["VALIDATION_FAILED", 400],
  ["MEDIA_TOO_LARGE", 413],
  ["MEDIA_TYPE_UNSUPPORTED", 415],
]);

export function isTerminalLegacyImageError(error) {
  return error instanceof ApiError && TERMINAL_LEGACY_IMAGE_ERRORS.get(error.code) === error.status;
}

function settleFailedClaim(database, { ownerId, row, claimId, error, at }) {
  // Malformed bytes, resource-limit violations, and unsupported actual codecs
  // cannot become valid by replaying the same immutable staging generation.
  // Transport/capacity failures and object-generation conflicts remain pending
  // so the owner can safely resume without uploading the source twice.
  const terminal = isTerminalLegacyImageError(error);
  withWrite(database, () => {
    const current = database.prepare(`SELECT status,processing_claim,staging_object_key
      FROM legacy_media_finalize_descriptors WHERE id=? AND owner_id=?`).get(row.id, ownerId);
    if (!current || current.status !== "processing" || current.processing_claim !== claimId) return;
    if (terminal) enqueueOwnedMediaKeys(database, { ownerId, keys: [current.staging_object_key], at });
    database.prepare(`UPDATE legacy_media_finalize_descriptors SET status=?,processing_claim=NULL,
      processing_started_at=NULL,last_error_code=?,updated_at=? WHERE id=? AND owner_id=? AND processing_claim=?`)
      .run(terminal ? "failed" : "pending", String(error?.code || "finalize_failed").slice(0, 80),
        at, row.id, ownerId, claimId);
  });
}

export async function finalizeLegacyMediaUpload(database, {
  ownerId,
  finalizeToken,
  env = process.env,
  at = Date.now(),
  fetchImpl = globalThis.fetch,
  imageProcessor,
  signal,
  imageFinalizationStage = null,
  imageExpectedFingerprint = null,
} = {}) {
  ensureLegacyMediaFinalizeSchema(database);
  const owner = normalizedOwner(ownerId);
  const descriptor = authenticatedDescriptor(database, { ownerId: owner, finalizeToken });
  if (descriptor.status === "finalized") return outputProjection(descriptor, { duplicate: true });
  const admissionFingerprint = sha256(JSON.stringify({
    descriptorId: descriptor.id,
    stagingObjectKey: descriptor.staging_object_key,
    stagingMimeType: descriptor.staging_mime_type,
    stagingByteSize: descriptor.staging_byte_size,
    outputMimeType: descriptor.output_mime_type,
    purpose: descriptor.purpose,
  }));
  if (imageFinalizationStage !== IMAGE_FINALIZATION_PREFLIGHT_TOKEN) {
    return runImageFinalizationPreflight({
      scope: database,
      ownerId: owner,
      baseKey: `legacy:${descriptor.id}:${descriptor.staging_object_key}`,
      fingerprint: admissionFingerprint,
      byteSize: Number(descriptor.staging_byte_size),
      signal,
      onJoin: (value) => Object.freeze({ ...value, duplicate: true }),
      task: ({ signal: sharedSignal }) => finalizeLegacyMediaUpload(database, {
        ownerId: owner,
        finalizeToken,
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
  if (imageExpectedFingerprint !== admissionFingerprint) {
    throw new ApiError(409, "That photo changed while it was waiting to be finalized.", "CONFLICT");
  }
  const claimId = randomUUID();
  const claim = claimDescriptor(database, { ownerId: owner, finalizeToken, at, claimId });
  if (claim.outcome === "finalized") return outputProjection(claim.row, { duplicate: true });
  if (claim.outcome !== "claimed") throw claimOutcomeError(claim.outcome);
  const row = claim.row;

  try {
    const { sanitized, sourceEtag } = await sanitizePrivateImageStaging(database, {
      ownerId: owner,
      objectKey: row.staging_object_key,
      expectedBytes: row.staging_byte_size,
      expectedType: row.staging_mime_type,
      outputType: row.output_mime_type,
      env,
      fetchImpl,
      imageProcessor,
      imageTimeoutMs: 60_000,
      allowHeicFallback: true,
      allowLegacyJpegTrailer: true,
      profileRendition: PROFILE_IMAGE_RENDITIONS.has(row.purpose) ? row.purpose : null,
      signal,
      imageFinalizationStage: IMAGE_FINALIZATION_PREFLIGHT_TOKEN,
    });
    const staged = await stageSanitizedPublicImage(database, {
      ownerId: owner,
      purpose: row.purpose,
      publicIdentity: row.id,
      stagingKey: row.staging_object_key,
      sourceBinding: { objectKey: row.staging_object_key, etag: sourceEtag },
      output: sanitized,
      env,
      at,
      fetchImpl,
      signal,
    });

    const committed = withWrite(database, () => {
      const current = authenticatedDescriptor(database, { ownerId: owner, finalizeToken });
      if (current.status === "finalized") return { row: current, duplicate: true };
      if (current.status !== "processing" || current.processing_claim !== claimId) {
        throw new ApiError(409, "That photo finalization changed while it was processing.", "CONFLICT");
      }
      if (Number(current.expires_at) <= at) {
        enqueueOwnedMediaKeys(database, {
          ownerId: owner,
          keys: [current.staging_object_key, staged.objectKey],
          at,
        });
        database.prepare(`UPDATE legacy_media_finalize_descriptors SET status='expired',processing_claim=NULL,
          processing_started_at=NULL,updated_at=? WHERE id=? AND owner_id=?`).run(at, current.id, owner);
        return { expired: true };
      }
      const outputLedger = database.prepare(`SELECT status,storage_scope FROM media_objects
        WHERE owner_id=? AND object_key=?`).get(owner, staged.objectKey);
      if (!outputLedger || outputLedger.storage_scope !== "public"
          || !new Set(["issued", "associated"]).has(outputLedger.status)) {
        throw new ApiError(409, "The sanitized photo is no longer available.", "CONFLICT");
      }
      const queued = enqueueOwnedMediaKeys(database, {
        ownerId: owner,
        keys: [current.staging_object_key],
        at,
      });
      if (queued.accepted !== 1) {
        throw new ApiError(409, "The private photo staging object is no longer available.", "CONFLICT");
      }
      database.prepare(`UPDATE legacy_media_finalize_descriptors SET status='finalized',processing_claim=NULL,
        processing_started_at=NULL,output_object_key=?,output_url=?,output_byte_size=?,width=?,height=?,
        finalized_at=?,updated_at=? WHERE id=? AND owner_id=? AND processing_claim=?`)
        .run(staged.objectKey, staged.publicUrl, staged.byteSize, staged.width, staged.height,
          at, at, current.id, owner, claimId);
      return {
        row: database.prepare("SELECT * FROM legacy_media_finalize_descriptors WHERE id=?").get(current.id),
        duplicate: false,
      };
    });
    if (committed.expired) throw claimOutcomeError("expired");
    return outputProjection(committed.row, { duplicate: committed.duplicate });
  } catch (error) {
    settleFailedClaim(database, { ownerId: owner, row, claimId, error, at: Date.now() });
    throw error;
  }
}

function finalizedDescriptorReference(database, {
  ownerId,
  publicUrl,
  purpose,
} = {}) {
  const owner = typeof ownerId === "string" ? ownerId.trim() : "";
  const url = String(publicUrl || "");
  if (!owner || !url) return null;
  const acceptedPurposes = new Set(
    (Array.isArray(purpose) ? purpose : [purpose])
      .filter((value) => typeof value === "string" && value)
      .map((value) => value.trim().toLowerCase()),
  );
  const row = database.prepare(`SELECT d.*,o.status object_status,o.storage_scope object_storage_scope
    FROM legacy_media_finalize_descriptors d
    JOIN media_objects o ON o.owner_id=d.owner_id AND o.object_key=d.output_object_key
    WHERE d.owner_id=? AND d.output_url=? AND d.status='finalized'
      AND o.storage_scope='public' AND o.status IN ('issued','associated')`)
    .get(owner, url);
  if (!row || (acceptedPurposes.size && !acceptedPurposes.has(row.purpose))) return null;
  return row;
}

// Read-only mutation guard. A URL merely present in the generic object ledger
// is not enough: this proves that the bytes crossed the private decode/re-encode
// boundary for this owner and destination before a profile/review can persist it.
export function verifiedFinalizedLegacyMedia(database, options = {}) {
  ensureLegacyMediaFinalizeSchema(database);
  const row = finalizedDescriptorReference(database, options);
  return row ? outputProjection(row) : null;
}

// Mutation routes use this after accepting the returned public URL. It closes
// the deployment window where an old raw-public PUT ticket might otherwise be
// mistaken for a server-sanitized legacy image.
export function associateFinalizedLegacyMedia(database, {
  ownerId,
  publicUrl,
  purpose,
  at = Date.now(),
} = {}) {
  ensureLegacyMediaFinalizeSchema(database);
  const owner = normalizedOwner(ownerId);
  return withWrite(database, () => {
    const row = finalizedDescriptorReference(database, { ownerId: owner, publicUrl, purpose });
    if (!row) {
      throw new ApiError(400, "That photo was not finalized for this destination.", "VALIDATION_FAILED");
    }
    const associated = database.prepare(`UPDATE media_objects SET status='associated',
      associated_at=COALESCE(associated_at,?),updated_at=?
      WHERE owner_id=? AND object_key=? AND storage_scope='public' AND status IN ('issued','associated')`)
      .run(at, at, owner, row.output_object_key);
    if (Number(associated.changes || 0) !== 1) {
      throw new ApiError(409, "That finalized photo is no longer available.", "CONFLICT");
    }
    database.prepare(`UPDATE legacy_media_finalize_descriptors SET consumed_at=COALESCE(consumed_at,?),updated_at=?
      WHERE id=? AND owner_id=?`).run(at, at, row.id, owner);
    return outputProjection(database.prepare("SELECT * FROM legacy_media_finalize_descriptors WHERE id=?").get(row.id));
  });
}

function recoveryProfileRow(database, { ownerId, target, artistKey }) {
  if (target.scope === "user") {
    return database.prepare(`SELECT id,avatar_uri,banner FROM users WHERE id=?`).get(ownerId) || null;
  }
  const key = typeof artistKey === "string" ? artistKey.trim() : "";
  if (!key) throw new ApiError(400, "The artist profile recovery target is invalid.", "VALIDATION_FAILED");
  return database.prepare(`SELECT artist_key,owner_id,avatar_uri,banner
    FROM artist_profiles WHERE artist_key=? AND owner_id=?`).get(key, ownerId) || null;
}

function replaceRecoveryProfileRow(database, {
  ownerId,
  target,
  artistKey,
  expectedCurrentUrl,
  publicUrl,
  at,
}) {
  let result;
  if (target.scope === "user" && target.field === "avatar_uri") {
    result = database.prepare("UPDATE users SET avatar_uri=? WHERE id=? AND avatar_uri=?")
      .run(publicUrl, ownerId, expectedCurrentUrl);
  } else if (target.scope === "user" && target.field === "banner") {
    result = database.prepare("UPDATE users SET banner=? WHERE id=? AND banner=?")
      .run(publicUrl, ownerId, expectedCurrentUrl);
  } else if (target.scope === "artist_profile" && target.field === "avatar_uri") {
    result = database.prepare(`UPDATE artist_profiles SET avatar_uri=?,updated_at=?
      WHERE artist_key=? AND owner_id=? AND avatar_uri=?`)
      .run(publicUrl, at, artistKey.trim(), ownerId, expectedCurrentUrl);
  } else {
    result = database.prepare(`UPDATE artist_profiles SET banner=?,updated_at=?
      WHERE artist_key=? AND owner_id=? AND banner=?`)
      .run(publicUrl, at, artistKey.trim(), ownerId, expectedCurrentUrl);
  }
  if (Number(result.changes || 0) !== 1) {
    throw new ApiError(409, "That profile photo changed during recovery.", "CONFLICT");
  }
}

function matchingRecoveryDescriptor(row, { ownerId, purpose, delivery }) {
  return !!row
    && row.owner_id === ownerId
    && row.purpose === purpose
    && row.status === "finalized"
    && row.staging_object_key === delivery.stagingKey
    && row.output_object_key === delivery.objectKey
    && row.output_url === delivery.publicUrl
    && row.output_mime_type === delivery.mimeType
    && Number(row.output_byte_size) === Number(delivery.byteSize)
    && Number(row.width) === Number(delivery.width)
    && Number(row.height) === Number(delivery.height);
}

// Internal recovery boundary for legacy profile references. The delivery must
// be the exact opaque object minted by stageSanitizedPublicImage after a full
// decode/re-encode and digest-bound upload. The old URL is used only as an exact
// compare-and-swap guard; it is never registered as safe or returned publicly by
// this helper. No API route exposes this operation.
export function recoverProfileImageReference(database, {
  ownerId,
  reference,
  artistKey,
  expectedCurrentUrl,
  sourceByteSize,
  sourceEtag,
  delivery,
  env = process.env,
  at = Date.now(),
} = {}) {
  ensureLegacyMediaFinalizeSchema(database);
  const owner = normalizedOwner(ownerId);
  const target = RECOVERABLE_PROFILE_REFERENCES[String(reference || "")];
  if (!target) throw new ApiError(400, "The profile photo recovery target is invalid.", "VALIDATION_FAILED");
  const expectedUrl = typeof expectedCurrentUrl === "string" ? expectedCurrentUrl.trim() : "";
  const expectedKey = trustedOwnedMediaKey(expectedUrl, { ownerId: owner, env });
  if (!expectedKey || expectedKey.split("/")[2] !== target.purpose) {
    throw new ApiError(400, "The legacy profile photo is not owner-bound to this destination.", "VALIDATION_FAILED");
  }
  const verifiedSourceBytes = Number(sourceByteSize);
  const verifiedSourceEtag = typeof sourceEtag === "string" && /^"[\x21\x23-\x7e]{1,200}"$/u.test(sourceEtag)
    ? sourceEtag
    : null;
  if (!Number.isSafeInteger(verifiedSourceBytes) || verifiedSourceBytes < 1) {
    throw new ApiError(400, "The legacy profile photo size was not verified.", "VALIDATION_FAILED");
  }
  if (!verifiedSourceEtag) {
    throw new ApiError(400, "The legacy profile photo generation was not verified.", "VALIDATION_FAILED");
  }

  const attested = verifiedSanitizedPublicImageDelivery(delivery, {
    ownerId: owner,
    purpose: target.purpose,
    sourceObjectKey: expectedKey,
    sourceEtag: verifiedSourceEtag,
    serverRecovery: true,
  });
  if (!attested || !SANITIZED_PROFILE_IMAGE_TYPES.has(attested.mimeType)
      || !trustedMediaQueueKey(attested.objectKey, owner)
      || !trustedMediaQueueKey(attested.stagingKey, owner)) {
    throw new ApiError(400, "The recovered profile photo is not a verified sanitized derivative.", "VALIDATION_FAILED");
  }
  const publicKey = trustedOwnedMediaKey(attested.publicUrl, { ownerId: owner, env });
  if (publicKey !== attested.objectKey || publicKey.split("/")[2] !== target.purpose
      || expectedUrl === attested.publicUrl) {
    throw new ApiError(400, "The recovered profile photo is not bound to this destination.", "VALIDATION_FAILED");
  }
  if (!Number.isSafeInteger(attested.byteSize) || attested.byteSize < 1
      || !Number.isSafeInteger(attested.width) || attested.width < 1
      || !Number.isSafeInteger(attested.height) || attested.height < 1) {
    throw new ApiError(400, "The recovered profile photo metadata is invalid.", "VALIDATION_FAILED");
  }

  return withWrite(database, () => {
    const profile = recoveryProfileRow(database, { ownerId: owner, target, artistKey });
    if (!profile) throw new ApiError(404, "That profile recovery target was not found.", "NOT_FOUND");
    const currentUrl = profile[target.field];
    const duplicate = currentUrl === attested.publicUrl;
    if (!duplicate && currentUrl !== expectedUrl) {
      throw new ApiError(409, "That profile photo changed before recovery completed.", "CONFLICT");
    }

    let sourceObject = database.prepare(`SELECT owner_id,storage_scope,purpose,byte_size,status
      FROM media_objects WHERE owner_id=? AND object_key=?`).get(owner, expectedKey);
    if (!sourceObject) {
      const recorded = recordMediaObjectTicket(database, {
        ownerId: owner,
        objectKey: expectedKey,
        storageScope: "public",
        byteSize: verifiedSourceBytes,
        at,
        expiresAt: null,
      });
      if (!recorded) {
        throw new ApiError(409, "The legacy profile photo could not be registered for retirement.", "CONFLICT");
      }
      sourceObject = database.prepare(`SELECT owner_id,storage_scope,purpose,byte_size,status
        FROM media_objects WHERE owner_id=? AND object_key=?`).get(owner, expectedKey);
    }
    if (sourceObject && Number(sourceObject.byte_size) === 0
        && sourceObject.owner_id === owner && sourceObject.storage_scope === "public"
        && sourceObject.purpose === target.purpose
        && new Set(["issued", "associated"]).has(sourceObject.status)) {
      database.prepare(`UPDATE media_objects SET byte_size=?,updated_at=?
        WHERE owner_id=? AND object_key=? AND byte_size=0 AND status IN ('issued','associated')`)
        .run(verifiedSourceBytes, at, owner, expectedKey);
      sourceObject = database.prepare(`SELECT owner_id,storage_scope,purpose,byte_size,status
        FROM media_objects WHERE owner_id=? AND object_key=?`).get(owner, expectedKey);
    }
    if (!sourceObject || sourceObject.owner_id !== owner || sourceObject.storage_scope !== "public"
        || sourceObject.purpose !== target.purpose
        || Number(sourceObject.byte_size) !== verifiedSourceBytes
        || (!duplicate && !new Set(["issued", "associated"]).has(sourceObject.status))) {
      throw new ApiError(409, "The legacy profile photo ledger does not match the verified source.", "CONFLICT");
    }

    const outputObject = database.prepare(`SELECT owner_id,storage_scope,purpose,byte_size,status
      FROM media_objects WHERE owner_id=? AND object_key=?`).get(owner, attested.objectKey);
    if (!outputObject || outputObject.storage_scope !== "public"
        || outputObject.purpose !== target.purpose
        || Number(outputObject.byte_size) !== Number(attested.byteSize)
        || !new Set(["issued", "associated"]).has(outputObject.status)) {
      throw new ApiError(409, "The sanitized profile photo is no longer available.", "CONFLICT");
    }

    let descriptor = finalizedDescriptorReference(database, {
      ownerId: owner,
      publicUrl: attested.publicUrl,
      purpose: target.purpose,
    });
    if (descriptor && !matchingRecoveryDescriptor(descriptor, {
      ownerId: owner,
      purpose: target.purpose,
      delivery: attested,
    })) {
      throw new ApiError(409, "The sanitized profile photo has conflicting recovery history.", "CONFLICT");
    }
    if (!descriptor) {
      const descriptorId = `lm_${sha256(`profile-recovery\0${owner}\0${target.purpose}\0${attested.objectKey}`).slice(0, 48)}`;
      const inaccessibleTokenHash = randomBytes(32).toString("hex");
      try {
        database.prepare(`INSERT INTO legacy_media_finalize_descriptors
          (id,owner_id,token_hash,purpose,staging_object_key,staging_mime_type,staging_byte_size,
           output_mime_type,output_object_key,output_url,output_byte_size,width,height,status,
           expires_at,consumed_at,finalized_at,created_at,updated_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'finalized',?,?,?,?,?)`)
          .run(descriptorId, owner, inaccessibleTokenHash, target.purpose, attested.stagingKey,
            attested.mimeType, attested.byteSize, attested.mimeType, attested.objectKey,
            attested.publicUrl, attested.byteSize, attested.width, attested.height,
            at + LEGACY_MEDIA_FINALIZE_TTL_MS, at, at, at, at);
      } catch (error) {
        throw new ApiError(409, "The sanitized profile photo could not be registered for recovery.", "CONFLICT", error);
      }
      descriptor = database.prepare("SELECT * FROM legacy_media_finalize_descriptors WHERE id=?")
        .get(descriptorId);
      if (!matchingRecoveryDescriptor(descriptor, {
        ownerId: owner,
        purpose: target.purpose,
        delivery: attested,
      })) {
        throw new ApiError(409, "The sanitized profile photo could not be registered for recovery.", "CONFLICT");
      }
    }

    if (!duplicate) {
      replaceRecoveryProfileRow(database, {
        ownerId: owner,
        target,
        artistKey,
        expectedCurrentUrl: expectedUrl,
        publicUrl: attested.publicUrl,
        at,
      });
    }
    const sourceUnreferenced = unreferencedOwnedMediaUrls(database, {
      ownerId: owner,
      urls: [expectedUrl],
      env,
    }).includes(expectedUrl);
    if (sourceUnreferenced) {
      const retired = enqueueOwnedMediaUrls(database, {
        ownerId: owner,
        urls: [expectedUrl],
        env,
        at,
      });
      if (retired.accepted !== 1) {
        throw new ApiError(409, "The legacy profile photo could not be retired.", "CONFLICT");
      }
    } else if (markOwnedMediaAssociated(database, {
      ownerId: owner,
      urls: [expectedUrl],
      env,
      at,
    }) !== 1) {
      throw new ApiError(409, "The shared legacy profile photo could not remain associated.", "CONFLICT");
    }
    const associated = database.prepare(`UPDATE media_objects SET status='associated',
      associated_at=COALESCE(associated_at,?),updated_at=?
      WHERE owner_id=? AND object_key=? AND storage_scope='public' AND status IN ('issued','associated')`)
      .run(at, at, owner, attested.objectKey);
    if (Number(associated.changes || 0) !== 1) {
      throw new ApiError(409, "The sanitized profile photo is no longer available.", "CONFLICT");
    }

    // A shared exact source may need another CAS after a process restart. Keep
    // deterministic private staging live until the final reference has moved;
    // then retire it in the same commit as the last raw public reference.
    if (sourceUnreferenced) {
      const stagingObject = database.prepare(`SELECT storage_scope,status FROM media_objects
        WHERE owner_id=? AND object_key=?`).get(owner, attested.stagingKey);
      if (stagingObject?.storage_scope === "private"
          && new Set(["issued", "associated"]).has(stagingObject.status)) {
        const queued = enqueueOwnedMediaKeys(database, {
          ownerId: owner,
          keys: [attested.stagingKey],
          at,
        });
        if (queued.accepted !== 1) {
          throw new ApiError(409, "The private recovery source could not be retired.", "CONFLICT");
        }
      }
    }
    database.prepare(`UPDATE legacy_media_finalize_descriptors
      SET consumed_at=COALESCE(consumed_at,?),updated_at=? WHERE id=? AND owner_id=?`)
      .run(at, at, descriptor.id, owner);
    const committed = database.prepare("SELECT * FROM legacy_media_finalize_descriptors WHERE id=?")
      .get(descriptor.id);
    return Object.freeze({
      ...outputProjection(committed, { duplicate }),
      reference: String(reference),
      sourceRetired: sourceUnreferenced,
    });
  });
}

export function expireLegacyMediaUploads(database, {
  at = Date.now(),
  limit = 100,
} = {}) {
  ensureLegacyMediaFinalizeSchema(database);
  const bounded = Math.max(1, Math.min(500, Math.trunc(Number(limit) || 100)));
  return withWrite(database, () => {
    const rows = database.prepare(`SELECT id,owner_id,staging_object_key FROM legacy_media_finalize_descriptors
      WHERE status IN ('pending','processing') AND expires_at<=? ORDER BY expires_at,id LIMIT ?`).all(at, bounded);
    for (const row of rows) {
      enqueueOwnedMediaKeys(database, { ownerId: row.owner_id, keys: [row.staging_object_key], at });
      database.prepare(`UPDATE legacy_media_finalize_descriptors SET status='expired',processing_claim=NULL,
        processing_started_at=NULL,updated_at=? WHERE id=? AND status IN ('pending','processing')`)
        .run(at, row.id);
    }
    return rows.length;
  });
}

export function eraseLegacyMediaFinalizeDescriptors(database, {
  ownerId,
  at = Date.now(),
} = {}) {
  ensureLegacyMediaFinalizeSchema(database);
  const owner = normalizedOwner(ownerId);
  return withWrite(database, () => {
    const rows = database.prepare(`SELECT staging_object_key,output_object_key
      FROM legacy_media_finalize_descriptors WHERE owner_id=?`).all(owner);
    const keys = rows.flatMap((row) => [row.staging_object_key, row.output_object_key]).filter(Boolean);
    enqueueOwnedMediaKeys(database, { ownerId: owner, keys, at });
    const removed = database.prepare("DELETE FROM legacy_media_finalize_descriptors WHERE owner_id=?").run(owner);
    return Object.freeze({ descriptors: Number(removed.changes || 0), queuedKeys: new Set(keys).size });
  });
}

export function legacyMediaFinalizeHealth(database, { at = Date.now() } = {}) {
  ensureLegacyMediaFinalizeSchema(database);
  const counts = Object.fromEntries(database.prepare(`SELECT status,COUNT(*) count
    FROM legacy_media_finalize_descriptors GROUP BY status`).all()
    .map((row) => [row.status, Number(row.count || 0)]));
  const expiredPending = Number(database.prepare(`SELECT COUNT(*) count FROM legacy_media_finalize_descriptors
    WHERE status IN ('pending','processing') AND expires_at<=?`).get(at)?.count || 0);
  return Object.freeze({
    pending: counts.pending || 0,
    processing: counts.processing || 0,
    finalized: counts.finalized || 0,
    failed: counts.failed || 0,
    expired: counts.expired || 0,
    expiredPending,
  });
}
