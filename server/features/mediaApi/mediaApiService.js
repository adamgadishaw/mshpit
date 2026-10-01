import { randomUUID } from "node:crypto";

import { ApiError } from "../../errors.js";
import { withImmediateWrite } from "../../databaseTransaction.js";
import {
  createMediaAsset,
  finalizeMediaAsset,
} from "../../mediaAssets.js";
import {
  MEDIA_API_GRANT_TTL_MS,
  MEDIA_API_IDEMPOTENCY_LEASE_MS,
  MEDIA_API_IDEMPOTENCY_TTL_MS,
  MEDIA_API_PAIRING_TTL_MS,
  ensureMediaApiSchema,
  mediaApiEnabled,
  newSecret,
  normalizeActor,
  normalizeIdempotencyKey,
  normalizeScopes,
  parseBearer,
  payloadDigest,
  secretHash,
} from "./mediaApiPolicy.js";

const WRITER_ROLES = new Set(["admin", "editor"]);
const MAX_RESPONSE_BYTES = 64 * 1024;

function json(value) {
  try { return JSON.parse(value || "{}"); }
  catch { return null; }
}

function integer(value, label) {
  if (!Number.isSafeInteger(Number(value))) throw new ApiError(400, `${label} is invalid.`, "VALIDATION_FAILED");
  return Number(value);
}

function requiredRevision(value) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new ApiError(400, "A current draft revision is required.", "VALIDATION_FAILED");
  }
  return value;
}

function mapNewsEditorError(error) {
  if (!error || error.name !== "NewsEditorError") return error;
  const message = error.message || "The editorial request could not be completed.";
  switch (error.code) {
    case "VALIDATION_FAILED": return new ApiError(400, message, "VALIDATION_FAILED", error.cause);
    case "NOT_FOUND": return new ApiError(404, message, "NOT_FOUND", error.cause);
    case "CONFLICT": return new ApiError(409, message, "CONFLICT", error.cause);
    case "ACTION_REQUIRED": return new ApiError(422, message, "ACTION_REQUIRED", error.cause);
    case "RATE_LIMITED": return new ApiError(429, message, "RATE_LIMITED", error.cause);
    case "PROVIDER_UNAVAILABLE": return new ApiError(502, message, "PROVIDER_UNAVAILABLE", error.cause);
    default: return new ApiError(500, "Something broke on our end, it's been logged.", "INTERNAL_ERROR", error.cause);
  }
}

function assertPhotoBody(body) {
  const contentType = typeof body?.contentType === "string"
    ? body.contentType.split(";", 1)[0].trim().toLowerCase() : "";
  if (!contentType.startsWith("image/")) {
    throw new ApiError(415, "This editorial API accepts photos only.", "MEDIA_TYPE_UNSUPPORTED");
  }
}

export function createMediaApiService({
  database,
  env = process.env,
  now = Date.now,
  newId = () => `mag_${randomUUID().replaceAll("-", "")}`,
  editor = null,
  media = {},
} = {}) {
  if (!database) throw new TypeError("A database is required.");
  ensureMediaApiSchema(database);
  const mediaCreate = media.create || createMediaAsset;
  const mediaFinalize = media.finalize || finalizeMediaAsset;
  const mediaFinalizeIsReal = mediaFinalize === finalizeMediaAsset;

  function enabled() {
    if (!mediaApiEnabled(env)) throw new ApiError(404, "Not found.", "NOT_FOUND");
  }

  function userById(id) {
    return database.prepare("SELECT id,role,email_verified_at,is_banned,suspended_until FROM users WHERE id=?").get(id) || null;
  }

  function assertActiveOwner(ownerId, at = now()) {
    const user = userById(ownerId);
    if (!user || user.is_banned || (user.suspended_until && user.suspended_until > at)
        || !(Number(user.email_verified_at) > 0) || !WRITER_ROLES.has(user.role)) {
      throw new ApiError(403, "The account is no longer allowed to use this editorial grant.", "FORBIDDEN");
    }
    return user;
  }

  function grantById(grantId) {
    return database.prepare("SELECT * FROM media_api_grants WHERE id=?").get(grantId) || null;
  }

  function assertGrantActive(grantId, requiredScope, at = now()) {
    const grant = grantById(grantId);
    if (!grant || grant.status !== "active" || Number(grant.expires_at) <= at) {
      throw new ApiError(401, "That editorial grant is no longer active.", "AUTH_INVALID");
    }
    const scopes = json(grant.scopes);
    if (!Array.isArray(scopes) || !scopes.includes(requiredScope)) {
      throw new ApiError(403, "That editorial grant does not include this operation.", "FORBIDDEN");
    }
    const owner = assertActiveOwner(grant.owner_id, at);
    return { ...grant, scopes, owner };
  }

  function authorize(authorization, requiredScope, at = now()) {
    enabled();
    const secret = parseBearer(authorization);
    if (!secret) throw new ApiError(401, "A valid editorial grant is required.", "AUTH_INVALID");
    const grant = database.prepare("SELECT * FROM media_api_grants WHERE token_hash=?").get(secretHash(secret));
    if (!grant) throw new ApiError(401, "A valid editorial grant is required.", "AUTH_INVALID");
    return assertGrantActive(grant.id, requiredScope, at);
  }

  function audit({ grantId = null, ownerId = null, actorType, actorLabel, requestId = null, action, targetType, targetId, payloadHash = null, result }) {
    database.prepare(`INSERT INTO media_api_audit
      (id,grant_id,owner_id,actor_type,actor_label,request_id,action,target_type,target_id,payload_hash,result,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(newId(), grantId, ownerId, actorType, actorLabel, requestId, action, targetType, targetId, payloadHash, result, now());
  }

  function reserveIdempotency(grant, operation, idempotencyKey, input, at = now()) {
    let key;
    try { key = normalizeIdempotencyKey(idempotencyKey); }
    catch (error) { throw new ApiError(400, error.message, "VALIDATION_FAILED"); }
    const hash = payloadDigest(input);
    return withImmediateWrite(database, () => {
      const current = assertGrantActive(grant.id, operation.startsWith("news") ? "news:write" : "media:write", at);
      database.prepare("DELETE FROM media_api_idempotency WHERE expires_at<=?").run(at);
      const existing = database.prepare(`SELECT * FROM media_api_idempotency
        WHERE grant_id=? AND operation=? AND idempotency_key=?`).get(grant.id, operation, key);
      if (existing) {
        if (existing.payload_hash !== hash) throw new ApiError(409, "That idempotency key belongs to a different request.", "IDEMPOTENCY_MISMATCH");
        if (existing.status === "completed") return { key, hash, replay: json(existing.response_json) };
        if (Number(existing.updated_at) + MEDIA_API_IDEMPOTENCY_LEASE_MS > at) {
          throw new ApiError(409, "That request is already in progress.", "CONFLICT");
        }
        database.prepare(`UPDATE media_api_idempotency SET payload_hash=?,status='reserved',response_json=NULL,updated_at=?,expires_at=?
          WHERE grant_id=? AND operation=? AND idempotency_key=?`)
          .run(hash, at, at + MEDIA_API_IDEMPOTENCY_TTL_MS, grant.id, operation, key);
      } else {
        database.prepare(`INSERT INTO media_api_idempotency
          (grant_id,operation,idempotency_key,payload_hash,status,response_json,created_at,updated_at,expires_at)
          VALUES (?,?,?,?,'reserved',NULL,?,?,?)`)
          .run(grant.id, operation, key, hash, at, at, at + MEDIA_API_IDEMPOTENCY_TTL_MS);
      }
      return { key, hash, replay: null, owner: current.owner };
    });
  }

  function completeIdempotency({ grant, operation, key, hash, response, requestId, action, targetType, targetId, result = "completed" }) {
    const encoded = JSON.stringify(response);
    if (Buffer.byteLength(encoded, "utf8") > MAX_RESPONSE_BYTES) {
      throw new ApiError(500, "The editorial response was too large.", "INTERNAL_ERROR");
    }
    const current = assertGrantActive(grant.id, operation.startsWith("news") ? "news:write" : "media:write", now());
    const changed = database.prepare(`UPDATE media_api_idempotency SET status='completed',response_json=?,updated_at=?
      WHERE grant_id=? AND operation=? AND idempotency_key=? AND payload_hash=? AND status='reserved'`)
      .run(encoded, now(), grant.id, operation, key, hash);
    if (!changed.changes) throw new ApiError(409, "That request is no longer available for completion.", "CONFLICT");
    audit({ grantId: current.id, ownerId: current.owner_id, actorType: current.actor_type, actorLabel: current.actor_label,
      requestId, action, targetType, targetId, payloadHash: hash, result });
    return response;
  }

  function clearReservation(grantId, operation, key) {
    try {
      database.prepare("DELETE FROM media_api_idempotency WHERE grant_id=? AND operation=? AND idempotency_key=? AND status='reserved'")
        .run(grantId, operation, key);
    } catch { /* the original operation owns the useful failure */ }
  }

  function issuePairing({ ownerId, actorType, actorLabel, scopes, expiresInSeconds, requestId } = {}) {
    enabled();
    let actor;
    try { actor = normalizeActor({ actorType, actorLabel }); }
    catch (error) { throw new ApiError(400, error.message, "VALIDATION_FAILED"); }
    let normalizedScopes;
    try { normalizedScopes = normalizeScopes(scopes); }
    catch (error) { throw new ApiError(400, error.message, "VALIDATION_FAILED"); }
    const requestedTtl = expiresInSeconds === undefined ? MEDIA_API_PAIRING_TTL_MS : integer(expiresInSeconds, "Pairing lifetime") * 1000;
    if (requestedTtl < 60_000 || requestedTtl > MEDIA_API_PAIRING_TTL_MS) {
      throw new ApiError(400, "Pairing lifetime must be between one minute and ten minutes.", "VALIDATION_FAILED");
    }
    const at = now();
    const code = newSecret(24);
    const pairingId = newId();
    withImmediateWrite(database, () => {
      assertActiveOwner(ownerId, at);
      database.prepare(`INSERT INTO media_api_pairings
        (id,owner_id,code_hash,actor_type,actor_label,scopes,status,attempts,issued_at,expires_at,consumed_at)
        VALUES (?,?,?,?,?,?, 'pending',0,?,?,NULL)`)
        .run(pairingId, ownerId, secretHash(code), actor.actorType, actor.actorLabel, JSON.stringify(normalizedScopes), at, at + requestedTtl);
      audit({ ownerId, actorType: "owner", actorLabel: "owner", requestId, action: "pairing_issued",
        targetType: "media_api_pairing", targetId: pairingId,
        payloadHash: payloadDigest({ actor, scopes: normalizedScopes, expiresAt: at + requestedTtl }), result: "completed" });
    });
    return { pairingId, pairingCode: code, expiresAt: at + requestedTtl, scopes: normalizedScopes, actor };
  }

  function exchangePairing({ pairingCode, requestId } = {}) {
    enabled();
    const code = typeof pairingCode === "string" ? pairingCode.trim() : "";
    if (!/^[A-Za-z0-9_-]{32,200}$/u.test(code)) throw new ApiError(401, "That pairing code is invalid or expired.", "AUTH_INVALID");
    const at = now();
    const token = newSecret(32);
    const grantId = newId();
    const outcome = withImmediateWrite(database, () => {
      const pairing = database.prepare("SELECT * FROM media_api_pairings WHERE code_hash=?").get(secretHash(code));
      if (!pairing || pairing.status !== "pending" || Number(pairing.expires_at) <= at || Number(pairing.attempts) >= 20) {
        return { invalid: true, pairingId: pairing?.status === "pending" ? pairing.id : null };
      }
      const owner = assertActiveOwner(pairing.owner_id, at);
      const consumed = database.prepare("UPDATE media_api_pairings SET status='consumed',consumed_at=? WHERE id=? AND status='pending' AND expires_at>? ")
        .run(at, pairing.id, at);
      if (!consumed.changes) throw new ApiError(401, "That pairing code is invalid or expired.", "AUTH_INVALID");
      // Pairing expiry bounds only the single-use exchange. A successfully
      // issued grant gets its own seven-day lifetime and remains revocable.
      const expiresAt = at + MEDIA_API_GRANT_TTL_MS;
      database.prepare(`INSERT INTO media_api_grants
        (id,owner_id,actor_type,actor_label,scopes,status,token_hash,issued_at,expires_at,revoked_at,updated_at)
        VALUES (?,?,?,?,?,'active',?,?,?,NULL,?)`)
        .run(grantId, owner.id, pairing.actor_type, pairing.actor_label, pairing.scopes, secretHash(token), at, expiresAt, at);
      audit({ grantId, ownerId: owner.id, actorType: "owner", actorLabel: "owner", requestId, action: "grant_issued",
        targetType: "media_api_grant", targetId: grantId, result: "completed" });
      return { grantId, accessToken: token, expiresAt, scopes: json(pairing.scopes), actor: { actorType: pairing.actor_type, actorLabel: pairing.actor_label } };
    });
    if (outcome?.invalid) {
      if (outcome.pairingId) {
        try {
          withImmediateWrite(database, () => {
            database.prepare("UPDATE media_api_pairings SET attempts=MIN(attempts+1,20),status=CASE WHEN expires_at<=? THEN 'expired' ELSE status END WHERE id=? AND status='pending'")
              .run(at, outcome.pairingId);
          });
        } catch { /* preserve the authentication failure if the counter cannot be recorded */ }
      }
      throw new ApiError(401, "That pairing code is invalid or expired.", "AUTH_INVALID");
    }
    return outcome;
  }

  function revokeGrant({ ownerId, grantId, requestId } = {}) {
    enabled();
    const at = now();
    return withImmediateWrite(database, () => {
      assertActiveOwner(ownerId, at);
      const grant = grantById(grantId);
      if (!grant || grant.owner_id !== ownerId) throw new ApiError(404, "That editorial grant was not found.", "NOT_FOUND");
      database.prepare("UPDATE media_api_grants SET status='revoked',token_hash=NULL,revoked_at=?,updated_at=? WHERE id=? AND status='active'")
        .run(at, at, grantId);
      const cancelled = database.prepare("UPDATE media_api_pairings SET status='revoked' WHERE owner_id=? AND status='pending'")
        .run(ownerId);
      audit({ grantId, ownerId, actorType: "owner", actorLabel: "owner", requestId, action: "grant_revoked",
        targetType: "media_api_grant", targetId: grantId,
        payloadHash: payloadDigest({ pendingPairingsRevoked: cancelled.changes }), result: "revoked" });
      return { revoked: true, grantId };
    });
  }

  function createNewsDraft({ authorization, body, idempotencyKey, requestId } = {}) {
    const grant = authorize(authorization, "news:write");
    const operation = "news.create";
    const reservation = reserveIdempotency(grant, operation, idempotencyKey, body);
    if (reservation.replay) return reservation.replay;
    let completed = false;
    try {
      if (!editor || typeof editor.writeSelfWritten !== "function") throw new ApiError(500, "The editorial writer is not ready.", "INTERNAL_ERROR");
      // API receipts are grant-scoped. Never pass a body fallback key into
      // the human editor's account-scoped save-receipt namespace.
      editor.writeSelfWritten({ ...body, idempotencyKey: null, actorId: grant.owner_id, actorType: grant.actor_type, actorLabel: grant.actor_label,
        grantId: grant.id, onSaved: (draft) => {
        assertGrantActive(grant.id, "news:write");
        const response = { draft };
        completeIdempotency({ grant, operation, key: reservation.key, hash: reservation.hash, response, requestId,
          action: "news_draft_created", targetType: "news_draft", targetId: draft.id });
        completed = true;
      } });
      if (!completed) throw new ApiError(500, "The editorial writer did not record the draft.", "INTERNAL_ERROR");
      return database.prepare("SELECT response_json FROM media_api_idempotency WHERE grant_id=? AND operation=? AND idempotency_key=?")
        .get(grant.id, operation, reservation.key)?.response_json ? json(database.prepare("SELECT response_json FROM media_api_idempotency WHERE grant_id=? AND operation=? AND idempotency_key=?").get(grant.id, operation, reservation.key).response_json) : null;
    } catch (error) {
      clearReservation(grant.id, operation, reservation.key);
      throw mapNewsEditorError(error);
    }
  }

  function publishNewsDraft({ authorization, draftId, expectedRevision, idempotencyKey, requestId } = {}) {
    const grant = authorize(authorization, "news:write");
    const row = database.prepare("SELECT id,status,origin,created_by,created_grant_id,revision FROM news_drafts WHERE id=?").get(draftId);
    if (!row || row.origin !== "self_written" || row.created_by !== grant.owner_id
        || (row.created_grant_id && row.created_grant_id !== grant.id)) {
      throw new ApiError(404, "That editorial draft was not found.", "NOT_FOUND");
    }
    const revision = requiredRevision(expectedRevision);
    const operation = "news.publish";
    const input = { draftId, expectedRevision: revision };
    const reservation = reserveIdempotency(grant, operation, idempotencyKey, input);
    if (reservation.replay) return reservation.replay;
    let completed = false;
    try {
      if (!editor || typeof editor.publish !== "function") throw new ApiError(500, "The editorial writer is not ready.", "INTERNAL_ERROR");
      const result = editor.publish(draftId, { expectedRevision: revision, onPublished: ({ draft, postId }) => {
        assertGrantActive(grant.id, "news:write");
        const response = { draft, postId };
        completeIdempotency({ grant, operation, key: reservation.key, hash: reservation.hash, response, requestId,
          action: "news_published", targetType: "news_post", targetId: postId });
        completed = true;
      } });
      if (!completed) throw new ApiError(500, "The editorial publication was not recorded.", "INTERNAL_ERROR");
      return result;
    } catch (error) {
      clearReservation(grant.id, operation, reservation.key);
      throw mapNewsEditorError(error);
    }
  }

  function createMedia({ authorization, body, idempotencyKey, requestId } = {}) {
    const grant = authorize(authorization, "media:write");
    assertPhotoBody(body);
    const operation = "media.create";
    const reservation = reserveIdempotency(grant, operation, idempotencyKey, body);
    if (reservation.replay) return reservation.replay;
    try {
      const response = withImmediateWrite(database, () => {
        const current = assertGrantActive(grant.id, "media:write");
        const result = mediaCreate(database, { ownerId: current.owner_id, body, at: now(), env, photosOnly: true });
        assertGrantActive(grant.id, "media:write");
        const assetId = result?.asset?.id || "unknown";
        completeIdempotency({ grant, operation, key: reservation.key, hash: reservation.hash, response: result, requestId,
          action: "media_created", targetType: "media_asset", targetId: assetId });
        return result;
      });
      return response;
    } catch (error) {
      clearReservation(grant.id, operation, reservation.key);
      throw error;
    }
  }

  async function finalizeMedia({ authorization, assetId, body, idempotencyKey, requestId, signal } = {}) {
    const grant = authorize(authorization, "media:write");
    const asset = mediaFinalizeIsReal
      ? database.prepare("SELECT kind FROM media_assets WHERE id=? AND owner_id=?").get(assetId, grant.owner_id)
      : null;
    if (asset?.kind && asset.kind !== "image") {
      throw new ApiError(415, "This editorial API accepts photos only.", "MEDIA_TYPE_UNSUPPORTED");
    }
    const operation = "media.finalize";
    const input = { assetId, body };
    const reservation = reserveIdempotency(grant, operation, idempotencyKey, input);
    if (reservation.replay) return reservation.replay;
    let finalizationPrepared = false;
    let ownsDurableCommit = false;
    try {
      const prepared = await mediaFinalize(database, { ownerId: grant.owner_id, assetId, body, at: now(), env, signal,
        photosOnly: true, deferCommit: true,
        assertAuthorized: () => assertGrantActive(grant.id, "media:write") });
      finalizationPrepared = true;
      const commit = prepared?.deferredCommit === true && typeof prepared.commit === "function" ? prepared.commit : null;
      ownsDurableCommit = !!commit;
      return withImmediateWrite(database, () => {
        assertGrantActive(grant.id, "media:write");
        const result = commit ? commit() : prepared;
        assertGrantActive(grant.id, "media:write");
        const response = { ...result, finalize: { state: result?.asset?.status === "ready" ? "completed" : "idle" } };
        completeIdempotency({ grant, operation, key: reservation.key, hash: reservation.hash,
          response, requestId, action: "media_finalized", targetType: "media_asset", targetId: assetId });
        return response;
      });
    } catch (error) {
      // A storage/HEAD failure can happen before finalizeMediaAsset returns its
      // prepared result. Release that reservation immediately; only legacy
      // adapters that already returned a durable result retain reconciliation
      // state after a later completion failure.
      if (!finalizationPrepared || ownsDurableCommit || error?.code === "MEDIA_STORAGE_UNAVAILABLE") {
        clearReservation(grant.id, operation, reservation.key);
      }
      throw error;
    }
  }

  return {
    issuePairing,
    exchangePairing,
    revokeGrant,
    createNewsDraft,
    publishNewsDraft,
    createMedia,
    finalizeMedia,
    authorize,
    assertGrantActive,
    assertEnabled: enabled,
  };
}
