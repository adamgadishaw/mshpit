import { withImmediateWrite } from "../../databaseTransaction.js";

export function ensureEventAccountSchema(db) {
  withImmediateWrite(db, () => db.exec(`CREATE TABLE IF NOT EXISTS event_account_claims (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    target_kind TEXT NOT NULL CHECK(target_kind IN ('event','festival')),
    target_id TEXT NOT NULL, entity_key TEXT NOT NULL,
    note TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','revoked')),
    created_at INTEGER NOT NULL,
    reviewed_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    reviewed_at INTEGER, review_reason TEXT, reviewed_url TEXT
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_event_claim_pending ON event_account_claims(account_id,entity_key) WHERE status='pending';
  CREATE INDEX IF NOT EXISTS idx_event_claim_review ON event_account_claims(status,created_at DESC,id DESC);
  CREATE INDEX IF NOT EXISTS idx_event_claim_account ON event_account_claims(account_id,created_at DESC,id DESC);`));
}

export function exportEventClaims(db, accountId) {
  return db.prepare(`SELECT id,target_kind AS targetKind,target_id AS targetId,entity_key AS entityKey,note,status,
    created_at AS createdAt,reviewed_at AS reviewedAt,review_reason AS reviewReason,reviewed_url AS reviewedUrl
    FROM event_account_claims WHERE account_id=? ORDER BY created_at DESC,id DESC`).all(accountId);
}
