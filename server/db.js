// SQLite database layer, Node's built-in node:sqlite, zero dependencies.
// WAL mode + foreign keys + busy timeout: safe under concurrent requests and
// survives crashes mid-write (the WAL journal replays).
//
// WAL is also why copying pit.db is NOT a backup: committed transactions live in
// pit.db-wal until a checkpoint, so a bare copy can be torn or stale. Use
// `npm run backup` (VACUUM INTO), which asks SQLite for a consistent snapshot.
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { toIsoDate } from "../src/domain/dates.mjs";
import { projectArtistGenre } from "../src/domain/genre.mjs";
import { slugify } from "../src/domain/urls.mjs";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PIT_SQLITE_APPLICATION_ID, prepareDataDirectory } from "./dataDirectory.js";
import { contentSafetyDecision } from "./contentSafety.js";
import { canonicalProfileExtras } from "./profileExtras.js";
import { legacyTrackOverrideIdentityKey, trackOverrideIdentityKey } from "./trackIdentity.js";
import { normalizeTaggedUserIds } from "../src/domain/postFriendTags.mjs";
import { privateErrorLabel } from "./errors.js";
import { quarantineUnsafeLegacyImages } from "./publicMedia.js";
import { ensurePostMediaCapacity, POST_MEDIA_MAX_POSITION } from "./postMediaSchema.js";
import { registerPitSqliteFunctions } from "./sqliteFunctions.js";
import { MUSIC_PLAYER_ENABLED } from "../src/domain/musicPlayerAvailability.mjs";
import { ensureShowSchema } from "./features/shows/showSchema.js";

export const artistSearchKey = (value) => String(value || "")
  .normalize("NFKD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase()
  .replace(/[^\p{L}\p{N}]+/gu, "");

const HERE = dirname(fileURLToPath(import.meta.url));
export const DATABASE_DIRECTORY = prepareDataDirectory({ fallbackDir: join(HERE, "data") });
export const DATABASE_PATH = join(DATABASE_DIRECTORY, "pit.db");

export const db = new DatabaseSync(DATABASE_PATH);
registerPitSqliteFunctions(db);

db.exec(`
  PRAGMA busy_timeout = 5000;
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
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
  profile_updated_at INTEGER NOT NULL DEFAULT 0,
  created_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_users_created ON users(created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  ip         TEXT,
  ua         TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

-- Short-lived receipts make a successfully consumed verification token safely
-- retryable after a response is lost. They contain only token/address hashes and
-- the account they confirmed; expiry keeps the replay window bounded.
CREATE TABLE IF NOT EXISTS email_verification_receipts (
  token_hash  TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email_hash  TEXT NOT NULL,
  verified_at INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_email_verification_receipts_expiry
  ON email_verification_receipts(expires_at);

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
  landing_showcase INTEGER NOT NULL DEFAULT 0,
  campaign      TEXT,
  attendance_ticket TEXT,
  tagged_user_ids TEXT NOT NULL DEFAULT '[]',
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
CREATE INDEX IF NOT EXISTS idx_posts_user_history ON posts(user_id, removed, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_posts_recommendation_candidates ON posts(removed, created_at DESC, id DESC);

-- Structured friend tags are a relationship, not an opaque post attribute.
-- Keep the legacy JSON column on posts for rolling-deploy/read compatibility,
-- while this indexed relation is authoritative for targeted privacy cleanup.
CREATE TABLE IF NOT EXISTS post_user_tags (
  post_id    TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  author_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  position   INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (post_id, user_id),
  UNIQUE (post_id, position)
);
CREATE INDEX IF NOT EXISTS idx_post_user_tags_user_post
  ON post_user_tags(user_id, post_id);
CREATE INDEX IF NOT EXISTS idx_post_user_tags_author_user_post
  ON post_user_tags(author_id, user_id, post_id);

CREATE TABLE IF NOT EXISTS likes (
  post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (post_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_likes_user_post ON likes(user_id, post_id);

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
CREATE INDEX IF NOT EXISTS idx_comments_user_recent ON comments(user_id, removed, created_at DESC, post_id);
CREATE INDEX IF NOT EXISTS idx_comments_post_distinct_users ON comments(post_id, removed, user_id);

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
CREATE INDEX IF NOT EXISTS idx_fan_club_members_user_artist ON fan_club_members(user_id, artist);

CREATE TABLE IF NOT EXISTS fan_club_messages (
  id         TEXT PRIMARY KEY,
  artist     TEXT NOT NULL,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text       TEXT NOT NULL,
  client_mutation_id TEXT,
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
  client_mutation_id TEXT,
  removed    INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_dms_pair ON dms(from_id, to_id);
CREATE INDEX IF NOT EXISTS idx_dms_cursor ON dms(from_id, to_id, created_at DESC, id DESC);

-- Read positions belong on the server so opening a conversation survives a
-- reload and carries across devices. The timestamp + id tuple uses the same
-- deterministic ordering as message pagination, including same-millisecond DMs.
CREATE TABLE IF NOT EXISTS dm_reads (
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  other_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_read_at INTEGER NOT NULL,
  last_read_id TEXT NOT NULL,
  PRIMARY KEY (user_id, other_id),
  CHECK (user_id <> other_id)
);
CREATE INDEX IF NOT EXISTS idx_follows_followee_follower ON follows(followee_id, follower_id);

CREATE TABLE IF NOT EXISTS reports (
  id          TEXT PRIMARY KEY,
  target_type TEXT NOT NULL,
  target_id   TEXT NOT NULL,
  reason      TEXT NOT NULL DEFAULT '',
  reporter_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  media_index INTEGER,
  media_fingerprint TEXT,
  status      TEXT NOT NULL DEFAULT 'open',
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reports_status_created ON reports(status, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_reports_created ON reports(created_at DESC);

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
  created_at  INTEGER NOT NULL DEFAULT 0,
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
  photos_public INTEGER NOT NULL DEFAULT 0,
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
  removed      INTEGER NOT NULL DEFAULT 0,
  updated_at   INTEGER
);

-- PIT-managed artist memorials are catalog facts, not artist-account UGC.
-- Only an administrator can publish one after deliberately confirming the page
-- represents a deceased individual and supplying a public HTTPS source. The
-- deceased marker remains public; the richer spotlight has an explicit window.
CREATE TABLE IF NOT EXISTS artist_memorials (
  artist_key           TEXT PRIMARY KEY CHECK (length(artist_key) BETWEEN 1 AND 200),
  artist_name          TEXT NOT NULL CHECK (length(artist_name) BETWEEN 1 AND 160),
  artist_mbid          TEXT CHECK (
                         artist_mbid IS NULL OR (
                           length(artist_mbid)=36 AND
                           lower(artist_mbid) GLOB '[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f]-[1-5][0-9a-f][0-9a-f][0-9a-f]-[89ab][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]'
                         )
                       ),
  status               TEXT NOT NULL CHECK (status IN ('draft','published')),
  death_date           TEXT NOT NULL CHECK (
                         length(death_date)=10 AND
                         death_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
                       ),
  summary              TEXT NOT NULL CHECK (length(summary) BETWEEN 20 AND 600),
  thank_you            TEXT NOT NULL CHECK (length(thank_you) BETWEEN 3 AND 320),
  accomplishments      TEXT NOT NULL CHECK (
                         json_valid(accomplishments) AND
                         json_type(accomplishments)='array' AND
                         json_array_length(accomplishments) BETWEEN 1 AND 8
                       ),
  source_url           TEXT NOT NULL CHECK (source_url LIKE 'https://%'),
  source_title         TEXT CHECK (source_title IS NULL OR length(source_title) BETWEEN 1 AND 180),
  published_at         INTEGER,
  spotlight_started_at INTEGER,
  created_at           INTEGER NOT NULL,
  updated_at           INTEGER NOT NULL,
  CHECK (
    (status='draft' AND published_at IS NULL AND spotlight_started_at IS NULL)
    OR
    (status='published' AND published_at IS NOT NULL AND spotlight_started_at IS NOT NULL)
  ),
  CHECK (created_at >= 0 AND updated_at >= created_at),
  CHECK (published_at IS NULL OR (published_at >= created_at AND published_at <= updated_at)),
  CHECK (spotlight_started_at IS NULL OR (spotlight_started_at >= published_at AND spotlight_started_at <= updated_at))
);
CREATE INDEX IF NOT EXISTS idx_artist_memorials_status_updated
  ON artist_memorials(status, updated_at DESC, artist_key);

-- The artist "updates" feed (posts on their own page).
CREATE TABLE IF NOT EXISTS artist_posts (
  id         TEXT PRIMARY KEY,
  artist_key TEXT NOT NULL,
  user_id    TEXT REFERENCES users(id) ON DELETE SET NULL,
  text       TEXT NOT NULL,
  removed    INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_artist_posts_artist ON artist_posts(artist_key);

-- ---- Privacy-safe first-party product analytics -----------------------------
-- Approved categorical behavior and internal content ids only. Raw IPs,
-- searches, messages, reviews, and media URLs are never written. Guests never
-- enter this raw table; the aggregate-only search counters below carry no
-- person or request identity. Raw rows have age/count ceilings in analyticsService.js.
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
CREATE INDEX IF NOT EXISTS idx_events_user_name_created ON events(user_id, name, created_at DESC);

-- Anonymous search demand is deliberately aggregate-only. One row represents
-- a site's daily counter, never a person or request: there is no account,
-- address, cookie, device, user-agent, URL, typed query, or exact timestamp.
-- The service prunes counters after 90 days.
CREATE TABLE IF NOT EXISTS guest_search_daily (
  day           TEXT NOT NULL CHECK (
                  length(day)=10 AND
                  day GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
                ),
  kind          TEXT NOT NULL CHECK (kind IN ('all','artists','venues','people','events','songs')),
  result_bucket TEXT NOT NULL CHECK (result_bucket IN ('zero','one_to_five','six_to_twenty','over_twenty','unknown')),
  outcome       TEXT NOT NULL CHECK (outcome IN ('success','failed')),
  count         INTEGER NOT NULL CHECK (typeof(count)='integer' AND count > 0),
  PRIMARY KEY (day, kind, result_bucket, outcome),
  CHECK (
    (outcome='failed' AND result_bucket='unknown') OR
    (outcome='success' AND result_bucket<>'unknown')
  )
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_guest_search_daily_day
  ON guest_search_daily(day DESC);

-- Product feedback is anonymous by design. Account ids, email addresses, IPs,
-- user agents, URLs, and cookies do not belong in this table. The opaque client
-- mutation id makes a network retry idempotent without identifying its author.
CREATE TABLE IF NOT EXISTS product_suggestions (
  id                 TEXT PRIMARY KEY,
  client_mutation_id TEXT NOT NULL UNIQUE,
  category           TEXT NOT NULL CHECK (category IN ('friction','idea','bug','other')),
  body               TEXT NOT NULL,
  surface            TEXT CHECK (surface IS NULL OR surface IN ('landing','feed','search','discover','you','artist','profile','player','settings','menu','other')),
  status             TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','considering','planned','shipped','closed')),
  created_at         INTEGER NOT NULL,
  updated_at         INTEGER NOT NULL,
  closed_at          INTEGER
);
CREATE INDEX IF NOT EXISTS idx_product_suggestions_status_created
  ON product_suggestions(status, created_at DESC, id DESC);

-- Core recommendation preference, independent of optional analytics. A member
-- who says "Not for me" must keep that post suppressed even when product
-- measurement is disabled or raw analytics is compacted.
CREATE TABLE IF NOT EXISTS recommendation_preferences (
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  post_id    TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  action     TEXT NOT NULL CHECK (action IN ('not_interested','hide')),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, post_id)
);
CREATE INDEX IF NOT EXISTS idx_recommendation_preferences_user_created
  ON recommendation_preferences(user_id, created_at DESC, post_id);

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
CREATE UNIQUE INDEX IF NOT EXISTS idx_notifs_post_tag_unique
  ON notifications(user_id, post_id, type) WHERE type='post_tag' AND post_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_notifs_post_tag_actor_recipient_created
  ON notifications(actor_id, user_id, created_at DESC) WHERE type='post_tag';

-- A tag recipient can remove their own association. Keep that choice durable so
-- an author cannot immediately add the same account back to the same post.
CREATE TABLE IF NOT EXISTS post_tag_rejections (
  post_id    TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (post_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_post_tag_rejections_user
  ON post_tag_rejections(user_id, created_at DESC, post_id);

-- ---- Tour dates (provider imports + authoritative artist/admin batches) -------
-- Active provider rows have no owner and are immediately public; inactive rows
-- remain durable historical evidence. First-party rows carry owner/release
-- attribution, so scheduled dates can be withheld without client-local state.
CREATE TABLE IF NOT EXISTS tour_dates (
  id                    TEXT PRIMARY KEY,
  artist                TEXT NOT NULL,
  artist_key            TEXT REFERENCES artists(norm),
  venue                 TEXT,
  place                 TEXT,
  lat                   REAL,
  lng                   REAL,
  date                  TEXT,
  ticket_url            TEXT,
  sold_out              INTEGER NOT NULL DEFAULT 0,
  source                TEXT,
  updated_at            INTEGER NOT NULL,
  owner_id              TEXT REFERENCES users(id) ON DELETE CASCADE,
  release_at            INTEGER NOT NULL DEFAULT 0,
  provider_event_id     TEXT,
  event_name            TEXT,
  tour_name             TEXT,
  start_date_time       TEXT,
  start_local_time      TEXT,
  access_start_date_time TEXT,
  access_start_approximate INTEGER,
  event_timezone        TEXT,
  event_status          TEXT,
  venue_provider_id     TEXT,
  venue_address_line1   TEXT,
  venue_address_line2   TEXT,
  venue_city            TEXT,
  venue_region          TEXT,
  venue_postal_code     TEXT,
  venue_country_code    TEXT,
  venue_country         TEXT,
  provider_active       INTEGER NOT NULL DEFAULT 1,
  last_seen_at          INTEGER,
  event_kind            TEXT NOT NULL DEFAULT 'concert',
  music_qualified       INTEGER NOT NULL DEFAULT 1,
  music_evidence        TEXT,
  billed_artists        TEXT NOT NULL DEFAULT '[]',
  event_end_date        TEXT,
  event_source_url      TEXT,
  event_image_url       TEXT,
  event_image_attribution TEXT,
  event_image_width     INTEGER,
  event_image_height    INTEGER
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
  public_slug TEXT,
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
CREATE INDEX IF NOT EXISTS idx_artists_name_nocase ON artists(name COLLATE NOCASE,rank_score DESC,norm);
-- Startup migrations reconcile provider event display names with canonical
-- artists. Keep that lookup indexed so existing production catalogues do not
-- turn the one-time backfill into an artists x events table scan.
CREATE INDEX IF NOT EXISTS idx_artists_trimmed_name_lookup ON artists(lower(trim(name)),norm);
-- A single cheap revision lets Discover cache the evidence-aware projection
-- without rescanning/parsing every rich artist blob on every request. Triggers
-- advance it only when a field that can change public genre membership changes.
CREATE TABLE IF NOT EXISTS artist_projection_revision (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  revision  INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO artist_projection_revision (singleton, revision) VALUES (1, 0);
CREATE TRIGGER IF NOT EXISTS trg_artist_projection_insert
AFTER INSERT ON artists BEGIN
  UPDATE artist_projection_revision SET revision = revision + 1 WHERE singleton = 1;
END;
CREATE TRIGGER IF NOT EXISTS trg_artist_projection_update
AFTER UPDATE OF genre, data, country ON artists
WHEN NOT (NEW.genre IS OLD.genre AND NEW.data IS OLD.data AND NEW.country IS OLD.country)
BEGIN
  UPDATE artist_projection_revision SET revision = revision + 1 WHERE singleton = 1;
END;
CREATE TRIGGER IF NOT EXISTS trg_artist_projection_delete
AFTER DELETE ON artists BEGIN
  UPDATE artist_projection_revision SET revision = revision + 1 WHERE singleton = 1;
END;
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
  provider   TEXT,
  source_id  TEXT,
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

-- High-impact changes use a separate founder-approval ledger. Only a digest of
-- the requested payload is copied into the immutable receipt; bearer tokens are
-- stored as hashes and are erased as soon as a request is decided or expires.
CREATE TABLE IF NOT EXISTS owner_approval_requests (
  id             TEXT PRIMARY KEY,
  kind           TEXT NOT NULL CHECK(kind IN ('privileged_role_change','security_release')),
  status         TEXT NOT NULL DEFAULT 'pending'
                   CHECK(status IN ('pending','approved','rejected','expired','superseded')),
  requested_by   TEXT REFERENCES users(id) ON DELETE SET NULL,
  target_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  safe_summary   TEXT NOT NULL,
  payload        TEXT NOT NULL,
  payload_hash   TEXT NOT NULL,
  token_hash     TEXT UNIQUE,
  requested_at   INTEGER NOT NULL,
  expires_at     INTEGER NOT NULL,
  decided_at     INTEGER,
  decided_by     TEXT REFERENCES users(id) ON DELETE SET NULL,
  receipt_id     TEXT,
  request_id     TEXT
);
CREATE INDEX IF NOT EXISTS idx_owner_approval_requests_status
  ON owner_approval_requests(status, requested_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_owner_approval_requests_target
  ON owner_approval_requests(target_user_id, status, requested_at DESC);

CREATE TABLE IF NOT EXISTS owner_approval_receipts (
  id             TEXT PRIMARY KEY,
  request_id     TEXT,
  kind           TEXT NOT NULL CHECK(kind IN ('privileged_role_change','security_release')),
  decision       TEXT NOT NULL CHECK(decision IN ('approved','rejected','recorded')),
  -- Opaque historical ids deliberately have no FK: a later account deletion
  -- must not mutate or invalidate an already-issued security receipt.
  requested_by   TEXT,
  decided_by     TEXT,
  target_user_id TEXT,
  safe_summary   TEXT NOT NULL,
  payload_hash   TEXT NOT NULL,
  previous_stamp TEXT NOT NULL,
  stamp          TEXT NOT NULL UNIQUE,
  release_commit TEXT,
  requested_at   INTEGER NOT NULL,
  created_at     INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_owner_approval_receipts_request
  ON owner_approval_receipts(request_id) WHERE request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_owner_approval_receipts_created
  ON owner_approval_receipts(created_at DESC, id DESC);

CREATE TRIGGER IF NOT EXISTS owner_approval_receipts_no_update
BEFORE UPDATE ON owner_approval_receipts
BEGIN
  SELECT RAISE(ABORT, 'owner approval receipts are append-only');
END;

CREATE TRIGGER IF NOT EXISTS owner_approval_receipts_no_delete
BEFORE DELETE ON owner_approval_receipts
BEGIN
  SELECT RAISE(ABORT, 'owner approval receipts are append-only');
END;

-- Concert lounge / afterparty chat, keyed by concertKey (artist|venue|date), so
-- attendee chat is shared + live like the fan clubs (not device-local).
CREATE TABLE IF NOT EXISTS lounge_messages (
  id         TEXT PRIMARY KEY,
  lounge_id  TEXT NOT NULL,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text       TEXT NOT NULL,
  client_mutation_id TEXT,
  removed    INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_lounge ON lounge_messages(lounge_id, created_at);
CREATE INDEX IF NOT EXISTS idx_lounge_cursor ON lounge_messages(lounge_id, removed, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_lounge_recent_directory
  ON lounge_messages(removed, created_at DESC, lower(lounge_id));

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

-- A listener who receives a genuine iframe 100/101/150 must not be handed the
-- same dead ID again, including when it came from a staff pin. These tombstones
-- are actor-scoped: an untrusted client can protect its own playback session but
-- cannot globally destroy a verified cache result or staff decision.
CREATE TABLE IF NOT EXISTS youtube_playback_failures (
  track_key  TEXT NOT NULL,
  video_id   TEXT NOT NULL,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (track_key, video_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_youtube_playback_failures_expiry
  ON youtube_playback_failures(created_at);

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

-- A v2 Owner identity is permanent. Normal application SQL cannot rewrite the
-- marker or remove/demote/restrict/delete its account. Recovery from physical
-- database corruption remains an offline operator procedure with the service
-- stopped, not a remotely reachable admin action.
CREATE TRIGGER IF NOT EXISTS owner_identity_no_update
BEFORE UPDATE ON app_meta
WHEN OLD.key='security.bootstrap_admin_identity.v1'
  AND json_extract(OLD.value,'$.version')=2
  AND NEW.value<>OLD.value
BEGIN
  SELECT RAISE(ABORT, 'the Owner identity is locked');
END;

CREATE TRIGGER IF NOT EXISTS owner_identity_no_delete
BEFORE DELETE ON app_meta
WHEN OLD.key='security.bootstrap_admin_identity.v1'
  AND json_extract(OLD.value,'$.version')=2
BEGIN
  SELECT RAISE(ABORT, 'the Owner identity is locked');
END;

CREATE TRIGGER IF NOT EXISTS owner_account_security_boundary
BEFORE UPDATE ON users
WHEN OLD.id=(SELECT json_extract(value,'$.userId') FROM app_meta
  WHERE key='security.bootstrap_admin_identity.v1' AND json_extract(value,'$.version')=2)
  AND (
    NEW.id<>OLD.id
    OR lower(NEW.email)<>(SELECT lower(json_extract(value,'$.email')) FROM app_meta
      WHERE key='security.bootstrap_admin_identity.v1')
    OR NEW.role<>'admin'
    OR COALESCE(NEW.is_banned,0)<>0
    OR NEW.suspended_until IS NOT NULL
    OR COALESCE(NEW.email_verified_at,0)<=0
  )
BEGIN
  SELECT RAISE(ABORT, 'the Owner account security boundary is locked');
END;

CREATE TRIGGER IF NOT EXISTS owner_account_no_delete
BEFORE DELETE ON users
WHEN OLD.id=(SELECT json_extract(value,'$.userId') FROM app_meta
  WHERE key='security.bootstrap_admin_identity.v1' AND json_extract(value,'$.version')=2)
BEGIN
  SELECT RAISE(ABORT, 'the Owner account cannot be deleted');
END;

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

-- Every direct-upload ticket is recorded before it is returned to the client.
-- This is intentionally not tied to users by a foreign key: account deletion
-- must leave the exact owner/key work list alive until object storage confirms
-- deletion, including uploads that were never attached to a database record.
CREATE TABLE IF NOT EXISTS media_objects (
  object_key    TEXT PRIMARY KEY,
  owner_id      TEXT NOT NULL,
  storage_scope TEXT NOT NULL DEFAULT 'public' CHECK (storage_scope IN ('public','private')),
  purpose       TEXT NOT NULL,
  byte_size     INTEGER NOT NULL DEFAULT 0 CHECK (byte_size >= 0),
  status        TEXT NOT NULL DEFAULT 'issued'
                  CHECK (status IN ('issued','associated','delete_queued','deletion_dead')),
  created_at    INTEGER NOT NULL,
  upload_expires_at INTEGER,
  associated_at INTEGER,
  updated_at    INTEGER NOT NULL,
  UNIQUE (owner_id, object_key)
);
CREATE INDEX IF NOT EXISTS idx_media_objects_owner ON media_objects(owner_id, status, created_at);
-- The service-wide upload circuit breaker aggregates only unresolved object
-- capabilities. Keep that reservation-time query off the full object ledger.
CREATE INDEX IF NOT EXISTS idx_media_objects_status_bytes ON media_objects(status, byte_size);

-- Every returned upload ticket consumes the owner's rolling upload allowance.
-- This history intentionally outlives media_objects deletion for 24 hours, so
-- rapidly uploading and deleting cannot reset the bandwidth/storage budget.
-- Account erasure removes it through the owner FK; old events are pruned by the
-- media cleanup worker and opportunistically before each new reservation.
CREATE TABLE IF NOT EXISTS media_upload_issuances (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  object_key TEXT NOT NULL,
  byte_size  INTEGER NOT NULL CHECK (byte_size > 0),
  issued_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_media_upload_issuances_owner_at
  ON media_upload_issuances(owner_id, issued_at);
CREATE INDEX IF NOT EXISTS idx_media_upload_issuances_at
  ON media_upload_issuances(issued_at);
-- The global rolling-byte breaker reads issued_at and SUM(byte_size). Covering
-- both columns avoids fetching every matching ledger row from the table.
CREATE INDEX IF NOT EXISTS idx_media_upload_issuances_at_bytes
  ON media_upload_issuances(issued_at, byte_size);

-- Stable media identity sits above the object ledger. media_objects remains
-- the deletion authority (and deliberately survives account erasure until the
-- bucket confirms deletion); these rows describe how an owned source is used by
-- the product. Source keys/URLs are minted by the server and never replaced by
-- a client-supplied URL. HEAD verification observes the signed byte count and
-- MIME transport metadata. Video publication additionally requires a bounded
-- ISO-BMFF track/duration probe. Image publication requires an isolated full
-- decode and a separately keyed, metadata-free server-authored rendition.
CREATE TABLE IF NOT EXISTS media_assets (
  id                 TEXT PRIMARY KEY,
  owner_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_asset_id    TEXT NOT NULL,
  create_hash        TEXT NOT NULL,
  purpose            TEXT NOT NULL CHECK (purpose IN ('post','review','venue')),
  kind               TEXT NOT NULL CHECK (kind IN ('image','video')),
  source_key         TEXT NOT NULL UNIQUE,
  source_url         TEXT NOT NULL UNIQUE,
  source_storage_scope TEXT NOT NULL DEFAULT 'public' CHECK (source_storage_scope IN ('public','private')),
  source_etag        TEXT,
  original_name      TEXT NOT NULL,
  mime_type          TEXT NOT NULL,
  byte_size          INTEGER NOT NULL CHECK (byte_size > 0),
  width              INTEGER,
  height             INTEGER,
  duration_ms        INTEGER,
  orientation        INTEGER NOT NULL DEFAULT 0 CHECK (orientation IN (0,90,180,270)),
  metadata_status    TEXT NOT NULL DEFAULT 'pending'
                         CHECK (metadata_status IN ('pending','declared')),
  codec_status       TEXT NOT NULL DEFAULT 'pending'
                         CHECK (codec_status IN ('pending','verified','not_applicable')),
  codec_verified_at  INTEGER,
  alt_text           TEXT NOT NULL DEFAULT '' CHECK (length(alt_text) <= 1000),
  status             TEXT NOT NULL DEFAULT 'upload_pending'
                         CHECK (status IN ('upload_pending','ready','render_pending','render_unavailable','failed')),
  edit_recipe        TEXT NOT NULL DEFAULT '{}',
  recipe_version     INTEGER NOT NULL DEFAULT 1,
  finalize_hash      TEXT,
  source_verified_at INTEGER,
  render_state       TEXT NOT NULL DEFAULT 'not_required'
                         CHECK (render_state IN ('not_required','pending','unavailable','ready','failed')),
  render_variant_id  TEXT,
  poster_variant_id  TEXT,
  poster_key         TEXT,
  poster_url         TEXT,
  poster_time_ms     INTEGER,
  created_at         INTEGER NOT NULL,
  updated_at         INTEGER NOT NULL,
  UNIQUE (owner_id, client_asset_id)
);
CREATE INDEX IF NOT EXISTS idx_media_assets_owner_status
  ON media_assets(owner_id, status, created_at DESC);

-- Renditions are separate owned objects. Client-rendered images are private
-- staging inputs; only an isolated decode/re-encode receives the durable public
-- identity. Destructive video edits remain unavailable until an authoritative
-- encoder is configured; no row is ready merely because a recipe exists.
CREATE TABLE IF NOT EXISTS media_variants (
  id                TEXT PRIMARY KEY,
  asset_id          TEXT NOT NULL REFERENCES media_assets(id) ON DELETE CASCADE,
  client_variant_id TEXT NOT NULL,
  create_hash       TEXT NOT NULL,
  role              TEXT NOT NULL CHECK (role IN ('render','poster')),
  object_key        TEXT NOT NULL UNIQUE,
  public_url        TEXT NOT NULL UNIQUE,
  mime_type         TEXT NOT NULL,
  byte_size         INTEGER NOT NULL CHECK (byte_size > 0),
  width             INTEGER,
  height            INTEGER,
  time_ms           INTEGER,
  status            TEXT NOT NULL DEFAULT 'upload_pending'
                        CHECK (status IN ('upload_pending','verified','failed')),
  finalize_hash     TEXT,
  verified_at       INTEGER,
  verification_origin TEXT NOT NULL DEFAULT 'client'
                        CHECK (verification_origin IN ('client','video_verifier_v1','private_derivative_v1')),
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL,
  UNIQUE (asset_id, client_variant_id),
  UNIQUE (asset_id, role)
);
CREATE INDEX IF NOT EXISTS idx_media_variants_asset ON media_variants(asset_id, role);

-- A photo re-edit is prepared beside the currently published rendition. The
-- active media_variants row and media_assets.render_variant_id remain untouched
-- until the replacement object has passed storage verification. Finalization
-- then moves this row into media_variants and retires the previous object in one
-- writer transaction, so a cancelled upload or failed HEAD can never blank the
-- owner's ready media. There is one pending recipe/output per asset; changing
-- the pending recipe retires only its unfinished object, never the active one.
CREATE TABLE IF NOT EXISTS media_asset_revisions (
  asset_id              TEXT PRIMARY KEY REFERENCES media_assets(id) ON DELETE CASCADE,
  edit_recipe           TEXT NOT NULL,
  recipe_version        INTEGER NOT NULL DEFAULT 1,
  base_render_variant_id TEXT NOT NULL,
  variant_id            TEXT UNIQUE,
  client_variant_id     TEXT,
  create_hash           TEXT,
  object_key            TEXT UNIQUE,
  public_url            TEXT UNIQUE,
  mime_type             TEXT,
  byte_size             INTEGER CHECK (byte_size IS NULL OR byte_size > 0),
  status                TEXT NOT NULL DEFAULT 'recipe_pending'
                           CHECK (status IN ('recipe_pending','upload_pending')),
  created_at            INTEGER NOT NULL,
  updated_at            INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_media_asset_revisions_variant
  ON media_asset_revisions(variant_id);

-- The old posts.photos URL array remains the compatibility/read fallback.
-- New clients additionally attach up to twenty stable assets in the same order.
-- An asset belongs to at most one post so removing a post has unambiguous
-- privacy/deletion semantics for its original and every rendition.
CREATE TABLE IF NOT EXISTS post_media (
  post_id    TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  asset_id   TEXT NOT NULL REFERENCES media_assets(id) ON DELETE CASCADE,
  position   INTEGER NOT NULL CHECK (position BETWEEN 0 AND ${POST_MEDIA_MAX_POSITION}),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (post_id, position),
  UNIQUE (asset_id)
);
CREATE INDEX IF NOT EXISTS idx_post_media_asset ON post_media(asset_id);

-- Five URL-only clips predate stable media_assets. Their source remains on the
-- grandfathered post URL path, but a trusted release backfill can attach one
-- immutable, server-verified cover without claiming that the clip itself passed
-- the newer codec publication gate. The poster stays in the ordinary owned
-- object ledger so post moderation, author deletion, and account erasure use
-- the same durable deletion queue as every other PIT upload.
CREATE TABLE IF NOT EXISTS legacy_video_posters (
  post_id          TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  media_url        TEXT NOT NULL,
  position         INTEGER NOT NULL CHECK (position BETWEEN 0 AND 7),
  owner_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  poster_key       TEXT NOT NULL UNIQUE,
  poster_url       TEXT NOT NULL UNIQUE,
  mime_type        TEXT NOT NULL CHECK (mime_type = 'image/jpeg'),
  byte_size        INTEGER NOT NULL CHECK (byte_size BETWEEN 1024 AND 5242880),
  width            INTEGER NOT NULL CHECK (width BETWEEN 1 AND 1920),
  height           INTEGER NOT NULL CHECK (height BETWEEN 1 AND 1920),
  time_ms          INTEGER NOT NULL CHECK (time_ms BETWEEN 0 AND 60000),
  content_sha256   TEXT NOT NULL CHECK (length(content_sha256) = 64),
  content_md5      TEXT NOT NULL CHECK (length(content_md5) = 32),
  status           TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','retry','verified','failed')),
  attempts         INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  next_attempt_at  INTEGER NOT NULL DEFAULT 0,
  last_error_code  TEXT,
  verified_at      INTEGER,
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL,
  PRIMARY KEY (post_id, media_url)
);
CREATE INDEX IF NOT EXISTS idx_legacy_video_posters_due
  ON legacy_video_posters(status, next_attempt_at, post_id);

-- Durable active-object cleanup. Backups use separate BACKUP_S3_* credentials
-- and never enter this table; the worker signs only MEDIA_* object keys.
CREATE TABLE IF NOT EXISTS media_deletion_queue (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id        TEXT NOT NULL,
  object_key      TEXT NOT NULL UNIQUE,
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','retry','processing','dead')),
  attempts        INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at INTEGER NOT NULL,
  last_error_code TEXT,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  dead_at         INTEGER,
  FOREIGN KEY (owner_id, object_key) REFERENCES media_objects(owner_id, object_key)
);
CREATE INDEX IF NOT EXISTS idx_media_deletion_due
  ON media_deletion_queue(status, next_attempt_at, id);
CREATE INDEX IF NOT EXISTS idx_media_deletion_owner
  ON media_deletion_queue(owner_id, status, created_at);

-- This cleanup deliberately lives in SQLite rather than only in the current
-- API process. During a rolling deploy an older worker can still edit a post
-- after the new worker registered these one-time mappings. The trigger keeps
-- that old write from stranding or exposing a derivative: the exact ledger key
-- is durably queued before its association is removed. Reordering an attached
-- source merely refreshes its position.
CREATE TRIGGER IF NOT EXISTS trg_legacy_video_posters_post_update_cleanup
AFTER UPDATE OF photos, removed, user_id ON posts
BEGIN
  INSERT OR IGNORE INTO media_deletion_queue
    (owner_id,object_key,status,attempts,next_attempt_at,last_error_code,created_at,updated_at,dead_at)
  SELECT lp.owner_id,lp.poster_key,'pending',0,
    CAST(strftime('%s','now') AS INTEGER) * 1000,
    NULL,CAST(strftime('%s','now') AS INTEGER) * 1000,
    CAST(strftime('%s','now') AS INTEGER) * 1000,NULL
  FROM legacy_video_posters lp
  JOIN media_objects mo ON mo.owner_id=lp.owner_id AND mo.object_key=lp.poster_key
  WHERE lp.post_id=NEW.id AND (
    NEW.removed<>0 OR NEW.user_id<>lp.owner_id OR NOT EXISTS (
      SELECT 1
      FROM json_each(CASE WHEN json_valid(NEW.photos) THEN NEW.photos ELSE '[]' END) photo
      WHERE photo.type='text' AND photo.value=lp.media_url
    )
  );

  UPDATE media_objects
  SET status='delete_queued',updated_at=CAST(strftime('%s','now') AS INTEGER) * 1000
  WHERE EXISTS (
    SELECT 1
    FROM legacy_video_posters lp
    JOIN media_deletion_queue queue
      ON queue.owner_id=lp.owner_id AND queue.object_key=lp.poster_key
    WHERE lp.post_id=NEW.id
      AND lp.owner_id=media_objects.owner_id
      AND lp.poster_key=media_objects.object_key
      AND (
        NEW.removed<>0 OR NEW.user_id<>lp.owner_id OR NOT EXISTS (
          SELECT 1
          FROM json_each(CASE WHEN json_valid(NEW.photos) THEN NEW.photos ELSE '[]' END) photo
          WHERE photo.type='text' AND photo.value=lp.media_url
        )
      )
  );

  DELETE FROM legacy_video_posters
  WHERE post_id=NEW.id AND (
    NEW.removed<>0 OR NEW.user_id<>owner_id OR NOT EXISTS (
      SELECT 1
      FROM json_each(CASE WHEN json_valid(NEW.photos) THEN NEW.photos ELSE '[]' END) photo
      WHERE photo.type='text' AND photo.value=legacy_video_posters.media_url
    )
  );

  UPDATE legacy_video_posters
  SET position=(
      SELECT CAST(photo.key AS INTEGER)
      FROM json_each(CASE WHEN json_valid(NEW.photos) THEN NEW.photos ELSE '[]' END) photo
      WHERE photo.type='text' AND photo.value=legacy_video_posters.media_url
      ORDER BY CAST(photo.key AS INTEGER)
      LIMIT 1
    ),
    updated_at=CAST(strftime('%s','now') AS INTEGER) * 1000
  WHERE post_id=NEW.id;
END;

-- Posts are normally soft-deleted, but this companion protects maintenance or
-- future hard-delete paths too. It runs before the FK cascade removes mapping
-- rows, leaving the storage work list alive independently of the post/account.
CREATE TRIGGER IF NOT EXISTS trg_legacy_video_posters_post_delete_cleanup
BEFORE DELETE ON posts
BEGIN
  INSERT OR IGNORE INTO media_deletion_queue
    (owner_id,object_key,status,attempts,next_attempt_at,last_error_code,created_at,updated_at,dead_at)
  SELECT lp.owner_id,lp.poster_key,'pending',0,
    CAST(strftime('%s','now') AS INTEGER) * 1000,
    NULL,CAST(strftime('%s','now') AS INTEGER) * 1000,
    CAST(strftime('%s','now') AS INTEGER) * 1000,NULL
  FROM legacy_video_posters lp
  JOIN media_objects mo ON mo.owner_id=lp.owner_id AND mo.object_key=lp.poster_key
  WHERE lp.post_id=OLD.id;

  UPDATE media_objects
  SET status='delete_queued',updated_at=CAST(strftime('%s','now') AS INTEGER) * 1000
  WHERE EXISTS (
    SELECT 1
    FROM legacy_video_posters lp
    JOIN media_deletion_queue queue
      ON queue.owner_id=lp.owner_id AND queue.object_key=lp.poster_key
    WHERE lp.post_id=OLD.id
      AND lp.owner_id=media_objects.owner_id
      AND lp.poster_key=media_objects.object_key
  );
END;

-- A per-owner ListObjectsV2 cursor closes the one pre-ledger blind spot: an old
-- direct upload that succeeded but was never attached to a row. Account deletion
-- creates this durable prefix job without waiting on object storage; the worker
-- paginates only users/{exact owner}/ and validates every returned key before it
-- can enter the object queue.
CREATE TABLE IF NOT EXISTS media_owner_sweeps (
  owner_id          TEXT PRIMARY KEY,
  storage_scope     TEXT NOT NULL DEFAULT 'public' CHECK (storage_scope IN ('public','private')),
  status            TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','retry','processing','dead')),
  attempts          INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  continuation_token TEXT,
  not_before_at     INTEGER NOT NULL DEFAULT 0,
  finalize_after_at INTEGER NOT NULL DEFAULT 0,
  verification_passes INTEGER NOT NULL DEFAULT 0 CHECK (verification_passes >= 0),
  next_attempt_at   INTEGER NOT NULL,
  discovered_count INTEGER NOT NULL DEFAULT 0,
  last_error_code   TEXT,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL,
  dead_at           INTEGER
);
CREATE INDEX IF NOT EXISTS idx_media_owner_sweeps_due
  ON media_owner_sweeps(status, next_attempt_at, owner_id);

-- Aggregated server errors. One row per DISTINCT problem, not per occurrence:
-- a 500 in a loop would otherwise write thousands of rows onto a 1GB disk and
-- bury the signal. The count column carries the volume instead.
--
-- Nothing user-authored is stored. No request bodies, query values, stack traces,
-- file paths or raw URLs — only the route PATTERN, stable error code, sanitized
-- cause name, and the server-generated request UUID used for correlation.
-- See CLAUDE.md on never surfacing internals.
CREATE TABLE IF NOT EXISTS error_events (
  fingerprint TEXT PRIMARY KEY,
  level       TEXT NOT NULL DEFAULT 'error',
  code        TEXT NOT NULL DEFAULT '',
  status      INTEGER NOT NULL DEFAULT 0,
  method      TEXT NOT NULL DEFAULT '',
  route       TEXT NOT NULL DEFAULT '',
  cause       TEXT NOT NULL DEFAULT '',
  last_request_id TEXT,
  count       INTEGER NOT NULL DEFAULT 0,
  first_seen  INTEGER NOT NULL,
  last_seen   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_error_events_last ON error_events(last_seen DESC);

-- The summary row above is lifetime-per-fingerprint. Time-bounded health
-- reports need occurrence volume for their actual window, so retain one small
-- counter per fingerprint/hour. This is still bounded aggregation: no request
-- values, messages, IPs, or per-occurrence rows are stored.
CREATE TABLE IF NOT EXISTS error_occurrence_buckets (
  fingerprint TEXT NOT NULL REFERENCES error_events(fingerprint) ON DELETE CASCADE,
  hour_start  INTEGER NOT NULL,
  count       INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (fingerprint,hour_start)
);
CREATE INDEX IF NOT EXISTS idx_error_occurrence_buckets_hour
  ON error_occurrence_buckets(hour_start DESC);

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

-- Exact provider-recording pins live outside the rolling-compatible tuple
-- table. An older binary safely ignores this additive table instead of
-- misclassifying a new key as a legacy ASCII row during startup reconciliation.
CREATE TABLE IF NOT EXISTS track_source_overrides (
  provider   TEXT NOT NULL,
  source_id  TEXT NOT NULL,
  title      TEXT NOT NULL,
  artist     TEXT NOT NULL DEFAULT '',
  video_id   TEXT,
  set_by     TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (provider, source_id)
);
CREATE INDEX IF NOT EXISTS idx_track_source_overrides_updated
  ON track_source_overrides(updated_at DESC);

-- Permanent provenance for identities that share the former ASCII key. Old
-- binaries cannot reveal their intended Unicode identity on an UPSERT conflict
-- (they update only video_id), so current code uses this registry to detect
-- ambiguity and fail closed instead of mirroring a video onto the wrong song.
CREATE TABLE IF NOT EXISTS track_override_compat_links (
  legacy_key  TEXT NOT NULL,
  current_key TEXT NOT NULL,
  title       TEXT NOT NULL,
  artist      TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (legacy_key,current_key)
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
  content_revision INTEGER NOT NULL DEFAULT 1,
  tested_revision  INTEGER,
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
  claimed_at  INTEGER,
  claim_token TEXT,
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

// Stamp the file after the complete Pit schema exists. Future production boots
// can distinguish an intentional Pit database from an unrelated SQLite file;
// the pre-marker live database is admitted once by the stricter legacy checks.
db.exec(`PRAGMA application_id = ${PIT_SQLITE_APPLICATION_ID}`);

// Additive migrations for DBs created before a column existed. Inspect the
// actual table before altering it: a real migration failure must stop startup,
// while an already-present column is safely skipped on every boot.
const additiveMigrations = [
  "ALTER TABLE users ADD COLUMN handle_changed_at INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE users ADD COLUMN profile_updated_at INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE users ADD COLUMN verified INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE users ADD COLUMN spotify_access_token TEXT",
  "ALTER TABLE users ADD COLUMN spotify_refresh_token TEXT",
  "ALTER TABLE users ADD COLUMN spotify_expires_at INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE posts ADD COLUMN tour TEXT",
  "ALTER TABLE posts ADD COLUMN updated_at INTEGER",
  "ALTER TABLE posts ADD COLUMN dims TEXT NOT NULL DEFAULT '{}'",
  "ALTER TABLE artists ADD COLUMN searches INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE artists ADD COLUMN search_key TEXT",
  // Immutable public identity. Nullable is required for rolling rollback: an
  // older process can ignore the column, while this release fills every row
  // deterministically before publishing the unique lookup index below.
  "ALTER TABLE artists ADD COLUMN public_slug TEXT",
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
  // Exact-message moderation keeps the private body as bounded adjudication
  // evidence while this flag hides it from both participants' read surfaces.
  "ALTER TABLE dms ADD COLUMN removed INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE users ADD COLUMN sponsor INTEGER NOT NULL DEFAULT 0", // admin-granted partner mark
  "ALTER TABLE users ADD COLUMN reset_hash TEXT", // sha256 of a password-reset token
  "ALTER TABLE users ADD COLUMN reset_expires INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE posts ADD COLUMN tags TEXT NOT NULL DEFAULT '[]'", // short word-art descriptors on a review
  "ALTER TABLE posts ADD COLUMN kind TEXT NOT NULL DEFAULT 'review'", // 'review' = a logged show, 'status' = a plain post
  // Venue-review images are private account media unless the author explicitly
  // allows aggregate public/crawler venue-gallery reuse.
  "ALTER TABLE venue_reviews ADD COLUMN photos_public INTEGER NOT NULL DEFAULT 0",
  // Separate, default-off consent for marketing-surface community imagery.
  // Existing artist-page photo consent must never silently become permission
  // to feature an old upload as the full-screen logged-out homepage.
  "ALTER TABLE posts ADD COLUMN landing_showcase INTEGER NOT NULL DEFAULT 0",
  // Versioned, server-authorized presentation metadata for verified-artist
  // status posts. The linked background remains a normal post_media asset so
  // moderation, deletion, ownership, and rendition guarantees stay unified.
  "ALTER TABLE posts ADD COLUMN campaign TEXT",
  // Versioned ticket-card metadata for an explicitly shared attendance post.
  // Nullable keeps old clients and rolling rollbacks compatible.
  "ALTER TABLE posts ADD COLUMN attendance_ticket TEXT",
  "ALTER TABLE posts ADD COLUMN tagged_user_ids TEXT NOT NULL DEFAULT '[]'", // structured account ids; distinct from descriptive review tags
  "ALTER TABLE posts ADD COLUMN song TEXT", // JSON of a tagged YouTube song {videoId,title,artist,url,thumb}
  "ALTER TABLE posts ADD COLUMN playlist TEXT", // immutable playlist snapshot attached to a post
  "ALTER TABLE plays ADD COLUMN video_id TEXT", // exact YouTube identity for cross-device replay
  "ALTER TABLE plays ADD COLUMN provider TEXT", // provider namespace for the exact source recording
  "ALTER TABLE plays ADD COLUMN source_id TEXT", // opaque provider recording id for cross-device replay
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
  // Chat creates use the same one-logical-write retry contract as posts. The
  // token is scoped to its author by a partial unique index below; old clients
  // may continue to omit it and receive the legacy at-most-once-request path.
  "ALTER TABLE dms ADD COLUMN client_mutation_id TEXT",
  "ALTER TABLE fan_club_messages ADD COLUMN client_mutation_id TEXT",
  "ALTER TABLE lounge_messages ADD COLUMN client_mutation_id TEXT",
  // Provider dates remain public (NULL owner, immediate release). Artist/admin
  // batches carry durable authorship and can be scheduled without leaking.
  "ALTER TABLE tour_dates ADD COLUMN owner_id TEXT REFERENCES users(id) ON DELETE CASCADE",
  "ALTER TABLE tour_dates ADD COLUMN artist_key TEXT REFERENCES artists(norm)",
  "ALTER TABLE tour_dates ADD COLUMN release_at INTEGER NOT NULL DEFAULT 0",
  // Provider identity and local/absolute time are kept separately. A local
  // wall-clock value without an offset must never be silently presented as UTC.
  "ALTER TABLE tour_dates ADD COLUMN provider_event_id TEXT",
  "ALTER TABLE tour_dates ADD COLUMN event_name TEXT",
  // Discovery APIs do not expose a dependable tour field. This remains nullable
  // and is populated only by conservative, explicit-title derivation.
  "ALTER TABLE tour_dates ADD COLUMN tour_name TEXT",
  "ALTER TABLE tour_dates ADD COLUMN start_date_time TEXT",
  "ALTER TABLE tour_dates ADD COLUMN start_local_time TEXT",
  // Ticketmaster calls this event access rather than guaranteed venue doors.
  // Approximation remains nullable for legacy rows and providers without it.
  "ALTER TABLE tour_dates ADD COLUMN access_start_date_time TEXT",
  "ALTER TABLE tour_dates ADD COLUMN access_start_approximate INTEGER",
  "ALTER TABLE tour_dates ADD COLUMN event_timezone TEXT",
  "ALTER TABLE tour_dates ADD COLUMN event_status TEXT",
  "ALTER TABLE tour_dates ADD COLUMN venue_provider_id TEXT",
  "ALTER TABLE tour_dates ADD COLUMN venue_address_line1 TEXT",
  "ALTER TABLE tour_dates ADD COLUMN venue_address_line2 TEXT",
  "ALTER TABLE tour_dates ADD COLUMN venue_city TEXT",
  "ALTER TABLE tour_dates ADD COLUMN venue_region TEXT",
  "ALTER TABLE tour_dates ADD COLUMN venue_postal_code TEXT",
  "ALTER TABLE tour_dates ADD COLUMN venue_country_code TEXT",
  "ALTER TABLE tour_dates ADD COLUMN venue_country TEXT",
  // Stale provider rows remain durable for archives and can be reactivated by
  // the same stable provider identity on a later successful refresh.
  "ALTER TABLE tour_dates ADD COLUMN provider_active INTEGER NOT NULL DEFAULT 1",
  "ALTER TABLE tour_dates ADD COLUMN last_seen_at INTEGER",
  "ALTER TABLE tour_dates ADD COLUMN event_kind TEXT NOT NULL DEFAULT 'concert'",
  "ALTER TABLE tour_dates ADD COLUMN music_qualified INTEGER NOT NULL DEFAULT 1",
  "ALTER TABLE tour_dates ADD COLUMN music_evidence TEXT",
  "ALTER TABLE tour_dates ADD COLUMN billed_artists TEXT NOT NULL DEFAULT '[]'",
  "ALTER TABLE tour_dates ADD COLUMN event_end_date TEXT",
  // Staff-curated festivals/fairs must retain the official public source used
  // to verify their live-music identity. It is never fetched server-side.
  "ALTER TABLE tour_dates ADD COLUMN event_source_url TEXT",
  // Ticketmaster supplies a bounded image descriptor with the event payload.
  // Persist the chosen asset and its attribution/dimensions so render paths do
  // not repeatedly search for or download venue/event imagery.
  "ALTER TABLE tour_dates ADD COLUMN event_image_url TEXT",
  "ALTER TABLE tour_dates ADD COLUMN event_image_attribution TEXT",
  "ALTER TABLE tour_dates ADD COLUMN event_image_width INTEGER",
  "ALTER TABLE tour_dates ADD COLUMN event_image_height INTEGER",
  // Stable attendee pagination for existing rows (0 + user id) and all new rows.
  "ALTER TABLE going ADD COLUMN created_at INTEGER NOT NULL DEFAULT 0",
  // Marketing consent. Broadcasts must honour this; password resets must not,
  // since a user who opted out of announcements still needs to reach their
  // account. server/emailService.js is where that distinction is enforced.
  "ALTER TABLE users ADD COLUMN marketing_opt_out INTEGER NOT NULL DEFAULT 1",
  "ALTER TABLE users ADD COLUMN marketing_consent_at INTEGER",
  "ALTER TABLE users ADD COLUMN marketing_consent_version TEXT",
  "ALTER TABLE users ADD COLUMN marketing_consent_source TEXT",
  "ALTER TABLE users ADD COLUMN marketing_withdrawn_at INTEGER",
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
  // Delivery claims are expiring leases. A unique token prevents a timed-out
  // sender from settling a row after a later worker has reclaimed it.
  "ALTER TABLE email_queue ADD COLUMN claimed_at INTEGER",
  "ALTER TABLE email_queue ADD COLUMN claim_token TEXT",
  // A test delivery approves exactly the campaign revision it rendered. Legacy
  // tested drafts deliberately gain no tested_revision and therefore require a
  // fresh test after this migration.
  "ALTER TABLE email_campaigns ADD COLUMN content_revision INTEGER NOT NULL DEFAULT 1",
  "ALTER TABLE email_campaigns ADD COLUMN tested_revision INTEGER",
  // Artist-page updates are UGC too. Soft removal lets the shared moderation
  // workflow hide them atomically while preserving an audit trail.
  "ALTER TABLE artist_posts ADD COLUMN removed INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE artist_profiles ADD COLUMN removed INTEGER NOT NULL DEFAULT 0",
  // A report stores only a verified positional selector. The attachment URL is
  // resolved from the still-current target for authorized, no-store staff reads.
  "ALTER TABLE reports ADD COLUMN media_index INTEGER",
  "ALTER TABLE reports ADD COLUMN media_fingerprint TEXT",
  // A deletion sweep cannot finish while a previously issued PUT can still
  // create an object after an early 404. Existing rows safely use NULL/0;
  // newly issued tickets persist their exact expiry and set the sweep barrier.
  "ALTER TABLE media_objects ADD COLUMN upload_expires_at INTEGER",
  // Existing ledger rows predate byte-accounting and are safely grandfathered
  // at zero. Every newly returned ticket records its measured byte count.
  "ALTER TABLE media_objects ADD COLUMN byte_size INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE media_owner_sweeps ADD COLUMN not_before_at INTEGER NOT NULL DEFAULT 0",
  // Keep exact-prefix verification alive after the first empty listing. S3
  // validates a presigned PUT when the request starts, so a slow transfer may
  // complete after its URL expires. Existing sweep rows get an immediate final
  // pass; newly created account-erasure sweeps receive the bounded quiet window.
  "ALTER TABLE media_owner_sweeps ADD COLUMN finalize_after_at INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE media_owner_sweeps ADD COLUMN verification_passes INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE media_owner_sweeps ADD COLUMN storage_scope TEXT NOT NULL DEFAULT 'public'",
  // Accessibility copy belongs to the stable asset rather than a visual edit
  // recipe, so changing/reading it never implies a new raster/video render.
  "ALTER TABLE media_assets ADD COLUMN alt_text TEXT NOT NULL DEFAULT ''",
  // Transport MIME and structural MP4 inspection are not playable-codec proof.
  // Video rows remain pending until an authoritative decoder/transcoder records
  // verification; existing rows cannot be newly selected while still pending.
  "ALTER TABLE media_assets ADD COLUMN codec_status TEXT NOT NULL DEFAULT 'pending'",
  "ALTER TABLE media_assets ADD COLUMN codec_verified_at INTEGER",
  "ALTER TABLE media_assets ADD COLUMN source_storage_scope TEXT NOT NULL DEFAULT 'public'",
  "ALTER TABLE media_assets ADD COLUMN source_etag TEXT",
  // Client-uploaded image renditions retain the default. A stable clip may be
  // published only with a poster whose row was minted and byte-verified through
  // the private authoritative video verifier path.
  "ALTER TABLE media_variants ADD COLUMN verification_origin TEXT NOT NULL DEFAULT 'client'",
  "ALTER TABLE media_objects ADD COLUMN storage_scope TEXT NOT NULL DEFAULT 'public'",
  // Legacy pre-release memorial rows are backfilled below only when their
  // exact catalog key resolves to a syntactically valid MusicBrainz identity.
  "ALTER TABLE artist_memorials ADD COLUMN artist_mbid TEXT",
  // Preserve one safe correlation handle per aggregated problem. The UUID is
  // generated by the HTTP shell and contains no user-authored data.
  "ALTER TABLE error_events ADD COLUMN last_request_id TEXT",
];

// Memorials briefly existed without a durable identity binding. Backfill under
// the startup write lock using exact catalog keys and valid MBIDs only.
// An unbound legacy row remains staff-visible but is fail-closed by the service
// until an admin re-saves it against an exact catalog identity.
function ensureArtistMemorialSchema(database) {
  const mbidGlob = "[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f]-[1-5][0-9a-f][0-9a-f][0-9a-f]-[89ab][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]";
  database.exec(`
    UPDATE artist_memorials
    SET artist_mbid=(
      SELECT lower(artists.mbid) FROM artists
      WHERE artists.norm=artist_memorials.artist_key
        AND length(artists.mbid)=36
        AND lower(artists.mbid) GLOB '${mbidGlob}'
    )
    WHERE artist_mbid IS NULL
      AND EXISTS (
        SELECT 1 FROM artists
        WHERE artists.norm=artist_memorials.artist_key
          AND length(artists.mbid)=36
          AND lower(artists.mbid) GLOB '${mbidGlob}'
      );
    CREATE TRIGGER IF NOT EXISTS trg_artist_memorials_require_mbid_insert
    BEFORE INSERT ON artist_memorials
    WHEN NEW.artist_mbid IS NULL
    BEGIN
      SELECT RAISE(ABORT,'artist memorial identity is required');
    END;
    CREATE TRIGGER IF NOT EXISTS trg_artist_memorials_require_mbid_update
    BEFORE UPDATE ON artist_memorials
    WHEN NEW.artist_mbid IS NULL
    BEGIN
      SELECT RAISE(ABORT,'artist memorial identity is required');
    END;
  `);
}

const artistSlugDigest = (identity) => createHash("sha256")
  .update(String(identity || "artist"), "utf8")
  .digest("hex");

function artistSlugCandidates(name, norm) {
  const base = slugify(name) || `artist-${artistSlugDigest(norm).slice(0, 12)}`;
  const digest = artistSlugDigest(`artist-public-slug\0${norm}`);
  const candidates = [base];
  for (const tokenLength of [10, 16, 24, 32, 48, 64]) {
    const stem = base.slice(0, Math.max(1, 79 - tokenLength));
    candidates.push(`${stem}-${digest.slice(0, tokenLength)}`);
  }
  return candidates;
}

// Backfill runs under the migration transaction's cross-process write lock.
// Existing non-empty slugs are immutable; blank legacy rows are processed in a
// stable order and collision suffixes derive only from the catalog identity.
function ensureArtistPublicSlugs(database) {
  const rows = database.prepare(`SELECT norm,name,public_slug FROM artists
    ORDER BY norm COLLATE BINARY`).all();
  const owners = new Map();
  for (const row of rows) {
    const slug = String(row.public_slug || "").trim();
    if (!slug) continue;
    const key = slug.toLowerCase();
    const owner = owners.get(key);
    if (owner && owner !== row.norm) throw new Error(`Duplicate artist public slug: ${slug}`);
    owners.set(key, row.norm);
  }

  const update = database.prepare(`UPDATE artists SET public_slug=?
    WHERE norm=? AND (public_slug IS NULL OR trim(public_slug)='')`);
  for (const row of rows) {
    if (String(row.public_slug || "").trim()) continue;
    const candidate = artistSlugCandidates(row.name, row.norm)
      .find((value) => !owners.has(value.toLowerCase()));
    if (!candidate) throw new Error(`Could not allocate artist public slug for ${row.norm}`);
    update.run(candidate, row.norm);
    owners.set(candidate.toLowerCase(), row.norm);
  }
}

db.exec("BEGIN IMMEDIATE");
try {
  // Keep the initial version row under the same cross-process write lock as the
  // additive migrations. Parallel test workers and multi-process boots must not
  // both observe an empty table and silently insert duplicate version rows.
  const ver = db.prepare("SELECT version FROM schema_version LIMIT 1").get();
  if (!ver) db.prepare("INSERT INTO schema_version (version) VALUES (1)").run();
  for (const stmt of additiveMigrations) {
    const match = /^ALTER TABLE ([a-z_][a-z0-9_]*) ADD COLUMN ([a-z_][a-z0-9_]*)/i.exec(stmt);
    if (!match) throw new Error(`Unsupported additive migration: ${stmt}`);
    const [, table, column] = match;
    // This check intentionally runs after the write lock is held. A second
    // process that waited for the first boot's migration now observes the new
    // column instead of racing into a duplicate ALTER TABLE.
    const present = db.prepare(`PRAGMA table_info(${table})`).all()
      .some((entry) => String(entry.name).toLowerCase() === column.toLowerCase());
    if (!present) db.exec(stmt);
  }
  ensurePostMediaCapacity(db);
  ensureShowSchema(db);
  ensureArtistPublicSlugs(db);
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_artists_public_slug
    ON artists(lower(public_slug)) WHERE public_slug IS NOT NULL AND public_slug<>''`);
  db.exec(`CREATE TRIGGER IF NOT EXISTS trg_artists_public_slug_immutable
    BEFORE UPDATE OF public_slug ON artists
    WHEN trim(COALESCE(OLD.public_slug,''))<>'' AND NEW.public_slug IS NOT OLD.public_slug
    BEGIN
      SELECT RAISE(ABORT,'artist public slug is immutable');
    END`);
  ensureArtistMemorialSchema(db);
  // Image codecs are outside the MP4 compatibility gate. This also gives image
  // rows created before the codec columns an honest, non-pending state.
  db.prepare("UPDATE media_assets SET codec_status='not_applicable' WHERE kind='image' AND codec_status='pending'").run();
  // Rows created before server-side image sanitization may point directly at a
  // public camera upload. Preserve their records and originals for an explicit
  // re-sanitization/backfill, but make their publish state fail closed now.
  quarantineUnsafeLegacyImages(db);
  db.exec("COMMIT");
} catch (error) {
  try { db.exec("ROLLBACK"); }
  catch { /* architecture: allow-empty-catch -- preserve the original schema migration failure */ }
  throw error;
}

// A rolling deploy can briefly have an older API process writing only the
// legacy posts.tagged_user_ids column. Database triggers keep the normalized
// relation synchronized for both old and current writers, closing that window
// without requiring the old binary to understand the new table.
db.exec(`
CREATE TRIGGER IF NOT EXISTS trg_posts_user_tags_insert
AFTER INSERT ON posts
WHEN json_valid(NEW.tagged_user_ids)
BEGIN
  INSERT OR IGNORE INTO post_user_tags (post_id,user_id,author_id,position,created_at)
  SELECT NEW.id,tag.value,NEW.user_id,CAST(tag.key AS INTEGER),NEW.created_at
  FROM json_each(NEW.tagged_user_ids) tag JOIN users tagged_user ON tagged_user.id=tag.value
  WHERE tag.type='text' AND CAST(tag.key AS INTEGER) BETWEEN 0 AND 7;
END;
CREATE TRIGGER IF NOT EXISTS trg_posts_user_tags_update
AFTER UPDATE OF tagged_user_ids,user_id ON posts
BEGIN
  DELETE FROM post_user_tags WHERE post_id=NEW.id;
  INSERT OR IGNORE INTO post_user_tags (post_id,user_id,author_id,position,created_at)
  SELECT NEW.id,tag.value,NEW.user_id,CAST(tag.key AS INTEGER),COALESCE(NEW.updated_at,NEW.created_at)
  FROM json_each(CASE WHEN json_valid(NEW.tagged_user_ids) THEN NEW.tagged_user_ids ELSE '[]' END) tag
  JOIN users tagged_user ON tagged_user.id=tag.value
  WHERE tag.type='text' AND CAST(tag.key AS INTEGER) BETWEEN 0 AND 7;
END;

-- During a rolling deploy, the previous API binary still knows how to perform
-- an irreversible author deletion, but its tombstone UPDATE cannot name columns
-- introduced by this release. Recognize that complete legacy scrub signature
-- (distinct from a moderator's reversible removed=1) and clear the new
-- authored campaign/tag fields too. Updating tagged_user_ids also invokes the
-- synchronization trigger above, so no normalized association survives.
CREATE TRIGGER IF NOT EXISTS trg_posts_legacy_author_tombstone
AFTER UPDATE OF removed ON posts
WHEN OLD.removed=0 AND NEW.removed=1
  AND NEW.artist='' AND NEW.venue='' AND NEW.city='' AND NEW.date=''
  AND NEW.overall=0 AND NEW.band IS NULL AND NEW.room IS NULL AND NEW.dims='{}'
  AND NEW.review='' AND NEW.photos='[]' AND NEW.photos_public=0 AND NEW.landing_showcase=0
  AND NEW.setlist='[]' AND NEW.tour IS NULL AND NEW.tags='[]'
  AND NEW.song IS NULL AND NEW.playlist IS NULL
  AND NEW.artist_key IS NULL AND NEW.artist_mbid IS NULL AND NEW.venue_key IS NULL
  AND NEW.client_mutation_id IS NULL AND NEW.client_mutation_hash IS NULL
  AND (NEW.campaign IS NOT NULL OR NEW.tagged_user_ids<>'[]')
BEGIN
  UPDATE posts SET campaign=NULL,tagged_user_ids='[]' WHERE id=NEW.id;
END;

-- A pre-upgrade account-erasure process does not know to rewrite the legacy
-- JSON column before deleting a recipient. Do that at the database boundary
-- while the recipient and indexed relation still exist. The post tag UPDATE
-- trigger rebuilds every affected relation with compact positions before the
-- user's FK cascades run, preventing an erased account id from surviving in an
-- author's export or being resurrected by a later legacy edit.
CREATE TRIGGER IF NOT EXISTS trg_users_legacy_post_tag_erasure
BEFORE DELETE ON users
BEGIN
  UPDATE posts
  SET tagged_user_ids=COALESCE((
        SELECT json_group_array(remaining.value)
        FROM (
          SELECT tag.value AS value
          FROM json_each(
            CASE WHEN json_valid(posts.tagged_user_ids)
              THEN CASE WHEN json_type(posts.tagged_user_ids)='array' THEN posts.tagged_user_ids ELSE '[]' END
              ELSE '[]'
            END
          ) tag
          WHERE tag.type='text' AND tag.value<>OLD.id
          ORDER BY CAST(tag.key AS INTEGER)
        ) remaining
      ),'[]'),
      updated_at=MAX(
        COALESCE(updated_at,created_at)+1,
        CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)
      )
  WHERE user_id<>OLD.id
    AND id IN (SELECT post_id FROM post_user_tags WHERE user_id=OLD.id);
END;
`);

// Move legacy structured friend-tag JSON into the indexed relationship table
// exactly once. The post column remains synchronized by current writes so an
// older process in a rolling deploy can continue reading the established API
// shape. A single immediate transaction makes a crash either preserve the
// pre-migration state or publish the complete relation plus its durable marker.
const postUserTagBackfillMarker = "schema:post-user-tags:v1";
if (!db.prepare("SELECT 1 FROM app_meta WHERE key=?").get(postUserTagBackfillMarker)) {
  db.exec("BEGIN IMMEDIATE");
  try {
    if (!db.prepare("SELECT 1 FROM app_meta WHERE key=?").get(postUserTagBackfillMarker)) {
      const legacyTaggedPosts = db.prepare(`SELECT id,user_id,tagged_user_ids,created_at
        FROM posts WHERE tagged_user_ids IS NOT NULL AND tagged_user_ids<>'[]'`).all();
      const insertTag = db.prepare(`INSERT OR IGNORE INTO post_user_tags
        (post_id,user_id,author_id,position,created_at)
        SELECT ?,?,?,?,? WHERE EXISTS (SELECT 1 FROM users WHERE id=?)`);
      for (const post of legacyTaggedPosts) {
        const taggedUserIds = normalizeTaggedUserIds(parseJsonArray(post.tagged_user_ids)) || [];
        taggedUserIds.forEach((userId, position) => {
          insertTag.run(post.id, userId, post.user_id, position, post.created_at, userId);
        });
      }
      db.prepare("INSERT OR IGNORE INTO app_meta (key,value) VALUES (?,?)")
        .run(postUserTagBackfillMarker, String(Date.now()));
    }
    db.exec("COMMIT");
  } catch (error) {
    try { db.exec("ROLLBACK"); }
    catch { /* architecture: allow-empty-catch -- preserve the original migration failure if rollback itself fails */ }
    throw error;
  }
}

db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_posts_client_mutation ON posts(user_id, client_mutation_id) WHERE client_mutation_id IS NOT NULL");
db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_dms_client_mutation ON dms(from_id, client_mutation_id) WHERE client_mutation_id IS NOT NULL");
db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_fcm_client_mutation ON fan_club_messages(user_id, client_mutation_id) WHERE client_mutation_id IS NOT NULL");
db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_lounge_client_mutation ON lounge_messages(user_id, client_mutation_id) WHERE client_mutation_id IS NOT NULL");
// Backfill only a single exact normalized display-name match. Ambiguous and
// unmatched provider rows deliberately stay NULL for later review.
db.exec(`UPDATE tour_dates SET artist_key=lower(trim(artist))
  WHERE artist_key IS NULL AND EXISTS (
    SELECT 1 FROM artists a WHERE a.norm=lower(trim(tour_dates.artist))
  )`);
db.exec(`UPDATE tour_dates SET artist_key=(
  SELECT a.norm FROM artists a WHERE lower(trim(a.name))=lower(trim(tour_dates.artist))
) WHERE artist_key IS NULL AND trim(COALESCE(artist,''))<>'' AND 1=(
  SELECT COUNT(*) FROM artists a WHERE lower(trim(a.name))=lower(trim(tour_dates.artist))
)`);
db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_tourdates_owner_show ON tour_dates(owner_id, lower(artist), lower(venue), lower(place), date) WHERE owner_id IS NOT NULL");
db.exec("CREATE INDEX IF NOT EXISTS idx_tourdates_visibility ON tour_dates(release_at, date)");
db.exec(`CREATE INDEX IF NOT EXISTS idx_tourdates_sitemap_cursor
  ON tour_dates(date, id, release_at, provider_active)`);
db.exec("CREATE INDEX IF NOT EXISTS idx_tourdates_owner ON tour_dates(owner_id, date)");
db.exec("CREATE INDEX IF NOT EXISTS idx_tourdates_artist_date ON tour_dates(lower(artist), date, id)");
db.exec("CREATE INDEX IF NOT EXISTS idx_tourdates_artist_trim_date ON tour_dates(lower(trim(artist)), date, id)");
db.exec("CREATE INDEX IF NOT EXISTS idx_tourdates_artist_visibility ON tour_dates(artist_key, release_at, date, provider_active, id) WHERE artist_key IS NOT NULL");
db.exec(`CREATE INDEX IF NOT EXISTS idx_tourdates_structured_city_date
  ON tour_dates(venue_country_code, venue_city, release_at, date, provider_active, id)
  WHERE venue_country_code IS NOT NULL AND venue_city IS NOT NULL`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_tourdates_provider_identity
  ON tour_dates(source, provider_event_id)
  WHERE owner_id IS NULL AND provider_event_id IS NOT NULL`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_tourdates_provider_venue
  ON tour_dates(source, venue_provider_id, date)
  WHERE owner_id IS NULL AND venue_provider_id IS NOT NULL`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_tourdates_provider_venue_public_slug
  ON tour_dates(pit_venue_public_slug(source, venue_provider_id), updated_at DESC, id DESC)
  WHERE venue_provider_id IS NOT NULL AND trim(venue_provider_id)<>''`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_tourdates_venue_public_slug
  ON tour_dates(pit_public_slug(venue), updated_at DESC, id DESC)
  WHERE trim(COALESCE(venue,''))<>''`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_posts_venue_public_slug
  ON posts(pit_public_slug(venue), updated_at DESC, created_at DESC, id DESC)
  WHERE removed=0 AND trim(COALESCE(venue,''))<>''`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_tourdates_provider_visibility
  ON tour_dates(provider_active, date, id) WHERE owner_id IS NULL`);
db.exec("CREATE INDEX IF NOT EXISTS idx_going_cursor ON going(concert_key, created_at DESC, user_id DESC)");
db.exec("CREATE INDEX IF NOT EXISTS idx_going_lounge_identity ON going(lower(concert_key), user_id)");
db.exec("CREATE INDEX IF NOT EXISTS idx_follows_followee_follower ON follows(followee_id, follower_id)");
db.exec("CREATE INDEX IF NOT EXISTS idx_posts_landing_media ON posts(landing_showcase, photos_public, removed, kind, created_at DESC, id DESC)");
db.exec("CREATE INDEX IF NOT EXISTS idx_posts_venue_visibility ON posts(venue_key, removed, created_at DESC) WHERE venue_key IS NOT NULL");
// Artist profile Top Reviews scans only substantive, live review posts. Keep
// both canonical-key and legacy-name reads bounded without bloating the general
// feed indexes with rows this projection can never return.
db.exec(`CREATE INDEX IF NOT EXISTS idx_posts_artist_reviews
  ON posts(artist_key, created_at DESC, id)
  WHERE removed=0 AND COALESCE(kind,'review')='review' AND length(trim(review))>0`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_posts_artist_name_reviews
  ON posts(lower(artist), created_at DESC, id)
  WHERE removed=0 AND COALESCE(kind,'review')='review' AND length(trim(review))>0`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_posts_artist_archive
  ON posts(artist_key, date DESC, created_at DESC, id DESC)
  WHERE removed=0 AND COALESCE(kind,'review')='review'
    AND date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_posts_artist_name_archive
  ON posts(lower(artist), date DESC, created_at DESC, id DESC)
  WHERE removed=0 AND COALESCE(kind,'review')='review'
    AND date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'`);
db.exec("CREATE INDEX IF NOT EXISTS idx_dms_visible_cursor ON dms(from_id, to_id, removed, created_at DESC, id DESC)");
// The queue is drained by "next pending for this campaign" on every iteration,
// and the log is read newest-first, so both need their own covering order.
db.exec("CREATE INDEX IF NOT EXISTS idx_email_queue_campaign ON email_queue(campaign_id, status, id)");
db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_email_queue_recipient ON email_queue(campaign_id, to_email)");
db.exec("CREATE INDEX IF NOT EXISTS idx_email_log_created ON email_log(created_at DESC, id DESC)");
db.exec("CREATE INDEX IF NOT EXISTS idx_email_log_campaign ON email_log(campaign_id, created_at DESC)");
db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_unsub_token ON users(unsub_token) WHERE unsub_token IS NOT NULL");
db.exec("CREATE INDEX IF NOT EXISTS idx_users_email_verify_hash ON users(email_verify_hash) WHERE email_verify_hash IS NOT NULL");
db.exec("CREATE INDEX IF NOT EXISTS idx_artists_search_key ON artists(search_key)");
db.exec("CREATE INDEX IF NOT EXISTS idx_artists_name_nocase ON artists(name COLLATE NOCASE,rank_score DESC,norm)");

// These unsafe triggers existed only in an unreleased development build. An
// old UPSERT cannot reveal which colliding Unicode identity it intended, so
// mirroring UPDATE/DELETE is information-theoretically unsafe. Remove any local
// intermediate copy before applying the fail-closed reconciliation below.
for (const trigger of [
  "trg_track_override_legacy_insert",
  "trg_track_override_legacy_update",
  "trg_track_override_legacy_delete",
  "trg_track_override_legacy_insert_v2",
  "trg_track_override_legacy_update_v2",
  "trg_track_override_legacy_delete_v2",
]) db.exec(`DROP TRIGGER IF EXISTS ${trigger}`);

// Copy legacy ASCII/delimiter override identities to the Unicode-safe v2 key.
// Keep the old row for code rollback, but never overwrite an existing v2 row:
// a later legacy UPDATE may actually be a different Unicode song whose old key
// collided. This boot transaction and current admin writes are the only places
// that register provenance; playback GETs remain read-only.
db.exec("BEGIN IMMEDIATE");
try {
  const legacyOverrides = db.prepare("SELECT key,title,artist,video_id,set_by,updated_at FROM track_overrides WHERE key NOT LIKE 'track:v2:%'").all();
  const linkOverride = db.prepare(`INSERT INTO track_override_compat_links (legacy_key,current_key,title,artist)
    VALUES (?,?,?,?) ON CONFLICT(legacy_key,current_key) DO UPDATE SET
      title=excluded.title,artist=excluded.artist`);
  const copyOverride = db.prepare(`INSERT OR IGNORE INTO track_overrides
    (key,title,artist,video_id,set_by,updated_at) VALUES (?,?,?,?,?,?)`);
  for (const row of legacyOverrides) {
    const currentKey = trackOverrideIdentityKey(row.title, row.artist);
    linkOverride.run(row.key, currentKey, row.title, row.artist);
    copyOverride.run(currentKey, row.title, row.artist, row.video_id, row.set_by, row.updated_at);
  }
  const currentOverrides = db.prepare("SELECT key,title,artist FROM track_overrides WHERE key LIKE 'track:v2:%'").all();
  for (const row of currentOverrides) {
    linkOverride.run(legacyTrackOverrideIdentityKey(row.title, row.artist), row.key, row.title, row.artist);
  }
  db.exec("COMMIT");
} catch (error) {
  try { db.exec("ROLLBACK"); }
  catch { /* architecture: allow-empty-catch -- preserve the original track-identity migration failure */ }
  throw error;
}

if (db.prepare("SELECT 1 FROM artists WHERE search_key IS NULL OR search_key='' LIMIT 1").get()) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const artistSearchKeyRows = db.prepare("SELECT norm,name FROM artists WHERE search_key IS NULL OR search_key='' ").all();
    const setArtistSearchKey = db.prepare("UPDATE artists SET search_key=? WHERE norm=?");
    for (const row of artistSearchKeyRows) setArtistSearchKey.run(artistSearchKey(row.name), row.norm);
    db.exec("COMMIT");
  } catch (error) {
    try { db.exec("ROLLBACK"); }
    catch { /* architecture: allow-empty-catch -- preserve the original search-key migration failure */ }
    throw error;
  }
}

// Analytics never needs a network address once request-level rate limiting is
// complete. Purge the legacy raw-IP column once and keep new rows null.
const eventIpPurgeMarker = "privacy:events-ip-purged:v1";
if (!db.prepare("SELECT 1 FROM app_meta WHERE key=?").get(eventIpPurgeMarker)) {
  db.exec("BEGIN IMMEDIATE");
  try {
    if (!db.prepare("SELECT 1 FROM app_meta WHERE key=?").get(eventIpPurgeMarker)) {
      db.prepare("UPDATE events SET ip=NULL WHERE ip IS NOT NULL").run();
      db.prepare("INSERT OR IGNORE INTO app_meta (key,value) VALUES (?,?)").run(eventIpPurgeMarker, String(Date.now()));
    }
    db.exec("COMMIT");
  } catch (error) {
    try { db.exec("ROLLBACK"); }
    catch { /* architecture: allow-empty-catch -- preserve the original privacy migration failure */ }
    throw error;
  }
}

// Session IP/user-agent columns predate the privacy-minimized session model and
// are not used for authorization or device management. Erase historical values
// once; new session rows intentionally write empty strings in auth.js.
const sessionMetadataPurgeMarker = "privacy:sessions-metadata-purged:v1";
if (!db.prepare("SELECT 1 FROM app_meta WHERE key=?").get(sessionMetadataPurgeMarker)) {
  db.exec("BEGIN IMMEDIATE");
  try {
    if (!db.prepare("SELECT 1 FROM app_meta WHERE key=?").get(sessionMetadataPurgeMarker)) {
      db.prepare("UPDATE sessions SET ip='',ua='' WHERE COALESCE(ip,'')<>'' OR COALESCE(ua,'')<>''").run();
      db.prepare("INSERT OR IGNORE INTO app_meta (key,value) VALUES (?,?)").run(sessionMetadataPurgeMarker, String(Date.now()));
    }
    db.exec("COMMIT");
  } catch (error) {
    try { db.exec("ROLLBACK"); }
    catch { /* architecture: allow-empty-catch -- preserve the original privacy migration failure */ }
    throw error;
  }
}

// Accepting Terms was historically (and incorrectly) treated as announcement
// consent. No affirmative record exists for those accounts, so fail private:
// migrate them to opted out and require a signed-in Settings action to opt in.
const marketingConsentPurgeMarker = "privacy:affirmative-marketing-consent:v1";
if (!db.prepare("SELECT 1 FROM app_meta WHERE key=?").get(marketingConsentPurgeMarker)) {
  db.exec("BEGIN IMMEDIATE");
  try {
    if (!db.prepare("SELECT 1 FROM app_meta WHERE key=?").get(marketingConsentPurgeMarker)) {
      db.prepare("UPDATE users SET marketing_opt_out=1 WHERE marketing_consent_at IS NULL").run();
      db.prepare("INSERT OR IGNORE INTO app_meta (key,value) VALUES (?,?)").run(marketingConsentPurgeMarker, String(Date.now()));
    }
    db.exec("COMMIT");
  } catch (error) {
    try { db.exec("ROLLBACK"); }
    catch { /* architecture: allow-empty-catch -- preserve the original privacy migration failure */ }
    throw error;
  }
}

// v1 admitted navigation/search/music display strings. They cannot be made
// categorical after the fact, so delete those legacy rows once rather than
// retaining typed terms or artist/title/venue history under the stricter policy.
const eventPropsV2Marker = "privacy:events-props-v2:v1";
if (!db.prepare("SELECT 1 FROM app_meta WHERE key=?").get(eventPropsV2Marker)) {
  db.exec("BEGIN IMMEDIATE");
  try {
    if (!db.prepare("SELECT 1 FROM app_meta WHERE key=?").get(eventPropsV2Marker)) {
      db.prepare(`DELETE FROM events WHERE NOT json_valid(props) OR CASE WHEN json_valid(props) THEN (
        json_extract(props,'$.q') IS NOT NULL OR json_extract(props,'$.artist') IS NOT NULL OR
        json_extract(props,'$.title') IS NOT NULL OR json_extract(props,'$.venue') IS NOT NULL OR
        json_extract(props,'$.city') IS NOT NULL OR json_extract(props,'$.target') IS NOT NULL OR
        json_extract(props,'$.post') IS NOT NULL OR json_extract(props,'$.url') IS NOT NULL OR
        json_extract(props,'$.mediaUrl') IS NOT NULL OR json_extract(props,'$.message') IS NOT NULL OR
        json_extract(props,'$.review') IS NOT NULL) ELSE 0 END`).run();
      db.prepare("INSERT OR IGNORE INTO app_meta (key,value) VALUES (?,?)").run(eventPropsV2Marker, String(Date.now()));
    }
    db.exec("COMMIT");
  } catch (error) {
    try { db.exec("ROLLBACK"); }
    catch { /* architecture: allow-empty-catch -- preserve the original event-policy migration failure */ }
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
  db.exec("BEGIN IMMEDIATE");
  try {
    if (!db.prepare("SELECT 1 FROM app_meta WHERE key=?").get(isoDateMigration)) {
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

      db.prepare("INSERT OR IGNORE INTO app_meta (key,value) VALUES (?,?)").run(isoDateMigration, String(Date.now()));
    }
    db.exec("COMMIT");
  } catch (error) {
    try { db.exec("ROLLBACK"); }
    catch { /* architecture: allow-empty-catch -- preserve the original date migration failure */ }
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
  record: db.prepare(`INSERT INTO error_events (fingerprint,level,code,status,method,route,cause,last_request_id,count,first_seen,last_seen)
    VALUES (@fingerprint,@level,@code,@status,@method,@route,@cause,@requestId,1,@at,@at)
    ON CONFLICT(fingerprint) DO UPDATE SET count=count+1, last_seen=excluded.last_seen,
      last_request_id=COALESCE(excluded.last_request_id,error_events.last_request_id)`),
  recent: db.prepare("SELECT * FROM error_events ORDER BY last_seen DESC LIMIT ?"),
  recordBucket: db.prepare(`INSERT INTO error_occurrence_buckets (fingerprint,hour_start,count)
    VALUES (?,?,1) ON CONFLICT(fingerprint,hour_start) DO UPDATE SET count=count+1`),
  since: db.prepare(`SELECT e.fingerprint,e.level,e.code,e.status,e.method,e.route,e.cause,
      e.last_request_id,e.first_seen,e.last_seen,SUM(b.count) count
    FROM error_occurrence_buckets b JOIN error_events e ON e.fingerprint=b.fingerprint
    WHERE b.hour_start>=? GROUP BY e.fingerprint
    ORDER BY count DESC,e.last_seen DESC LIMIT ?`),
  totalSince: db.prepare(`SELECT COALESCE(SUM(count),0) c,COUNT(DISTINCT fingerprint) kinds
    FROM error_occurrence_buckets WHERE hour_start>=?`),
  // Anything not seen recently is noise once it stops happening. Pruning by age
  // keeps the table bounded without a background job.
  prune: db.prepare("DELETE FROM error_events WHERE last_seen < ?"),
  pruneBuckets: db.prepare("DELETE FROM error_occurrence_buckets WHERE hour_start < ?"),
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
  verificationReceiptByHash: db.prepare("SELECT * FROM email_verification_receipts WHERE token_hash=? AND expires_at>?"),
  recordVerificationReceipt: db.prepare(`INSERT INTO email_verification_receipts
    (token_hash,user_id,email_hash,verified_at,expires_at) VALUES (?,?,?,?,?)
    ON CONFLICT(token_hash) DO NOTHING`),
  pruneVerificationReceipts: db.prepare("DELETE FROM email_verification_receipts WHERE expires_at<=?"),
  markWelcomeSent: db.prepare("UPDATE users SET welcome_sent_at=? WHERE id=? AND welcome_sent_at=0"),

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
    content_revision=CASE WHEN name IS NOT @name OR subject IS NOT @subject OR body IS NOT @body
      OR cta_label IS NOT @cta_label OR cta_url IS NOT @cta_url OR audience IS NOT @audience
      THEN content_revision+1 ELSE content_revision END,
    test_sent_at=CASE WHEN name IS NOT @name OR subject IS NOT @subject OR body IS NOT @body
      OR cta_label IS NOT @cta_label OR cta_url IS NOT @cta_url OR audience IS NOT @audience
      THEN NULL ELSE test_sent_at END,
    tested_revision=CASE WHEN name IS NOT @name OR subject IS NOT @subject OR body IS NOT @body
      OR cta_label IS NOT @cta_label OR cta_url IS NOT @cta_url OR audience IS NOT @audience
      THEN NULL ELSE tested_revision END,
    cta_label=@cta_label,cta_url=@cta_url,audience=@audience,updated_at=@updated_at
    WHERE id=@id AND status='draft' AND content_revision=@expected_revision`),
  setCampaignStatus: db.prepare("UPDATE email_campaigns SET status=?, updated_at=? WHERE id=?"),
  pauseCampaign: db.prepare("UPDATE email_campaigns SET status='paused',updated_at=? WHERE id=? AND status='sending'"),
  markCampaignTested: db.prepare(`UPDATE email_campaigns
    SET test_sent_at=@tested_at,tested_revision=@revision,updated_at=@tested_at
    WHERE id=@id AND status='draft' AND content_revision=@revision`),
  startCampaign: db.prepare(`UPDATE email_campaigns SET status='sending',started_at=@started_at,total=@total,updated_at=@started_at
    WHERE id=@id AND status IN ('draft','paused') AND content_revision=@revision
      AND (@require_current_test=0 OR (test_sent_at IS NOT NULL AND tested_revision=content_revision))`),
  finishCampaign: db.prepare("UPDATE email_campaigns SET status=?,finished_at=?,updated_at=? WHERE id=? AND status='sending'"),
  bumpCampaignCounts: db.prepare(`UPDATE email_campaigns SET
    sent_count=(SELECT COUNT(*) FROM email_queue WHERE campaign_id=@id AND status='sent'),
    failed_count=(SELECT COUNT(*) FROM email_queue WHERE campaign_id=@id AND status='failed'),
    skipped_count=(SELECT COUNT(*) FROM email_queue WHERE campaign_id=@id AND status='skipped'),
    updated_at=@updated_at WHERE id=@id`),

  enqueue: db.prepare(`INSERT OR IGNORE INTO email_queue (campaign_id,user_id,to_email,status,created_at)
    VALUES (?,?,?,'pending',?)`),
  nextPending: db.prepare("SELECT * FROM email_queue WHERE campaign_id=? AND status='pending' ORDER BY id LIMIT 1"),
  countPending: db.prepare("SELECT COUNT(*) c FROM email_queue WHERE campaign_id=? AND status='pending'"),
  countOpen: db.prepare("SELECT COUNT(*) c FROM email_queue WHERE campaign_id=? AND status IN ('pending','sending')"),
  countQueued: db.prepare("SELECT COUNT(*) c FROM email_queue WHERE campaign_id=?"),
  claimQueueRow: db.prepare(`UPDATE email_queue
    SET status='sending',attempts=attempts+1,claimed_at=@claimed_at,claim_token=@claim_token,last_error=NULL
    WHERE id=(SELECT queue.id FROM email_queue queue JOIN email_campaigns campaign ON campaign.id=queue.campaign_id
      WHERE queue.campaign_id=@campaign_id AND queue.status='pending' AND campaign.status='sending'
      ORDER BY queue.id LIMIT 1)
      AND status='pending'
    RETURNING *`),
  settleQueueRow: db.prepare(`UPDATE email_queue
    SET status=@status,last_error=@last_error,sent_at=@sent_at,claimed_at=NULL,claim_token=NULL
    WHERE id=@id AND status='sending' AND claim_token=@claim_token`),
  clearQueue: db.prepare("DELETE FROM email_queue WHERE campaign_id=?"),

  insertLog: db.prepare(`INSERT INTO email_log (created_at,kind,template_key,campaign_id,user_id,to_email,subject,status,reason)
    VALUES (@created_at,@kind,@template_key,@campaign_id,@user_id,@to_email,@subject,@status,@reason)`),
  countSentSince: db.prepare("SELECT COUNT(*) c FROM email_log WHERE status='sent' AND created_at >= ?"),
  logStats: db.prepare(`SELECT status, COUNT(*) c FROM email_log WHERE created_at >= ? GROUP BY status`),

  userUnsubToken: db.prepare("SELECT unsub_token FROM users WHERE id = ?"),
  setUnsubToken: db.prepare("UPDATE users SET unsub_token=? WHERE id=?"),
  userByUnsubToken: db.prepare("SELECT * FROM users WHERE unsub_token = ?"),
  setMarketingPreference: db.prepare(`UPDATE users SET
    marketing_opt_out=@opt_out,
    marketing_consent_at=CASE WHEN @opt_out=0 THEN @at ELSE marketing_consent_at END,
    marketing_consent_version=CASE WHEN @opt_out=0 THEN @version ELSE marketing_consent_version END,
    marketing_consent_source=@source,
    marketing_withdrawn_at=CASE WHEN @opt_out=1 THEN @at ELSE NULL END
    WHERE id=@id`),
};

// YouTube video-ID cache statements. Positive entries are periodically
// revalidated and known-bad iframe IDs are retained as exclusions so the next
// lookup does not select the same unavailable/karaoke result again.
export const ytStmts = {
  get: db.prepare("SELECT key,video_id,updated_at,metadata,score,expires_at,rejected_ids FROM yt_cache WHERE key = ?"),
  delete: db.prepare("DELETE FROM yt_cache WHERE key = ?"),
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
const ARTIST_COLS = "norm,name,public_slug,search_key,genre,photo,bio,mbid,spotify_id,country,formed,popularity,rank_score,data,source,created_at,updated_at";
export const MISSING_ARTIST_RETENTION_DAYS = 30;
export const MISSING_ARTIST_MAX_ROWS = 5000;
export const artistStmts = {
  byNorm: db.prepare("SELECT * FROM artists WHERE norm = ?"),
  byPublicSlug: db.prepare(`SELECT * FROM artists
    WHERE public_slug IS NOT NULL AND public_slug<>'' AND lower(public_slug)=lower(?)`),
  count: db.prepare("SELECT COUNT(*) c FROM artists"),
  // Most type-ahead searches begin at the artist's first character. Let both
  // canonical names and punctuation-folded names use their indexes for that
  // common path; the API falls back to the bounded substring query only when
  // neither prefix has a hit (for searches such as a surname).
  searchPrefix: db.prepare(`SELECT * FROM artists
    WHERE (norm >= ? AND norm < ?) OR (search_key >= ? AND search_key < ?)
    ORDER BY (norm = ?) DESC, (search_key = ?) DESC, rank_score DESC, name LIMIT ?`),
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
  pruneMissingBefore: db.prepare("DELETE FROM missing_artists WHERE last_at < ?"),
  trimMissingAfter: db.prepare(`DELETE FROM missing_artists WHERE norm IN (
    SELECT norm FROM missing_artists ORDER BY last_at DESC,norm DESC LIMIT -1 OFFSET ?
  )`),
  upsert: db.prepare(`INSERT INTO artists (${ARTIST_COLS})
    VALUES (@norm,@name,@public_slug,@search_key,@genre,@photo,@bio,@mbid,@spotify_id,@country,@formed,@popularity,@rank_score,@data,@source,@created_at,@updated_at)
    ON CONFLICT(norm) DO UPDATE SET
      name=excluded.name,
      public_slug=COALESCE(artists.public_slug,excluded.public_slug),
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

// Failed artist lookups are user-supplied search text, not permanent catalog
// evidence. Keep only a short, bounded admin enrichment queue. This function is
// run at boot, hourly, after a miss, and before staff read the queue.
export function pruneMissingArtists(at = Date.now(), {
  retentionDays = MISSING_ARTIST_RETENTION_DAYS,
  maxRows = MISSING_ARTIST_MAX_ROWS,
} = {}) {
  const clock = Number.isFinite(Number(at)) ? Number(at) : Date.now();
  const days = Math.max(1, Math.min(365, Math.floor(Number(retentionDays) || MISSING_ARTIST_RETENTION_DAYS)));
  const ceiling = Math.max(1, Math.min(MISSING_ARTIST_MAX_ROWS, Math.floor(Number(maxRows) || MISSING_ARTIST_MAX_ROWS)));
  const expired = Number(artistStmts.pruneMissingBefore.run(clock - days * 24 * 60 * 60 * 1000).changes || 0);
  const overflow = Number(artistStmts.trimMissingAfter.run(ceiling).changes || 0);
  return { expired, overflow };
}

pruneMissingArtists();

export const normName = (s) => (s || "").trim().toLowerCase();

const artistPublicSlugByNorm = db.prepare("SELECT public_slug FROM artists WHERE norm=?");
const artistPublicSlugOwner = db.prepare(`SELECT norm FROM artists
  WHERE public_slug IS NOT NULL AND public_slug<>'' AND lower(public_slug)=lower(?) LIMIT 1`);

function artistPublicSlugForWrite(norm, name) {
  const existing = String(artistPublicSlugByNorm.get(norm)?.public_slug || "").trim();
  if (existing) return existing;
  const candidate = artistSlugCandidates(name, norm).find((value) => {
    const owner = artistPublicSlugOwner.get(value)?.norm;
    return !owner || owner === norm;
  });
  if (!candidate) throw new Error(`Could not allocate artist public slug for ${norm}`);
  return candidate;
}

// Build a row from an artist object (bundled shape or a resolved MB/Spotify one).
export function artistRow(key, a, source = "musicbrainz") {
  const now = Date.now();
  const norm = normName(key || a.name);
  const name = a.name || key;
  const rank = (a.popularity != null ? a.popularity * 1000 : 0) + (a.albums?.length || 0) * 10 + ((a.topTracks?.length || 0) ? 5 : 0);
  return {
    norm,
    name,
    public_slug: artistPublicSlugForWrite(norm, name),
    search_key: artistSearchKey(name),
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
  const projectedGenre = projectArtistGenre(data, r.genre);
  return {
    // `key` is the catalog's stable identity. The composer sends it back when a
    // suggestion is picked, so a review binds to this artist rather than to
    // whatever string was typed.
    ...data, key: r.norm, name: r.name, publicSlug: r.public_slug || null,
    photo: r.photo, bio: r.bio, mbid: r.mbid, spotifyId: r.spotify_id,
    formed: r.formed || null,
    country: r.country, popularity: r.popularity,
    genre: projectedGenre.genre,
    genreHint: projectedGenre.genreHint,
    genreSource: projectedGenre.genreSource,
    genreConfidence: projectedGenre.genreConfidence,
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
    try { db.exec("ROLLBACK"); }
    catch { /* architecture: allow-empty-catch -- optional seed failure remains the primary diagnostic */ }
    console.warn(`[db] artist seed skipped cause=${privateErrorLabel(e)}`);
  }
}
seedArtistsFromBundle();

// One-time cleanup for rows written by the old enrichment job. A marker avoids
// reparsing the full catalogue on every boot; new writes no longer persist these
// links, so the migration remains complete after it runs once.
export function sanitizeStoredArtistPreviews() {
  const marker = "strip-ephemeral-artist-previews-v1";
  if (db.prepare("SELECT 1 FROM app_meta WHERE key=?").get(marker)) return 0;
  let changed = 0;
  // Test workers and multiple Render processes can open the same SQLite file at
  // once. The optimistic check above is only a fast path; acquire the write lock
  // and recheck inside it before touching rows. Without that second check two
  // booters can both observe a missing marker and the loser crashes on the
  // unique app_meta key after the winner commits.
  db.exec("BEGIN IMMEDIATE");
  try {
    if (db.prepare("SELECT 1 FROM app_meta WHERE key=?").get(marker)) {
      db.exec("COMMIT");
      return 0;
    }
    const rows = db.prepare(`SELECT norm,data FROM artists WHERE data LIKE '%"preview"%'`).all();
    const update = db.prepare("UPDATE artists SET data=? WHERE norm=?");
    for (const row of rows) {
      let parsed;
      try { parsed = JSON.parse(row.data || "{}"); } catch { continue; }
      const cleaned = JSON.stringify(stripEphemeralPreviews(parsed));
      if (cleaned !== row.data) { update.run(cleaned, row.norm); changed++; }
    }
    db.prepare("INSERT OR IGNORE INTO app_meta (key,value) VALUES (?,?)").run(marker, String(Date.now()));
    db.exec("COMMIT");
  } catch (error) {
    try { db.exec("ROLLBACK"); }
    catch { /* architecture: allow-empty-catch -- preserve the original preview-retention failure */ }
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
  const extras = canonicalProfileExtras(parseJsonObject(u.extras)).value;
  for (const key of Object.keys(u)) delete extras[key];
  for (const key of [
    "id", "email", "name", "handle", "role", "verified", "sponsor",
    "artistName", "home", "bio", "avatarUri", "avatarColor", "banner",
    "initials", "genres", "favoriteArtists",
  ]) delete extras[key];
  if (extras.nowPlaying && (!contentSafetyDecision(extras.nowPlaying.title).safe || !contentSafetyDecision(extras.nowPlaying.artist).safe)) {
    delete extras.nowPlaying;
  }
  const publicExtraKeys = MUSIC_PLAYER_ENABLED ? ["theme", "nowPlaying"] : ["theme"];
  const selfExtraKeys = [
    "consentAt", "analyticsConsentAt", "termsAcceptedAt", "termsVersion",
    "analyticsOptOut", "searchIndexingOptOut",
    ...(MUSIC_PLAYER_ENABLED ? ["treble", "bass", "playlists"] : []),
  ];
  const publicExtras = Object.fromEntries(publicExtraKeys.filter((key) => extras[key] !== undefined).map((key) => [key, extras[key]]));
  const selfExtras = self
    ? Object.fromEntries(selfExtraKeys.filter((key) => extras[key] !== undefined).map((key) => [key, extras[key]]))
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
    home: u.home_city ? {
      city: u.home_city,
      ...(self ? { lat: u.home_lat, lng: u.home_lng } : {}),
    } : null,
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
    ...(self ? {
      email: u.email,
      emailVerified: !!u.email_verified_at,
      marketingOptOut: !!u.marketing_opt_out || !u.marketing_consent_at,
      marketingConsentAt: u.marketing_consent_at || null,
      isBanned: !!u.is_banned,
      suspendedUntil: u.suspended_until || null,
    } : {}),
  };
}
