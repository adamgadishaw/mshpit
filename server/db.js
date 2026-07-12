// SQLite database layer, Node's built-in node:sqlite, zero dependencies.
// WAL mode + foreign keys + busy timeout: safe under concurrent requests,
// survives crashes mid-write (WAL journal replays), and the whole DB is one
// file you can back up by copying.
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.PIT_DATA_DIR || join(HERE, "data");
mkdirSync(DATA_DIR, { recursive: true });

export const db = new DatabaseSync(join(DATA_DIR, "pit.db"));

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;
`);

// Schema, created idempotently. Migrations append below with schema_version.
db.exec(`
CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL);

CREATE TABLE IF NOT EXISTS users (
  id              TEXT PRIMARY KEY,
  email           TEXT NOT NULL UNIQUE,
  name            TEXT NOT NULL,
  handle          TEXT NOT NULL UNIQUE,
  pass_hash       TEXT NOT NULL,
  role            TEXT NOT NULL DEFAULT 'fan',
  artist_name     TEXT,
  home_city       TEXT,
  home_lat        REAL,
  home_lng        REAL,
  bio             TEXT NOT NULL DEFAULT '',
  avatar_uri      TEXT,
  avatar_color    TEXT,
  banner          TEXT,
  initials        TEXT,
  genres          TEXT NOT NULL DEFAULT '[]',
  favorite_artists TEXT NOT NULL DEFAULT '[]',
  extras          TEXT NOT NULL DEFAULT '{}',
  is_banned       INTEGER NOT NULL DEFAULT 0,
  suspended_until INTEGER,
  handle_changed_at INTEGER NOT NULL DEFAULT 0,
  created_at      INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  ip         TEXT,
  ua         TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS posts (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  artist        TEXT NOT NULL,
  venue         TEXT NOT NULL,
  city          TEXT NOT NULL DEFAULT '',
  date          TEXT NOT NULL DEFAULT '',
  overall       REAL NOT NULL,
  band          REAL,
  room          REAL,
  review        TEXT NOT NULL DEFAULT '',
  photos        TEXT NOT NULL DEFAULT '[]',
  photos_public INTEGER NOT NULL DEFAULT 0,
  setlist       TEXT NOT NULL DEFAULT '[]',
  removed       INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_posts_user ON posts(user_id);
CREATE INDEX IF NOT EXISTS idx_posts_created ON posts(created_at DESC);

CREATE TABLE IF NOT EXISTS likes (
  post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (post_id, user_id)
);

CREATE TABLE IF NOT EXISTS comments (
  id         TEXT PRIMARY KEY,
  post_id    TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text       TEXT NOT NULL,
  removed    INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_comments_post ON comments(post_id);

CREATE TABLE IF NOT EXISTS follows (
  follower_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  followee_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (follower_id, followee_id)
);

CREATE TABLE IF NOT EXISTS fan_club_members (
  artist  TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (artist, user_id)
);

CREATE TABLE IF NOT EXISTS fan_club_messages (
  id         TEXT PRIMARY KEY,
  artist     TEXT NOT NULL,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text       TEXT NOT NULL,
  removed    INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_fcm_artist ON fan_club_messages(artist);

CREATE TABLE IF NOT EXISTS dms (
  id         TEXT PRIMARY KEY,
  from_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text       TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_dms_pair ON dms(from_id, to_id);

CREATE TABLE IF NOT EXISTS reports (
  id          TEXT PRIMARY KEY,
  target_type TEXT NOT NULL,
  target_id   TEXT NOT NULL,
  reason      TEXT NOT NULL DEFAULT '',
  reporter_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  status      TEXT NOT NULL DEFAULT 'open',
  created_at  INTEGER NOT NULL
);

-- ---- SQLite migration slice 7 (ratings, going, venue reviews, artist pages) ----

-- Album + song ratings. kind = 'album' | 'song', ref = norm(artist)|norm(title).
CREATE TABLE IF NOT EXISTS ratings (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind    TEXT NOT NULL,
  ref     TEXT NOT NULL,
  rating  REAL NOT NULL,
  PRIMARY KEY (user_id, kind, ref)
);
CREATE INDEX IF NOT EXISTS idx_ratings_ref ON ratings(kind, ref);

-- Planned attendance ("I'm going"), keyed by the concert key (artist|venue|date).
CREATE TABLE IF NOT EXISTS going (
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  concert_key TEXT NOT NULL,
  artist      TEXT NOT NULL,
  venue       TEXT NOT NULL,
  city        TEXT NOT NULL DEFAULT '',
  date        TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (user_id, concert_key)
);
CREATE INDEX IF NOT EXISTS idx_going_key ON going(concert_key);

-- Venue reviews (room reputation), keyed by norm(venue).
CREATE TABLE IF NOT EXISTS venue_reviews (
  id         TEXT PRIMARY KEY,
  venue_key  TEXT NOT NULL,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rating     REAL NOT NULL,
  text       TEXT NOT NULL DEFAULT '',
  photos     TEXT NOT NULL DEFAULT '[]',
  removed    INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_venue_reviews_venue ON venue_reviews(venue_key);

-- Artist account requests (fan → admin-approved artist).
CREATE TABLE IF NOT EXISTS artist_requests (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  artist_name TEXT NOT NULL,
  note        TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'pending',
  created_at  INTEGER NOT NULL
);

-- Artist-owned profile overrides (banner/avatar/bio/feed toggle), keyed by norm(name).
CREATE TABLE IF NOT EXISTS artist_profiles (
  artist_key   TEXT PRIMARY KEY,
  bio          TEXT,
  banner       TEXT,
  avatar_uri   TEXT,
  feed_enabled INTEGER NOT NULL DEFAULT 0,
  owner_id     TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_at   INTEGER
);

-- The artist "updates" feed (posts on their own page).
CREATE TABLE IF NOT EXISTS artist_posts (
  id         TEXT PRIMARY KEY,
  artist_key TEXT NOT NULL,
  user_id    TEXT REFERENCES users(id) ON DELETE SET NULL,
  text       TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_artist_posts_artist ON artist_posts(artist_key);

-- ---- Analytics / ad-targeting events ---------------------------------------
-- The activity we collect to personalize content and advertising (disclosed in
-- the Privacy policy and consented to at sign-up). user_id is null for guests.
CREATE TABLE IF NOT EXISTS events (
  id         TEXT PRIMARY KEY,
  user_id    TEXT REFERENCES users(id) ON DELETE SET NULL,
  name       TEXT NOT NULL,
  props      TEXT NOT NULL DEFAULT '{}',
  ip         TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_name ON events(name, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_user ON events(user_id, created_at DESC);

-- ---- Notifications / activity (server-backed, cross-device) -----------------
-- Addressed to a recipient (user_id) when someone (actor_id) acts on their stuff.
CREATE TABLE IF NOT EXISTS notifications (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  actor_id   TEXT REFERENCES users(id) ON DELETE SET NULL,
  type       TEXT NOT NULL,
  post_id    TEXT,
  artist     TEXT,
  text       TEXT,
  read       INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notifs_user ON notifications(user_id, created_at DESC);

-- ---- Tour dates (scraped live into the DB, not the bundled file) -------------
-- Written by the in-process scheduler (server/tourdates.js) from Ticketmaster /
-- Bandsintown; served via GET /api/tourdates and merged into the client catalog.
-- No git push, no redeploy, updates go live the moment the scheduler writes.
CREATE TABLE IF NOT EXISTS tour_dates (
  id         TEXT PRIMARY KEY,
  artist     TEXT NOT NULL,
  venue      TEXT,
  place      TEXT,
  lat        REAL,
  lng        REAL,
  date       TEXT,
  ticket_url TEXT,
  sold_out   INTEGER NOT NULL DEFAULT 0,
  source     TEXT,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tourdates_artist ON tour_dates(artist);

-- ---- Artist catalog (moved out of the bundled JSON so it can scale past a
-- bundle: on-demand resolution + a full MusicBrainz dump seed). norm is the
-- lowercased/trimmed name and the key. data holds the rich blob (albums,
-- topTracks, photos, galleryPool). rank_score orders search (release count /
-- popularity proxy) so notable artists surface first. ----
CREATE TABLE IF NOT EXISTS artists (
  norm        TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  genre       TEXT,
  photo       TEXT,
  bio         TEXT,
  mbid        TEXT,
  spotify_id  TEXT,
  country     TEXT,
  formed      TEXT,
  popularity  INTEGER,
  rank_score  INTEGER NOT NULL DEFAULT 0,
  data        TEXT,
  source      TEXT,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_artists_rank ON artists(rank_score DESC);
CREATE INDEX IF NOT EXISTS idx_artists_name ON artists(name);

-- Names people searched that returned nothing from MusicBrainz. The admin catalog
-- queue reads this to seed on demand (info + photos) instead of a blind bulk dump.
CREATE TABLE IF NOT EXISTS missing_artists (
  norm      TEXT PRIMARY KEY,
  name      TEXT NOT NULL,
  searches  INTEGER NOT NULL DEFAULT 1,
  last_at   INTEGER NOT NULL
);

-- Every song played, cross-device. Powers listening history + "friends listening".
CREATE TABLE IF NOT EXISTS plays (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  artist     TEXT,
  url        TEXT,
  art        TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_plays_user ON plays(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_plays_created ON plays(created_at DESC);

-- Saved listening sessions / playlists (from the player's Save-as-playlist).
CREATE TABLE IF NOT EXISTS playlists (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  tracks     TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_playlists_user ON playlists(user_id, created_at DESC);

-- User blocks: blocker never sees or hears from blocked (posts, DMs, follows).
CREATE TABLE IF NOT EXISTS blocks (
  blocker_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (blocker_id, blocked_id)
);
CREATE INDEX IF NOT EXISTS idx_blocks_blocked ON blocks(blocked_id);

-- Concert lounge / afterparty chat, keyed by concertKey (artist|venue|date), so
-- attendee chat is shared + live like the fan clubs (not device-local).
CREATE TABLE IF NOT EXISTS lounge_messages (
  id         TEXT PRIMARY KEY,
  lounge_id  TEXT NOT NULL,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text       TEXT NOT NULL,
  removed    INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_lounge ON lounge_messages(lounge_id, created_at);

-- Catalog-seed crawl cursor: how deep each genre tag has been crawled, so a
-- re-run resumes instead of re-fetching MusicBrainz pages it already finished.
CREATE TABLE IF NOT EXISTS seed_cursor (
  tag        TEXT PRIMARY KEY,
  next_off   INTEGER NOT NULL DEFAULT 0,
  exhausted  INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
`);

const ver = db.prepare("SELECT version FROM schema_version LIMIT 1").get();
if (!ver) db.prepare("INSERT INTO schema_version (version) VALUES (1)").run();

// Additive migrations for DBs created before a column existed. ADD COLUMN throws
// if it's already there, so each is best-effort, safe to run on every boot.
for (const stmt of [
  "ALTER TABLE users ADD COLUMN handle_changed_at INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE users ADD COLUMN verified INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE users ADD COLUMN spotify_access_token TEXT",
  "ALTER TABLE users ADD COLUMN spotify_refresh_token TEXT",
  "ALTER TABLE users ADD COLUMN spotify_expires_at INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE posts ADD COLUMN tour TEXT",
  "ALTER TABLE artists ADD COLUMN searches INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE comments ADD COLUMN parent_id TEXT", // forum-style reply threading
  "ALTER TABLE users ADD COLUMN sponsor INTEGER NOT NULL DEFAULT 0", // admin-granted partner mark
  "ALTER TABLE users ADD COLUMN reset_hash TEXT", // sha256 of a password-reset token
  "ALTER TABLE users ADD COLUMN reset_expires INTEGER NOT NULL DEFAULT 0",
]) { try { db.exec(stmt); } catch {} }

// --- tiny helpers ------------------------------------------------------------
export const q = {
  userByEmail: db.prepare("SELECT * FROM users WHERE email = ?"),
  userById: db.prepare("SELECT * FROM users WHERE id = ?"),
  userByHandle: db.prepare("SELECT * FROM users WHERE handle = ?"),
  insertUser: db.prepare(`INSERT INTO users (id,email,name,handle,pass_hash,role,home_city,home_lat,home_lng,initials,avatar_color,created_at)
                          VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`),
  insertSession: db.prepare("INSERT INTO sessions (token_hash,user_id,created_at,expires_at,ip,ua) VALUES (?,?,?,?,?,?)"),
  sessionByHash: db.prepare("SELECT * FROM sessions WHERE token_hash = ?"),
  deleteSession: db.prepare("DELETE FROM sessions WHERE token_hash = ?"),
  deleteExpiredSessions: db.prepare("DELETE FROM sessions WHERE expires_at < ?"),
};

// --- Artist catalog statements + helpers -------------------------------------
const ARTIST_COLS = "norm,name,genre,photo,bio,mbid,spotify_id,country,formed,popularity,rank_score,data,source,created_at,updated_at";
export const artistStmts = {
  byNorm: db.prepare("SELECT * FROM artists WHERE norm = ?"),
  count: db.prepare("SELECT COUNT(*) c FROM artists"),
  search: db.prepare("SELECT * FROM artists WHERE norm LIKE ? ORDER BY (norm = ?) DESC, rank_score DESC, name LIMIT ?"),
  top: db.prepare("SELECT * FROM artists ORDER BY rank_score DESC, name LIMIT ?"),
  bumpSearches: db.prepare("UPDATE artists SET searches = searches + 1 WHERE norm = ?"),
  thin: db.prepare("SELECT * FROM artists WHERE photo IS NULL ORDER BY searches DESC, updated_at DESC LIMIT ?"),
  thinCount: db.prepare("SELECT COUNT(*) c FROM artists WHERE photo IS NULL"),
  purge: db.prepare("DELETE FROM artists WHERE norm = ?"),
  recordMissing: db.prepare("INSERT INTO missing_artists (norm,name,searches,last_at) VALUES (?,?,1,?) ON CONFLICT(norm) DO UPDATE SET searches = searches + 1, last_at = excluded.last_at"),
  listMissing: db.prepare("SELECT * FROM missing_artists ORDER BY searches DESC, last_at DESC LIMIT ?"),
  clearMissing: db.prepare("DELETE FROM missing_artists WHERE norm = ?"),
  upsert: db.prepare(`INSERT INTO artists (${ARTIST_COLS})
    VALUES (@norm,@name,@genre,@photo,@bio,@mbid,@spotify_id,@country,@formed,@popularity,@rank_score,@data,@source,@created_at,@updated_at)
    ON CONFLICT(norm) DO UPDATE SET
      name=excluded.name,
      genre=COALESCE(excluded.genre,artists.genre),
      photo=COALESCE(excluded.photo,artists.photo),
      bio=COALESCE(excluded.bio,artists.bio),
      mbid=COALESCE(excluded.mbid,artists.mbid),
      spotify_id=COALESCE(excluded.spotify_id,artists.spotify_id),
      country=COALESCE(excluded.country,artists.country),
      formed=COALESCE(excluded.formed,artists.formed),
      popularity=COALESCE(excluded.popularity,artists.popularity),
      rank_score=MAX(excluded.rank_score,artists.rank_score),
      data=COALESCE(excluded.data,artists.data),
      updated_at=excluded.updated_at`),
};

export const normName = (s) => (s || "").trim().toLowerCase();

// Build a row from an artist object (bundled shape or a resolved MB/Spotify one).
export function artistRow(key, a, source = "musicbrainz") {
  const now = Date.now();
  const rank = (a.popularity != null ? a.popularity * 1000 : 0) + (a.albums?.length || 0) * 10 + ((a.topTracks?.length || 0) ? 5 : 0);
  return {
    norm: normName(key || a.name),
    name: a.name || key,
    genre: a.genre || null,
    photo: a.photo || null,
    bio: a.bio || null,
    mbid: a.mbid || null,
    spotify_id: a.spotifyId || null,
    country: a.country || null,
    formed: a.beginYear || a.formed || null,
    popularity: a.popularity ?? null,
    rank_score: Math.round(a.rank_score ?? rank),
    data: JSON.stringify(a),
    source,
    created_at: now,
    updated_at: now,
  };
}

// Public projection, merges the rich `data` blob with the typed columns.
export function publicArtist(r) {
  if (!r) return null;
  let data = {};
  try { data = r.data ? JSON.parse(r.data) : {}; } catch {}
  return { ...data, name: r.name, genre: r.genre, photo: r.photo, bio: r.bio, mbid: r.mbid, spotifyId: r.spotify_id, country: r.country, popularity: r.popularity };
}

// Merge the bundled catalog into the DB on boot. The upsert is idempotent
// (COALESCE + MAX rank), so re-merging every boot cheaply propagates fresh
// enrichment (e.g. Deezer popularity/rank) to the ~1.6k bundled artists without
// touching on-demand-resolved ones. New artists arrive via resolve + MB dump.
export function seedArtistsFromBundle() {
  try {
    const path = join(HERE, "..", "src", "seed", "catalog.generated.json");
    const cat = JSON.parse(readFileSync(path, "utf8"));
    const entries = Object.entries(cat.artists || {});
    if (!entries.length) return;
    const fresh = artistStmts.count.get().c === 0;
    db.exec("BEGIN");
    for (const [key, a] of entries) artistStmts.upsert.run(artistRow(key, a, "bundle"));
    db.exec("COMMIT");
    if (fresh) console.log(`[db] seeded ${entries.length} artists into the DB from the bundled catalog`);
    else console.log(`[db] merged ${entries.length} bundled artists (refreshed rank/enrichment)`);
  } catch (e) {
    try { db.exec("ROLLBACK"); } catch {}
    console.warn("[db] artist seed skipped:", e.message);
  }
}
seedArtistsFromBundle();

// Public projection, NEVER include pass_hash or email in list responses.
export function publicUser(u, { self = false } = {}) {
  if (!u) return null;
  return {
    id: u.id,
    name: u.name,
    handle: u.handle,
    role: u.role,
    verified: !!u.verified,
    sponsor: !!u.sponsor,
    spotifyConnected: !!u.spotify_refresh_token, // safe boolean; tokens never leave the server
    artistName: u.artist_name || undefined,
    home: u.home_city ? { city: u.home_city, lat: u.home_lat, lng: u.home_lng } : null,
    bio: u.bio,
    avatarUri: u.avatar_uri,
    avatarColor: u.avatar_color,
    banner: u.banner,
    initials: u.initials,
    genres: JSON.parse(u.genres || "[]"),
    favoriteArtists: JSON.parse(u.favorite_artists || "[]"),
    ...(JSON.parse(u.extras || "{}")),
    ...(self ? { email: u.email } : {}),
  };
}
