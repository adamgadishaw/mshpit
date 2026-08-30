// A Lounge is a short-lived member surface attached to one exact Show. The
// messages remain in their existing moderation store; this table keeps only
// lifecycle/retention metadata so closed rooms cannot be mistaken for public
// chat history.
export function ensureLoungeSchema(database) {
  if (!database?.exec) throw new TypeError("Lounge schema requires a database");
  database.exec(`
    CREATE TABLE IF NOT EXISTS concert_lounges (
      lounge_id             TEXT PRIMARY KEY COLLATE NOCASE,
      show_id               TEXT REFERENCES shows(id) ON DELETE SET NULL,
      artist                TEXT NOT NULL DEFAULT '',
      doors_open_at         INTEGER,
      show_start_at         INTEGER,
      cutoff_at             INTEGER NOT NULL,
      cutoff_source         TEXT NOT NULL
        CHECK (cutoff_source IN ('doors_open','show_start')),
      status                TEXT NOT NULL DEFAULT 'open'
        CHECK (status IN ('open','archived')),
      closed_at             INTEGER,
      archived_at           INTEGER,
      retention_policy_key  TEXT,
      retention_review_at   INTEGER,
      created_at            INTEGER NOT NULL,
      updated_at            INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_concert_lounges_status_cutoff
      ON concert_lounges(status,cutoff_at,lounge_id);
    CREATE INDEX IF NOT EXISTS idx_concert_lounges_show
      ON concert_lounges(show_id,lounge_id);
  `);
}
