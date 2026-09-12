import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { ApiError } from "../../errors.js";
import { profileAudienceAllows } from "../../accountVisibility.js";
import { concertHistoryRoutes } from "./concertHistoryRoutes.js";
import { createConcertHistoryLocationResolver, EMPTY_CONCERT_LOCATION } from "./concertHistoryLocation.js";

const NOW = Date.parse("2026-09-09T12:00:00Z");
const VENUES = [
  { key: "history", name: "History", city: "Toronto", region: "Ontario", country: "Canada", countryCode: "CA", lat: 43.664, lng: -79.33 },
  { key: "the o2 arena", name: "The O2 Arena", city: "London", country: "United Kingdom", countryCode: "GB", lat: 51.503, lng: 0.003 },
];

function fixture(t, options = {}) {
  const database = new DatabaseSync(":memory:");
  t.after(() => database.close());
  database.exec(`CREATE TABLE users (id TEXT PRIMARY KEY,profile_audience TEXT DEFAULT 'everyone',
      is_banned INTEGER DEFAULT 0,dormant_at INTEGER,suspended_until INTEGER,extras TEXT DEFAULT '{}');
    CREATE TABLE blocks (blocker_id TEXT,blocked_id TEXT);
    CREATE TABLE posts (id TEXT PRIMARY KEY,user_id TEXT,kind TEXT DEFAULT 'review',experience_type TEXT DEFAULT 'in_person',
      removed INTEGER DEFAULT 0,created_at INTEGER,artist TEXT,venue TEXT,venue_key TEXT,city TEXT,date TEXT,overall REAL,
      photos_public INTEGER DEFAULT 0,photos TEXT DEFAULT '[]');
    CREATE INDEX idx_posts_user_history ON posts(user_id,removed,created_at DESC,id DESC);
    INSERT INTO users(id) VALUES ('author'),('reader');`);
  const queried = [];
  const headers = {};
  const wrapped = { prepare(sql) { queried.push(sql); return database.prepare(sql); } };
  const route = concertHistoryRoutes({ database: wrapped, ApiError,
    visibleProfileOrNull(id, viewer) {
      const user = database.prepare("SELECT * FROM users WHERE id=?").get(id);
      return profileAudienceAllows(user, viewer) ? user : null;
    },
    blockedEitherWay(viewer, target) {
      return !!database.prepare("SELECT 1 FROM blocks WHERE (blocker_id=? AND blocked_id=?) OR (blocker_id=? AND blocked_id=?)")
        .get(viewer, target, target, viewer);
    },
    rateLimit() {}, now: () => NOW, venues: VENUES, ...options,
  })["GET /api/users/:id/concert-history"];
  const read = ({ user = null, query = {}, target = "author" } = {}) => route({ user, query, params: { id: target }, setHeader(key, value) { headers[key] = value; } });
  const add = (id, patch = {}) => {
    const post = { id, user_id: "author", created_at: 10, artist: "A Band", venue: "History", venue_key: "history",
      city: "Toronto", date: "2025-08-01", overall: 4, ...patch };
    const keys = Object.keys(post);
    database.prepare(`INSERT INTO posts (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`).run(...Object.values(post));
  };
  return { database, add, read, queried, headers };
}

test("only past physical reviews qualify; plans, statuses, online, invalid dates and removed posts do not", (t) => {
  const f = fixture(t);
  f.add("past");
  f.add("legacy-date", { date: "2024 · 06 · 21" });
  f.add("online", { experience_type: "online" });
  f.add("status", { kind: "status" });
  f.add("old-going-ticket", { kind: "status", date: "2020-01-01" });
  f.add("today", { date: "2026-09-09" });
  f.add("future", { date: "2027-01-01" });
  f.add("invalid", { date: "2025-02-31" });
  f.add("removed", { removed: 1 });
  f.add("missing-venue", { venue: " " });
  const result = f.read();
  assert.deepEqual(result.concerts.map(({ id }) => id).sort(), ["legacy-date", "past"]);
  assert.equal(result.concerts[0].lat, 43.664);
  assert.equal(result.complete, true);
  assert.equal(result.hasMore, false);
  assert.equal(result.nextCursor, null);
  assert.deepEqual(result.coverage, { source: "visible_reviews", includesPrivateAttendance: false, unmappedCount: 0 });
  assert.equal(f.headers["Cache-Control"], "no-store");
});

test("cursor pages are bounded, deterministic at timestamp ties, and do not reread newly inserted head rows", (t) => {
  const f = fixture(t);
  for (let n = 0; n < 405; n++) f.add(`p${String(n).padStart(4, "0")}`);
  const first = f.read({ query: { limit: 10000 } });
  assert.equal(first.concerts.length, 200);
  assert.equal(first.hasMore, true);
  f.add("new-head", { created_at: 20 });
  const second = f.read({ query: { before: first.nextCursor } });
  const third = f.read({ query: { before: second.nextCursor } });
  assert.equal(second.concerts.length, 200);
  assert.equal(third.concerts.length, 5);
  assert.equal(third.complete, true);
  assert.equal(new Set([...first.concerts, ...second.concerts, ...third.concerts].map(({ id }) => id)).size, 405);
  const plan = f.database.prepare(`EXPLAIN QUERY PLAN ${f.queried[0]}`).all("author", 201);
  assert.ok(plan.some((row) => row.detail.includes("idx_posts_user_history")));
  assert.ok(plan.every((row) => !row.detail.includes("TEMP B-TREE")));
});

test("an empty filtered page retains a continuation cursor rather than silently truncating older concerts", (t) => {
  const f = fixture(t);
  f.add("older", { created_at: 1 });
  f.add("future", { created_at: 2, date: "2027-01-01" });
  const first = f.read({ query: { limit: 1 } });
  assert.deepEqual(first.concerts, []);
  assert.equal(first.complete, false);
  const next = f.read({ query: { limit: 1, before: first.nextCursor } });
  assert.deepEqual(next.concerts.map(({ id }) => id), ["older"]);
  assert.equal(next.complete, true);
});

test("profile audience, restrictions and both block directions are checked before every page", (t) => {
  const f = fixture(t);
  f.add("p1"); f.add("p2");
  const first = f.read({ query: { limit: 1 } });
  const denied = (options) => assert.throws(() => f.read(options), { status: 404, code: "NOT_FOUND" });
  f.database.prepare("UPDATE users SET profile_audience='members' WHERE id='author'").run();
  denied({ query: { before: first.nextCursor } });
  assert.equal(f.read({ user: { id: "reader" } }).concerts.length, 2);
  f.database.prepare("UPDATE users SET profile_audience='only_me' WHERE id='author'").run();
  denied({ user: { id: "reader" } });
  assert.equal(f.read({ user: { id: "author" } }).concerts.length, 2);
  f.database.prepare("UPDATE users SET profile_audience='everyone' WHERE id='author'").run();
  for (const [from, to] of [["author", "reader"], ["reader", "author"]]) {
    f.database.prepare("INSERT INTO blocks VALUES (?,?)").run(from, to);
    denied({ user: { id: "reader" } });
    f.database.exec("DELETE FROM blocks");
  }
  for (const update of ["is_banned=1", "is_banned=0,dormant_at=1", "dormant_at=NULL,suspended_until=9999999999999"]) {
    f.database.exec(`UPDATE users SET ${update} WHERE id='author'`);
    denied(); denied({ user: { id: "author" } });
  }
  denied({ target: "missing" });
});

test("map opt-out strips location and derived map coverage for guest, member and owner without losing list rows", (t) => {
  const f = fixture(t);
  f.add("known"); f.add("unknown", { venue_key: "unknown" });
  const visible = f.read();
  assert.equal(visible.coverage.unmappedCount, 1);
  f.database.prepare("UPDATE users SET extras=? WHERE id='author'").run(JSON.stringify({ concertMapVisible: false }));
  for (const user of [null, { id: "reader" }, { id: "author" }]) {
    const result = f.read({ user });
    assert.equal(result.mapVisible, false);
    assert.equal(result.coverage.unmappedCount, null);
    assert.equal(result.concerts.length, 2);
    for (const row of result.concerts) for (const field of ["lat", "lng", "countryCode", "country"]) assert.equal(row[field], null);
    assert.equal(result.concerts[0].city, "Toronto");
  }
});

test("cursor validation rejects malformed, foreign-profile and invalid tuple values; page size rejects unsafe values", (t) => {
  const f = fixture(t);
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  for (const before of ["!", "a".repeat(601), encode({ v: 1, targetId: "reader", createdAt: 10, id: "p" }),
    encode({ v: 1, targetId: "author", createdAt: -1, id: "p" }), encode(null)]) {
    assert.throws(() => f.read({ query: { before } }), { status: 400, code: "VALIDATION_FAILED" });
  }
  for (const limit of [0, -1, 1.5, "garbage", "Infinity"]) assert.throws(() => f.read({ query: { limit } }), { status: 400 });
});

test("compact records do not hydrate full posts and malformed photo JSON is harmless", (t) => {
  const calls = [];
  const f = fixture(t, { projectPhoto(row, viewerId) { calls.push([row.photo_candidate, viewerId]); return null; } });
  f.add("malformed", { photos: "{" });
  f.add("candidate", { photos: JSON.stringify(["https://media.example/one.jpg", "https://media.example/two.jpg"]) });
  const rows = f.read({ user: { id: "reader" } }).concerts;
  assert.equal(rows.length, 2);
  assert.deepEqual(calls, [[null, "reader"], ["https://media.example/one.jpg", "reader"]]);
  assert.deepEqual(Object.keys(rows[0]).sort(), ["artist", "city", "country", "countryCode", "date", "id", "lat", "lng", "photo", "postId", "rating", "venue", "venueKey"].sort());
});

test("thumbnail uses only the author's verified public image derivative and honors the photo visibility flag", (t) => {
  const f = fixture(t);
  f.database.exec(`CREATE TABLE media_assets (id TEXT,kind TEXT,owner_id TEXT,source_key TEXT,source_url TEXT,
      status TEXT,source_verified_at INTEGER,metadata_status TEXT,codec_status TEXT,render_state TEXT,render_variant_id TEXT);
    CREATE TABLE media_objects (owner_id TEXT,object_key TEXT,status TEXT,storage_scope TEXT);
    CREATE TABLE media_variants (id TEXT,asset_id TEXT,role TEXT,object_key TEXT,public_url TEXT,status TEXT,verification_origin TEXT);
    INSERT INTO media_assets VALUES ('asset','image','author','source','https://media.example/private-source',
      'ready',1,'declared','not_applicable','ready','render');
    INSERT INTO media_objects VALUES ('author','source','associated','private'),('author','render-key','associated','public');
    INSERT INTO media_variants VALUES ('render','asset','render','render-key','https://media.example/safe.jpg','verified','private_derivative_v1');`);
  f.add("public-image", { photos_public: 1, photos: JSON.stringify(["https://media.example/safe.jpg"]) });
  f.add("private-image", { photos_public: 0, photos: JSON.stringify(["https://media.example/safe.jpg"]) });
  f.add("raw-source", { photos_public: 1, photos: JSON.stringify(["https://media.example/private-source"]) });
  f.add("foreign-image", { photos_public: 1, photos: JSON.stringify(["https://media.example/other.jpg"]) });
  const photos = (user) => Object.fromEntries(f.read({ user }).concerts.map(({ id, photo }) => [id, photo]));
  assert.deepEqual(photos(null), { "raw-source": null, "public-image": "https://media.example/safe.jpg", "private-image": null, "foreign-image": null });
  assert.equal(photos({ id: "author" })["private-image"], "https://media.example/safe.jpg");
  for (const update of ["UPDATE media_objects SET status='deleted' WHERE object_key='render-key'",
    "UPDATE media_objects SET status='associated',storage_scope='private' WHERE object_key='render-key'",
    "UPDATE media_objects SET storage_scope='public' WHERE object_key='render-key'; UPDATE media_variants SET verification_origin='untrusted'",
    "UPDATE media_variants SET verification_origin='private_derivative_v1'; UPDATE media_assets SET owner_id='reader'"]) {
    f.database.exec(update);
    assert.equal(photos(null)["public-image"], null);
  }
});

test("location resolution requires an exact known venue identity plus nonconflicting city", () => {
  const resolve = createConcertHistoryLocationResolver(VENUES);
  assert.equal(resolve({ venue_key: "history toronto", city: "Toronto, Ontario, Canada" }).lat, 43.664);
  assert.equal(resolve({ venue: "History", city: "Toronto" }).countryCode, "CA");
  for (const row of [{ venue_key: "unknown", venue: "History", city: "Toronto" },
    { venue: "History", city: "Toronto, United States" }, { venue_key: "history", city: "London" },
    { venue: "Histor", city: "Toronto" }, { venue: "History", home: { lat: 43, lng: -79 } }]) {
    assert.deepEqual(resolve(row), EMPTY_CONCERT_LOCATION);
  }
});

test("ambiguous same-name cities fail closed; provider venue keys remain exact and source-scoped", () => {
  const resolve = createConcertHistoryLocationResolver([
    ...VENUES, { ...VENUES[0], key: "history-other", lat: 43.7 },
    { ...VENUES[0], key: "provider:ticketmaster:Ab123" },
  ]);
  assert.deepEqual(resolve({ venue: "History", city: "Toronto" }), EMPTY_CONCERT_LOCATION);
  assert.equal(resolve({ venue_key: "history", city: "Toronto" }).lat, 43.664);
  assert.equal(resolve({ venue_key: "provider:ticketmaster:Ab123", city: "Toronto" }).lat, 43.664);
  assert.deepEqual(resolve({ venue_key: "provider:other:Ab123", city: "Toronto" }), EMPTY_CONCERT_LOCATION);
  assert.deepEqual(resolve({ venue_key: "provider:ticketmaster:ab123", city: "Toronto" }), EMPTY_CONCERT_LOCATION);
});

test("coordinates are numeric and range checked without null/zero coercion", () => {
  for (const [lat, lng] of [[null, -79], ["", -79], [false, -79], ["43", -79], [NaN, -79], [91, 1], [1, 181], [0, 0]]) {
    const result = createConcertHistoryLocationResolver([{ ...VENUES[0], lat, lng }])({ venue_key: "history", city: "Toronto" });
    assert.equal(result.lat, null); assert.equal(result.lng, null);
  }
  assert.equal(createConcertHistoryLocationResolver([{ ...VENUES[0], lat: 0, lng: 30 }])({ venue_key: "history", city: "Toronto" }).lat, 0);
});
