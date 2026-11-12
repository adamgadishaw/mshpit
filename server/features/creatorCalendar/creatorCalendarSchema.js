import { withImmediateWrite } from "../../databaseTransaction.js";

export function ensureCreatorCalendarSchema(db) {
  withImmediateWrite(db, () => {
    if (!db.prepare("PRAGMA table_info(tour_dates)").all().some(row => row.name === "creator_revision")) {
      db.exec("ALTER TABLE tour_dates ADD COLUMN creator_revision INTEGER NOT NULL DEFAULT 0");
    }
    db.exec(`CREATE TABLE IF NOT EXISTS creator_calendar_publications (
      id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      mutation_id TEXT NOT NULL, payload_hash TEXT NOT NULL,
      event_id TEXT NOT NULL REFERENCES tour_dates(id) ON DELETE CASCADE,
      revision INTEGER NOT NULL, release_at INTEGER NOT NULL,
      state TEXT NOT NULL CHECK(state IN ('scheduled','published','cancelled','blocked')),
      payload TEXT NOT NULL CHECK(json_valid(payload)),
      post_id TEXT REFERENCES posts(id) ON DELETE SET NULL,
      created_at INTEGER NOT NULL, UNIQUE(account_id,mutation_id)
    );
    CREATE INDEX IF NOT EXISTS idx_creator_calendar_due ON creator_calendar_publications(state,release_at,id);
    CREATE INDEX IF NOT EXISTS idx_creator_calendar_event ON creator_calendar_publications(event_id,revision);
    CREATE INDEX IF NOT EXISTS idx_creator_calendar_post ON creator_calendar_publications(post_id);
    CREATE INDEX IF NOT EXISTS idx_creator_calendar_owner ON creator_calendar_publications(account_id,created_at,id);`);
  });
}

export function exportCreatorCalendar(db, accountId) {
  return db.prepare(`SELECT id,event_id AS eventId,revision,release_at AS releaseAt,state,post_id AS postId,
    payload,created_at AS createdAt FROM creator_calendar_publications WHERE account_id=? ORDER BY created_at,id`)
    .all(accountId).map(row => ({ ...row, payload: JSON.parse(row.payload) }));
}
