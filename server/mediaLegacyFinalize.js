import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";

import { withImmediateWrite as withWrite } from "./databaseTransaction.js";
import { ApiError } from "./errors.js";
import {
  createMediaPresign,
  validateMediaRequest,
} from "./media.js";
import {
  sanitizePrivateImageStaging,
  stageSanitizedPublicImage,
} from "./mediaAssets.js";
import {
  enqueueOwnedMediaKeys,
  MEDIA_UPLOAD_TICKET_MS,
  reserveMediaUploadTicket,
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
  "image/heif": "image/jpeg",
});
const DUMMY_TOKEN_HASH = createHash("sha256").update("pit-invalid-legacy-media-token").digest("hex");
const initializedSchemas = new WeakSet();

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

function settleFailedClaim(database, { ownerId, row, claimId, error, at }) {
  const terminal = error instanceof ApiError && error.status === 415;
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
} = {}) {
  ensureLegacyMediaFinalizeSchema(database);
  const owner = normalizedOwner(ownerId);
  const claimId = randomUUID();
  const claim = claimDescriptor(database, { ownerId: owner, finalizeToken, at, claimId });
  if (claim.outcome === "finalized") return outputProjection(claim.row, { duplicate: true });
  if (claim.outcome !== "claimed") throw claimOutcomeError(claim.outcome);
  const row = claim.row;

  try {
    const { sanitized } = await sanitizePrivateImageStaging(database, {
      ownerId: owner,
      objectKey: row.staging_object_key,
      expectedBytes: row.staging_byte_size,
      expectedType: row.staging_mime_type,
      outputType: row.output_mime_type,
      env,
      fetchImpl,
      imageProcessor,
      signal,
    });
    const staged = await stageSanitizedPublicImage(database, {
      ownerId: owner,
      purpose: row.purpose,
      publicIdentity: row.id,
      stagingKey: row.staging_object_key,
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
