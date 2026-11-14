import assert from "node:assert/strict";
import test from "node:test";
import { currentReview, reviewEventPath, reviewIsUnavailable } from "./reviewDetail.mjs";
import { isReviewDetail } from "./showNavigation.mjs";
import { publicFramePath } from "./publicFrameNavigation.mjs";
import { retainNativeFeedForMedia } from "./nativeFeedMediaRetention.mjs";

const review = { id: "saved-review-42", userId: "author-a", kind: "review", archiveShowKey: "opaque/key|date", overall: 4.7, band: 4.1, room: 3.6, version: 10 };

test("server-shaped archive review keeps its author/post identity and a separate canonical event link", () => {
  assert.equal(isReviewDetail(review), true);
  assert.equal(publicFramePath({ post: review }), "/post/saved-review-42");
  assert.equal(reviewEventPath(review), "/concert/opaque%2Fkey%7Cdate");
  assert.equal(review.overall, 4.7);
  assert.equal(isReviewDetail({ ...review, performanceEvent: true }), false);
  assert.equal(isReviewDetail({ ...review, kind: "status" }), false);
  assert.equal(isReviewDetail({ ...review, news: {} }), false);
  assert.equal(isReviewDetail({ id: "provider-42", artist: "Band" }), false);
  assert.equal(isReviewDetail({ ...review, kind: undefined }), true);
});

test("event links never reinterpret post ids or manufacture a venue for online/city-only reviews", () => {
  assert.equal(reviewEventPath({ ...review, archiveShowKey: null }), null);
  assert.equal(reviewEventPath({ ...review, archiveShowKey: null, tourDateId: "provider-42" }), "/event/provider-42");
  assert.equal(reviewEventPath({ ...review, experienceType: "online" }), null);
  assert.equal(reviewEventPath({ ...review, archiveShowKey: null, city: "Toronto" }), null);
});

test("fresh authorization wins over stale feed content; newer edits reconcile independently", () => {
  const old = { ...review, version: 9, review: "stale private content" };
  const same = { ...old, version: 10 };
  const edited = { ...review, version: 11, review: "edited", overall: 2.8 };
  assert.equal(currentReview(review, old), review);
  assert.equal(currentReview(review, same), review);
  assert.equal(currentReview(review, edited), edited);
  assert.equal(reviewIsUnavailable(review, ["author-a"]), true);
  assert.equal(reviewIsUnavailable(review, [], ["saved-review-42"]), true);
  assert.equal(reviewIsUnavailable(null), true);
  assert.equal(reviewIsUnavailable(review, ["other-author"], ["other-post"]), false);
});

test("native feed survives review/gallery/event visit but never crosses accounts or retains status visits", () => {
  const base = { platform: "ios", accountId: "viewer-a", tab: "feed", hasOverlay: true };
  for (const frames of [[{}, { post: review }], [{}, { post: review }, { photos: {} }], [{}, { post: review }, { openLog: { performanceEvent: true } }]]) {
    assert.equal(retainNativeFeedForMedia({ ...base, frames }), true);
    assert.equal(retainNativeFeedForMedia({ ...base, frames, accountId: null }), false);
  }
  assert.equal(retainNativeFeedForMedia({ ...base, frames: [{}, { post: { ...review, kind: "status" } }] }), false);
});
