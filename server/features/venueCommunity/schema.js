import { withImmediateWrite } from '../../databaseTransaction.js';

export function ensureVenueCommunitySchema(db) {
  return withImmediateWrite(db, () => {
    const reviewColumns = new Set(db.prepare('PRAGMA table_info(venue_reviews)').all().map(row => row.name));
    if (!reviewColumns.has('updated_at')) db.exec('ALTER TABLE venue_reviews ADD COLUMN updated_at INTEGER');
    db.exec(`
    CREATE TABLE IF NOT EXISTS venue_claims (
      id TEXT PRIMARY KEY,
      venue_path TEXT NOT NULL,
      venue_name TEXT NOT NULL,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      website TEXT NOT NULL,
      note TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','revoked','cancelled')),
      created_at INTEGER NOT NULL,
      reviewed_at INTEGER,
      reviewer_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      review_method TEXT,
      review_reference TEXT,
      review_note TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_venue_claim_pending ON venue_claims(venue_path,user_id) WHERE status='pending';
    CREATE INDEX IF NOT EXISTS idx_venue_claim_queue ON venue_claims(status,created_at DESC,id DESC);
    CREATE INDEX IF NOT EXISTS idx_venue_claim_user ON venue_claims(user_id,venue_path,created_at DESC,id DESC);
    CREATE INDEX IF NOT EXISTS idx_venue_claim_all ON venue_claims(created_at DESC,id DESC);
    CREATE INDEX IF NOT EXISTS idx_venue_claim_account ON venue_claims(user_id,created_at DESC,id DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_venue_canonical_rating ON venue_reviews(venue_key,user_id)
      WHERE venue_key LIKE '/venue/%' AND removed=0;
    `);
    const columns = new Set(db.prepare('PRAGMA table_info(venue_claims)').all().map(row => row.name));
    for (const [name, type] of [['conversion_consent', 'TEXT'], ['conversion_consent_at', 'INTEGER'], ['account_role_at_request', 'TEXT']]) {
      if (!columns.has(name)) db.exec(`ALTER TABLE venue_claims ADD COLUMN ${name} ${type}`);
    }
  });
}
