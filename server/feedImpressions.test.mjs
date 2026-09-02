import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

const dataDir = mkdtempSync(join(tmpdir(), "pit-feed-impressions-"));
process.env.PIT_DATA_DIR = dataDir;

const { db, q } = await import("./db.js");
const { ApiError, routes } = await import("./api.js");
const {
  cleanFeedImpressionBatch,
  FEED_IMPRESSION_HISTORY_RETENTION_MS,
  pruneExpiredFeedImpressionHistory,
  recordFeedImpressions,
  resetFeedImpressionPruneClockForTests,
} = await import("./feedImpressions.js");
const { clearRecommendationSnapshotsForTests } = await import("./recommendationService.js");

after(() => {
  db.close();
  rmSync(dataDir, { recursive: true, force: true });
});

function addUser(id) {
  q.insertUser.run(
    id, `${id}@example.test`, id, id, "hash", "fan", "Toronto",
    43.65, -79.38, id.slice(0, 2).toUpperCase(), "#123456", Date.now(),
  );
  return q.userById.get(id);
}

function addPost(id, userId, artist = "Artist", createdAt = Date.now()) {
  db.prepare(`INSERT INTO posts
    (id,user_id,artist,venue,city,overall,review,created_at) VALUES (?,?,?,?,?,?,?,?)`)
    .run(id, userId, artist, "Venue", "Toronto", 4, "A real music post.", createdAt);
}

test("impression batches are authenticated, idempotent, private, and exclude ineligible or self views", () => {
  const viewer = addUser("impviewer");
  const author = addUser("impauthor");
  addPost("p_impression_live", author.id);
  const handler = routes["POST /api/feed/impressions"];
  assert.throws(
    () => handler({ body: { impressions: [{ postId: "p_impression_live", eventId: "event_auth_001" }] } }),
    (error) => error instanceof ApiError && error.status === 401,
  );

  const first = handler({
    user: viewer,
    ip: "imp-viewer",
    body: { impressions: [
      { postId: "p_impression_live", eventId: "event_live_001", surface: "everyone" },
      { postId: "p_impression_live", eventId: "event_live_001", surface: "everyone" },
    ] },
  });
  assert.deepEqual(first, {
    received: 2,
    recorded: 1,
    counted: 1,
    acknowledgedEventIds: ["event_live_001"],
  });
  assert.deepEqual(handler({
    user: viewer,
    ip: "imp-viewer",
    body: { impressions: [{ postId: "p_impression_live", eventId: "event_live_001" }] },
  }), {
    received: 1,
    recorded: 0,
    counted: 0,
    acknowledgedEventIds: ["event_live_001"],
  });
  const quickRepeat = handler({
    user: viewer,
    ip: "imp-viewer",
    body: { impressions: [{ postId: "p_impression_live", eventId: "event_live_002" }] },
  });
  assert.equal(quickRepeat.recorded, 1);
  assert.equal(quickRepeat.counted, 0, "new viewport callbacks inside five minutes do not inflate counts");

  const memberPost = routes["GET /api/feed"]({ user: viewer, query: { limit: "20" } }).posts
    .find((post) => post.id === "p_impression_live");
  assert.equal(memberPost.viewCount, 1, "repeat callbacks do not inflate a current member-view count");
  assert.equal(memberPost.viewerSeen.count, 1);
  assert.equal(Number.isInteger(memberPost.viewerSeen.firstSeenAt), true);
  assert.equal(Number.isInteger(memberPost.viewerSeen.lastSeenAt), true);
  const guestPost = routes["GET /api/feed"]({ user: null, query: { limit: "20" } }).posts
    .find((post) => post.id === "p_impression_live");
  assert.equal(guestPost.viewCount, 1);
  assert.equal(Object.hasOwn(guestPost, "viewerSeen"), false, "private viewer history is not projected to guests");

  const self = handler({
    user: author,
    ip: "imp-author",
    body: { impressions: [{ postId: "p_impression_live", eventId: "event_self_001" }] },
  });
  assert.equal(self.recorded, 0, "authors cannot inflate their own tally");
  assert.deepEqual(self.acknowledgedEventIds, ["event_self_001"], "a no-op is acknowledged so it cannot retry forever");

  const blockedAuthor = addUser("impblockedauthor");
  addPost("p_impression_blocked", blockedAuthor.id);
  db.prepare("INSERT INTO blocks (blocker_id,blocked_id,created_at) VALUES (?,?,?)")
    .run(blockedAuthor.id, viewer.id, Date.now());
  assert.equal(handler({
    user: viewer,
    ip: "imp-viewer",
    body: { impressions: [{ postId: "p_impression_blocked", eventId: "event_blocked_01" }] },
  }).recorded, 0);
  addPost("p_impression_removed", blockedAuthor.id);
  db.prepare("UPDATE posts SET removed=1 WHERE id='p_impression_removed'").run();
  assert.equal(handler({
    user: viewer,
    ip: "imp-viewer",
    body: { impressions: [{ postId: "p_impression_removed", eventId: "event_removed_01" }] },
  }).recorded, 0);
  assert.throws(() => cleanFeedImpressionBatch([
    { postId: "p_impression_live", eventId: "event_conflict_1" },
    { postId: "p_impression_blocked", eventId: "event_conflict_1" },
  ]), (error) => error instanceof ApiError && error.code === "VALIDATION_FAILED");
});

test("return views rotate privately, repair a missing aggregate, and cascade at privacy boundaries", () => {
  const viewer = q.userById.get("impviewer");
  const author = q.userById.get("impauthor");
  const before = db.prepare(`SELECT last_seen_at FROM post_impressions
    WHERE user_id=? AND post_id=?`).get(viewer.id, "p_impression_live");
  const later = Number(before.last_seen_at) + 5 * 60_000 + 1;
  const counted = recordFeedImpressions(db, {
    userId: viewer.id,
    at: later,
    impressions: [{ postId: "p_impression_live", eventId: "event_later_001" }],
  });
  assert.deepEqual(counted, { recorded: 1, counted: 1 });
  assert.equal(db.prepare(`SELECT seen_count FROM post_impressions
    WHERE user_id=? AND post_id=?`).get(viewer.id, "p_impression_live").seen_count, 2);
  assert.equal(db.prepare("SELECT view_count FROM post_impression_totals WHERE post_id=?")
    .get("p_impression_live").view_count, 1, "return sessions do not change member reach while private history exists");

  db.prepare("DELETE FROM post_impression_totals WHERE post_id=?").run("p_impression_live");
  const repaired = recordFeedImpressions(db, {
    userId: viewer.id,
    at: later + 1,
    impressions: [{ postId: "p_impression_live", eventId: "event_repair_01" }],
  });
  assert.deepEqual(repaired, { recorded: 1, counted: 0 });
  assert.equal(db.prepare("SELECT view_count FROM post_impression_totals WHERE post_id=?")
    .get("p_impression_live").view_count, 1, "repair does not claim a second counted session");

  addPost("p_impression_aged", author.id);
  db.prepare(`INSERT INTO post_impressions
    (user_id,post_id,seen_count,first_seen_at,last_seen_at) VALUES (?,?,1,1,1)`)
    .run(viewer.id, "p_impression_aged");
  db.prepare(`INSERT INTO post_impression_totals
    (post_id,view_count,first_seen_at,last_seen_at) VALUES (?,1,1,1)`)
    .run("p_impression_aged");
  db.prepare(`INSERT INTO post_impression_receipts
    (user_id,event_id,post_id,created_at) VALUES (?,?,?,?)`)
    .run(viewer.id, "event_expired_1", "p_impression_live", 1);
  const pruneAt = FEED_IMPRESSION_HISTORY_RETENTION_MS + 2;
  assert.deepEqual(pruneExpiredFeedImpressionHistory(db, { at: pruneAt }), {
    receiptsDeleted: 1,
    historyDeleted: 1,
  }, "retention runs independently even when nobody records a new impression");
  assert.equal(db.prepare("SELECT 1 FROM post_impression_receipts WHERE event_id='event_expired_1'").get(), undefined);
  assert.equal(db.prepare("SELECT 1 FROM post_impressions WHERE post_id='p_impression_aged'").get(), undefined,
    "private personalization history ages out automatically");
  assert.equal(db.prepare("SELECT view_count FROM post_impression_totals WHERE post_id='p_impression_aged'").get().view_count, 1,
    "aging private history does not rewrite the anonymous post tally");
  assert.equal(FEED_IMPRESSION_HISTORY_RETENTION_MS, 180 * 24 * 60 * 60_000);
  db.prepare("DELETE FROM posts WHERE id='p_impression_aged'").run();

  addPost("p_impression_recount", author.id);
  db.prepare(`INSERT INTO post_impressions
    (user_id,post_id,seen_count,first_seen_at,last_seen_at) VALUES (?,?,1,1,1)`)
    .run(viewer.id, "p_impression_recount");
  db.prepare(`INSERT INTO post_impression_totals
    (post_id,view_count,first_seen_at,last_seen_at) VALUES (?,1,1,1)`)
    .run("p_impression_recount");
  assert.deepEqual(pruneExpiredFeedImpressionHistory(db, { at: pruneAt }), {
    receiptsDeleted: 0,
    historyDeleted: 1,
  });
  assert.deepEqual(recordFeedImpressions(db, {
    userId: viewer.id,
    at: pruneAt + 1,
    impressions: [{ postId: "p_impression_recount", eventId: "event_recount_01" }],
  }), { recorded: 1, counted: 1 });
  assert.equal(db.prepare("SELECT view_count FROM post_impression_totals WHERE post_id=?")
    .get("p_impression_recount").view_count, 2,
  "a later view can count again after the private dedupe history ages out, as disclosed");
  db.prepare("DELETE FROM posts WHERE id='p_impression_recount'").run();

  db.prepare("DELETE FROM users WHERE id=?").run(viewer.id);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM post_impressions WHERE user_id=?").get(viewer.id).c, 0);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM post_impression_receipts WHERE user_id=?").get(viewer.id).c, 0);
  assert.equal(db.prepare("SELECT view_count FROM post_impression_totals WHERE post_id=?")
    .get("p_impression_live").view_count, 1, "the anonymous aggregate can survive account erasure");
  db.prepare("DELETE FROM posts WHERE id=?").run("p_impression_live");
  assert.equal(db.prepare("SELECT 1 FROM post_impression_totals WHERE post_id='p_impression_live'").get(), undefined);
});

test("feed-impression retention has an index led by the expiry timestamp", () => {
  const indexes = db.prepare("PRAGMA index_list('post_impressions')").all();
  assert.ok(indexes.some((row) => row.name === "idx_post_impressions_retention"));
  const columns = db.prepare("PRAGMA index_info('idx_post_impressions_retention')").all();
  assert.deepEqual(columns.map((row) => row.name), ["last_seen_at", "user_id", "post_id"]);
  resetFeedImpressionPruneClockForTests();
});

test("a recorded view invalidates only the next head snapshot and rotates the seen post down", () => {
  const viewer = addUser("rankviewer");
  const strongAuthor = addUser("rankstrong");
  const otherAuthor = addUser("rankother");
  const at = Date.now();
  addPost("p_rank_seen", strongAuthor.id, "Rank Artist Seen", at);
  addPost("p_rank_other", otherAuthor.id, "Rank Artist Other", at);
  for (let index = 0; index < 20; index++) {
    const liker = addUser(`ranklike${index}`);
    db.prepare("INSERT INTO likes (post_id,user_id) VALUES (?,?)").run("p_rank_seen", liker.id);
  }
  clearRecommendationSnapshotsForTests();
  const first = routes["GET /api/feed/for-you"]({ user: viewer, ip: "rank-viewer", query: { limit: "50" } });
  const firstIds = first.posts.map((post) => post.id);
  assert.ok(firstIds.indexOf("p_rank_seen") < firstIds.indexOf("p_rank_other"));
  routes["POST /api/feed/impressions"]({
    user: viewer,
    ip: "rank-viewer",
    body: { impressions: [{ postId: "p_rank_seen", eventId: "event_rank_seen_1", surface: "for_you" }] },
  });
  const refreshed = routes["GET /api/feed/for-you"]({ user: viewer, ip: "rank-viewer", query: { limit: "50" } });
  const refreshedIds = refreshed.posts.map((post) => post.id);
  assert.ok(refreshedIds.indexOf("p_rank_other") < refreshedIds.indexOf("p_rank_seen"));
  assert.equal(refreshed.posts.find((post) => post.id === "p_rank_seen").recommendation.rotation.alreadySeen, true);
  assert.equal(refreshed.algorithm.version, 2);
  assert.match(refreshed.algorithm.seenRotation, /lowered, not hidden/i);
});
