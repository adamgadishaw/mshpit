import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import {
  SHOW_DISCUSSION_COUNT_LIMIT,
  hasPostDiscussion,
  showDiscussionCount,
} from "./showDiscussion.mjs";

const showScreen = readFileSync(new URL("../screens/ShowScreen.jsx", import.meta.url), "utf8");
const postScreen = readFileSync(new URL("../screens/PostScreen.jsx", import.meta.url), "utf8");
const nearbyAfterparty = readFileSync(new URL("../components/NearbyAfterparty.jsx", import.meta.url), "utf8");
const store = readFileSync(new URL("../store.js", import.meta.url), "utf8");
const commentCacheHook = readFileSync(new URL("../features/comments/useAccountCommentCache.js", import.meta.url), "utf8");

test("discussion counts are honest, integer, and bounded for compact display", () => {
  assert.equal(showDiscussionCount(undefined), null);
  assert.equal(showDiscussionCount(""), null);
  assert.equal(showDiscussionCount("   "), null);
  assert.equal(showDiscussionCount(false), null);
  assert.equal(showDiscussionCount([]), null);
  assert.equal(showDiscussionCount(-1), null);
  assert.equal(showDiscussionCount(Number.NaN), null);
  assert.deepEqual(showDiscussionCount(0), { value: 0, label: "0", capped: false });
  assert.deepEqual(showDiscussionCount("12.9"), { value: 12, label: "12", capped: false });
  assert.deepEqual(showDiscussionCount(SHOW_DISCUSSION_COUNT_LIMIT + 500), {
    value: SHOW_DISCUSSION_COUNT_LIMIT,
    label: `${SHOW_DISCUSSION_COUNT_LIMIT}+`,
    capped: true,
  });
});

test("only persisted posts can open a PostScreen discussion", () => {
  assert.equal(hasPostDiscussion({ id: 42, userId: "fan-1", kind: "review" }), true);
  assert.equal(hasPostDiscussion({ id: "post_42", userId: "fan-1" }), true, "legacy reviews may omit kind");
  assert.equal(hasPostDiscussion({ id: "post_42", user: { id: "fan-1" }, kind: "review" }), true);
  assert.equal(hasPostDiscussion({ id: "tour_42", artist: "Geese", venue: "History", date: "2027-02-20", createdBy: "artist-1" }), false, "a persisted tour-date id is not a post id");
  assert.equal(hasPostDiscussion({ id: "post_42", userId: "fan-1", kind: "repost" }), false);
  assert.equal(hasPostDiscussion({ id: "  ", userId: "fan-1" }), false);
  assert.equal(hasPostDiscussion({ id: "post_42" }), false);
  assert.equal(hasPostDiscussion({}), false);
  assert.equal(hasPostDiscussion(null), false);
});

test("ShowScreen delegates the full thread to PostScreen", () => {
  assert.match(showScreen, /onOpenPost/);
  assert.match(showScreen, /onOpenPost\?\.\(norm\)/);
  assert.match(showScreen, /\{discussionAvailable \? <View style=\{styles\.discussionCard\}>/);
  assert.match(showScreen, /<NearbyAfterparty\s+log=\{norm\}\s+coord=\{coord\}/);
  assert.doesNotMatch(showScreen, /AfterpartySection|TextInput|addComment|deleteOwnComment|loadComments|commentsFor/);
  assert.equal(existsSync(new URL("../components/AfterpartySection.jsx", import.meta.url)), false);
});

test("aggregate show review pagination keeps loaded reviews and exposes retry feedback", () => {
  assert.match(showScreen, /const \[archiveLoadMoreFailed, setArchiveLoadMoreFailed\] = useState\(false\)/);
  assert.match(showScreen, /const result = await loadMoreArchiveReviews\(\)/);
  assert.match(showScreen, /result\?\.status === "error"/);
  assert.match(showScreen, /The reviews already on screen are still available/);
  assert.match(showScreen, /accessibilityLabel="Retry loading more fan reviews"/);
});

test("PostScreen scopes comment reads and exposes honest loading failure recovery", () => {
  assert.match(postScreen, /const commentScope = accountTargetScope\(session\?\.id, `post-comments:\$\{String\(log\.id \|\| ""\)\}`\)/);
  assert.match(postScreen, /const result = await loadComments\(log\.id, \{ limit: 50, force: true \}\)/);
  assert.match(postScreen, /commentResource\.scope === commentScope/);
  assert.match(postScreen, /commentsUsable && tree\.length === 0/);
  assert.match(postScreen, /accessibilityLabel="Retry loading comments"/);
  assert.match(postScreen, /setCommentRequestVersion\(\(version\) => version \+ 1\)/);
  assert.match(postScreen, /if \(!appActive\) return undefined/);
  assert.match(postScreen, /\}, \[appActive, commentScope, commentRequestVersion\]\)/);

  assert.match(store, /const commentCache = useAccountCommentCache\(session\?\.id \|\| null\)/);
  assert.match(store, /commentRequestCacheKey\(claim\.accountId, id, safeLimit\)/);
  assert.match(store, /expectedAccountId: claim\.accountId/);
  assert.match(store, /if \(pending\) return pending/);
  assert.match(store, /if \(!commentClaimIsCurrent\(claim\)\) return \{ ok: false, stale: true \}/);
  assert.match(store, /commentCache\.releaseRequest\(requestKey, request\)/);
});

test("comment projections rotate synchronously at every account identity boundary", () => {
  assert.doesNotMatch(store, /usePersisted\("pit\.comments"/);
  assert.match(commentCacheHook, /commentCacheStorageKey\(transition\.previousAccountId\)/);
  assert.match(commentCacheHook, /withoutPendingComments\(stateRef\.current\.comments\)/);
  assert.match(commentCacheHook, /stateRef\.current\.inflight\.clear\(\)/);
  assert.match(commentCacheHook, /stateRef\.current\.loadedAt\.clear\(\)/);
  assert.match(store, /comments: scopedComments/);

  const rotateAt = store.indexOf("adoptCommentAccount(nextAccountId);");
  const feedEarlyReturnAt = store.indexOf("if (nextAccountId === feedAccountIdRef.current) return;");
  assert.ok(rotateAt >= 0 && rotateAt < feedEarlyReturnAt, "comments must rotate before the feed account early return");
});

test("nearby afterparty stays a Maps-only discovery surface", () => {
  assert.match(nearbyAfterparty, /afterpartySearches\(coord\)/);
  assert.match(nearbyAfterparty, /Google Maps/);
  assert.match(nearbyAfterparty, /Verify hours, distance, age rules, and accessibility/);
  assert.doesNotMatch(nearbyAfterparty, /useStore|TextInput|addComment|deleteOwnComment|loadComments|toggleLike/);
});
