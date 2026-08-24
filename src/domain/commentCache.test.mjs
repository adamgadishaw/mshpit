import assert from "node:assert/strict";
import test from "node:test";

import {
  LEGACY_COMMENT_CACHE_KEY,
  commentCacheStorageKey,
  commentRequestCacheKey,
  createCommentAccountCoordinator,
  resolveAccountCommentCache,
  withoutPendingComments,
} from "./commentCache.mjs";

function memoryPersistence(entries = {}) {
  const values = new Map(Object.entries(entries));
  return {
    read: (key, fallback) => values.has(key) ? values.get(key) : fallback,
    write: (key, value) => values.set(key, value),
    value: (key) => values.get(key),
  };
}

test("comment storage and request keys isolate guest and signed-in viewer projections", () => {
  assert.equal(commentCacheStorageKey(null), "pit.comments.v2.guest");
  assert.equal(commentCacheStorageKey("viewer/a"), "pit.comments.v2.viewer%2Fa");
  assert.notEqual(commentRequestCacheKey("viewer-a", "post", 50), commentRequestCacheKey("viewer-b", "post", 50));
  assert.notEqual(commentRequestCacheKey("viewer-a", "post", 50), commentRequestCacheKey("viewer-a", "post", 100));
});

test("production discards the unattributable global cache instead of assigning it to the cookie account", () => {
  const persistence = memoryPersistence({
    [LEGACY_COMMENT_CACHE_KEY]: { post: [{ id: "viewer-a-filtered" }] },
  });
  const result = resolveAccountCommentCache({
    accountId: "viewer-b",
    read: persistence.read,
    write: persistence.write,
  });
  assert.deepEqual(result, {});
  assert.deepEqual(persistence.value(LEGACY_COMMENT_CACHE_KEY), {});
  assert.deepEqual(persistence.value(commentCacheStorageKey("viewer-b")), {});
});

test("demo mode migrates its device-owned global comments once and preserves an existing scoped empty cache", () => {
  const legacy = { log_1: [{ id: "c1", text: "demo" }] };
  const persistence = memoryPersistence({ [LEGACY_COMMENT_CACHE_KEY]: legacy });
  assert.deepEqual(resolveAccountCommentCache({
    accountId: "u_demo",
    demoEnabled: true,
    demoSeed: { log_1: [{ id: "seed" }] },
    read: persistence.read,
    write: persistence.write,
  }), legacy);
  assert.deepEqual(persistence.value(commentCacheStorageKey("u_demo")), legacy);
  assert.deepEqual(persistence.value(LEGACY_COMMENT_CACHE_KEY), {});

  persistence.write(commentCacheStorageKey("u_demo"), {});
  assert.deepEqual(resolveAccountCommentCache({
    accountId: "u_demo",
    demoEnabled: true,
    demoSeed: { log_1: [{ id: "must-not-reseed" }] },
    read: persistence.read,
    write: persistence.write,
  }), {});
});

test("A to B to A transitions reject the original A claim and pending rows never cross the boundary", () => {
  const coordinator = createCommentAccountCoordinator("viewer-a");
  const firstA = coordinator.capture();
  coordinator.adopt("viewer-b");
  assert.equal(coordinator.isCurrent(firstA, "viewer-b"), false);
  coordinator.adopt("viewer-a");
  assert.equal(coordinator.isCurrent(firstA, "viewer-a"), false, "account equality alone must not revive a prior-session response");
  assert.equal(coordinator.isCurrent(coordinator.capture(), "viewer-a"), true);

  assert.deepEqual(withoutPendingComments({
    post: [{ id: "pending", pending: true }, { id: "confirmed", pending: false }],
    empty: [{ id: "only-pending", pending: true }],
  }), { post: [{ id: "confirmed", pending: false }] });
});
