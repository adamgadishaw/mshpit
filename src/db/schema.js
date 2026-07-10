// SQLite storage layer (scaffold), the efficient, normalized store that replaces
// the in-memory JSON as the catalog grows to Soundmap/Spotify scale.
//
// NOT wired in yet: nothing imports this module, so it does not affect the running
// app. Adopt it incrementally (see STORAGE.md). Requires:  npx expo install expo-sqlite
//
// Why this is efficient vs the current catalog.generated.json:
//  - Data is normalized: an event stores artist_id + venue_id, not repeated copies
//    of the full artist/venue objects (the JSON currently duplicates them).
//  - Photos are ONE row per URL (deduped), referenced by owner, no repetition.
//  - Indexed columns (name, city, artist_id) make search/browse O(log n), not a
//    full scan of a giant JSON blob loaded entirely into memory on every launch.
//  - Only the rows a screen needs are read; images are lazy-loaded + disk-cached.

export const SCHEMA = `
PRAGMA journal_mode = WAL;              -- concurrent reads while the worker writes
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS artists (
  id        INTEGER PRIMARY KEY,
  key       TEXT UNIQUE NOT NULL,       -- normalized lowercase name
  name      TEXT NOT NULL,
  genre     TEXT,
  photo     TEXT,                       -- primary photo url (denormalized for speed)
  updated_at INTEGER DEFAULT 0          -- scraper cursor
);
CREATE INDEX IF NOT EXISTS idx_artists_name ON artists(name COLLATE NOCASE);

CREATE TABLE IF NOT EXISTS venues (
  id        INTEGER PRIMARY KEY,
  key       TEXT UNIQUE NOT NULL,
  name      TEXT NOT NULL,
  city      TEXT,
  region    TEXT,
  country   TEXT,
  lat       REAL,
  lng       REAL,
  capacity  INTEGER,
  photo     TEXT,
  updated_at INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_venues_city ON venues(city COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_venues_name ON venues(name COLLATE NOCASE);

CREATE TABLE IF NOT EXISTS events (
  id         INTEGER PRIMARY KEY,
  artist_id  INTEGER NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
  venue_id   INTEGER NOT NULL REFERENCES venues(id)  ON DELETE CASCADE,
  date       TEXT,
  ticket_url TEXT,
  sold_out   INTEGER DEFAULT 0,
  release_at INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_events_date  ON events(date);
CREATE INDEX IF NOT EXISTS idx_events_venue ON events(venue_id);

-- One row per image URL, deduped; owned by an artist OR a venue.
CREATE TABLE IF NOT EXISTS photos (
  id         INTEGER PRIMARY KEY,
  url        TEXT UNIQUE NOT NULL,
  owner_kind TEXT NOT NULL,             -- 'artist' | 'venue'
  owner_id   INTEGER NOT NULL,
  source     TEXT,                      -- 'commons' | 'openverse' | 'web' | 'google' | 'fan'
  credit     TEXT,
  removed    INTEGER DEFAULT 0,         -- takedown flag (soft delete)
  ord        INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_photos_owner ON photos(owner_kind, owner_id, removed, ord);

CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);
`;

// Open (and migrate) the database. Call once at app start.
export async function openDb() {
  const SQLite = await import("expo-sqlite");
  const db = await SQLite.openDatabaseAsync("pit.db");
  await db.execAsync(SCHEMA);
  return db;
}

// Idempotent seed from the existing catalog JSON on first launch only.
export async function seedFromCatalog(db, catalog) {
  const seeded = await db.getFirstAsync(`SELECT v FROM meta WHERE k = 'seeded'`);
  if (seeded?.v === "1") return;
  await db.withTransactionAsync(async () => {
    for (const [key, a] of Object.entries(catalog.artists || {})) {
      const r = await db.runAsync(
        `INSERT OR IGNORE INTO artists(key,name,genre,photo,updated_at) VALUES(?,?,?,?,?)`,
        key, a.name, a.genre ?? null, a.photo ?? null, a.updatedAt ?? 0
      );
      await insertPhotos(db, "artist", r.lastInsertRowId, a.galleryPool, a.photos, a.photoCredit);
    }
    // venues + events follow the same pattern (see STORAGE.md for the full seeder).
    await db.runAsync(`INSERT OR REPLACE INTO meta(k,v) VALUES('seeded','1')`);
  });
}

async function insertPhotos(db, kind, ownerId, pool, flat, fallbackCredit) {
  const rows = (pool && pool.length ? pool : (flat || []).map((url) => ({ uri: url, credit: fallbackCredit })));
  let ord = 0;
  for (const p of rows) {
    if (!p?.uri) continue;
    await db.runAsync(
      `INSERT OR IGNORE INTO photos(url,owner_kind,owner_id,source,credit,ord) VALUES(?,?,?,?,?,?)`,
      p.uri, kind, ownerId, p.source ?? "commons", p.credit ?? null, ord++
    );
  }
}

// ---- Query API (mirrors useStore() shapes so screens don't change) ----
export const queries = {
  searchArtists: (db, q, limit = 200) =>
    db.getAllAsync(`SELECT name, genre FROM artists WHERE name LIKE ? ORDER BY name LIMIT ?`, `%${q}%`, limit),
  searchVenues: (db, q, limit = 200) =>
    db.getAllAsync(
      `SELECT v.name, v.city, v.region, v.country,
              (SELECT COUNT(*) FROM events e WHERE e.venue_id = v.id AND e.release_at <= ?) AS upcoming
       FROM venues v WHERE v.name LIKE ? OR v.city LIKE ? ORDER BY upcoming DESC, v.name LIMIT ?`,
      Date.now(), `%${q}%`, `%${q}%`, limit
    ),
  // Live gallery = non-removed photos in order (self-healing under takedowns).
  gallery: (db, kind, ownerId, limit = 5) =>
    db.getAllAsync(
      `SELECT url, credit, source FROM photos WHERE owner_kind=? AND owner_id=? AND removed=0 ORDER BY ord LIMIT ?`,
      kind, ownerId, limit
    ),
  removePhoto: (db, url) => db.runAsync(`UPDATE photos SET removed=1 WHERE url=?`, url),
};
