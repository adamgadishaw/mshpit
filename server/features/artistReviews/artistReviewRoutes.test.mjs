import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { createArtistReviewRepository } from "./artistReviewRepository.js";
import { artistReviewRoutes } from "./artistReviewRoutes.js";

function createDatabase() {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      handle TEXT NOT NULL,
      initials TEXT,
      avatar_uri TEXT,
      avatar_color TEXT,
      role TEXT NOT NULL DEFAULT 'fan',
      artist_name TEXT,
      is_banned INTEGER NOT NULL DEFAULT 0,
      suspended_until INTEGER
    );
    CREATE TABLE posts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      artist TEXT NOT NULL,
      artist_key TEXT,
      artist_mbid TEXT,
      venue_key TEXT,
      venue TEXT NOT NULL,
      city TEXT NOT NULL DEFAULT '',
      date TEXT NOT NULL DEFAULT '',
      overall REAL NOT NULL,
      band REAL,
      room REAL,
      dims TEXT NOT NULL DEFAULT '{}',
      review TEXT NOT NULL DEFAULT '',
      photos TEXT NOT NULL DEFAULT '[]',
      photos_public INTEGER NOT NULL DEFAULT 0,
      setlist TEXT NOT NULL DEFAULT '[]',
      tour TEXT,
      tags TEXT NOT NULL DEFAULT '[]',
      kind TEXT NOT NULL DEFAULT 'review',
      removed INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE likes (post_id TEXT NOT NULL, user_id TEXT NOT NULL, PRIMARY KEY (post_id,user_id));
    CREATE TABLE comments (id TEXT PRIMARY KEY, post_id TEXT NOT NULL, user_id TEXT NOT NULL, removed INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE blocks (blocker_id TEXT NOT NULL, blocked_id TEXT NOT NULL, PRIMARY KEY (blocker_id,blocked_id));
    CREATE INDEX idx_likes_post ON likes(post_id,user_id);
    CREATE INDEX idx_comments_post ON comments(post_id,removed,user_id);
  `);
  return database;
}

function addAccount(database, id, { banned = false, suspended = false } = {}) {
  database.prepare(`INSERT INTO users
    (id,name,handle,initials,avatar_uri,avatar_color,role,artist_name,is_banned,suspended_until)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
    id,
    `Name ${id}`,
    id,
    id.slice(0, 2).toUpperCase(),
    null,
    "#123456",
    "fan",
    null,
    banned ? 1 : 0,
    suspended ? Date.now() + 86_400_000 : null,
  );
}

function addPost(database, {
  id,
  authorId = "author",
  artist = "Alpha",
  artistKey = "alpha",
  venue = "History",
  date = "2026-06-01",
  overall = 4,
  review = `Review ${id}`,
  kind = "review",
  removed = false,
  createdAt = 1,
  photos = [],
  photosPublic = false,
} = {}) {
  database.prepare(`INSERT INTO posts
    (id,user_id,artist,artist_key,venue,city,date,overall,band,room,dims,review,photos,photos_public,setlist,tags,kind,removed,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    id, authorId, artist, artistKey, venue, "Toronto", date, overall, overall, overall,
    "{}", review, JSON.stringify(photos), photosPublic ? 1 : 0, "[]", "[]", kind, removed ? 1 : 0, createdAt,
  );
}

function addEngagement(database, postId, accountId, suffix) {
  database.prepare("INSERT OR IGNORE INTO likes (post_id,user_id) VALUES (?,?)").run(postId, accountId);
  database.prepare("INSERT INTO comments (id,post_id,user_id,removed) VALUES (?,?,?,0)")
    .run(`comment-${postId}-${suffix}`, postId, accountId);
}

function projectPost(row, viewerId) {
  return {
    id: row.id,
    userId: row.user_id,
    kind: row.kind,
    user: { name: row.u_name, handle: row.u_handle, initials: row.u_initials },
    artist: row.artist,
    venue: row.venue,
    city: row.city,
    date: row.date,
    artistKey: row.artist_key,
    artistMbid: row.artist_mbid,
    venueKey: row.venue_key,
    overall: row.overall,
    band: row.band,
    room: row.room,
    dims: JSON.parse(row.dims),
    review: row.review,
    photosPublic: !!row.photos_public,
    photos: JSON.parse(row.photos),
    media: JSON.parse(row.photos).map((url) => ({ url, kind: "image" })),
    mediaAssetIds: JSON.parse(row.photos).map((_, index) => `asset-${index}`),
    setlist: JSON.parse(row.setlist),
    tour: row.tour,
    tags: JSON.parse(row.tags),
    taggedPeople: Array.from({ length: 12 }, (_, index) => ({
      id: `tagged-${index}`,
      name: `Tagged person ${index}`,
      handle: `tagged${index}`,
    })),
    song: { videoId: "youtube-123", title: "Midnight", artist: row.artist },
    likes: row.like_count,
    comments: row.comment_count,
    liked: !!row.viewer_liked,
    createdAt: row.created_at,
    editedAt: row.updated_at,
    version: row.updated_at || row.created_at,
    landingShowcase: true,
    flags: 99,
  };
}

class TestApiError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const clean = (value, { max } = {}) => String(value ?? "").trim().slice(0, max || Infinity);
const normName = (value) => String(value || "").trim().toLowerCase();

test("repository ranks all eligible history by engagement, score, show date, publication date, then id", () => {
  const database = createDatabase();
  try {
    for (const id of ["author", "banned-author", "suspended-author", "crowd-a", "crowd-b", "banned-crowd", "suspended-crowd"]) {
      addAccount(database, id, {
        banned: id.startsWith("banned"),
        suspended: id.startsWith("suspended"),
      });
    }
    addPost(database, { id: "more-engagement", overall: 1, date: "2020-01-01" });
    addPost(database, { id: "more-score", overall: 5, date: "2024-01-01" });
    addPost(database, { id: "newer-show", overall: 5, date: "2026-02-01", createdAt: 1 });
    addPost(database, { id: "newer-post", overall: 5, date: "2026-02-01", createdAt: 20 });
    addPost(database, { id: "same-a", overall: 5, date: "2026-02-01", createdAt: 20 });
    addPost(database, { id: "same-b", overall: 5, date: "2026-02-01", createdAt: 20 });
    addPost(database, { id: "status", kind: "status", overall: 5 });
    addPost(database, { id: "blank", review: "   ", overall: 5 });
    addPost(database, { id: "removed", removed: true, overall: 5 });
    addPost(database, { id: "banned-author", authorId: "banned-author", overall: 5 });
    addPost(database, { id: "suspended-author", authorId: "suspended-author", overall: 5 });

    for (const postId of ["more-score", "newer-show", "newer-post", "same-a", "same-b"]) {
      addEngagement(database, postId, "crowd-a", "a");
    }
    addEngagement(database, "more-engagement", "crowd-a", "a");
    addEngagement(database, "more-engagement", "crowd-b", "b");
    // Inactive engagement never changes the public rank.
    addEngagement(database, "more-score", "banned-crowd", "banned");
    addEngagement(database, "more-score", "suspended-crowd", "suspended");

    const repository = createArtistReviewRepository(database);
    const rows = repository.findTopReviews({ artistKey: "alpha", limit: 10 });
    assert.deepEqual(rows.map((row) => row.id), [
      "more-engagement",
      "newer-post",
      "same-a",
      "same-b",
      "newer-show",
      "more-score",
    ]);
    assert.equal(rows.find((row) => row.id === "more-score").like_count, 1);
    assert.equal(rows.find((row) => row.id === "more-score").comment_count, 1);
  } finally {
    database.close();
  }
});

test("repository includes matching legacy-unbound reviews without mixing canonical homonyms and applies two-way viewer blocks", () => {
  const database = createDatabase();
  try {
    for (const id of ["viewer", "blocked-by-viewer", "blocks-viewer", "beta-author"]) addAccount(database, id);
    addPost(database, { id: "alpha-a", authorId: "blocked-by-viewer", artist: "Twin Act", artistKey: "twin-a" });
    addPost(database, { id: "alpha-b", authorId: "blocks-viewer", artist: "Twin Act", artistKey: "twin-a" });
    addPost(database, { id: "beta", authorId: "beta-author", artist: "Twin Act", artistKey: "twin-b" });
    addPost(database, { id: "legacy-unbound", authorId: "beta-author", artist: "Twin Act", artistKey: null, createdAt: 2 });
    database.prepare("INSERT INTO blocks (blocker_id,blocked_id) VALUES (?,?)").run("viewer", "blocked-by-viewer");
    database.prepare("INSERT INTO blocks (blocker_id,blocked_id) VALUES (?,?)").run("blocks-viewer", "viewer");

    const repository = createArtistReviewRepository(database);
    assert.deepEqual(repository.findTopReviews({ artistKey: "twin-a", viewerId: "viewer" }), []);
    assert.deepEqual(repository.findTopReviews({ artistKey: "twin-a" }).map((row) => row.id), ["alpha-a", "alpha-b"]);
    assert.deepEqual(repository.findTopReviews({ artistKey: "twin-b" }).map((row) => row.id), ["beta"]);
    assert.deepEqual(
      repository.findTopReviews({ artistKey: "twin-a", name: "Twin Act", limit: 10 }).map((row) => row.id),
      ["legacy-unbound", "alpha-a", "alpha-b"],
      "matching unbound history joins the canonical page but twin-b stays excluded",
    );
    assert.deepEqual(
      repository.findTopReviews({ artistKey: "twin-b", name: "Twin Act", limit: 10 }).map((row) => row.id),
      ["legacy-unbound", "beta"],
      "the other canonical page never receives twin-a rows",
    );
    assert.deepEqual(repository.findTopReviews({ name: "twin act", limit: 10 }).map((row) => row.id), ["legacy-unbound", "alpha-a", "alpha-b", "beta"]);
  } finally {
    database.close();
  }
});

test("route bounds the read, validates identity, and fails closed for non-gallery media", () => {
  const database = createDatabase();
  try {
    addAccount(database, "author");
    addAccount(database, "viewer");
    for (let index = 0; index < 12; index += 1) {
      addPost(database, {
        id: `post-${String(index).padStart(2, "0")}`,
        overall: index === 0 ? 5 : 4,
        createdAt: 100 - index,
        photos: [`https://media.test/${index}.jpg`],
        photosPublic: index !== 0,
      });
    }
    database.prepare("INSERT INTO likes (post_id,user_id) VALUES (?,?)").run("post-00", "viewer");
    const rateCalls = [];
    const routes = artistReviewRoutes({
      database,
      ApiError: TestApiError,
      clean,
      normName,
      projectPost,
      rateLimit: (...args) => rateCalls.push(args),
      resolveArtistName: (key) => key === "alpha" ? "Alpha" : null,
    });
    const read = routes["GET /api/artists/reviews"];
    const response = read({ user: { id: "viewer" }, query: { artistKey: " ALPHA ", name: "Alpha", limit: "99" } });

    assert.equal(response.reviews.length, 10);
    assert.equal(response.reviews[0].id, "post-00");
    assert.equal(response.reviews[0].liked, true);
    assert.equal(response.reviews[1].liked, false);
    assert.deepEqual(response.reviews[0].photos, []);
    assert.deepEqual(response.reviews[0].media, []);
    assert.deepEqual(response.reviews[0].mediaAssetIds, []);
    assert.deepEqual(response.reviews[0].song, {
      videoId: "youtube-123",
      title: "Midnight",
      artist: "Alpha",
    });
    assert.equal(response.reviews[0].taggedPeople.length, 8);
    assert.deepEqual(response.reviews[0].taggedPeople.map((person) => person.id), [
      "tagged-0", "tagged-1", "tagged-2", "tagged-3",
      "tagged-4", "tagged-5", "tagged-6", "tagged-7",
    ]);
    assert.equal(Object.hasOwn(response.reviews[0], "landingShowcase"), false);
    assert.equal(Object.hasOwn(response.reviews[0], "flags"), false);
    assert.equal(response.reviews[1].photos.length, 1);
    assert.equal(rateCalls[0][1], "artist-reviews");
    assert.equal(rateCalls[0][2], 120);

    assert.throws(
      () => read({ user: null, query: {} }),
      (error) => error instanceof TestApiError && error.status === 400 && error.code === "VALIDATION_FAILED",
    );
    assert.equal(rateCalls.length, 2, "rate limiting precedes validation on public reads");

    assert.throws(
      () => read({ user: null, query: { artistKey: "alpha", name: "Different Act" } }),
      (error) => error instanceof TestApiError && error.status === 400 && error.code === "VALIDATION_FAILED",
    );
    assert.equal(rateCalls.length, 3);
  } finally {
    database.close();
  }
});
