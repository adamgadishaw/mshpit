import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { createMessageRelationshipContextService } from "./messageRelationshipContext.js";

function fixture() {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      role TEXT NOT NULL DEFAULT 'fan',
      is_banned INTEGER NOT NULL DEFAULT 0,
      suspended_until INTEGER,
      email_verified_at INTEGER
    );
    CREATE TABLE follows (
      follower_id TEXT NOT NULL,
      followee_id TEXT NOT NULL,
      PRIMARY KEY (follower_id,followee_id)
    );
    CREATE TABLE blocks (
      blocker_id TEXT NOT NULL,
      blocked_id TEXT NOT NULL,
      PRIMARY KEY (blocker_id,blocked_id)
    );
    CREATE TABLE posts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      artist TEXT NOT NULL DEFAULT '',
      artist_key TEXT,
      venue TEXT NOT NULL DEFAULT '',
      venue_key TEXT,
      city TEXT NOT NULL DEFAULT '',
      date TEXT NOT NULL DEFAULT '',
      kind TEXT NOT NULL DEFAULT 'review',
      experience_type TEXT NOT NULL DEFAULT 'in_person',
      removed INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE post_user_tags (
      post_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      author_id TEXT NOT NULL,
      PRIMARY KEY (post_id,user_id)
    );
    CREATE TABLE shows (
      id TEXT PRIMARY KEY,
      artist TEXT NOT NULL DEFAULT '',
      venue TEXT NOT NULL DEFAULT '',
      city TEXT NOT NULL DEFAULT '',
      date TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE show_attendance (
      show_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      state TEXT NOT NULL,
      visibility TEXT NOT NULL DEFAULT 'members',
      legacy_artist TEXT NOT NULL DEFAULT '',
      legacy_venue TEXT NOT NULL DEFAULT '',
      legacy_city TEXT NOT NULL DEFAULT '',
      legacy_date TEXT NOT NULL DEFAULT '',
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (show_id,user_id)
    );
  `);
  return database;
}

function user(database, id, { role = "fan", verified = true, banned = false, suspendedUntil = null } = {}) {
  database.prepare("INSERT INTO users VALUES (?,?,?,?,?)")
    .run(id, role, banned ? 1 : 0, suspendedUntil, verified ? 1 : null);
}

function follow(database, followerId, followeeId) {
  database.prepare("INSERT INTO follows VALUES (?,?)").run(followerId, followeeId);
}

function show(database, {
  id, artist = "J. Cole", venue = "Scotiabank Arena", city = "Toronto", date = "2026-07-27",
}) {
  database.prepare("INSERT INTO shows VALUES (?,?,?,?,?)").run(id, artist, venue, city, date);
}

function attendance(database, {
  showId, userId, visibility = "members", state = "went", updatedAt = 1,
  artist = "", venue = "", city = "", date = "",
}) {
  database.prepare("INSERT INTO show_attendance VALUES (?,?,?,?,?,?,?,?,?)")
    .run(showId, userId, state, visibility, artist, venue, city, date, updatedAt);
}

function review(database, {
  id, userId, artist = "J. Cole", artistKey = "j-cole", venue = "Scotiabank Arena",
  venueKey = "scotiabank-arena", city = "Toronto", date = "2026-07-27",
  kind = "review", experienceType = "in_person", removed = 0, createdAt = 1,
}) {
  database.prepare("INSERT INTO posts VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
    .run(id, userId, artist, artistKey, venue, venueKey, city, date, kind, experienceType, removed, createdAt);
}

test("projects relationship labels without crossing blocks, account status, or attendance privacy", () => {
  const database = fixture();
  user(database, "viewer");
  user(database, "friend");
  user(database, "following");
  user(database, "follows-viewer");
  user(database, "artist", { role: "artist" });
  user(database, "blocked");
  user(database, "suspended", { suspendedUntil: 2_000 });
  follow(database, "viewer", "friend");
  follow(database, "friend", "viewer");
  follow(database, "viewer", "following");
  follow(database, "follows-viewer", "viewer");
  database.prepare("INSERT INTO blocks VALUES (?,?)").run("blocked", "viewer");

  review(database, { id: "tagged-review", userId: "viewer" });
  database.prepare("INSERT INTO post_user_tags VALUES (?,?,?)").run("tagged-review", "friend", "viewer");
  review(database, {
    id: "online-tag", userId: "viewer", artist: "Livestream", artistKey: "livestream",
    venue: "YouTube", venueKey: "youtube", city: "", date: "2026-07-28", experienceType: "online",
  });
  database.prepare("INSERT INTO post_user_tags VALUES (?,?,?)").run("online-tag", "following", "viewer");

  show(database, { id: "shared-members" });
  attendance(database, { showId: "shared-members", userId: "viewer" });
  attendance(database, { showId: "shared-members", userId: "friend" });
  show(database, { id: "shared-followers", artist: "Doechii", date: "2026-08-03" });
  attendance(database, { showId: "shared-followers", userId: "viewer" });
  attendance(database, { showId: "shared-followers", userId: "following", visibility: "followers" });
  attendance(database, { showId: "shared-followers", userId: "follows-viewer", visibility: "followers" });
  attendance(database, { showId: "shared-followers", userId: "artist", visibility: "private" });

  const contexts = createMessageRelationshipContextService(database).forPeers(
    "viewer",
    ["friend", "following", "follows-viewer", "artist", "blocked", "suspended"],
    { activeAt: 1_000 },
  );

  assert.deepEqual(
    { friend: contexts.get("friend").friend, following: contexts.get("friend").following, followsYou: contexts.get("friend").followsYou },
    { friend: true, following: true, followsYou: true },
  );
  assert.equal(contexts.get("friend").concertBuddy, true);
  assert.equal(contexts.get("friend").sharedShow.source, "visible_attendance");
  assert.equal(contexts.get("following").following, true);
  assert.equal(contexts.get("following").sharedShow.artist, "Doechii");
  assert.equal(contexts.get("following").concertBuddy, false, "online tags are not concert-buddy evidence");
  assert.equal(contexts.get("follows-viewer").followsYou, true);
  assert.equal(contexts.get("follows-viewer").sharedShow, null, "followers-only attendance requires the viewer to follow the peer");
  assert.equal(contexts.get("artist").artist, true);
  assert.equal(contexts.get("artist").sharedShow, null, "private attendance is never projected");
  assert.equal(contexts.has("blocked"), false);
  assert.equal(contexts.has("suspended"), false);
});

test("uses exact public in-person review evidence but does not expose member attendance to unverified accounts", () => {
  const database = fixture();
  user(database, "viewer", { verified: false });
  user(database, "review-peer");
  user(database, "wrong-city");
  user(database, "attendance-peer");
  review(database, { id: "mine", userId: "viewer" });
  review(database, { id: "theirs", userId: "review-peer" });
  review(database, {
    id: "wrong-place", userId: "wrong-city", venueKey: null, city: "Ottawa", createdAt: 2,
  });
  review(database, {
    id: "mine-without-key", userId: "viewer", venueKey: null, createdAt: 3,
  });
  show(database, { id: "members-show", artist: "IDLES", venue: "History", date: "2026-09-12" });
  attendance(database, { showId: "members-show", userId: "viewer" });
  attendance(database, { showId: "members-show", userId: "attendance-peer" });

  const contexts = createMessageRelationshipContextService(database)
    .forPeers("viewer", ["review-peer", "wrong-city", "attendance-peer"]);

  assert.deepEqual(contexts.get("review-peer").sharedShow, {
    artist: "J. Cole",
    venue: "Scotiabank Arena",
    city: "Toronto",
    date: "2026-07-27",
    source: "public_reviews",
  });
  assert.equal(contexts.get("wrong-city").sharedShow, null, "a same-name venue in another city is not the same show");
  assert.equal(contexts.get("attendance-peer").sharedShow, null, "member attendance requires a verified viewer");

  database.prepare("UPDATE users SET is_banned=1 WHERE id='viewer'").run();
  assert.equal(
    createMessageRelationshipContextService(database).forPeers("viewer", ["review-peer"]).size,
    0,
    "inactive viewers receive no relationship projection",
  );
});

test("10- and 100-peer batches keep a fixed query shape under concurrent simulated reads", async () => {
  const database = fixture();
  user(database, "viewer");
  for (let index = 0; index < 100; index += 1) {
    const peerId = `peer-${String(index).padStart(3, "0")}`;
    user(database, peerId);
    follow(database, "viewer", peerId);
  }
  let reads = 0;
  const measuredDatabase = {
    prepare(sql) {
      const statement = database.prepare(sql);
      return {
        all(params) {
          reads += 1;
          return statement.all(params);
        },
      };
    },
  };
  const service = createMessageRelationshipContextService(measuredDatabase);
  const tenPeers = Array.from({ length: 10 }, (_, index) => `peer-${String(index).padStart(3, "0")}`);
  const hundredPeers = Array.from({ length: 100 }, (_, index) => `peer-${String(index).padStart(3, "0")}`);

  assert.equal(service.forPeers("viewer", tenPeers).size, 10);
  assert.equal(reads, 4, "a 10-peer read uses the same four batched projections");
  assert.equal(service.forPeers("viewer", hundredPeers).size, 100);
  assert.equal(reads, 8, "a 100-peer read does not add per-peer queries");

  const beforeConcurrent = reads;
  const batches = await Promise.all(Array.from({ length: 12 }, () => Promise.resolve()
    .then(() => service.forPeers("viewer", hundredPeers))));
  assert.equal(batches.every((batch) => batch.size === 100), true);
  assert.equal(
    reads - beforeConcurrent,
    12 * 4,
    "concurrent simulated reads stay at four statements per request rather than N+1 work",
  );
});
