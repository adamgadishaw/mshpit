// Canonical shows and attendance are additive to the legacy `going` table.
// There is deliberately no startup backfill: a show is claimed lazily the next
// time somebody changes attendance, while old rows remain readable throughout
// rolling deploys and code rollbacks.
export function ensureShowSchema(database) {
  if (!database?.exec) throw new TypeError("Show schema requires a database");
  database.exec(`
    CREATE TABLE IF NOT EXISTS shows (
      id            TEXT PRIMARY KEY,
      canonical_key TEXT NOT NULL COLLATE NOCASE UNIQUE,
      artist        TEXT NOT NULL DEFAULT '',
      artist_key    TEXT,
      venue         TEXT NOT NULL DEFAULT '',
      venue_key     TEXT,
      city          TEXT NOT NULL DEFAULT '',
      date          TEXT NOT NULL DEFAULT '',
      local_date    TEXT,
      start_at      INTEGER,
      start_local_time TEXT,
      timezone      TEXT,
      lifecycle     TEXT NOT NULL DEFAULT 'unknown'
        CHECK (lifecycle IN ('unknown','upcoming','happening','completed','postponed','cancelled')),
      tour          TEXT,
      tour_date_id  TEXT,
      provider      TEXT,
      provider_event_id TEXT,
      identity_source TEXT NOT NULL DEFAULT 'legacy_concert_key',
      public_eligible INTEGER NOT NULL DEFAULT 0
        CHECK (public_eligible IN (0,1)),
      created_at    INTEGER NOT NULL,
      updated_at    INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_shows_provider_identity
      ON shows(provider,provider_event_id)
      WHERE provider IS NOT NULL AND provider_event_id IS NOT NULL;

    CREATE TABLE IF NOT EXISTS show_aliases (
      alias_type TEXT NOT NULL,
      alias_value TEXT NOT NULL COLLATE NOCASE,
      show_id    TEXT NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (alias_type,alias_value)
    );
    CREATE INDEX IF NOT EXISTS idx_show_aliases_show
      ON show_aliases(show_id,alias_type,alias_value);
    CREATE INDEX IF NOT EXISTS idx_show_aliases_value_show
      ON show_aliases(alias_value,show_id);

    CREATE TABLE IF NOT EXISTS show_performers (
      show_id        TEXT NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
      performer_key  TEXT NOT NULL,
      performer_name TEXT NOT NULL DEFAULT '',
      role            TEXT NOT NULL DEFAULT 'support'
        CHECK (role IN ('headliner','co_headliner','support','guest')),
      position        INTEGER NOT NULL DEFAULT 0,
      created_at      INTEGER NOT NULL,
      PRIMARY KEY (show_id,performer_key,role)
    );
    CREATE INDEX IF NOT EXISTS idx_show_performers_performer_show
      ON show_performers(performer_key,show_id);

    CREATE TABLE IF NOT EXISTS show_attendance (
      show_id    TEXT NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
      user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      state      TEXT NOT NULL CHECK (state IN ('interested','going','here','went')),
      visibility TEXT NOT NULL DEFAULT 'members'
        CHECK (visibility IN ('members','followers','private')),
      checked_in_at INTEGER,
      legacy_concert_key TEXT,
      legacy_artist TEXT NOT NULL DEFAULT '',
      legacy_artist_key TEXT,
      legacy_venue TEXT NOT NULL DEFAULT '',
      legacy_venue_key TEXT,
      legacy_city TEXT NOT NULL DEFAULT '',
      legacy_date TEXT NOT NULL DEFAULT '',
      legacy_tour TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (show_id,user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_show_attendance_user_updated
      ON show_attendance(user_id,updated_at DESC,show_id);
    CREATE INDEX IF NOT EXISTS idx_show_attendance_show_state_cursor
      ON show_attendance(show_id,state,updated_at DESC,user_id DESC);
    CREATE INDEX IF NOT EXISTS idx_show_attendance_show_visibility_state
      ON show_attendance(show_id,visibility,state);

    -- Only an authoritative verification workflow may write this table. The
    -- member attendance route has intentionally not been given that capability.
    CREATE TABLE IF NOT EXISTS show_attendance_verifications (
      show_id      TEXT NOT NULL,
      user_id      TEXT NOT NULL,
      source       TEXT NOT NULL,
      verified_at  INTEGER NOT NULL,
      revoked_at   INTEGER,
      verified_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
      PRIMARY KEY (show_id,user_id),
      FOREIGN KEY (show_id,user_id)
        REFERENCES show_attendance(show_id,user_id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_show_attendance_verifications_show
      ON show_attendance_verifications(show_id,revoked_at,user_id);

    -- Rolling deploys may briefly run an older API binary that only knows the
    -- visibility-blind going table. These boundary triggers ensure that old
    -- writes cannot override a canonical private, historical, or Interested
    -- relationship. Exactly member-visible Going remains a safe projection.
    CREATE TRIGGER IF NOT EXISTS trg_going_guard_canonical_insert
    AFTER INSERT ON going
    WHEN EXISTS (
      SELECT 1 FROM show_attendance a
      WHERE a.user_id=NEW.user_id
        AND a.show_id=COALESCE(
          (SELECT sa.show_id FROM show_aliases sa
            WHERE sa.alias_type='legacy_concert_key'
              AND sa.alias_value=NEW.concert_key COLLATE NOCASE),
          (SELECT s.id FROM shows s
            WHERE s.canonical_key=NEW.concert_key COLLATE NOCASE)
        )
        AND (a.state<>'going' OR a.visibility<>'members')
    )
    BEGIN
      DELETE FROM going
      WHERE user_id=NEW.user_id AND concert_key=NEW.concert_key;
    END;

    CREATE TRIGGER IF NOT EXISTS trg_going_guard_canonical_update
    AFTER UPDATE ON going
    WHEN EXISTS (
      SELECT 1 FROM show_attendance a
      WHERE a.user_id=NEW.user_id
        AND a.show_id=COALESCE(
          (SELECT sa.show_id FROM show_aliases sa
            WHERE sa.alias_type='legacy_concert_key'
              AND sa.alias_value=NEW.concert_key COLLATE NOCASE),
          (SELECT s.id FROM shows s
            WHERE s.canonical_key=NEW.concert_key COLLATE NOCASE)
        )
        AND (a.state<>'going' OR a.visibility<>'members')
    )
    BEGIN
      DELETE FROM going
      WHERE user_id=NEW.user_id AND concert_key=NEW.concert_key;
    END;

    CREATE TRIGGER IF NOT EXISTS trg_show_attendance_prune_legacy_insert
    AFTER INSERT ON show_attendance
    WHEN NEW.state<>'going' OR NEW.visibility<>'members'
    BEGIN
      DELETE FROM going
      WHERE user_id=NEW.user_id
        AND NEW.show_id=COALESCE(
          (SELECT sa.show_id FROM show_aliases sa
            WHERE sa.alias_type='legacy_concert_key'
              AND sa.alias_value=going.concert_key COLLATE NOCASE),
          (SELECT s.id FROM shows s
            WHERE s.canonical_key=going.concert_key COLLATE NOCASE)
        );
    END;

    CREATE TRIGGER IF NOT EXISTS trg_show_attendance_prune_legacy_update
    AFTER UPDATE OF state,visibility,show_id,user_id ON show_attendance
    WHEN NEW.state<>'going' OR NEW.visibility<>'members'
    BEGIN
      DELETE FROM going
      WHERE user_id=NEW.user_id
        AND NEW.show_id=COALESCE(
          (SELECT sa.show_id FROM show_aliases sa
            WHERE sa.alias_type='legacy_concert_key'
              AND sa.alias_value=going.concert_key COLLATE NOCASE),
          (SELECT s.id FROM shows s
            WHERE s.canonical_key=going.concert_key COLLATE NOCASE)
        );
    END;

    CREATE TRIGGER IF NOT EXISTS trg_show_alias_prune_legacy_insert
    AFTER INSERT ON show_aliases
    WHEN NEW.alias_type='legacy_concert_key'
    BEGIN
      DELETE FROM going
      WHERE concert_key=NEW.alias_value COLLATE NOCASE
        AND EXISTS (
          SELECT 1 FROM show_attendance a
          WHERE a.show_id=NEW.show_id AND a.user_id=going.user_id
            AND (a.state<>'going' OR a.visibility<>'members')
        );
    END;
  `);

  // These guards support a rolling deploy from the first foundation revision.
  // Definitions are fixed constants; no request data reaches migration SQL.
  const showColumns = new Set(database.prepare("PRAGMA table_info(shows)").all()
    .map(({ name }) => name));
  if (!showColumns.has("public_eligible")) {
    database.exec("ALTER TABLE shows ADD COLUMN public_eligible INTEGER NOT NULL DEFAULT 0 CHECK (public_eligible IN (0,1))");
  }
  if (!showColumns.has("tour_date_id")) {
    database.exec("ALTER TABLE shows ADD COLUMN tour_date_id TEXT");
  }
  database.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_shows_tour_date_identity
    ON shows(tour_date_id) WHERE tour_date_id IS NOT NULL`);
  const attendanceColumns = new Set(database.prepare("PRAGMA table_info(show_attendance)").all()
    .map(({ name }) => name));
  const additiveAttendanceColumns = [
    ["legacy_concert_key", "TEXT"],
    ["legacy_artist", "TEXT NOT NULL DEFAULT ''"],
    ["legacy_artist_key", "TEXT"],
    ["legacy_venue", "TEXT NOT NULL DEFAULT ''"],
    ["legacy_venue_key", "TEXT"],
    ["legacy_city", "TEXT NOT NULL DEFAULT ''"],
    ["legacy_date", "TEXT NOT NULL DEFAULT ''"],
    ["legacy_tour", "TEXT"],
  ];
  for (const [name, definition] of additiveAttendanceColumns) {
    if (!attendanceColumns.has(name)) {
      database.exec(`ALTER TABLE show_attendance ADD COLUMN ${name} ${definition}`);
    }
  }
}
