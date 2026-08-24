import assert from "node:assert/strict";
import test from "node:test";

import {
  NOTIFICATION_BUNDLE_WINDOW_MS,
  bundleNotifications,
  notificationActorSummary,
  notificationBundleTarget,
} from "./notification-bundles.mjs";

const like = (id, actorId, actorName, ts, postId = "post-1") => ({
  id, actorId, actorName, ts, postId, type: "like", read: true,
});

test("notification bundles are deterministic by type, target, timestamp and id", () => {
  const input = [
    like("n-1", "adam", "Adam", 1_000),
    { ...like("n-3", "cara", "Cara", 3_000), read: false },
    like("n-2", "bea", "Bea", 2_000),
    { ...like("n-4", "drew", "Drew", 2_500), type: "comment" },
    like("n-5", "erin", "Erin", 2_400, "post-2"),
  ];
  const forward = bundleNotifications(input);
  const reversed = bundleNotifications(input.slice().reverse());

  assert.deepEqual(forward, reversed);
  assert.equal(forward.length, 3);
  assert.equal(forward[0].count, 3);
  assert.equal(forward[0].primary.id, "n-3");
  assert.equal(forward[0].read, false);
  assert.equal(forward[1].type, "comment");
  assert.equal(forward[2].target, "post:post-2");
});

test("a bundle never spans beyond its newest event rolling window", () => {
  const newest = 3 * NOTIFICATION_BUNDLE_WINDOW_MS;
  const bundles = bundleNotifications([
    like("new", "adam", "Adam", newest),
    like("edge", "bea", "Bea", newest - NOTIFICATION_BUNDLE_WINDOW_MS),
    like("old", "cara", "Cara", newest - NOTIFICATION_BUNDLE_WINDOW_MS - 1),
  ]);

  assert.equal(bundles.length, 2);
  assert.deepEqual(bundles[0].items.map((item) => item.id), ["new", "edge"]);
  assert.deepEqual(bundles[1].items.map((item) => item.id), ["old"]);
});

test("actor summaries stay accessible and count distinct people", () => {
  const items = Array.from({ length: 9 }, (_, index) => like(
    `n-${index}`,
    `actor-${index}`,
    index === 0 ? "Adam" : `Fan ${index}`,
    10_000 - index,
  ));
  assert.equal(notificationActorSummary(items), "Adam and 8 others");
  assert.equal(notificationActorSummary([items[0], { ...items[0], id: "repeat" }]), "Adam");
  assert.equal(notificationActorSummary([items[0], items[1]]), "Adam and Fan 1");
});

test("bundle targets keep conversations separate and malformed post activity isolated", () => {
  assert.equal(notificationBundleTarget({ id: "follow-1", type: "follow", actorId: "adam" }), "account");
  assert.equal(notificationBundleTarget({ id: "dm-1", type: "dm", actorId: "adam" }), "thread:adam");
  assert.equal(notificationBundleTarget({ id: "like-1", type: "like", postId: "post-1" }), "post:post-1");
  assert.equal(notificationBundleTarget({ id: "tag-1", type: "post_tag", postId: "post-1" }), "post:post-1");
  assert.notEqual(
    notificationBundleTarget({ id: "bad-1", type: "like" }),
    notificationBundleTarget({ id: "bad-2", type: "like" }),
  );
});
