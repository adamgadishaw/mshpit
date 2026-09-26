import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { createArtistNewsReader } from "./artistNewsReader.js";
import { ensureArtistUpdatesSchema, listArtistUpdates } from "./artistUpdatesService.js";
import { artistUpdatesRoutes } from "./artistUpdatesRoutes.js";

function fixture(t) {
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  db.exec(`CREATE TABLE users(id TEXT PRIMARY KEY,is_banned INTEGER DEFAULT 0,dormant_at INTEGER,
      suspended_until INTEGER,profile_audience TEXT DEFAULT 'everyone');
    CREATE TABLE artists(norm TEXT PRIMARY KEY,name TEXT,public_slug TEXT,photo TEXT,source TEXT);
    CREATE TABLE artist_profiles(artist_key TEXT,owner_id TEXT,removed INTEGER DEFAULT 0,identity_review_status TEXT DEFAULT 'clear');
    CREATE TABLE blocks(blocker_id TEXT,blocked_id TEXT);
    CREATE TABLE tour_dates(id TEXT PRIMARY KEY,artist TEXT,venue TEXT,date TEXT,event_name TEXT,owner_id TEXT,
      music_qualified INTEGER DEFAULT 1,event_kind TEXT DEFAULT 'concert',music_evidence TEXT,billed_artists TEXT DEFAULT '[]',event_end_date TEXT);
    INSERT INTO users(id) VALUES ('owner'),('viewer');
    INSERT INTO artists VALUES ('indie fixture','Indie Fixture','indie-fixture',NULL,'artist-created');
    INSERT INTO artist_profiles(artist_key,owner_id) VALUES ('indie fixture','owner');`);
  ensureArtistUpdatesSchema(db);
  const add = (id, kind = "release", payload = { release: { title: "Fixture Album", type: "album", releaseDate: "2026-09-20" } }) => {
    db.prepare(`INSERT INTO artist_updates(id,artist_key,artist_name,kind,dedupe_key,title,payload,source,occurred_at,created_at,updated_at)
      VALUES (?,'indie fixture','Indie Fixture',?,?, 'Fixture news',?,'deezer',1,1,1)`)
      .run(id, kind, id, JSON.stringify(payload));
  };
  add("news_release");
  const reader = createArtistNewsReader(db, { visibilitySql: "td.date>=@today AND @at>0", artistPathFor: () => "/artist/indie-fixture" });
  return { db, add, reader };
}

test("news pagination normalizes fractional and non-finite bounds before SQLite", (t) => {
  const { db } = fixture(t);
  for (const limit of [1.5, 0.5, Infinity, NaN, "bad", -3, 1e100]) {
    assert.doesNotThrow(() => listArtistUpdates(db, { limit }), `limit ${String(limit)}`);
  }
});

test("stored news cannot bypass a member-created artist's current publication boundary", (t) => {
  const { db, reader } = fixture(t);
  assert.equal(reader.read().items.length, 1);
  for (const change of [
    "UPDATE artist_profiles SET removed=1",
    "UPDATE artist_profiles SET identity_review_status='rejected'",
    "UPDATE users SET profile_audience='only_me' WHERE id='owner'",
    "UPDATE users SET profile_audience='members' WHERE id='owner'",
    "UPDATE users SET is_banned=1 WHERE id='owner'",
    "UPDATE users SET dormant_at=1 WHERE id='owner'",
    `UPDATE users SET suspended_until=${Date.now() + 86_400_000} WHERE id='owner'`,
  ]) {
    db.exec(change);
    assert.equal(reader.read().items.length, 0, change);
    db.exec("UPDATE artist_profiles SET removed=0,identity_review_status='clear'; UPDATE users SET profile_audience='everyone',is_banned=0,dormant_at=NULL,suspended_until=NULL");
  }
  db.exec("UPDATE users SET profile_audience='members' WHERE id='owner'");
  assert.equal(reader.read({ viewer: { id: "viewer" } }).items.length, 1);
  db.exec("INSERT INTO blocks VALUES ('owner','viewer')");
  assert.equal(reader.read({ viewer: { id: "viewer" } }).items.length, 0);
  db.exec("DELETE FROM blocks; INSERT INTO blocks VALUES ('viewer','owner')");
  assert.equal(reader.read({ viewer: { id: "viewer" } }).items.length, 0);
  db.exec("DELETE FROM artists");
  assert.equal(reader.read().items.length, 0, "a deleted identity is never reconstructed from stale news");
});

test("provider artist news hides blocked owners' authored tour dates in both directions", (t) => {
  const { db, add, reader } = fixture(t);
  db.exec("UPDATE artists SET source='musicbrainz'; DELETE FROM artist_updates");
  db.prepare("INSERT INTO tour_dates(id,artist,venue,date,owner_id) VALUES ('show_one','Indie Fixture','Room','2099-01-01','owner')").run();
  add("news_show", "shows", { dates: [{ id: "show_one", venue: "Room", date: "2099-01-01" }] });
  assert.equal(reader.read({ viewer: { id: "viewer" } }).items.length, 1);
  db.exec("INSERT INTO blocks VALUES ('owner','viewer')");
  assert.equal(reader.read({ viewer: { id: "viewer" } }).items.length, 0);
  db.exec("DELETE FROM blocks; INSERT INTO blocks VALUES ('viewer','owner')");
  assert.equal(reader.read({ viewer: { id: "viewer" } }).items.length, 0);
});

test("news routes carry the authenticated viewer and prohibit shared cache reuse", () => {
  const calls = [];
  const routes = artistUpdatesRoutes({ ApiError: Error, rateLimit: () => {}, requireUser: (ctx) => ctx.user,
    readNews: (options) => { calls.push(options); return { items: [], nextCursor: null }; }, resolveArtistKey: () => "indie fixture" });
  for (const path of ["GET /api/news", "GET /api/artists/:key/news"]) {
    const headers = {};
    const user = { id: "viewer" };
    routes[path]({ user, query: {}, setHeader: (name, value) => { headers[name] = value; } });
    assert.equal(calls.at(-1).viewer, user);
    assert.equal(headers["Cache-Control"], "private, no-store");
  }
});

test("filtered news pages advance to eligible news without losing the stable cursor", (t) => {
  const { db, add, reader } = fixture(t);
  db.exec("DELETE FROM artist_updates; INSERT INTO artists VALUES ('gone','Gone','gone',NULL,'artist-created')");
  add("older_visible");
  add("newer_hidden");
  db.exec("UPDATE artist_updates SET artist_key='gone',created_at=10 WHERE id='newer_hidden'");
  const page = reader.read({ limit: 1 });
  assert.deepEqual(page.items.map((item) => item.id), ["older_visible"]);
  assert.equal(page.nextCursor, null);
});
