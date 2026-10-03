import { randomBytes, randomUUID } from "node:crypto";
import { ApiError } from "../../errors.js";
import { withImmediateWrite } from "../../databaseTransaction.js";
import { secretHash } from "../mediaApi/mediaApiPolicy.js";
import { CATALOG_LIMITS, CATALOG_SCOPES, catalogKey, catalogObject, catalogType } from "../catalogApi/catalogApiPolicy.js";
import { catalogAudit } from "../catalogResearch/catalogWorkQueue.js";

// No OAuth service, persistent client secret, or editorial credential reuse.
export function createCatalogGrantIssuance({ database, now, assertOwner, assertEnabled, snapshot }) {
  return {
    issuePairing({ ownerId, input }) {
      assertOwner(ownerId);
      catalogObject(input, ["actorLabel", "scopes", "entities", "commitLimit"]);
      const { actorLabel, scopes, entities, commitLimit = 0 } = input;
      if (typeof actorLabel !== "string" || !actorLabel.trim() || actorLabel.length > 80
        || /[\u0000-\u001f\u007f]/u.test(actorLabel)
        || !Array.isArray(scopes) || !scopes.length || scopes.length > CATALOG_SCOPES.length
        || new Set(scopes).size !== scopes.length || scopes.some(scope => !CATALOG_SCOPES.includes(scope))
        || !Array.isArray(entities) || entities.length < 1 || entities.length > CATALOG_LIMITS.pilotEntities
        || !Number.isSafeInteger(commitLimit) || commitLimit < 0 || commitLimit > entities.length) {
        throw new ApiError(400, "Choose up to six records, exact scopes and a bounded commit limit.", "VALIDATION_FAILED");
      }
      const selected = entities.map(entry => {
        catalogObject(entry, ["type", "key"]);
        return { type: catalogType(entry.type), key: catalogKey(entry.key) };
      }).sort((a, b) => a.type.localeCompare(b.type) || a.key.localeCompare(b.key));
      if (new Set(selected.map(entry => JSON.stringify(entry))).size !== selected.length
        || scopes.some(scope => !selected.some(entry => scope.startsWith(`catalog:${entry.type}:`)))
        || selected.some(entry => !scopes.includes(`catalog:${entry.type}:read`))
        || scopes.some(scope => scope.endsWith(":commit") && (!commitLimit || !scopes.includes(scope.replace(/commit$/u, "propose"))))) {
        throw new ApiError(400, "The record selection and scopes do not match.", "VALIDATION_FAILED");
      }
      return withImmediateWrite(database, () => {
        assertOwner(ownerId);
        const at = now();
        for (const entry of selected) snapshot(entry.type, entry.key, at);
        database.prepare("DELETE FROM catalog_pairings WHERE expires_at<=?").run(at);
        if (database.prepare("SELECT COUNT(*) n FROM catalog_pairings").get().n >= CATALOG_LIMITS.grantRows
          || database.prepare("SELECT COUNT(*) n FROM api_grants").get().n >= CATALOG_LIMITS.grantRows) {
          throw new ApiError(429, "Catalog access capacity needs review.", "RATE_LIMITED");
        }
        const id = randomUUID(), code = randomBytes(32).toString("base64url");
        database.prepare(`INSERT INTO catalog_pairings
          (id,owner_id,code_hash,actor_label,scopes,entities_json,commit_limit,issued_at,expires_at,status)
          VALUES (?,?,?,?,?,?,?,?,?,'pending')`).run(id, ownerId, secretHash(code), actorLabel.trim(),
          JSON.stringify(scopes), JSON.stringify(selected), commitLimit, at, at + CATALOG_LIMITS.pairingMs);
        catalogAudit(database, { actorType: "owner", actorLabel: "owner", action: "pairing_issued", at });
        return { pairingId: id, pairingCode: code, expiresAt: at + CATALOG_LIMITS.pairingMs,
          scopes, entities: selected, commitLimit };
      });
    },
    exchangePairing({ pairingCode }) {
      assertEnabled();
      if (typeof pairingCode !== "string" || !/^[A-Za-z0-9_-]{43}$/u.test(pairingCode)) {
        throw new ApiError(401, "This pairing code is invalid or expired.", "AUTH_INVALID");
      }
      return withImmediateWrite(database, () => {
        assertEnabled(); const at = now();
        const row = database.prepare("SELECT * FROM catalog_pairings WHERE code_hash=?").get(secretHash(pairingCode));
        if (!row || row.status !== "pending" || row.issued_at > at || row.expires_at <= at) {
          throw new ApiError(401, "This pairing code is invalid or expired.", "AUTH_INVALID");
        }
        assertOwner(row.owner_id);
        if (database.prepare("SELECT COUNT(*) n FROM api_grants").get().n >= CATALOG_LIMITS.grantRows) {
          throw new ApiError(429, "Catalog access capacity needs review.", "RATE_LIMITED");
        }
        const id = randomUUID(), token = randomBytes(32).toString("base64url");
        database.prepare("UPDATE catalog_pairings SET status='consumed',consumed_at=? WHERE id=?").run(at, row.id);
        database.prepare(`INSERT INTO api_grants
          (id,audience,owner_id,actor_type,actor_label,scopes,token_hash,status,issued_at,expires_at)
          VALUES (?,'pit-catalog-v1',?,'assistant',?,?,?,'active',?,?)`)
          .run(id, row.owner_id, row.actor_label, row.scopes, secretHash(token), at, at + CATALOG_LIMITS.grantMs);
        database.prepare("INSERT INTO catalog_grant_limits(grant_id,entities_json,commit_limit) VALUES (?,?,?)")
          .run(id, row.entities_json, row.commit_limit);
        catalogAudit(database, { actorType: "assistant", actorLabel: row.actor_label, grantId: id, action: "paired", at });
        return { grantId: id, accessToken: token, expiresAt: at + CATALOG_LIMITS.grantMs,
          entities: JSON.parse(row.entities_json), scopes: JSON.parse(row.scopes), commitLimit: row.commit_limit };
      });
    },
  };
}
