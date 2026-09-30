import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eligibleNewsPosts, ensureNewsFeedSchema, introduceNewsPost, newsFeedRoutes } from "./newsFeedPlacement.js";

const NOW = Date.now();
const viewer = { id: "viewer", favorite_artists: '["Moon Walker"]' };
function fixture(path = ":memory:") {
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE users(id TEXT PRIMARY KEY,is_banned INTEGER DEFAULT 0,dormant_at INTEGER,suspended_until INTEGER);
    CREATE TABLE posts(id TEXT PRIMARY KEY,user_id TEXT REFERENCES users(id),removed INTEGER DEFAULT 0);
    CREATE TABLE artists(norm TEXT PRIMARY KEY,name TEXT);
    CREATE TABLE news_stories(id TEXT PRIMARY KEY,post_id TEXT,status TEXT,created_at INTEGER,artist_keys TEXT,
      headline TEXT NOT NULL DEFAULT '',summary TEXT NOT NULL DEFAULT '',body TEXT NOT NULL DEFAULT '',category TEXT NOT NULL DEFAULT 'other');
    CREATE TABLE fan_club_members(user_id TEXT,artist TEXT);
    CREATE TABLE blocks(blocker_id TEXT,blocked_id TEXT);
    CREATE TABLE account_mutes(muter_id TEXT,muted_id TEXT);
    CREATE TABLE recommendation_preferences(user_id TEXT,post_id TEXT);
    CREATE TABLE post_impressions(user_id TEXT,post_id TEXT,seen_count INTEGER);
    INSERT INTO users(id) VALUES('viewer'),('other'),('author'),('different-author');
    INSERT INTO artists VALUES('moon-walker','Moon Walker'),('russ','Russ');`);
  const add = (id, artist, age = 0, author = "author") => {
    db.prepare("INSERT INTO posts(id,user_id) VALUES(?,?)").run(`news_${id}`, author);
    db.prepare("INSERT INTO news_stories(id,post_id,status,created_at,artist_keys) VALUES(?,?,?,?,?)").run(id, `news_${id}`, "published", NOW - age, JSON.stringify([artist]));
  };
  add("latest", "moon-walker"); add("earlier", "moon-walker", 1000); add("unrelated", "russ");
  ensureNewsFeedSchema(db);
  return db;
}
const project = (id) => ({ id });
const intro = (db, requestId, extra = {}) => introduceNewsPost(db, { viewer, requestId, at: NOW, project, ...extra });
test("guests and unrelated listeners receive no news; explicit favorite and fan-club follows do", () => {
  const db = fixture();
  try {
    assert.deepEqual(eligibleNewsPosts(db, null, NOW), []);
    assert.deepEqual(eligibleNewsPosts(db, { id: "other", favorite_artists: "[]" }, NOW), []);
    assert.deepEqual(eligibleNewsPosts(db, viewer, NOW).map(r => r.post_id), ["news_latest", "news_earlier"]);
    db.exec("INSERT INTO fan_club_members VALUES('other','moon walker')");
    assert.equal(eligibleNewsPosts(db, { id: "other" }, NOW).length, 2);
  } finally { db.close(); }
});
test("news pushed into For You follows the reader's region", () => {
  const db = fixture();
  try {
    db.prepare("UPDATE news_stories SET headline=? WHERE id='latest'").run("Moon Walker adds UK and Ireland stadium dates");
    const toronto = { ...viewer, home_city: "Toronto, Ontario, Canada" };
    assert.deepEqual(eligibleNewsPosts(db, toronto, NOW).map((row) => row.post_id), ["news_earlier"], "UK-only dates are not pushed to Toronto");
    assert.deepEqual(eligibleNewsPosts(db, { ...viewer, home_city: "Glasgow, Scotland, United Kingdom" }, NOW).map((row) => row.post_id), ["news_latest", "news_earlier"]);
    assert.deepEqual(eligibleNewsPosts(db, viewer, NOW).map((row) => row.post_id), ["news_latest", "news_earlier"], "no home city means everything");
  } finally { db.close(); }
});
test("newest introduction is durable, idempotent, per-account, and not a synthetic view", () => {
  const dir = mkdtempSync(join(tmpdir(), "pit-news-introduction-"));
  const file = join(dir, "fixture.sqlite");
  let db = fixture(file);
  try {
    assert.equal(intro(db, "request-a").id, "news_latest");
    assert.equal(intro(db, "request-a").id, "news_latest", "retry cannot consume older story");
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM post_impressions").get().n, 0);
    db.close(); db = new DatabaseSync(file); ensureNewsFeedSchema(db);
    assert.equal(intro(db, "request-b").id, "news_earlier", "process restart cannot repin last story");
    assert.equal(intro(db, "request-c"), null);
    assert.equal(intro(db, "request-a", { viewer: { ...viewer, id: "other" } }).id, "news_latest");
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
});
test("prior genuine views, withdrawal, actual-author blocks, mute, and hidden preference exclude introductions", () => {
  for (const sql of [
    "INSERT INTO post_impressions VALUES('viewer','news_latest',1)",
    "UPDATE news_stories SET status='withdrawn' WHERE post_id='news_latest'",
    "UPDATE posts SET removed=1 WHERE id='news_latest'",
    "INSERT INTO blocks VALUES('viewer','author')",
    "INSERT INTO blocks VALUES('author','viewer')",
    "INSERT INTO account_mutes VALUES('viewer','author')",
    "INSERT INTO recommendation_preferences VALUES('viewer','news_latest')",
    "UPDATE users SET is_banned=1 WHERE id='author'",
    "UPDATE users SET dormant_at=1 WHERE id='author'",
    `UPDATE users SET suspended_until=${NOW + 86400000} WHERE id='author'`,
  ]) {
    const db = fixture();
    try { db.exec(sql); assert.notEqual(intro(db, "request-x")?.id, "news_latest", sql); }
    finally { db.close(); }
  }
});
test("retry rechecks access and does not switch to a different story after a block or unfollow", () => {
  const db = fixture();
  try {
    intro(db, "request-a");
    assert.equal(intro(db, "request-a", { viewer: { ...viewer, favorite_artists: "[]" } }), null);
    db.exec("UPDATE posts SET user_id='different-author' WHERE id='news_earlier'; INSERT INTO blocks VALUES('viewer','author')");
    assert.equal(intro(db, "request-a"), null);
    assert.equal(intro(db, "request-b").id, "news_earlier");
  } finally { db.close(); }
});
test("null/throwing projection cannot consume introduction and old receipts prune outside eligibility", () => {
  const db = fixture();
  try {
    assert.equal(intro(db, "request-a", { project: () => null }), null);
    assert.throws(() => intro(db, "request-a", { project: () => { throw new Error("projection"); } }), /projection/);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM news_feed_introductions").get().n, 0);
    assert.equal(intro(db, "request-a").id, "news_latest");
    assert.equal(intro(db, "request-z", { at: NOW + 8 * 86400000 }), null);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM news_feed_introductions").get().n, 0);
  } finally { db.close(); }
});
test("introduction is an authenticated private command with idempotent concurrent requests", async () => {
  const db = fixture();
  try {
    const headers = new Map();
    const routes = newsFeedRoutes({ database: db, requireUser: ctx => { if (!ctx.user) throw Error("auth"); return ctx.user; }, rateLimit: () => {}, ApiError: Error, project, now: () => NOW });
    const route = routes["POST /api/feed/news-introduction"];
    assert.throws(() => route({ body: { requestId: "request-a" } }), /auth/);
    assert.equal(route({ user: viewer, body: { requestId: "request-a" }, setHeader: (k,v) => headers.set(k,v) }).post.id, "news_latest");
    assert.equal(headers.get("Cache-Control"), "private, no-store");
    const retries = await Promise.all(Array.from({ length: 8 }, async () => route({ user: viewer, body: { requestId: "request-a" } })));
    assert.ok(retries.every(result => result.post.id === "news_latest"));
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM news_feed_introductions").get().n, 1);
    assert.throws(() => route({ user: viewer, body: { requestId: "bad" } }));
  } finally { db.close(); }
});
