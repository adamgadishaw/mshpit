// SQLite database layer, Node's built-in node:sqlite, zero dependencies.
// WAL mode + foreign keys + busy timeout: safe under concurrent requests and
// survives crashes mid-write (the WAL journal replays).
//
// WAL is also why copying pit.db is NOT a backup: committed transactions live in
// pit.db-wal until a checkpoint, so a bare copy can be torn or stale. Use
// `npm run backup` (VACUUM INTO), which asks SQLite for a consistent snapshot.
import { DatabaseSync } from "node:sqlite";
import { toIsoDate } from "../src/domain/dates.mjs";
import { displayGenre, resolveGenre, storedClaims } from "../src/domain/genre.mjs";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PIT_SQLITE_APPLICATION_ID, prepareDataDirectory } from "./dataDirectory.js";

export const artistSearchKey = (value) => String(value || "")
  .normalize("NFKD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase()
  .replace(/[^\p{L}\p{N}]+/gu, "");

const HERE = dirname(fileURLToPath(import.meta.url));
export const DATABASE_DIRECTORY = prepareDataDirectory({ fallbackDir: join(HERE, "data") });
export const DATABASE_PATH = join(DATABASE_DIRECTORY, "pit.db");

export const db = new DatabaseSync(DATABASE_PATH);

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
  dims          TEXT NOT NULL DEFAULT '{}',
  review        TEXT NOT NULL DEFAULT '',
  photos        TEXT NOT NULL DEFAULT '[]',
  photos_public INTEGER NOT NULL DEFAULT 0,
  setlist       TEXT NOT NULL DEFAULT '[]',
  client_mutation_id TEXT,
  client_mutation_hash TEXT,
  removed       INTEGER NOT NULL DEFAULT 0,
  updated_at    INTEGER,
  created_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_posts_user ON posts(user_id);
CREATE INDEX IF NOT EXISTS idx_posts_created ON posts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_cursor ON posts(created_at DESC, id DESC);

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
CREATE INDEX IF NOT EXISTS idx_comments_cursor ON comments(post_id, removed, created_at DESC, id DESC);

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
CREATE INDEX IF NOT EXISTS idx_fcm_cursor ON fan_club_messages(artist, removed, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS dms (
  id         TEXT PRIMARY KEY,
  from_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text       TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_dms_pair ON dms(from_id, to_id);
CREATE INDEX IF NOT EXISTS idx_dms_cursor ON dms(from_id, to_id, created_at DESC, id DESC);

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
CREATE INDEX IF NOT EXISTS idx_venue_reviews_cursor ON venue_reviews(venue_key, removed, created_at DESC, id DESC);

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
CREATE INDEX IF NOT EXISTS idx_events_created ON events(created_at DESC);

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
CREATE INDEX IF NOT EXISTS idx_notifs_cursor ON notifications(user_id, created_at DESC, id DESC);

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
  search_key  TEXT,
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
-- Wikidata enrichment groups aliases by canonical MBID. Without this
-- expression index its startup CTE performs nested full-table scans and blocks
-- the single Node event loop long enough to fail hosted health checks.
CREATE INDEX IF NOT EXISTS idx_artists_mbid_lower ON artists(lower(mbid));

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
  video_id   TEXT,
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
  visibility TEXT NOT NULL DEFAULT 'public',
  created_at INTEGER NOT NULL,
  updated_at INTEGER
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

-- Durable achievement ledger. Progress is computed from authoritative tables;
-- earned rows remain as a historical record and cannot be duplicated.
CREATE TABLE IF NOT EXISTS user_achievements (
  user_id            TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  badge_id           TEXT NOT NULL,
  definition_version INTEGER NOT NULL DEFAULT 1,
  points             INTEGER NOT NULL,
  earned_at          INTEGER NOT NULL,
  progress_snapshot  TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY (user_id, badge_id)
);
CREATE INDEX IF NOT EXISTS idx_achievements_user ON user_achievements(user_id, earned_at);

-- Append-only moderation trail: records who changed what and why. It stores no
-- private content body, credentials, or session material.
CREATE TABLE IF NOT EXISTS moderation_actions (
  id          TEXT PRIMARY KEY,
  actor_id    TEXT REFERENCES users(id) ON DELETE SET NULL,
  action      TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id   TEXT NOT NULL,
  reason      TEXT NOT NULL DEFAULT '',
  prior_state TEXT NOT NULL DEFAULT '{}',
  next_state  TEXT NOT NULL DEFAULT '{}',
  request_id  TEXT,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_moderation_actions_created ON moderation_actions(created_at DESC);

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
CREATE INDEX IF NOT EXISTS idx_lounge_cursor ON lounge_messages(lounge_id, removed, created_at DESC, id DESC);

-- Catalog-seed crawl cursor: how deep each genre tag has been crawled, so a
-- re-run resumes instead of re-fetching MusicBrainz pages it already finished.
CREATE TABLE IF NOT EXISTS seed_cursor (
  tag        TEXT PRIMARY KEY,
  next_off   INTEGER NOT NULL DEFAULT 0,
  exhausted  INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

-- YouTube video-ID cache: title+artist -> videoId, resolved via the YouTube Data
-- API and kept FOREVER (the free API quota is small, so we never re-resolve a
-- track we've already looked up). video_id NULL is a cached "no match" (short TTL
-- via updated_at) so a miss doesn't burn quota on every play.
CREATE TABLE IF NOT EXISTS yt_cache (
  key        TEXT PRIMARY KEY,
  video_id   TEXT,
  updated_at INTEGER NOT NULL
);

-- Provider responses that are safe to keep across restarts. Only durable
-- metadata belongs here: short-lived playback URLs are deliberately excluded.
CREATE TABLE IF NOT EXISTS provider_cache (
  key        TEXT PRIMARY KEY,
  data       TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_provider_cache_expiry ON provider_cache(expires_at);

-- Durable history for long-running catalog jobs. The previous in-memory-only
-- status disappeared on every restart and could report success after adding 0.
CREATE TABLE IF NOT EXISTS seed_runs (
  id          TEXT PRIMARY KEY,
  mode        TEXT NOT NULL,
  status      TEXT NOT NULL,
  start_total INTEGER NOT NULL,
  target      INTEGER NOT NULL,
  added       INTEGER NOT NULL DEFAULT 0,
  enriched    INTEGER NOT NULL DEFAULT 0,
  error_code  TEXT,
  note        TEXT NOT NULL DEFAULT '',
  started_at  INTEGER NOT NULL,
  finished_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_seed_runs_started ON seed_runs(started_at DESC);

CREATE TABLE IF NOT EXISTS app_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Durable, indexed Wikidata discovery state. The original implementation kept
-- every processed MBID in one ever-growing app_meta JSON array, then applied a
-- SQL LIMIT before filtering it. That both rewrote the whole array per batch
-- and permanently stranded artists beyond the limit. One row per identity lets
-- SQL select the next eligible batch and gives misses a bounded retry date.
CREATE TABLE IF NOT EXISTS wikidata_channel_checks (
  mbid       TEXT PRIMARY KEY,
  channel_id TEXT,
  validated  INTEGER NOT NULL DEFAULT 0,
  checked_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_wikidata_channel_checks_at ON wikidata_channel_checks(checked_at);

-- Human-curated song -> YouTube video pins. Checked BEFORE the search resolver,
-- so a wrong match fixed by an admin stays fixed. video_id NULL means an admin
-- confirmed no correct embeddable video exists (the player then uses the Deezer
-- preview and says so, instead of playing a wrong version).
-- Per-photo likes (the Facebook-style media viewer). Keyed by the durable
-- object URL, which is unique per upload and never reused, so a reaction stays
-- attached to the right photo even when a post is edited or reordered. post_id
-- is context (SET NULL on post deletion keeps the photo's count if the image
-- also lives in a gallery).
CREATE TABLE IF NOT EXISTS media_reactions (
  media_url  TEXT NOT NULL,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  post_id    TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (media_url, user_id)
);
CREATE INDEX IF NOT EXISTS idx_media_reactions_url ON media_reactions(media_url);

-- Aggregated server errors. One row per DISTINCT problem, not per occurrence:
-- a 500 in a loop would otherwise write thousands of rows onto a 1GB disk and
-- bury the signal. The count column carries the volume instead.
--
-- Nothing user-authored is stored. No request bodies, query values, stack traces,
-- file paths or raw URLs — only the route PATTERN, the stable error code, and a
-- sanitized cause name, which is the same information the console line already
-- prints. See CLAUDE.md on never surfacing internals.
CREATE TABLE IF NOT EXISTS error_events (
  fingerprint TEXT PRIMARY KEY,
  level       TEXT NOT NULL DEFAULT 'error',
  code        TEXT NOT NULL DEFAULT '',
  status      INTEGER NOT NULL DEFAULT 0,
  method      TEXT NOT NULL DEFAULT '',
  route       TEXT NOT NULL DEFAULT '',
  cause       TEXT NOT NULL DEFAULT '',
  count       INTEGER NOT NULL DEFAULT 0,
  first_seen  INTEGER NOT NULL,
  last_seen   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_error_events_last ON error_events(last_seen DESC);

-- Admin-created badges: tiers, event marks, ad-hoc status. Art is chosen from the
-- named palette in src/domain/badgeArt.mjs rather than free-form, so a badge can
-- never carry an arbitrary colour string into an SVG attribute.
CREATE TABLE IF NOT EXISTS custom_badges (
  id          TEXT PRIMARY KEY,
  slug        TEXT NOT NULL UNIQUE,
  label       TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  kind        TEXT NOT NULL DEFAULT 'event',
  color       TEXT NOT NULL DEFAULT 'cool',
  glyph       TEXT NOT NULL DEFAULT 'check',
  glyph_char  TEXT,
  created_by  TEXT,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER,
  -- Archived rather than deleted: a badge someone was granted must keep meaning
  -- something, so retiring it hides it from the grant list without erasing it
  -- from the profiles that already show it.
  archived_at INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS user_badges (
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  badge_id   TEXT NOT NULL REFERENCES custom_badges(id) ON DELETE CASCADE,
  granted_by TEXT,
  granted_at INTEGER NOT NULL,
  note       TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (user_id, badge_id)
);
CREATE INDEX IF NOT EXISTS idx_user_badges_user ON user_badges(user_id, granted_at);
CREATE INDEX IF NOT EXISTS idx_user_badges_badge ON user_badges(badge_id);

CREATE TABLE IF NOT EXISTS track_overrides (
  key        TEXT PRIMARY KEY,
  title      TEXT NOT NULL,
  artist     TEXT NOT NULL DEFAULT '',
  video_id   TEXT,
  set_by     TEXT,
  updated_at INTEGER NOT NULL
);

-- Owner-editable copy for the mail the app sends on its own (welcome, password
-- reset). A missing row is not an error: server/emails.js falls back to the
-- built-in default, so a bad edit can be undone by deleting the row.
CREATE TABLE IF NOT EXISTS email_templates (
  key        TEXT PRIMARY KEY,
  subject    TEXT NOT NULL,
  body       TEXT NOT NULL,
  cta_label  TEXT,
  cta_url    TEXT,
  updated_at INTEGER NOT NULL,
  updated_by TEXT
);

-- One admin-composed broadcast. Counters are the durable progress record: a
-- restart mid-send resumes from email_queue rather than starting over.
CREATE TABLE IF NOT EXISTS email_campaigns (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  subject       TEXT NOT NULL,
  body          TEXT NOT NULL,
  cta_label     TEXT,
  cta_url       TEXT,
  audience      TEXT NOT NULL DEFAULT 'all',
  status        TEXT NOT NULL DEFAULT 'draft',
  created_by    TEXT,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  started_at    INTEGER,
  finished_at   INTEGER,
  test_sent_at  INTEGER,
  total         INTEGER NOT NULL DEFAULT 0,
  sent_count    INTEGER NOT NULL DEFAULT 0,
  failed_count  INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0
);

-- Per-recipient work list. Rows are claimed one at a time and marked terminal
-- immediately, so a crash re-sends at most the single in-flight address.
CREATE TABLE IF NOT EXISTS email_queue (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id TEXT NOT NULL REFERENCES email_campaigns(id) ON DELETE CASCADE,
  user_id     TEXT,
  to_email    TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending',
  attempts    INTEGER NOT NULL DEFAULT 0,
  last_error  TEXT,
  created_at  INTEGER NOT NULL,
  sent_at     INTEGER
);

-- Every message the platform attempts, transactional and campaign alike, lands
-- here exactly once including the ones that were never sent. Skips and failures
-- are the entries that matter: a send that silently vanished is the thing this
-- table exists to make impossible.
CREATE TABLE IF NOT EXISTS email_log (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at   INTEGER NOT NULL,
  kind         TEXT NOT NULL,
  template_key TEXT,
  campaign_id  TEXT,
  user_id      TEXT,
  to_email     TEXT NOT NULL,
  subject      TEXT NOT NULL,
  status       TEXT NOT NULL,
  reason       TEXT
);
`);

const ver = db.prepare("SELECT version FROM schema_version LIMIT 1").get();
if (!ver) db.prepare("INSERT INTO schema_version (version) VALUES (1)").run();
// Stamp the file after the complete Pit schema exists. Future production boots
// can distinguish an intentional Pit database from an unrelated SQLite file;
// the pre-marker live database is admitted once by the stricter legacy checks.
db.exec(`PRAGMA application_id = ${PIT_SQLITE_APPLICATION_ID}`);

// Additive migrations for DBs created before a column existed. Inspect the
// actual table before altering it: a real migration failure must stop startup,
// while an already-present column is safely skipped on every boot.
for (const stmt of [
  "ALTER TABLE users ADD COLUMN handle_changed_at INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE users ADD COLUMN verified INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE users ADD COLUMN spotify_access_token TEXT",
  "ALTER TABLE users ADD COLUMN spotify_refresh_token TEXT",
  "ALTER TABLE users ADD COLUMN spotify_expires_at INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE posts ADD COLUMN tour TEXT",
  "ALTER TABLE posts ADD COLUMN updated_at INTEGER",
  "ALTER TABLE posts ADD COLUMN dims TEXT NOT NULL DEFAULT '{}'",
  "ALTER TABLE artists ADD COLUMN searches INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE artists ADD COLUMN search_key TEXT",
  // The artist's YouTube channel. Since June 2026 search.list has its own
  // 100-call/day bucket; catalogue endpoints use the separate general bucket.
  // Provenance distinguishes a CC0 Wikidata identity from YouTube API data, and
  // youtube_channel_at supplies the mandatory refresh/validation timestamp.
  // These fields stay out of the catalogue upsert so a re-seed cannot wipe them.
  "ALTER TABLE artists ADD COLUMN youtube_channel_id TEXT",
  "ALTER TABLE artists ADD COLUMN youtube_channel_at INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE artists ADD COLUMN youtube_channel_source TEXT",
  "ALTER TABLE wikidata_channel_checks ADD COLUMN validated INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE comments ADD COLUMN parent_id TEXT", // forum-style reply threading
  "ALTER TABLE users ADD COLUMN sponsor INTEGER NOT NULL DEFAULT 0", // admin-granted partner mark
  "ALTER TABLE users ADD COLUMN reset_hash TEXT", // sha256 of a password-reset token
  "ALTER TABLE users ADD COLUMN reset_expires INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE posts ADD COLUMN tags TEXT NOT NULL DEFAULT '[]'", // short word-art descriptors on a review
  "ALTER TABLE posts ADD COLUMN kind TEXT NOT NULL DEFAULT 'review'", // 'review' = a logged show, 'status' = a plain post
  "ALTER TABLE posts ADD COLUMN song TEXT", // JSON of a tagged YouTube song {videoId,title,artist,url,thumb}
  "ALTER TABLE posts ADD COLUMN playlist TEXT", // immutable playlist snapshot attached to a post
  "ALTER TABLE plays ADD COLUMN video_id TEXT", // exact YouTube identity for cross-device replay
  "ALTER TABLE playlists ADD COLUMN visibility TEXT NOT NULL DEFAULT 'public'",
  "ALTER TABLE playlists ADD COLUMN updated_at INTEGER",
  "ALTER TABLE yt_cache ADD COLUMN metadata TEXT",
  "ALTER TABLE yt_cache ADD COLUMN score REAL",
  "ALTER TABLE yt_cache ADD COLUMN expires_at INTEGER",
  "ALTER TABLE yt_cache ADD COLUMN rejected_ids TEXT NOT NULL DEFAULT '[]'",
  // A review pointed at an entity only by display name, so "The Fillmore" and a
  // same-named room in another city were the same thing. These bind a post to a
  // canonical catalog entity; the display strings stay for what the user typed.
  "ALTER TABLE posts ADD COLUMN artist_key TEXT",
  "ALTER TABLE posts ADD COLUMN artist_mbid TEXT",
  "ALTER TABLE posts ADD COLUMN venue_key TEXT",
  // Stable per-composer token. If a write commits but its response is lost,
  // retrying returns that row instead of publishing a duplicate review.
  "ALTER TABLE posts ADD COLUMN client_mutation_id TEXT",
  // Bind that token to the exact create request. Reusing a restored draft token
  // after changing its text must never silently return the earlier payload.
  "ALTER TABLE posts ADD COLUMN client_mutation_hash TEXT",
  // Marketing consent. Broadcasts must honour this; password resets must not,
  // since a user who opted out of announcements still needs to reach their
  // account. server/emailService.js is where that distinction is enforced.
  "ALTER TABLE users ADD COLUMN marketing_opt_out INTEGER NOT NULL DEFAULT 0",
  // Per-user unsubscribe secret, minted lazily. A link must not be forgeable
  // from the address alone, or anyone could opt out anybody.
  "ALTER TABLE users ADD COLUMN unsub_token TEXT",
  // Email verification. Deliberately NOT the existing `verified` column: that is
  // the public, admin-granted check rendered beside a name in feeds and comments.
  // Reusing it would hand a public verification mark to anyone who clicked a link
  // in their own inbox. These are private account state.
  "ALTER TABLE users ADD COLUMN email_verified_at INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE users ADD COLUMN email_verify_hash TEXT",
  "ALTER TABLE users ADD COLUMN email_verify_expires INTEGER NOT NULL DEFAULT 0",
  // Set when the welcome mail goes out, so verifying twice, an admin marking an
  // already-verified account, or a resend cannot send it again.
  "ALTER TABLE users ADD COLUMN welcome_sent_at INTEGER NOT NULL DEFAULT 0",
]) {
  const match = /^ALTER TABLE ([a-z_]+) ADD COLUMN ([a-z_]+)/i.exec(stmt);
  if (!match) throw new Error(`Unsupported additive migration: ${stmt}`);
  const [, table, column] = match;
  const present = db.prepare(`PRAGMA table_info(${table})`).all()
    .some((entry) => String(entry.name).toLowerCase() === column.toLowerCase());
  if (!present) db.exec(stmt);
}

db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_posts_client_mutation ON posts(user_id, client_mutation_id) WHERE client_mutation_id IS NOT NULL");
// The queue is drained by "next pending for this campaign" on every iteration,
// and the log is read newest-first, so both need their own covering order.
db.exec("CREATE INDEX IF NOT EXISTS idx_email_queue_campaign ON email_queue(campaign_id, status, id)");
db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_email_queue_recipient ON email_queue(campaign_id, to_email)");
db.exec("CREATE INDEX IF NOT EXISTS idx_email_log_created ON email_log(created_at DESC, id DESC)");
db.exec("CREATE INDEX IF NOT EXISTS idx_email_log_campaign ON email_log(campaign_id, created_at DESC)");
db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_unsub_token ON users(unsub_token) WHERE unsub_token IS NOT NULL");
db.exec("CREATE INDEX IF NOT EXISTS idx_artists_search_key ON artists(search_key)");
const artistSearchKeyRows = db.prepare("SELECT norm,name FROM artists WHERE search_key IS NULL OR search_key='' ").all();
if (artistSearchKeyRows.length) {
  const setArtistSearchKey = db.prepare("UPDATE artists SET search_key=? WHERE norm=?");
  db.exec("BEGIN");
  try {
    for (const row of artistSearchKeyRows) setArtistSearchKey.run(artistSearchKey(row.name), row.norm);
    db.exec("COMMIT");
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch {}
    throw error;
  }
}

// Analytics never needs a network address once request-level rate limiting is
// complete. Purge the legacy raw-IP column once and keep new rows null.
const eventIpPurgeMarker = "privacy:events-ip-purged:v1";
if (!db.prepare("SELECT 1 FROM app_meta WHERE key=?").get(eventIpPurgeMarker)) {
  db.exec("BEGIN");
  try {
    db.prepare("UPDATE events SET ip=NULL WHERE ip IS NOT NULL").run();
    db.prepare("INSERT INTO app_meta (key,value) VALUES (?,?)").run(eventIpPurgeMarker, String(Date.now()));
    db.exec("COMMIT");
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch {}
    throw error;
  }
}

// Performance dates move to canonical ISO storage, with display formatting done
// at render time. Until this ran, the stored date WAS the display string, so a
// different separator forked one night into two performances and split its
// lounge, attendance and score aggregation. Canonicalizing merges those back.
//
// `concert_key` and `lounge_id` embed the date, so they are rebuilt in the same
// transaction as the columns they are derived from, or attendance and chat
// would point at performances that no longer exist. The rebuild mirrors the
// client's `concertKey` exactly: `artist|venue|date`, trimmed and lowercased.
const isoDateMigration = "dates:canonical-iso:v1";
if (!db.prepare("SELECT 1 FROM app_meta WHERE key=?").get(isoDateMigration)) {
  const keyFor = (artist, venue, date) => `${(artist || "").trim()}|${(venue || "").trim()}|${date || ""}`.toLowerCase();
  db.exec("BEGIN");
  try {
    for (const table of ["posts", "tour_dates"]) {
      const rows = db.prepare(`SELECT id,date FROM ${table} WHERE date IS NOT NULL AND date <> ''`).all();
      const update = db.prepare(`UPDATE ${table} SET date=? WHERE id=?`);
      for (const row of rows) {
        const iso = toIsoDate(row.date);
        // A date too broken to parse is left exactly as it is. Blanking it would
        // destroy the only record of when someone's night happened, and the
        // display layer already falls back rather than rendering mojibake.
        if (iso && iso !== row.date) update.run(iso, row.id);
      }
    }

    // OR REPLACE performs the merge: if a user was going to both the forked and
    // the canonical spelling of one night, they end up with the single row that
    // was always intended. PRIMARY KEY (user_id, concert_key) makes that safe.
    for (const row of db.prepare("SELECT user_id,concert_key,artist,venue,date FROM going").all()) {
      const iso = toIsoDate(row.date);
      if (!iso) continue;
      const key = keyFor(row.artist, row.venue, iso);
      if (key === row.concert_key && iso === row.date) continue;
      db.prepare("UPDATE OR REPLACE going SET concert_key=?, date=? WHERE user_id=? AND concert_key=?")
        .run(key, iso, row.user_id, row.concert_key);
    }

    // Lounge ids are opaque strings built by the client, so they are rewritten
    // by canonicalizing the date segment in place rather than by re-deriving
    // the whole key from data the messages table does not carry. Two lounges
    // that collapse to one id simply become one room, which is correct: they
    // were always the same night.
    for (const row of db.prepare("SELECT DISTINCT lounge_id FROM lounge_messages").all()) {
      const parts = String(row.lounge_id || "").split("|");
      if (parts.length !== 3) continue;
      const iso = toIsoDate(parts[2]);
      if (!iso || iso === parts[2]) continue;
      const next = `${parts[0]}|${parts[1]}|${iso}`;
      db.prepare("UPDATE lounge_messages SET lounge_id=? WHERE lounge_id=?").run(next, row.lounge_id);
    }

    db.prepare("INSERT INTO app_meta (key,value) VALUES (?,?)").run(isoDateMigration, String(Date.now()));
    db.exec("COMMIT");
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch {}
    throw error;
  }
}

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

// Email management: owner-editable templates, broadcasts, the per-recipient
// queue, and the log of every attempt. Audience selection lives in
// server/emailQueue.js because it needs the opt-out rules alongside it.
export const errorStmts = {
  record: db.prepare(`INSERT INTO error_events (fingerprint,level,code,status,method,route,cause,count,first_seen,last_seen)
    VALUES (@fingerprint,@level,@code,@status,@method,@route,@cause,1,@at,@at)
    ON CONFLICT(fingerprint) DO UPDATE SET count=count+1, last_seen=excluded.last_seen`),
  recent: db.prepare("SELECT * FROM error_events ORDER BY last_seen DESC LIMIT ?"),
  since: db.prepare("SELECT * FROM error_events WHERE last_seen >= ? ORDER BY count DESC, last_seen DESC LIMIT ?"),
  totalSince: db.prepare("SELECT COALESCE(SUM(count),0) c, COUNT(*) kinds FROM error_events WHERE last_seen >= ?"),
  // Anything not seen recently is noise once it stops happening. Pruning by age
  // keeps the table bounded without a background job.
  prune: db.prepare("DELETE FROM error_events WHERE last_seen < ?"),
  countRows: db.prepare("SELECT COUNT(*) c FROM error_events"),
  oldest: db.prepare("SELECT last_seen FROM error_events ORDER BY last_seen ASC LIMIT ?"),
  pruneBelow: db.prepare("DELETE FROM error_events WHERE last_seen <= ?"),
};

export const badgeStmts = {
  all: db.prepare("SELECT * FROM custom_badges ORDER BY archived_at, kind, label"),
  active: db.prepare("SELECT * FROM custom_badges WHERE archived_at = 0 ORDER BY kind, label"),
  byId: db.prepare("SELECT * FROM custom_badges WHERE id = ?"),
  bySlug: db.prepare("SELECT * FROM custom_badges WHERE slug = ?"),
  insert: db.prepare(`INSERT INTO custom_badges (id,slug,label,description,kind,color,glyph,glyph_char,created_by,created_at,updated_at)
    VALUES (@id,@slug,@label,@description,@kind,@color,@glyph,@glyph_char,@created_by,@created_at,@created_at)`),
  update: db.prepare(`UPDATE custom_badges SET label=@label,description=@description,kind=@kind,
    color=@color,glyph=@glyph,glyph_char=@glyph_char,updated_at=@updated_at WHERE id=@id`),
  setArchived: db.prepare("UPDATE custom_badges SET archived_at=?, updated_at=? WHERE id=?"),
  holderCount: db.prepare("SELECT COUNT(*) c FROM user_badges WHERE badge_id = ?"),

  grant: db.prepare(`INSERT INTO user_badges (user_id,badge_id,granted_by,granted_at,note)
    VALUES (?,?,?,?,?) ON CONFLICT(user_id,badge_id) DO NOTHING`),
  revoke: db.prepare("DELETE FROM user_badges WHERE user_id=? AND badge_id=?"),
  // Archived badges still render on the profiles that hold them; retiring a badge
  // must not silently strip it from people who earned it.
  forUser: db.prepare(`SELECT b.slug,b.label,b.description,b.kind,b.color,b.glyph,b.glyph_char,ub.granted_at
    FROM user_badges ub JOIN custom_badges b ON b.id = ub.badge_id
    WHERE ub.user_id = ? ORDER BY ub.granted_at`),
  holders: db.prepare(`SELECT u.id,u.name,u.handle,ub.granted_at FROM user_badges ub
    JOIN users u ON u.id = ub.user_id WHERE ub.badge_id = ? ORDER BY ub.granted_at DESC LIMIT 200`),
};

export const emailStmts = {
  // Email verification. Lookup is by HASH of the token, never the token itself,
  // so a database read cannot be replayed to verify somebody else's address.
  setVerifyToken: db.prepare("UPDATE users SET email_verify_hash=?, email_verify_expires=? WHERE id=?"),
  userByVerifyHash: db.prepare("SELECT * FROM users WHERE email_verify_hash=? AND email_verify_expires > ?"),
  markEmailVerified: db.prepare("UPDATE users SET email_verified_at=?, email_verify_hash=NULL, email_verify_expires=0 WHERE id=?"),
  markWelcomeSent: db.prepare("UPDATE users SET welcome_sent_at=? WHERE id=?"),

  templateByKey: db.prepare("SELECT * FROM email_templates WHERE key = ?"),
  allTemplates: db.prepare("SELECT * FROM email_templates"),
  upsertTemplate: db.prepare(`INSERT INTO email_templates (key,subject,body,cta_label,cta_url,updated_at,updated_by)
    VALUES (@key,@subject,@body,@cta_label,@cta_url,@updated_at,@updated_by)
    ON CONFLICT(key) DO UPDATE SET subject=excluded.subject,body=excluded.body,
      cta_label=excluded.cta_label,cta_url=excluded.cta_url,
      updated_at=excluded.updated_at,updated_by=excluded.updated_by`),
  deleteTemplate: db.prepare("DELETE FROM email_templates WHERE key = ?"),

  campaignById: db.prepare("SELECT * FROM email_campaigns WHERE id = ?"),
  listCampaigns: db.prepare("SELECT * FROM email_campaigns ORDER BY created_at DESC LIMIT ?"),
  insertCampaign: db.prepare(`INSERT INTO email_campaigns (id,name,subject,body,cta_label,cta_url,audience,status,created_by,created_at,updated_at)
    VALUES (@id,@name,@subject,@body,@cta_label,@cta_url,@audience,'draft',@created_by,@created_at,@created_at)`),
  updateCampaign: db.prepare(`UPDATE email_campaigns SET name=@name,subject=@subject,body=@body,
    cta_label=@cta_label,cta_url=@cta_url,audience=@audience,updated_at=@updated_at WHERE id=@id AND status='draft'`),
  setCampaignStatus: db.prepare("UPDATE email_campaigns SET status=?, updated_at=? WHERE id=?"),
  markCampaignTested: db.prepare("UPDATE email_campaigns SET test_sent_at=?, updated_at=? WHERE id=?"),
  startCampaign: db.prepare("UPDATE email_campaigns SET status='sending', started_at=?, total=?, updated_at=? WHERE id=?"),
  finishCampaign: db.prepare("UPDATE email_campaigns SET status=?, finished_at=?, updated_at=? WHERE id=?"),
  bumpCampaignCounts: db.prepare(`UPDATE email_campaigns SET
    sent_count=(SELECT COUNT(*) FROM email_queue WHERE campaign_id=@id AND status='sent'),
    failed_count=(SELECT COUNT(*) FROM email_queue WHERE campaign_id=@id AND status='failed'),
    skipped_count=(SELECT COUNT(*) FROM email_queue WHERE campaign_id=@id AND status='skipped'),
    updated_at=@updated_at WHERE id=@id`),

  enqueue: db.prepare(`INSERT OR IGNORE INTO email_queue (campaign_id,user_id,to_email,status,created_at)
    VALUES (?,?,?,'pending',?)`),
  nextPending: db.prepare("SELECT * FROM email_queue WHERE campaign_id=? AND status='pending' ORDER BY id LIMIT 1"),
  countPending: db.prepare("SELECT COUNT(*) c FROM email_queue WHERE campaign_id=? AND status='pending'"),
  countQueued: db.prepare("SELECT COUNT(*) c FROM email_queue WHERE campaign_id=?"),
  settleQueueRow: db.prepare("UPDATE email_queue SET status=?, attempts=attempts+1, last_error=?, sent_at=? WHERE id=? AND status='pending'"),
  clearQueue: db.prepare("DELETE FROM email_queue WHERE campaign_id=?"),

  insertLog: db.prepare(`INSERT INTO email_log (created_at,kind,template_key,campaign_id,user_id,to_email,subject,status,reason)
    VALUES (@created_at,@kind,@template_key,@campaign_id,@user_id,@to_email,@subject,@status,@reason)`),
  countSentSince: db.prepare("SELECT COUNT(*) c FROM email_log WHERE status='sent' AND created_at >= ?"),
  logStats: db.prepare(`SELECT status, COUNT(*) c FROM email_log WHERE created_at >= ? GROUP BY status`),

  userUnsubToken: db.prepare("SELECT unsub_token FROM users WHERE id = ?"),
  setUnsubToken: db.prepare("UPDATE users SET unsub_token=? WHERE id=?"),
  userByUnsubToken: db.prepare("SELECT * FROM users WHERE unsub_token = ?"),
  setMarketingOptOut: db.prepare("UPDATE users SET marketing_opt_out=? WHERE id=?"),
};

// YouTube video-ID cache statements. Positive entries are periodically
// revalidated and known-bad iframe IDs are retained as exclusions so the next
// lookup does not select the same unavailable/karaoke result again.
export const ytStmts = {
  get: db.prepare("SELECT key,video_id,updated_at,metadata,score,expires_at,rejected_ids FROM yt_cache WHERE key = ?"),
  set: db.prepare(`INSERT INTO yt_cache (key,video_id,updated_at,metadata,score,expires_at,rejected_ids)
    VALUES (@key,@video_id,@updated_at,@metadata,@score,@expires_at,@rejected_ids)
    ON CONFLICT(key) DO UPDATE SET video_id=excluded.video_id,updated_at=excluded.updated_at,
      metadata=excluded.metadata,score=excluded.score,expires_at=excluded.expires_at,rejected_ids=excluded.rejected_ids`),
  // Keep a bounded rejection tombstone so the next resolution cannot select
  // the exact video a listener just reported. It is still expired/deleted
  // within the same 30-day policy window as other YouTube API-derived data.
  invalidate: db.prepare(`UPDATE yt_cache SET video_id=NULL,
    metadata='{"invalidated":true}',score=NULL,updated_at=?,expires_at=?,rejected_ids=?
    WHERE key=?`),
  deleteExpired: db.prepare(`DELETE FROM yt_cache
    WHERE (expires_at IS NOT NULL AND expires_at <= ?)
       OR (expires_at IS NULL AND updated_at <= ?)`),
};

export const providerCacheStmts = {
  get: db.prepare("SELECT data,updated_at,expires_at FROM provider_cache WHERE key=?"),
  set: db.prepare(`INSERT INTO provider_cache (key,data,updated_at,expires_at) VALUES (?,?,?,?)
    ON CONFLICT(key) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at,expires_at=excluded.expires_at`),
  deleteExpired: db.prepare("DELETE FROM provider_cache WHERE expires_at < ?"),
};

// --- Artist catalog statements + helpers -------------------------------------
const ARTIST_COLS = "norm,name,search_key,genre,photo,bio,mbid,spotify_id,country,formed,popularity,rank_score,data,source,created_at,updated_at";
export const artistStmts = {
  byNorm: db.prepare("SELECT * FROM artists WHERE norm = ?"),
  count: db.prepare("SELECT COUNT(*) c FROM artists"),
  search: db.prepare(`SELECT * FROM artists WHERE norm LIKE ? OR search_key LIKE ?
    ORDER BY (norm = ?) DESC, (search_key = ?) DESC, rank_score DESC, name LIMIT ?`),
  top: db.prepare("SELECT * FROM artists ORDER BY rank_score DESC, name LIMIT ?"),
  bumpSearches: db.prepare("UPDATE artists SET searches = searches + 1 WHERE norm = ?"),
  // Channel identity is reusable, but API-derived values are refreshed within
  // 30 days. A null id records a bounded miss so a fruitless discovery is not
  // retried on every play.
  getChannel: db.prepare(`SELECT youtube_channel_id AS channelId,
    youtube_channel_at AS at, youtube_channel_source AS source FROM artists WHERE norm = ?`),
  setChannel: db.prepare("UPDATE artists SET youtube_channel_id = ?, youtube_channel_at = ?, youtube_channel_source = ? WHERE norm = ?"),
  setWikidataChannel: db.prepare("UPDATE artists SET youtube_channel_id = ?, youtube_channel_at = ?, youtube_channel_source = ? WHERE norm = ?"),
  clearChannel: db.prepare("UPDATE artists SET youtube_channel_id = NULL, youtube_channel_at = 0, youtube_channel_source = NULL WHERE norm = ?"),
  refreshChannel: db.prepare("UPDATE artists SET youtube_channel_at = ? WHERE norm = ?"),
  thin: db.prepare("SELECT * FROM artists WHERE photo IS NULL ORDER BY searches DESC, updated_at DESC LIMIT ?"),
  thinCount: db.prepare("SELECT COUNT(*) c FROM artists WHERE photo IS NULL"),
  purge: db.prepare("DELETE FROM artists WHERE norm = ?"),
  recordMissing: db.prepare("INSERT INTO missing_artists (norm,name,searches,last_at) VALUES (?,?,1,?) ON CONFLICT(norm) DO UPDATE SET searches = searches + 1, last_at = excluded.last_at"),
  listMissing: db.prepare("SELECT * FROM missing_artists ORDER BY searches DESC, last_at DESC LIMIT ?"),
  clearMissing: db.prepare("DELETE FROM missing_artists WHERE norm = ?"),
  upsert: db.prepare(`INSERT INTO artists (${ARTIST_COLS})
    VALUES (@norm,@name,@search_key,@genre,@photo,@bio,@mbid,@spotify_id,@country,@formed,@popularity,@rank_score,@data,@source,@created_at,@updated_at)
    ON CONFLICT(norm) DO UPDATE SET
      name=excluded.name,
      search_key=excluded.search_key,
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
    search_key: artistSearchKey(a.name || key),
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
  // A genre is a claim with a source, and only claims backed by evidence are
  // stated as fact. `data.genreRecord` is written by enrichment and by staff
  // corrections; rows that predate it are classified by shape. An unverified
  // crawl-bucket guess is still returned, but as `genreHint`, so Discover and
  // the artist page can stop presenting "Justin Bieber / Metal" as truth while
  // admin review still has something to work with.
  // The column is kept by COALESCE on partial enrichment, so it can hold a
  // stale value; `data` carries the authoritative claims and wins.
  const record = resolveGenre(storedClaims(data, r.genre));
  const shown = displayGenre(record);
  return {
    // `key` is the catalog's stable identity. The composer sends it back when a
    // suggestion is picked, so a review binds to this artist rather than to
    // whatever string was typed.
    ...data, key: r.norm, name: r.name, photo: r.photo, bio: r.bio, mbid: r.mbid, spotifyId: r.spotify_id,
    formed: r.formed || null,
    country: r.country, popularity: r.popularity,
    genre: shown,
    genreHint: shown ? null : (record?.value || null),
    genreSource: record?.source || null,
    genreConfidence: record?.confidence ?? null,
  };
}

function objectData(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value;
}

// Bundled rows are a useful baseline, but they are not newer than production
// enrichment. Keep the DB-rich fields authoritative and only fill gaps from the
// bundle. This prevents every server boot from restoring stale tracks/previews.
export function mergeBundledArtist(existingRow, bundled) {
  const incoming = objectData(bundled);
  let existingData = {};
  try { existingData = objectData(JSON.parse(existingRow?.data || "{}")); } catch {}
  const merged = { ...incoming, ...existingData };
  for (const field of ["albums", "topTracks", "photos", "galleryPool"]) {
    const current = existingData[field];
    if (!Array.isArray(current) || current.length === 0) {
      const fallback = incoming[field];
      if (Array.isArray(fallback) && fallback.length) merged[field] = fallback;
    }
  }
  if (!existingRow) return merged;
  return {
    ...merged,
    name: existingRow.name || merged.name,
    genre: existingRow.genre || merged.genre || null,
    photo: existingRow.photo || merged.photo || null,
    bio: existingRow.bio || merged.bio || null,
    mbid: existingRow.mbid || merged.mbid || null,
    spotifyId: existingRow.spotify_id || merged.spotifyId || null,
    country: existingRow.country || merged.country || null,
    beginYear: existingRow.formed || merged.beginYear || merged.formed || null,
    popularity: existingRow.popularity ?? merged.popularity ?? null,
    rank_score: Math.max(Number(existingRow.rank_score) || 0, Number(merged.rank_score) || 0),
  };
}

// Deezer preview links are signed, short-lived URLs. Removing only URL-valued
// `preview` fields keeps titles/albums/photos intact while ensuring old links can
// never be replayed after their signature expires. Playback resolves a fresh URL.
export function stripEphemeralPreviews(value) {
  if (Array.isArray(value)) return value.map(stripEphemeralPreviews);
  if (!value || typeof value !== "object") return value;
  const out = {};
  for (const [key, child] of Object.entries(value)) {
    if (key === "preview" && typeof child === "string" && /^https?:\/\//i.test(child)) continue;
    out[key] = stripEphemeralPreviews(child);
  }
  return out;
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
    for (const [key, a] of entries) {
      const existing = artistStmts.byNorm.get(normName(key || a?.name));
      artistStmts.upsert.run(artistRow(key, mergeBundledArtist(existing, a), "bundle"));
    }
    db.exec("COMMIT");
    if (fresh) console.log(`[db] seeded ${entries.length} artists into the DB from the bundled catalog`);
    else console.log(`[db] merged ${entries.length} bundled artists (refreshed rank/enrichment)`);
  } catch (e) {
    try { db.exec("ROLLBACK"); } catch {}
    console.warn("[db] artist seed skipped:", e.message);
  }
}
seedArtistsFromBundle();

// One-time cleanup for rows written by the old enrichment job. A marker avoids
// reparsing the full catalogue on every boot; new writes no longer persist these
// links, so the migration remains complete after it runs once.
export function sanitizeStoredArtistPreviews() {
  const marker = "strip-ephemeral-artist-previews-v1";
  if (db.prepare("SELECT 1 FROM app_meta WHERE key=?").get(marker)) return 0;
  const rows = db.prepare(`SELECT norm,data FROM artists WHERE data LIKE '%"preview"%'`).all();
  const update = db.prepare("UPDATE artists SET data=? WHERE norm=?");
  let changed = 0;
  db.exec("BEGIN");
  try {
    for (const row of rows) {
      let parsed;
      try { parsed = JSON.parse(row.data || "{}"); } catch { continue; }
      const cleaned = JSON.stringify(stripEphemeralPreviews(parsed));
      if (cleaned !== row.data) { update.run(cleaned, row.norm); changed++; }
    }
    db.prepare("INSERT INTO app_meta (key,value) VALUES (?,?)").run(marker, String(Date.now()));
    db.exec("COMMIT");
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch {}
    throw error;
  }
  if (changed) console.log(`[db] removed expired preview URLs from ${changed} artist profiles`);
  return changed;
}
sanitizeStoredArtistPreviews();

// Exported because the post projection in api.js needs the same tolerance the
// user projection has. A single malformed column would otherwise throw while
// building a feed page and 500 the whole feed for everyone, not just that row.
export function parseJsonObject(value) {
  try {
    const parsed = JSON.parse(value || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function parseJsonArray(value) {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// Public projection, NEVER include pass_hash or email in list responses.
/**
 * Admin-granted badges for one account. Deliberately NOT folded into publicUser:
 * that runs once per row when rendering a feed or a comment thread, and a query
 * per row there is an N+1. Callers that show a profile opt in with
 * `publicUser(u, { badges: true })`.
 */
export function customBadgesFor(userId) {
  return badgeStmts.forUser.all(userId).map((b) => ({
    slug: b.slug, label: b.label, description: b.description, kind: b.kind,
    color: b.color, glyph: b.glyph, glyphChar: b.glyph_char, grantedAt: b.granted_at,
  }));
}

export function publicUser(u, { self = false, badges = false } = {}) {
  if (!u) return null;

  // Extras hold optional client profile fields (theme, consent record, music
  // picks). They are user-controlled, so they must never replace typed/trusted
  // DB columns or expose a raw column under its database or public name.
  const extras = parseJsonObject(u.extras);
  for (const key of Object.keys(u)) delete extras[key];
  for (const key of [
    "id", "email", "name", "handle", "role", "verified", "sponsor",
    "artistName", "home", "bio", "avatarUri", "avatarColor", "banner",
    "initials", "genres", "favoriteArtists",
  ]) delete extras[key];
  const publicExtras = Object.fromEntries(["theme", "nowPlaying"].filter((key) => extras[key] !== undefined).map((key) => [key, extras[key]]));
  const selfExtras = self
    ? Object.fromEntries(["consentAt", "termsVersion", "analyticsOptOut", "treble", "bass", "playlists"].filter((key) => extras[key] !== undefined).map((key) => [key, extras[key]]))
    : {};

  return {
    ...publicExtras,
    ...selfExtras,
    id: u.id,
    name: u.name,
    handle: u.handle,
    role: u.role,
    verified: !!u.verified,
    sponsor: !!u.sponsor,
    artistName: u.artist_name || undefined,
    home: u.home_city ? { city: u.home_city, lat: u.home_lat, lng: u.home_lng } : null,
    bio: u.bio,
    avatarUri: u.avatar_uri,
    avatarColor: u.avatar_color,
    banner: u.banner,
    initials: u.initials,
    genres: parseJsonArray(u.genres),
    favoriteArtists: parseJsonArray(u.favorite_artists),
    // Email verification is PRIVATE account state, unlike `verified` above which
    // is the public admin-granted check. Exposing it publicly would leak whether
    // a stranger has confirmed their address, and invite it being read as a
    // trust signal it is not.
    ...(badges ? { badges: customBadgesFor(u.id) } : {}),
    ...(self ? { email: u.email, emailVerified: !!u.email_verified_at } : {}),
  };
}
