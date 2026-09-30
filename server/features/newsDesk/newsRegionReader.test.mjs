import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { createNewsDeskReader } from "./newsDeskService.js";

const NOW = Date.now();
const HOUR = 3_600_000;

// The reader's own tables, just enough for news lists.
function fixture(headlines) {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE users(id TEXT PRIMARY KEY,name TEXT,handle TEXT,is_banned INTEGER DEFAULT 0,dormant_at INTEGER,suspended_until INTEGER);
    CREATE TABLE posts(id TEXT PRIMARY KEY,user_id TEXT,removed INTEGER DEFAULT 0);
    CREATE TABLE artists(norm TEXT PRIMARY KEY,name TEXT,public_slug TEXT,photo TEXT,data TEXT);
    CREATE TABLE news_stories(id TEXT PRIMARY KEY,status TEXT,headline TEXT,summary TEXT DEFAULT '',body TEXT DEFAULT '',category TEXT DEFAULT 'tour',
      artist_keys TEXT DEFAULT '[]',sources TEXT DEFAULT '[]',post_id TEXT,created_at INTEGER,updated_at INTEGER,score REAL DEFAULT 1);
    INSERT INTO users(id,name,handle) VALUES('desk','Mshpit News','news_mod');`);
  headlines.forEach((headline, index) => {
    db.prepare("INSERT INTO posts(id,user_id) VALUES(?,?)").run(`news_${index}`, "desk");
    db.prepare("INSERT INTO news_stories(id,status,headline,post_id,created_at,updated_at) VALUES(?,?,?,?,?,?)")
      .run(`s${String(index).padStart(3, "0")}`, "published", headline, `news_${index}`, NOW - index * HOUR, NOW - index * HOUR);
  });
  return createNewsDeskReader(db, { ensureSchema: false });
}

test("a Toronto reader's news leaves out UK-only stories and still pages cleanly", () => {
  // Newest first: 30 UK-only stories bury the worldwide ones below them.
  const headlines = [
    ...Array.from({ length: 30 }, (_, index) => `Band ${index} adds UK and Ireland stadium dates`),
    "Kendrick Lamar wins five Grammys",
    "Drake adds three more Toronto shows",
    ...Array.from({ length: 5 }, (_, index) => `Singer ${index} shares a new album`),
  ];
  const reader = fixture(headlines);
  const everyone = reader.list({ limit: 5 });
  assert.equal(everyone.stories.length, 5);
  assert.match(everyone.stories[0].headline, /UK and Ireland/u, "no region: everything, newest first");

  const first = reader.list({ limit: 5, region: "us-canada", city: "Toronto" });
  assert.deepEqual(first.stories.map((story) => story.headline).slice(0, 2), ["Kendrick Lamar wins five Grammys", "Drake adds three more Toronto shows"]);
  assert.equal(first.stories.length, 5);
  assert.ok(first.stories.every((story) => !/UK and Ireland/u.test(story.headline)));
  assert.equal(first.stories[1].localTo, "Toronto", "their own city is marked");
  assert.equal(first.stories[0].localTo, undefined);
  const second = reader.list({ limit: 5, region: "us-canada", city: "Toronto", before: first.nextCursor });
  assert.deepEqual(second.stories.map((story) => story.headline), ["Singer 3 shares a new album", "Singer 4 shares a new album"]);
  assert.equal(second.nextCursor, null);

  const uk = reader.list({ limit: 40, region: "uk-ireland" });
  assert.equal(uk.stories.length, 30 + 1 + 5, "a UK reader sees their dates and the worldwide news, not Toronto shows");
  assert.equal(reader.list({ limit: 40, region: "us-canada", artist: "someone" }).stories.length, 0, "an artist filter still applies");
});

test("top stories lift the reader's own city and region", () => {
  const reader = fixture(["Singer shares a new album", "Drake adds three more Toronto shows", "Oasis add UK stadium dates"]);
  const top = reader.list({ sort: "top", limit: 5, region: "us-canada", city: "Toronto" });
  assert.deepEqual(top.stories.map((story) => story.headline), ["Drake adds three more Toronto shows", "Singer shares a new album"]);
  assert.equal(top.stories[0].localTo, "Toronto");
  assert.equal(reader.list({ sort: "top", limit: 5 }).stories.length, 3, "guests see every story");
});
