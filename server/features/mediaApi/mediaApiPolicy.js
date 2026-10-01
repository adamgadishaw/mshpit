import { createHash, randomBytes } from "node:crypto";
import { withImmediateWrite } from "../../databaseTransaction.js";

export const MEDIA_API_ENABLED_ENV = "PIT_MEDIA_API_ENABLED";
export const MEDIA_API_SCOPES = Object.freeze(["news:write", "media:write"]);
export const MEDIA_API_PAIRING_TTL_MS = 10 * 60 * 1000;
export const MEDIA_API_GRANT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const MEDIA_API_IDEMPOTENCY_TTL_MS = 72 * 60 * 60 * 1000;
export const MEDIA_API_IDEMPOTENCY_LEASE_MS = 15 * 60 * 1000;

export function mediaApiEnabled(env = process.env) {
  return /^(1|true|yes|on)$/iu.test(String(env?.[MEDIA_API_ENABLED_ENV] || "").trim());
}

function tableExists(database, name) {
  return !!database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
}

export function ensureMediaApiSchema(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS media_api_pairings (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      code_hash TEXT NOT NULL UNIQUE,
      actor_type TEXT NOT NULL CHECK(actor_type IN ('human','assistant')),
      actor_label TEXT NOT NULL CHECK(length(actor_label) BETWEEN 1 AND 80),
      scopes TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','consumed','expired','revoked')),
      attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 20),
      issued_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      consumed_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_media_api_pairings_owner
      ON media_api_pairings(owner_id,status,issued_at DESC);
    CREATE TABLE IF NOT EXISTS media_api_grants (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      actor_type TEXT NOT NULL CHECK(actor_type IN ('human','assistant')),
      actor_label TEXT NOT NULL CHECK(length(actor_label) BETWEEN 1 AND 80),
      scopes TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','revoked','expired')),
      token_hash TEXT UNIQUE,
      issued_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      revoked_at INTEGER,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_media_api_grants_owner
      ON media_api_grants(owner_id,status,updated_at DESC);
    CREATE TABLE IF NOT EXISTS media_api_idempotency (
      grant_id TEXT NOT NULL REFERENCES media_api_grants(id) ON DELETE CASCADE,
      operation TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      payload_hash TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('reserved','completed')),
      response_json TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      PRIMARY KEY(grant_id,operation,idempotency_key)
    );
    CREATE INDEX IF NOT EXISTS idx_media_api_idempotency_expiry
      ON media_api_idempotency(expires_at);
    CREATE TABLE IF NOT EXISTS media_api_audit (
      id TEXT PRIMARY KEY,
      -- Audit identifiers are immutable historical references. They are
      -- intentionally not foreign keys: account/grant deletion must never
      -- mutate an append-only audit row through ON DELETE SET NULL.
      grant_id TEXT,
      owner_id TEXT,
      actor_type TEXT NOT NULL CHECK(actor_type IN ('owner','human','assistant')),
      actor_label TEXT NOT NULL,
      request_id TEXT,
      action TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      payload_hash TEXT,
      result TEXT NOT NULL CHECK(result IN ('started','completed','failed','revoked')),
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_media_api_audit_created
      ON media_api_audit(created_at DESC,id DESC);
    CREATE TRIGGER IF NOT EXISTS media_api_audit_no_update
      BEFORE UPDATE ON media_api_audit BEGIN
        SELECT RAISE(ABORT, 'media api audit is append-only');
      END;
    CREATE TRIGGER IF NOT EXISTS media_api_audit_no_delete
      BEFORE DELETE ON media_api_audit BEGIN
        SELECT RAISE(ABORT, 'media api audit is append-only');
      END;
    `);

  // Older local/production-shaped databases were created with ON DELETE
  // SET NULL on the immutable audit table. SQLite implements that action as
  // an UPDATE, which correctly conflicts with the append-only trigger. Rebuild
  // only this small table without foreign keys and retain every row.
  const auditForeignKeys = database.prepare("PRAGMA foreign_key_list(media_api_audit)").all();
  const auditLegacyExists = tableExists(database, "media_api_audit_legacy");
  if (auditForeignKeys.length || auditLegacyExists) {
    // Keep the rebuild atomic. The legacy-name check also repairs a process
    // that stopped after renaming/creating the replacement table but before
    // copying or dropping the populated legacy table.
    withImmediateWrite(database, () => {
      database.exec(`
        DROP TRIGGER IF EXISTS media_api_audit_no_update;
        DROP TRIGGER IF EXISTS media_api_audit_no_delete;
        DROP INDEX IF EXISTS idx_media_api_audit_created;
      `);
      const sources = [];
      if (auditForeignKeys.length) {
        const renamed = auditLegacyExists ? "media_api_audit_migration_current" : "media_api_audit_legacy";
        database.exec(`ALTER TABLE media_api_audit RENAME TO ${renamed}`);
        sources.push(renamed);
      }
      if (auditLegacyExists) sources.push("media_api_audit_legacy");
      database.exec(`
        CREATE TABLE IF NOT EXISTS media_api_audit (
          id TEXT PRIMARY KEY,
          grant_id TEXT,
          owner_id TEXT,
          actor_type TEXT NOT NULL CHECK(actor_type IN ('owner','human','assistant')),
          actor_label TEXT NOT NULL,
          request_id TEXT,
          action TEXT NOT NULL,
          target_type TEXT NOT NULL,
          target_id TEXT NOT NULL,
          payload_hash TEXT,
          result TEXT NOT NULL CHECK(result IN ('started','completed','failed','revoked')),
          created_at INTEGER NOT NULL
        );
      `);
      for (const source of sources) {
        database.exec(`INSERT OR IGNORE INTO media_api_audit
          (id,grant_id,owner_id,actor_type,actor_label,request_id,action,target_type,target_id,payload_hash,result,created_at)
          SELECT id,grant_id,owner_id,actor_type,actor_label,request_id,action,target_type,target_id,payload_hash,result,created_at
          FROM ${source}`);
        database.exec(`DROP TABLE ${source}`);
      }
    });
  }
  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_media_api_audit_created
      ON media_api_audit(created_at DESC,id DESC);
    CREATE TRIGGER IF NOT EXISTS media_api_audit_no_update
      BEFORE UPDATE ON media_api_audit BEGIN
        SELECT RAISE(ABORT, 'media api audit is append-only');
      END;
    CREATE TRIGGER IF NOT EXISTS media_api_audit_no_delete
      BEFORE DELETE ON media_api_audit BEGIN
        SELECT RAISE(ABORT, 'media api audit is append-only');
      END;
  `);
}

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  if (value === undefined) return "null";
  return JSON.stringify(value);
}

export function payloadDigest(value) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

export function secretHash(value) {
  return createHash("sha256").update(String(value || ""), "utf8").digest("hex");
}

export function newSecret(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}

export function parseBearer(value) {
  const text = typeof value === "string" ? value.trim() : "";
  const match = /^Bearer ([A-Za-z0-9_-]{32,200})$/u.exec(text);
  return match ? match[1] : null;
}

export function normalizeScopes(value) {
  if (!Array.isArray(value) || !value.length) throw new TypeError("At least one API scope is required.");
  const scopes = [...new Set(value.map((scope) => String(scope || "").trim()))];
  if (scopes.some((scope) => !MEDIA_API_SCOPES.includes(scope))) throw new TypeError("That API scope is not available.");
  return scopes.sort();
}

export function normalizeActor({ actorType, actorLabel } = {}) {
  const type = actorType === "human" || actorType === "assistant" ? actorType : "";
  const label = typeof actorLabel === "string" ? actorLabel.normalize("NFKC").trim() : "";
  if (!type || !/^[A-Za-z0-9][A-Za-z0-9 ._:@/-]{0,79}$/u.test(label)) {
    throw new TypeError("The actor identity is invalid.");
  }
  return { actorType: type, actorLabel: label };
}

export function normalizeIdempotencyKey(value) {
  const key = typeof value === "string" ? value.trim() : "";
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/u.test(key)) {
    throw new TypeError("An idempotency key between 8 and 128 safe characters is required.");
  }
  return key;
}
