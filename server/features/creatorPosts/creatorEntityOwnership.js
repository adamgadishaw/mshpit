import { ApiError } from "../../errors.js";
import { accountIsPublic } from "../../accountVisibility.js";

// Internal claim-integration boundary, not a route. The caller must validate
// its claim/reviewer and hold the same IMMEDIATE transaction that approves or
// revokes the claim and assigns the account's entity role. The expected owner
// is a compare-and-set guard against another approval winning first.
export function setCreatorEntityOwnership(db, { entityType, entityKey, name, ownerId, expectedOwnerId, status = "active" }) {
  if (!db.isTransaction) throw new TypeError("Creator ownership requires the claim transaction");
  if (!["venue", "event"].includes(entityType) || typeof entityKey !== "string" || !entityKey.trim() || entityKey.length > 200
    || typeof name !== "string" || !name.trim() || name.length > 200 || /[\p{Cc}\p{Cf}]/u.test(entityKey + name)
    || !["active", "held", "removed"].includes(status) || expectedOwnerId === undefined) throw new ApiError(400, "Choose a valid page claim.", "VALIDATION_FAILED");
  const prior = db.prepare("SELECT owner_id FROM creator_entities WHERE entity_type=? AND entity_key=?").get(entityType, entityKey);
  if ((prior?.owner_id || null) !== expectedOwnerId) throw new ApiError(409, "This page’s owner changed. Refresh the claim.", "CONFLICT");
  if (ownerId) {
    const account = db.prepare("SELECT * FROM users WHERE id=?").get(ownerId);
    if (!accountIsPublic(account) || account.role !== entityType) throw new ApiError(403, "The page requires the matching entity account.", "FORBIDDEN");
  }
  db.prepare(`INSERT INTO creator_entities(entity_type,entity_key,name,owner_id,status) VALUES (?,?,?,?,?)
    ON CONFLICT(entity_type,entity_key) DO UPDATE SET name=excluded.name,owner_id=excluded.owner_id,status=excluded.status`)
    .run(entityType, entityKey, name.trim(), ownerId || null, status);
}

export function exportCreatorRelationships(db, accountId) {
  return {
    pages: db.prepare("SELECT entity_type AS entityType,entity_key AS entityKey,name,status FROM creator_entities WHERE owner_id=? ORDER BY entity_type,entity_key").all(accountId),
    follows: db.prepare("SELECT entity_type AS entityType,entity_key AS entityKey,following,notify_updates AS notifyUpdates,updated_at AS updatedAt FROM creator_follows WHERE account_id=? ORDER BY entity_type,entity_key").all(accountId)
      .map(row => ({ ...row, following: !!row.following, notifyUpdates: !!row.notifyUpdates })),
  };
}
