import assert from "node:assert/strict";
import test from "node:test";

import {
  isCurrentNotificationPostRequest,
  normalizeFetchedNotificationPost,
  notificationDestination,
  notificationPostFailureNotice,
  resolveNotificationPost,
} from "./notificationDeepLink.mjs";

test("notification destinations preserve social intent", () => {
  assert.deepEqual(notificationDestination({ type: "follow", actorId: "fan-b" }), { kind: "profile", actorId: "fan-b" });
  assert.deepEqual(notificationDestination({ type: "dm", actorId: "fan-b" }), { kind: "thread", actorId: "fan-b" });
  assert.deepEqual(notificationDestination({ type: "comment", postId: "post-1" }), { kind: "post", postId: "post-1" });
  assert.deepEqual(notificationDestination({ type: "like", postId: null }), { kind: "unavailable" });
});

test("a missing local notification post requests its canonical server record", () => {
  const notification = { type: "like", postId: "post-2" };
  assert.deepEqual(resolveNotificationPost(notification, [{ id: "post-1" }]), { kind: "fetch-post", postId: "post-2" });
  assert.deepEqual(resolveNotificationPost(notification, [{ id: "post-2", artist: "SZA" }]), { kind: "local-post", post: { id: "post-2", artist: "SZA" } });
});

test("fetched notification posts must match the requested id and normalize arrays", () => {
  assert.equal(normalizeFetchedNotificationPost({ post: { id: "other" } }, "post-2"), null);
  assert.equal(normalizeFetchedNotificationPost({ post: null }, "post-2"), null);
  assert.deepEqual(normalizeFetchedNotificationPost({ post: { id: "post-2", photos: null } }, "post-2"), {
    id: "post-2", photos: [], media: [], mediaAssetIds: [], setlist: [],
  });
});

test("notification post reads reject stale sequence, account, post, and abort state", () => {
  const controller = new AbortController();
  const active = { sequence: 3, accountId: "fan-a", postId: "post-2", controller };
  assert.equal(isCurrentNotificationPostRequest(active, { sequence: 3, accountId: "fan-a", postId: "post-2" }), true);
  assert.equal(isCurrentNotificationPostRequest(active, { sequence: 2, accountId: "fan-a", postId: "post-2" }), false);
  assert.equal(isCurrentNotificationPostRequest(active, { sequence: 3, accountId: "fan-b", postId: "post-2" }), false);
  assert.equal(isCurrentNotificationPostRequest(active, { sequence: 3, accountId: "fan-a", postId: "post-3" }), false);
  controller.abort();
  assert.equal(isCurrentNotificationPostRequest(active, { sequence: 3, accountId: "fan-a", postId: "post-2" }), false);
});

test("notification post failures distinguish unavailable content from retryable reads", () => {
  assert.equal(notificationPostFailureNotice({ status: 404 }), "This post is no longer available.");
  assert.equal(notificationPostFailureNotice({ status: 403 }), "This post is no longer available.");
  assert.equal(notificationPostFailureNotice({ status: 410 }), "This post is no longer available.");
  assert.equal(notificationPostFailureNotice({ status: 500 }), "This post couldn't load. Check your connection and try again.");
  assert.equal(notificationPostFailureNotice(new Error("offline")), "This post couldn't load. Check your connection and try again.");
});
