import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { createNewsDeskReader } from "./newsDeskService.js";
import { NEWS_REGIONS } from "./newsRegions.js";

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
  headlines.forEach((item, index) => {
    const { headline, summary = "", body = "", category = "tour" } = typeof item === "string" ? { headline: item } : item;
    db.prepare("INSERT INTO posts(id,user_id) VALUES(?,?)").run(`news_${index}`, "desk");
    db.prepare("INSERT INTO news_stories(id,status,headline,summary,body,category,post_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)")
      .run(`s${String(index).padStart(3, "0")}`, "published", headline, summary, body, category, `news_${index}`, NOW - index * HOUR, NOW - index * HOUR);
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

test("latest and Top keep incidental geography worldwide without local metadata or ranking lift", () => {
  const examples = [
    ["Toronto", { headline: "Aimyon announces a new single", category: "release", body: "A preview begins at midnight in Japan, equivalent to October 4 in Toronto." }],
    ["Toronto", { headline: "A new single arrives at 6 p.m. in Toronto", category: "release" }],
    ["Toronto", { headline: "The show in Toronto time starts at 6 p.m." }],
    ["Toronto", { headline: "Singer announces a new album", summary: "The singer was born in Toronto." }],
    ["Chicago", { headline: "Chicago announce a new album", category: "release" }],
    ["Chicago", { headline: "Chicago tours Europe this summer" }],
  ];
  for (const [city, item] of examples) {
    const reader = fixture(["Another artist shares a new album", item]);
    for (const region of [null, ...NEWS_REGIONS.map(({ id }) => id)]) {
      for (const sort of ["latest", "top"]) {
        const result = reader.list({ sort, limit: 5, at: NOW, region, city }).stories;
        assert.deepEqual(result.map(({ id }) => id), ["s000", "s001"], `${sort}/${region}: no city or regional boost for ${item.headline}`);
        assert.ok(result.every(({ localTo }) => localTo === undefined), `${sort}/${region}: no false local label`);
        assert.equal(result[1].body, item.body || "", "authored text is preserved");
      }
    }
  }
});

test("true local shows keep their Top lift, including worldwide tour stops", () => {
  const reader = fixture([
    "Singer shares a new album",
    "Drake adds three more Toronto shows",
    "Beyonce's world tour adds shows in London and Toronto",
    { headline: "Pulp announce shows in Glasgow", body: "The announcement arrived at 6 p.m. in Toronto." },
  ]);
  const top = reader.list({ sort: "top", limit: 5, at: NOW, region: "us-canada", city: "Toronto" }).stories;
  assert.deepEqual(top.map(({ id }) => id), ["s001", "s002", "s000"]);
  assert.deepEqual(top.map(({ localTo }) => localTo), ["Toronto", "Toronto", undefined]);
  const latest = reader.list({ limit: 5, at: NOW, region: "us-canada", city: "Toronto" }).stories;
  assert.deepEqual(latest.map(({ id }) => id), ["s000", "s001", "s002"]);
  assert.deepEqual(latest.map(({ localTo }) => localTo), [undefined, "Toronto", "Toronto"]);
  const uk = reader.list({ sort: "top", limit: 5, at: NOW, region: "uk-ireland", city: "Toronto" }).stories;
  assert.deepEqual(uk.map(({ id }) => id), ["s002", "s003", "s000"]);
  assert.equal(uk.find(({ id }) => id === "s003").localTo, undefined, "the timezone reference does not label a UK show as Toronto");
});
