// SQLite database layer — Node's built-in node:sqlite, zero dependencies.
// WAL mode + foreign keys + busy timeout: safe under concurrent requests,
// survives crashes mid-write (WAL journal replays), and the whole DB is one
// file you can back up by copying.
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
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

// Schema — created idempotently. Migrations append below with schema_version.
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
-- No git push, no redeploy — updates go live the moment the scheduler writes.
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
`);

const ver = db.prepare("SELECT version FROM schema_version LIMIT 1").get();
if (!ver) db.prepare("INSERT INTO schema_version (version) VALUES (1)").run();

// Additive migrations for DBs created before a column existed. ADD COLUMN throws
// if it's already there, so each is best-effort — safe to run on every boot.
for (const stmt of [
  "ALTER TABLE users ADD COLUMN handle_changed_at INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE users ADD COLUMN verified INTEGER NOT NULL DEFAULT 0",
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

// Public projection — NEVER include pass_hash or email in list responses.
export function publicUser(u, { self = false } = {}) {
  if (!u) return null;
  return {
    id: u.id,
    name: u.name,
    handle: u.handle,
    role: u.role,
    verified: !!u.verified,
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
