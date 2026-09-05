import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { createArtistRecommendationService } from "./artistRecommendationService.js";

function database() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY,name TEXT,handle TEXT,role TEXT DEFAULT 'fan',verified INTEGER DEFAULT 0,
      avatar_uri TEXT,avatar_color TEXT,initials TEXT,profile_updated_at INTEGER DEFAULT 0,
      home_city TEXT,genres TEXT DEFAULT '[]',favorite_artists TEXT DEFAULT '[]',
      is_banned INTEGER DEFAULT 0,suspended_until INTEGER
    );
    CREATE TABLE artists (
      norm TEXT PRIMARY KEY,name TEXT,public_slug TEXT,photo TEXT,country TEXT,popularity INTEGER,
      rank_score INTEGER DEFAULT 0,genre TEXT,mbid TEXT,data TEXT DEFAULT '{}'
    );
    CREATE TABLE artist_memorials (artist_key TEXT,status TEXT,artist_mbid TEXT);
    CREATE TABLE fan_club_members (artist TEXT,user_id TEXT);
    CREATE TABLE posts (
      id TEXT PRIMARY KEY,user_id TEXT,artist_key TEXT,artist TEXT,overall REAL,removed INTEGER DEFAULT 0,
      kind TEXT DEFAULT 'review',experience_type TEXT DEFAULT 'in_person',created_at INTEGER
    );
    CREATE TABLE likes (post_id TEXT,user_id TEXT);
    CREATE INDEX idx_likes_user_post ON likes(user_id,post_id);
    CREATE TABLE comments (id TEXT,post_id TEXT,user_id TEXT,removed INTEGER DEFAULT 0,created_at INTEGER);
    CREATE INDEX idx_comments_user_recent ON comments(user_id,removed,created_at DESC,post_id);
    CREATE TABLE follows (follower_id TEXT,followee_id TEXT,PRIMARY KEY(follower_id,followee_id));
    CREATE TABLE blocks (blocker_id TEXT,blocked_id TEXT,PRIMARY KEY(blocker_id,blocked_id));
    CREATE TABLE shows (id TEXT PRIMARY KEY,artist TEXT,artist_key TEXT);
    CREATE TABLE show_attendance (
      show_id TEXT,user_id TEXT,state TEXT,legacy_artist TEXT DEFAULT '',legacy_artist_key TEXT,
      updated_at INTEGER,PRIMARY KEY(show_id,user_id)
    );
    CREATE INDEX idx_show_attendance_user_updated ON show_attendance(user_id,updated_at DESC,show_id);
    CREATE TABLE tour_dates (
      id TEXT PRIMARY KEY,artist_key TEXT,artist TEXT,release_at INTEGER DEFAULT 0,music_qualified INTEGER DEFAULT 1,
      owner_id TEXT,provider_active INTEGER DEFAULT 1,date TEXT,event_end_date TEXT,event_status TEXT,
      start_date_time TEXT,start_local_time TEXT,event_name TEXT,tour_name TEXT,venue TEXT,venue_city TEXT,
      place TEXT,venue_country TEXT,event_kind TEXT NOT NULL DEFAULT 'concert',
      music_evidence TEXT,billed_artists TEXT NOT NULL DEFAULT '[]'
    );
    CREATE TABLE media_assets (
      id TEXT,owner_id TEXT,source_key TEXT,render_variant_id TEXT,kind TEXT,status TEXT,
      source_verified_at INTEGER,metadata_status TEXT,codec_status TEXT,render_state TEXT
    );
    CREATE TABLE media_objects (owner_id TEXT,object_key TEXT,storage_scope TEXT,status TEXT);
    CREATE TABLE media_variants (
      id TEXT,asset_id TEXT,role TEXT,status TEXT,verification_origin TEXT,object_key TEXT,public_url TEXT
    );
  `);
  return db;
}

const genreData = (genre) => JSON.stringify({ genreClaims: [{ value: genre, source: "staff", at: 1 }] });

function insertUser(db, { id, genres = [], favorites = [], banned = 0 }) {
  db.prepare(`INSERT INTO users
    (id,name,handle,role,verified,avatar_uri,avatar_color,initials,profile_updated_at,home_city,genres,favorite_artists,is_banned,suspended_until)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,NULL)`).run(
    id, id, id, "fan", 0, `https://images.example/${id}.jpg`, "#fff", id.slice(0, 1), 1,
    "Toronto", JSON.stringify(genres), JSON.stringify(favorites), banned,
  );
}

function insertArtist(db, { key, name, genre = "Indie", rank = 100, photo = null, mbid = null }) {
  db.prepare(`INSERT INTO artists
    (norm,name,public_slug,photo,country,popularity,rank_score,genre,mbid,data)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
    key, name, `${key}-slug`, photo || `https://images.example/${key}.jpg`, "Canada", rank, rank, genre, mbid, genreData(genre),
  );
}

function insertSafeAvatar(db, userId) {
  const assetId = `${userId}-avatar`;
  const sourceKey = `${userId}/avatar-source`;
  const renderKey = `${userId}/avatar-render`;
  const variantId = `${userId}-avatar-render`;
  const publicUrl = `https://images.example/${userId}.jpg`;
  db.prepare("INSERT INTO media_objects VALUES (?,?,?,?)").run(userId, sourceKey, "private", "associated");
  db.prepare("INSERT INTO media_objects VALUES (?,?,?,?)").run(userId, renderKey, "public", "associated");
  db.prepare("INSERT INTO media_assets VALUES (?,?,?,?,?,?,?,?,?,?)").run(
    assetId, userId, sourceKey, variantId, "image", "ready", 1, "declared", "not_applicable", "ready",
  );
  db.prepare("INSERT INTO media_variants VALUES (?,?,?,?,?,?,?)").run(
    variantId, assetId, "render", "verified", "private_derivative_v1", renderKey, publicUrl,
  );
}

test("artist recommendations use real taste signals, public upcoming dates, and block-safe social proof", () => {
  const db = database();
  try {
    insertUser(db, { id: "me", genres: ["Indie"], favorites: ["Anchor"] });
    insertUser(db, { id: "friend" });
    insertUser(db, { id: "blocked" });
    insertSafeAvatar(db, "friend");
    insertSafeAvatar(db, "blocked");
    insertArtist(db, { key: "anchor", name: "Anchor", rank: 80 });
    insertArtist(db, { key: "candidate", name: "Candidate", rank: 500 });
    insertArtist(db, { key: "memorial", name: "Memorial", rank: 600, mbid: "dead-id" });
    db.prepare("INSERT INTO artist_memorials VALUES (?,?,?)").run("memorial", "published", "dead-id");

    db.prepare("INSERT INTO posts VALUES (?,?,?,?,?,?,?,?,?)")
      .run("mine", "me", "anchor", "Anchor", 5, 0, "review", "in_person", 10);
    db.prepare("INSERT INTO follows VALUES (?,?)").run("me", "friend");
    db.prepare("INSERT INTO follows VALUES (?,?)").run("friend", "me");
    db.prepare("INSERT INTO follows VALUES (?,?)").run("me", "blocked");
    db.prepare("INSERT INTO blocks VALUES (?,?)").run("me", "blocked");
    db.prepare("INSERT INTO posts VALUES (?,?,?,?,?,?,?,?,?)")
      .run("friend-review", "friend", "candidate", "Candidate", 4.5, 0, "review", "in_person", 20);
    db.prepare("INSERT INTO posts VALUES (?,?,?,?,?,?,?,?,?)")
      .run("blocked-review", "blocked", "candidate", "Candidate", 5, 0, "review", "in_person", 21);
    db.prepare("INSERT INTO posts VALUES (?,?,?,?,?,?,?,?,?)")
      .run("online-review", "friend", "candidate", "Candidate", 1, 0, "review", "online", 22);

    db.prepare(`INSERT INTO tour_dates
      (id,artist_key,artist,release_at,music_qualified,owner_id,provider_active,date,event_status,start_local_time,venue,venue_city,venue_country)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      "bad-date", "candidate", "Candidate", 0, 1, null, 1, "2030-02-31", "onsale", "19:00", "Bad", "Nowhere", "Canada",
    );
    db.prepare(`INSERT INTO tour_dates
      (id,artist_key,artist,release_at,music_qualified,owner_id,provider_active,date,event_status,start_local_time,venue,venue_city,venue_country)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      "next-date", "candidate", "Candidate", 0, 1, null, 1, "2030-04-20", "onsale", "20:00", "History", "Toronto", "Canada",
    );

    const service = createArtistRecommendationService(db);
    const result = service.list(db.prepare("SELECT * FROM users WHERE id='me'").get(), {
      limit: 6,
      at: Date.parse("2030-01-01T12:00:00Z"),
    });
    assert.equal(result.personalized, true);
    assert.equal(result.recommendations.length, 1);
    const recommendation = result.recommendations[0];
    assert.equal(recommendation.artist.key, "candidate");
    assert.equal(recommendation.reason.code, "rated");
    assert.match(recommendation.reason.label, /rated Anchor 5\.0/);
    assert.equal(recommendation.liveRating, 4.5, "online and blocked reviews cannot alter the visible live rating");
    assert.equal(recommendation.reviewCount, 1);
    assert.equal(recommendation.nextDate.id, "next-date");
    assert.equal(recommendation.socialProof.count, 1);
    assert.equal(recommendation.socialProof.friendCount, 1);
    assert.equal(recommendation.socialProof.people[0].id, "friend");
    assert.equal(recommendation.socialProof.people[0].avatarUri, "https://images.example/friend.jpg");
    assert.doesNotMatch(JSON.stringify(result), /blocked/);
    assert.doesNotMatch(JSON.stringify(result), /memorial/);
  } finally {
    db.close();
  }
});

test("artist recommendations stay empty rather than fabricate personalization without taste history", () => {
  const db = database();
  try {
    insertUser(db, { id: "me" });
    insertArtist(db, { key: "candidate", name: "Candidate", rank: 500 });
    const service = createArtistRecommendationService(db);
    assert.deepEqual(service.list(db.prepare("SELECT * FROM users WHERE id='me'").get()), {
      recommendations: [],
      personalized: false,
      signalCount: 0,
    });
  } finally {
    db.close();
  }
});
