// A feed page is built from many rows. If projecting ONE row throws, the whole
// page 500s and every user loses the feed, not just the one whose post is bad.
//
// publicUser was already defensive about malformed stored JSON, and the post
// projection guarded `song` inline, but left dims/photos/setlist/tags bare.
// These lock the tolerance in.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

const dataDir = mkdtempSync(join(tmpdir(), "pit-feed-resilience-"));
process.env.PIT_DATA_DIR = dataDir;

const { db, q, parseJsonArray, parseJsonObject } = await import("./db.js");
const { routes } = await import("./api.js");

after(() => {
  db.close();
  rmSync(dataDir, { recursive: true, force: true });
});

test("the JSON helpers absorb every shape a corrupt column can hold", () => {
  for (const bad of ["{broken", "", null, undefined, "null", "[1,2", "not json", "undefined", "{}"]) {
    assert.doesNotThrow(() => parseJsonArray(bad));
    assert.doesNotThrow(() => parseJsonObject(bad));
    assert.ok(Array.isArray(parseJsonArray(bad)));
    assert.equal(typeof parseJsonObject(bad), "object");
  }
  // A value of the wrong TYPE is coerced to the right one, not passed through.
  assert.deepEqual(parseJsonArray('{"a":1}'), [], "an object is not an array");
  assert.deepEqual(parseJsonObject("[1,2,3]"), {}, "an array is not an object");
  assert.deepEqual(parseJsonArray('"a string"'), []);
});

test("one corrupt post does not take down the feed for everyone", () => {
  q.insertUser.run("u_feed", "feed@example.com", "Feed", "feeduser", "hash", "fan", null, null, null, "F", "#123456", Date.now());

  const good = db.prepare(`INSERT INTO posts (id,user_id,artist,venue,city,date,overall,band,room,review,dims,photos,setlist,tags,kind,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  good.run("p_ok", "u_feed", "Artist", "Venue", "City", "2026-01-01", 5, 5, 5, "fine", "{}", "[]", "[]", "[]", "review", Date.now());

  // Exactly the corruption the old code would have thrown on.
  good.run("p_bad", "u_feed", "Artist", "Venue", "City", "2026-01-02", 5, 5, 5, "bad row",
    "{broken", "[not-json", "{\"wrong\":\"type\"}", "null", "review", Date.now());

  const result = routes["GET /api/feed"]({ query: { limit: 20 }, user: null });
  const posts = result.posts || result.items || [];
  assert.ok(posts.length >= 2, `expected both posts back, got ${posts.length}`);

  const bad = posts.find((p) => p.id === "p_bad");
  assert.ok(bad, "the corrupt row must still be served, degraded");
  assert.deepEqual(bad.photos, [], "an unparseable array degrades to empty");
  assert.deepEqual(bad.setlist, [], "an object in an array column degrades to empty");
  assert.deepEqual(bad.tags, []);
  assert.deepEqual(bad.dims, {}, "an unparseable object degrades to empty");

  // And the healthy row beside it is untouched.
  const ok = posts.find((p) => p.id === "p_ok");
  assert.deepEqual(ok.photos, []);
  assert.equal(ok.review, "fine");
});
