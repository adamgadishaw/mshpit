import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { cleanTimesSeen, ensureSeenBaselineSchema, projectSupportingActs, seenOrdinalForPost } from "./supportingActs.js";
import { parseTimesSeen } from "../src/domain/supportingActs.mjs";

function fixture(t) {
  const database = new DatabaseSync(":memory:"); t.after(() => database.close());
  database.exec(`CREATE TABLE users(id TEXT PRIMARY KEY); INSERT INTO users VALUES ('fan');
    CREATE TABLE artists(norm TEXT PRIMARY KEY,public_slug TEXT);
    CREATE TABLE posts(id TEXT PRIMARY KEY,user_id TEXT,artist TEXT,artist_key TEXT,removed INTEGER DEFAULT 0,
      kind TEXT DEFAULT 'review',experience_type TEXT DEFAULT 'in_person',date TEXT,created_at INTEGER,supporting_acts TEXT DEFAULT '[]');`);
  ensureSeenBaselineSchema(database);
  let at = 0;
  const put = (id, artist, artistKey, date, acts = []) => database.prepare(`INSERT INTO posts
    (id,user_id,artist,artist_key,date,created_at,supporting_acts) VALUES (?,'fan',?,?,?,?,?)`)
    .run(id, artist, artistKey, date, ++at, JSON.stringify(acts));
  return { database, put, count: id => seenOrdinalForPost(database, id) };
}

test("times seen never merges two explicitly different artist identities sharing a name", t => {
  const f = fixture(t);
  f.put("old", "Same Name", "act-one", "2026-01-01");
  f.put("later", "Same Name", "act-two", "2026-02-01");
  assert.equal(f.count("later"), 1);
  f.put("legacy", "Same Name", null, "2025-01-01");
  assert.equal(f.count("later"), 2, "unbound historical records keep the documented name fallback");
});

test("the same opener mentioned in several festival reviews counts as one dated sighting", t => {
  const f = fixture(t), opener = [{ name: "Opener", artistKey: "opener" }];
  f.put("headliner-a", "Headliner A", "a", "2026-01-01", opener);
  f.put("headliner-b", "Headliner B", "b", "2026-01-01", opener);
  f.put("later", "Opener", "opener", "2026-02-01");
  assert.equal(f.count("later"), 2);
  f.put("another-night", "Headliner C", "c", "2026-01-02", opener);
  assert.equal(f.count("later"), 3);
  f.put("direct-review", "Opener", "opener", "2026-01-01");
  assert.equal(f.count("later"), 3, "a same-night direct review replaces rather than adds to opener sightings");
});

test("an opener's different known identity cannot be replaced by a same-name review", t => {
  const f = fixture(t);
  f.put("main", "Headliner", "main", "2026-01-01", [{ name: "Same Name", artistKey: "act-one" }]);
  f.put("wrong", "Same Name", "act-two", "2026-01-01");
  f.put("later", "Same Name", "act-one", "2026-02-01");
  assert.equal(f.count("later"), 2);
  assert.equal(projectSupportingActs(f.database, f.database.prepare("SELECT * FROM posts WHERE id='main'").get())[0].reviewPostId, null);
  f.put("right", "Same Name", "act-one", "2026-01-01");
  assert.equal(projectSupportingActs(f.database, f.database.prepare("SELECT * FROM posts WHERE id='main'").get())[0].reviewPostId, "right");
  assert.equal(f.count("later"), 2);
});

test("unknown dates remain separate sightings rather than inventing a shared night", t => {
  const f = fixture(t), opener = [{ name: "Opener", artistKey: "opener" }];
  f.put("unknown-a", "Headliner A", "a", "", opener);
  f.put("unknown-b", "Headliner B", "b", "", opener);
  f.put("later", "Opener", "opener", "2026-02-01");
  assert.equal(f.count("later"), 3);
});

test("times-seen input rejects JSON arrays, booleans and objects instead of coercing them", () => {
  for (const value of [true, false, [], [1], [999], {}, { value: 5 }]) {
    assert.equal(cleanTimesSeen(value), false);
    assert.equal(parseTimesSeen(value), null);
  }
  for (const value of [1, 999, "1", " 3 "]) assert.equal(cleanTimesSeen(value), Number(value));
  assert.equal(cleanTimesSeen(null), null); assert.equal(cleanTimesSeen(undefined), undefined);
});
