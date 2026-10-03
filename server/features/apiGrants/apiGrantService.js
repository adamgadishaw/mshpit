import { ApiError } from "../../errors.js";
import { isOwnerId } from "../../ownerIdentity.js";
import { parseBearer, secretHash } from "../mediaApi/mediaApiPolicy.js";
import { CATALOG_AUDIENCE, CATALOG_SCOPES } from "../catalogApi/catalogApiPolicy.js";
import { withImmediateWrite } from "../../databaseTransaction.js";

// Separate storage and explicit audience: editorial grants are never adopted
// or broadened. Issuance is isolated in catalogGrantIssuance.
export function ensureApiGrantSchema(database) {
  return withImmediateWrite(database, () => database.exec(`CREATE TABLE IF NOT EXISTS api_grants (
    id TEXT PRIMARY KEY, audience TEXT NOT NULL CHECK(audience='pit-catalog-v1'),
    owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    actor_type TEXT NOT NULL CHECK(actor_type='assistant'),
    actor_label TEXT NOT NULL CHECK(length(actor_label) BETWEEN 1 AND 80),
    scopes TEXT NOT NULL CHECK(length(scopes)<=1000),
    token_hash TEXT NOT NULL UNIQUE CHECK(length(token_hash)=64),
    status TEXT NOT NULL CHECK(status IN ('active','revoked')),
    issued_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, revoked_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_api_grants_owner ON api_grants(owner_id,status);
  CREATE TABLE IF NOT EXISTS catalog_grant_limits (
    grant_id TEXT PRIMARY KEY REFERENCES api_grants(id) ON DELETE CASCADE,
    entities_json TEXT NOT NULL CHECK(length(entities_json)<=10000),
    commit_limit INTEGER NOT NULL CHECK(commit_limit BETWEEN 0 AND 6),
    commits INTEGER NOT NULL DEFAULT 0 CHECK(commits>=0 AND commits<=commit_limit));
  CREATE TABLE IF NOT EXISTS catalog_pairings (
    id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code_hash TEXT NOT NULL UNIQUE, actor_label TEXT NOT NULL, scopes TEXT NOT NULL,
    entities_json TEXT NOT NULL, commit_limit INTEGER NOT NULL,
    issued_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, consumed_at INTEGER,
    status TEXT NOT NULL CHECK(status IN ('pending','consumed','revoked')));`));
}

export function createApiGrantService({ database, now = Date.now }) {
  function assertActive(id, scope) {
    const at = now();
    const row = database.prepare("SELECT * FROM api_grants WHERE id=? AND audience=?")
      .get(id, CATALOG_AUDIENCE);
    if (!row || row.status !== "active" || !Number.isSafeInteger(row.issued_at) || row.issued_at < 0
      || !Number.isSafeInteger(row.expires_at) || row.expires_at <= at || row.issued_at > at) {
      throw new ApiError(401, "A current catalog grant is required.", "AUTH_INVALID");
    }
    let scopes;
    try { scopes = JSON.parse(row.scopes); } catch { scopes = null; }
    if (!CATALOG_SCOPES.includes(scope) || !Array.isArray(scopes)
      || scopes.some(value => !CATALOG_SCOPES.includes(value)) || !scopes.includes(scope)) {
      throw new ApiError(403, "This grant does not include the catalog operation.", "FORBIDDEN");
    }
    const owner = database.prepare("SELECT * FROM users WHERE id=?").get(row.owner_id);
    if (!owner || owner.role !== "admin" || !(owner.email_verified_at > 0) || owner.is_banned
      || owner.dormant_at || (owner.suspended_until && owner.suspended_until > at) || !isOwnerId(database, row.owner_id)) {
      throw new ApiError(403, "The catalog grant's issuing owner is no longer authorized.", "FORBIDDEN");
    }
    const policy = database.prepare("SELECT * FROM catalog_grant_limits WHERE grant_id=?").get(row.id);
    let entities;
    try { entities = JSON.parse(policy?.entities_json); } catch { entities = null; }
    if (!Array.isArray(entities) || entities.length < 1 || entities.length > 6
      || entities.some(entry => !entry || !["artist", "venue", "event"].includes(entry.type)
        || typeof entry.key !== "string" || !entry.key || entry.key.length > 600)
      || !Number.isSafeInteger(policy?.commit_limit) || policy.commit_limit < 0 || policy.commit_limit > 6) {
      throw new ApiError(403, "This catalog grant needs a bounded record selection.", "FORBIDDEN");
    }
    // Usage is intentionally excluded: completing one record must not invalidate
    // another active claim's immutable authority binding.
    return { id: row.id, ownerId: row.owner_id, actorType: row.actor_type, actorLabel: row.actor_label, scopes,
      issuedAt: row.issued_at, expiresAt: row.expires_at, entities, commitLimit: policy.commit_limit };
  }
  return {
    assertActive,
    authorize(authorization, scope) {
      const token = parseBearer(authorization);
      const row = token && database.prepare("SELECT id FROM api_grants WHERE token_hash=? AND audience=?")
        .get(secretHash(token), CATALOG_AUDIENCE);
      if (!row) throw new ApiError(401, "A current catalog grant is required.", "AUTH_INVALID");
      return assertActive(row.id, scope);
    },
  };
}

export function assertCatalogGrantEntity(grant, type, key) {
  if (!grant.entities.some(entry => entry.type === type && entry.key === key)) {
    throw new ApiError(403, "This record is outside the approved catalog selection.", "FORBIDDEN");
  }
}
