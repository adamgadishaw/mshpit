import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

const directory = mkdtempSync(join(tmpdir(), "pit-feed-history-"));
process.env.PIT_DATA_DIR = directory;
const { db, q } = await import("./db.js");
const { routes } = await import("./api.js");
const { clearRecommendationSnapshotsForTests } = await import("./recommendationService.js");
after(() => { db.close(); rmSync(directory, { recursive: true, force: true }); });
const at = Date.now() - 10_000;
function user(id, city) {
  q.insertUser.run(id, `${id}@example.test`, id, id, "hash", "fan", city, null, null, "FH", "#123456", at);
  return q.userById.get(id);
}
const viewer = user("history_viewer", "Toronto");
const local = user("history_local", "Toronto");
const remote = user("history_remote", "Montreal");
const blocked = user("history_blocked", "Toronto");
db.prepare("INSERT INTO blocks(blocker_id,blocked_id,created_at) VALUES(?,?,?)").run(blocked.id, viewer.id, at);
const insert = db.prepare("INSERT INTO posts(id,user_id,artist,venue,overall,created_at) VALUES(?,?,?,'Venue',4,?)");
db.exec("BEGIN");
for (let i = 0; i < 65; i++) insert.run(`p_history_${String(i).padStart(4,"0")}`, local.id, "Artist", at - i);
for (let i = 0; i < 8; i++) insert.run(`p_remote_${i}`, remote.id, "Artist", at - i);
insert.run("p_blocked_history", blocked.id, "Artist", at);
db.exec("COMMIT");

function allPages(route, query) {
  const posts = [];
  let cursor = null;
  let pages = 0;
  do {
    const page = routes[route]({ user: q.userById.get(viewer.id), ip: "history-test", query: { ...query, limit: "50", ...(cursor ? { [route.endsWith("for-you") ? "cursor" : "before"]: cursor } : {}) } });
    posts.push(...page.posts);
    cursor = page.nextCursor;
    assert.ok(++pages < 100, "pagination must reach genuine exhaustion");
  } while (cursor);
  assert.equal(new Set(posts.map(post => post.id)).size, posts.length, "pages never duplicate cards");
  return posts;
}

test("For You continues past candidate/author limits through all eligible history", () => {
  clearRecommendationSnapshotsForTests();
  const posts = allPages("GET /api/feed/for-you", {});
  assert.equal(posts.length, 73);
  assert.ok(posts.some(post => post.id === "p_history_0064"));
  assert.ok(posts.every(post => post.userId !== blocked.id));
  // The chronological tail remains stable even for equal timestamps.
  const tail = posts.slice(20);
  for (let i = 1; i < tail.length; i++) assert.ok(tail[i-1].createdAt >= tail[i].createdAt);
});

test("Local cursor pages exhaust home-city authors independently of recommendations", () => {
  const posts = allPages("GET /api/feed", { mode: "local" });
  assert.equal(posts.length, 65);
  assert.ok(posts.every(post => post.userId === local.id));
  assert.equal(q.userById.get(viewer.id).home_city, "Toronto");
});

test("Local without a saved city is empty rather than another city's history", () => {
  const guestCity = user("history_no_city", null);
  const page = routes["GET /api/feed"]({ user: guestCity, query: { mode: "local", limit: "50" } });
  assert.deepEqual(page.posts, []);
  assert.equal(page.nextCursor, null);
});
