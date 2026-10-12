-- Core tables exported from the e23c65e application schema before artist-access retention.
-- Static schema only; no real account or production data.
PRAGMA application_id=1346982961;
CREATE TABLE schema_version (version INTEGER NOT NULL);

CREATE TABLE "users" (
  id              TEXT PRIMARY KEY,
  email TEXT NOT NULL,
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
  age_band        TEXT NOT NULL DEFAULT 'unknown' CHECK (age_band IN ('13_17','18_plus','unknown')),
  dm_policy       TEXT NOT NULL DEFAULT 'mutuals' CHECK (dm_policy IN ('nobody','people_i_follow','mutuals')),
  profile_audience TEXT NOT NULL DEFAULT 'everyone' CHECK (profile_audience IN ('everyone','members','only_me')),
  -- Only accounts explicitly created by signup receive a numeric onboarding
  -- version. Historical and staff-created rows remain NULL and exempt.
  onboarding_version INTEGER CHECK (onboarding_version IS NULL OR onboarding_version BETWEEN 0 AND 1000),
  created_at      INTEGER NOT NULL
, verified INTEGER NOT NULL DEFAULT 0, spotify_access_token TEXT, spotify_refresh_token TEXT, spotify_expires_at INTEGER NOT NULL DEFAULT 0, sponsor INTEGER NOT NULL DEFAULT 0, reset_hash TEXT, reset_expires INTEGER NOT NULL DEFAULT 0, marketing_opt_out INTEGER NOT NULL DEFAULT 1, marketing_consent_at INTEGER, marketing_consent_version TEXT, marketing_consent_source TEXT, marketing_withdrawn_at INTEGER, unsub_token TEXT, email_verified_at INTEGER NOT NULL DEFAULT 0, email_verify_hash TEXT, email_verify_expires INTEGER NOT NULL DEFAULT 0, welcome_sent_at INTEGER NOT NULL DEFAULT 0, signup_cancel_hash TEXT, last_active_at INTEGER, dormant_at INTEGER, inactivity_warning_sent_at INTEGER, inactivity_warning_activity_at INTEGER, inactivity_warning_receipt TEXT, inactivity_warning_attempted_at INTEGER, inactivity_next_check_at INTEGER);

CREATE TABLE posts (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  artist        TEXT NOT NULL,
  venue         TEXT NOT NULL,
  city          TEXT NOT NULL DEFAULT '',
  event_address TEXT CHECK (event_address IS NULL OR length(event_address) <= 240),
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
  experience_type TEXT NOT NULL DEFAULT 'in_person' CHECK (experience_type IN ('in_person','online')),
  online_title  TEXT CHECK (online_title IS NULL OR length(online_title) <= 160),
  youtube_url   TEXT CHECK (youtube_url IS NULL OR length(youtube_url) <= 200),
  youtube_video_id TEXT CHECK (youtube_video_id IS NULL OR length(youtube_video_id) = 11),
  tagged_user_ids TEXT NOT NULL DEFAULT '[]',
  setlist       TEXT NOT NULL DEFAULT '[]',
  supporting_acts TEXT NOT NULL DEFAULT '[]',
  show_format   TEXT NOT NULL DEFAULT 'headline' CHECK (show_format IN ('headline','co_headline','festival')),
  end_date      TEXT NOT NULL DEFAULT '',
  client_mutation_id TEXT,
  client_mutation_hash TEXT,
  removed       INTEGER NOT NULL DEFAULT 0,
  updated_at    INTEGER,
  created_at    INTEGER NOT NULL
, tour TEXT, tags TEXT NOT NULL DEFAULT '[]', kind TEXT NOT NULL DEFAULT 'review', song TEXT, playlist TEXT, artist_key TEXT, artist_mbid TEXT, venue_key TEXT);

CREATE TABLE artist_posts (
  id         TEXT PRIMARY KEY,
  artist_key TEXT NOT NULL,
  user_id    TEXT REFERENCES users(id) ON DELETE SET NULL,
  text       TEXT NOT NULL,
  removed    INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE artist_profiles (
  artist_key   TEXT PRIMARY KEY,
  bio          TEXT,
  bio_staff_curated INTEGER NOT NULL DEFAULT 0,
  banner       TEXT,
  banner_owner_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  avatar_uri   TEXT,
  avatar_owner_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  feed_enabled INTEGER NOT NULL DEFAULT 0,
  owner_id     TEXT REFERENCES users(id) ON DELETE SET NULL,
  removed      INTEGER NOT NULL DEFAULT 0,
  updated_at   INTEGER
, identity_review_status TEXT NOT NULL DEFAULT 'clear', identity_review_json TEXT NOT NULL DEFAULT '{}', identity_review_reason TEXT, identity_reviewed_at INTEGER, identity_reviewed_by TEXT, identity_review_evidence_url TEXT);

CREATE TABLE artists (
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
, searches INTEGER NOT NULL DEFAULT 0, youtube_channel_id TEXT, youtube_channel_at INTEGER NOT NULL DEFAULT 0, youtube_channel_source TEXT);

CREATE TABLE tour_dates (
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
, provider_artist_id TEXT, artist_identity_status TEXT
    CHECK(artist_identity_status IS NULL OR artist_identity_status IN ('registered','pending','conflict')));
INSERT INTO schema_version VALUES (1);
