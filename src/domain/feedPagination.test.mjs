import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { captureFeedRead, feedReadIsCurrent, filteredFeedNextAction } from "./feedPagination.mjs";

test("filtered feeds reveal matches already in memory before fetching", () => {
  assert.equal(filteredFeedNextAction({
    filter: "following",
    visibleCount: 8,
    loadedMatchCount: 19,
    hasMore: true,
    loadingMore: false,
  }), "reveal");
});

test("filtered feeds fetch only after all loaded matches are visible", () => {
  assert.equal(filteredFeedNextAction({
    filter: "local",
    visibleCount: 8,
    loadedMatchCount: 8,
    hasMore: true,
    loadingMore: false,
  }), "fetch");
  assert.equal(filteredFeedNextAction({
    filter: "local",
    visibleCount: 8,
    loadedMatchCount: 8,
    hasMore: true,
    loadingMore: true,
  }), "none");
});

test("the everyone feed keeps using its normal end-reached path", () => {
  assert.equal(filteredFeedNextAction({
    filter: "everyone",
    visibleCount: 8,
    loadedMatchCount: 20,
    hasMore: true,
    loadingMore: false,
  }), "none");
});

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

// Execute the actual store readers with controlled transport/React setters.
// Transport deliberately ignores abort so publication guards are exercised too.
const store = readFileSync(new URL("../store.js", import.meta.url), "utf8");
const readersStart = store.indexOf("const currentFeedReadState =");
const readersEnd = store.indexOf("const revalidateCachedFeed =", readersStart);
assert.ok(readersStart >= 0 && readersEnd > readersStart);
const readersSource = store.slice(readersStart, readersEnd);

function feedHarness() {
  const state = { posts: [{ id: "head" }], cursor: "initial-cursor", hasMore: true, loading: false };
  const calls = [];
  const events = [];
  const refs = {
    feedAccountIdRef: { current: "A" },
    accountMutationEpochRef: { current: 1 },
    feedRefreshRef: { current: { inFlight: false, sequence: 1 } },
    feedMutationRevisionRef: { current: 0 },
    feedLoadMoreRef: { current: null },
    feedModeRef: { current: "for-you" },
    feedAlgorithmRef: { current: "personal-v1" },
    feedSnapshotIdentityRef: { current: "for-you:1" },
    feedPageRef: { current: 1 },
  };
  const render = () => {
    const dependencies = {
      ...refs, captureFeedRead, feedReadIsCurrent,
      feedLoadingMore: state.loading, feedHasMore: state.hasMore, feedNextCursor: state.cursor,
      FEED_PAGE_LIMIT: 20, ENABLE_DEMO_DATA: false,
      api: (url, options) => {
        const pending = deferred();
        calls.push({ ...pending, url, options });
        return pending.promise;
      },
      mergeServerFeed: (posts, { authoritative, prepend }) => {
        state.posts = authoritative ? posts : prepend ? [...posts, ...state.posts] : [...state.posts, ...posts];
      },
      setFeedLoadingMore: (value) => { state.loading = value; },
      setFeedNextCursor: (value) => { state.cursor = value; },
      setFeedHasMore: (value) => { state.hasMore = value; },
      trackProductEvent: (...args) => events.push(args),
      analyticsDurationBucket: () => "under_1s",
    };
    return new Function(...Object.keys(dependencies), `"use strict"; ${readersSource}; return { hydrateFeed, loadMoreFeed };`)(...Object.values(dependencies));
  };
  return { state, refs, calls, events, render };
}

test("a late next page cannot replace a refreshed head or its cursor", async () => {
  const h = feedHarness();
  const oldPage = h.render().loadMoreFeed();
  const refreshed = h.render().hydrateFeed();
  assert.equal(h.calls[0].options.signal.aborted, true);
  assert.equal(await h.render().loadMoreFeed(), false, "no pagination while the head is changing");
  assert.equal(h.calls.length, 2);
  h.calls[1].resolve({ posts: [{ id: "new-head" }], nextCursor: "new-cursor", algorithm: { id: "new-algorithm", snapshotAt: 2 } });
  assert.equal(await refreshed, true);
  h.calls[0].resolve({ posts: [{ id: "old-page" }], nextCursor: "old-cursor", algorithm: { id: "old-algorithm" } });
  assert.equal(await oldPage, false);
  assert.deepEqual(h.state.posts, [{ id: "new-head" }]);
  assert.equal(h.state.cursor, "new-cursor");
  assert.equal(h.refs.feedAlgorithmRef.current, "new-algorithm");
  assert.equal(h.refs.feedPageRef.current, 1);
});

test("a late prior-account page neither falls back nor releases a new account's page lock", async () => {
  for (const failure of [false, true]) {
    const h = feedHarness();
    const oldPage = h.render().loadMoreFeed();
    h.refs.feedAccountIdRef.current = "B";
    h.refs.accountMutationEpochRef.current += 1;
    const headB = h.render().hydrateFeed();
    h.calls[1].resolve({ posts: [{ id: "B-head" }], nextCursor: "B-next", algorithm: { snapshotAt: 2 } });
    await headB;
    const pageB = h.render().loadMoreFeed();
    const currentLock = h.refs.feedLoadMoreRef.current;
    if (failure) h.calls[0].reject({ status: 403, serverCode: "FORBIDDEN" });
    else h.calls[0].resolve({ posts: [{ id: "A-private" }], nextCursor: "A-cursor" });
    assert.equal(await oldPage, false);
    assert.equal(h.calls.length, 3, "an obsolete failure must not start a fallback request");
    assert.equal(h.refs.feedLoadMoreRef.current, currentLock);
    assert.equal(h.state.loading, true);
    assert.deepEqual(h.state.posts, [{ id: "B-head" }]);
    h.calls[2].resolve({ posts: [{ id: "B-page" }], nextCursor: "B-last" });
    assert.equal(await pageB, true);
    assert.deepEqual(h.state.posts, [{ id: "B-head" }, { id: "B-page" }]);
    assert.equal(h.state.cursor, "B-last");
    assert.equal(h.refs.feedLoadMoreRef.current, null);
    assert.equal(h.state.loading, false);
  }
});

test("obsolete head responses cannot change feed mode or start a legacy fallback", async () => {
  for (const failure of [false, true]) {
    const h = feedHarness();
    const oldHead = h.render().hydrateFeed();
    h.refs.feedAccountIdRef.current = "B";
    h.refs.accountMutationEpochRef.current += 1;
    h.refs.feedRefreshRef.current.sequence += 1;
    h.refs.feedRefreshRef.current.inFlight = false;
    const currentHead = h.render().hydrateFeed();
    h.calls[1].resolve({ posts: [{ id: "B-head" }], nextCursor: "B-next", algorithm: { id: "B-algorithm", snapshotAt: 2 } });
    await currentHead;
    if (failure) h.calls[0].reject({ status: 409, serverCode: "IDENTITY_CHANGED" });
    else h.calls[0].resolve({ posts: [{ id: "A-private" }], nextCursor: "A-cursor", algorithm: { id: "A-algorithm" } });
    assert.equal(await oldHead, null);
    assert.equal(h.calls.length, 2);
    assert.deepEqual(h.state.posts, [{ id: "B-head" }]);
    assert.equal(h.refs.feedAlgorithmRef.current, "B-algorithm");
    assert.equal(h.state.cursor, "B-next");
  }
});

test("valid current-account fallback keeps card positions and adopts a legacy cursor", async () => {
  const h = feedHarness();
  const page = h.render().loadMoreFeed();
  assert.equal(await h.render().loadMoreFeed(), false, "duplicate end-reached is locked immediately");
  h.calls[0].reject({ status: 503 });
  await Promise.resolve();
  assert.match(h.calls[1].url, /^\/api\/feed\?limit=/);
  assert.equal(h.calls[1].options.signal, h.calls[0].options.signal);
  h.calls[1].resolve({ posts: [{ id: "legacy-page" }], nextCursor: "legacy-next" });
  assert.equal(await page, true);
  assert.deepEqual(h.state.posts, [{ id: "head" }, { id: "legacy-page" }]);
  assert.equal(h.state.cursor, "legacy-next");
  assert.equal(h.refs.feedModeRef.current, "legacy");
  assert.equal(h.refs.feedAlgorithmRef.current, "chronological-v1");
});

test("local mutations invalidate pending pages without changing existing feed state", async () => {
  const h = feedHarness();
  const page = h.render().loadMoreFeed();
  h.refs.feedMutationRevisionRef.current += 1;
  h.calls[0].resolve({ posts: [{ id: "old-page" }], nextCursor: "old-cursor" });
  assert.equal(await page, false);
  assert.deepEqual(h.state.posts, [{ id: "head" }]);
  assert.equal(h.state.cursor, "initial-cursor");
  assert.equal(h.state.loading, false);
});

test("feed tickets reject account roundtrips, cancellation and identity changes", () => {
  const current = { accountId: "A", epoch: 1, sequence: 2, mutationRevision: 3 };
  const read = captureFeedRead(current);
  assert.equal(feedReadIsCurrent(read, current), true);
  assert.equal(feedReadIsCurrent(read, { ...current, epoch: 3 }), false);
  assert.equal(feedReadIsCurrent(read, current, { error: { serverCode: "IDENTITY_CHANGED" } }), false);
  assert.equal(feedReadIsCurrent(read, current, { error: { name: "AbortError" } }), false);
  assert.equal(feedReadIsCurrent(read, current, { signal: { aborted: true } }), false);
});
