import assert from "node:assert/strict";
import test from "node:test";
import {
  artistEventArchiveFromResponse,
  artistEventArchiveRequest,
  artistEventReviewsFromResponse,
  artistEventReviewsRequest,
} from "./artistEventRequest.mjs";

test("archive requests encode canonical identity and bind the viewer account", () => {
  assert.deepEqual(artistEventArchiveRequest({ artistKey: " alpha/key ", name: "A & B", accountId: "account-a" }), {
    path: "/api/artists/archive?artistKey=alpha%2Fkey&name=A%20%26%20B",
    expectedAccountId: "account-a",
  });
  assert.equal(artistEventArchiveRequest({ name: "Alpha" }).expectedAccountId, null);
  assert.throws(() => artistEventArchiveRequest(), /requires an artist identity/);
});

test("review requests require one typed selection and opaque cursor", () => {
  assert.deepEqual(artistEventReviewsRequest({
    artistKey: "alpha",
    name: "Alpha",
    tourKey: "tour/key",
    cursor: "30",
    limit: 99,
    accountId: "account-a",
  }), {
    path: "/api/artists/archive/reviews?artistKey=alpha&name=Alpha&tourKey=tour%2Fkey&cursor=30&limit=50",
    expectedAccountId: "account-a",
  });
  assert.equal(artistEventReviewsRequest({ name: "Alpha", showKey: "show", limit: 0 }).path.endsWith("limit=30"), true);
  assert.throws(() => artistEventReviewsRequest({ name: "Alpha" }), /exactly one show or tour/);
  assert.throws(() => artistEventReviewsRequest({ name: "Alpha", showKey: "show", tourKey: "tour" }), /exactly one show or tour/);
  assert.throws(() => artistEventReviewsRequest({ name: "Alpha", showKey: "show", cursor: " " }), /cursor is invalid/);
});

test("archive and review decoders reject partial transport shapes", () => {
  const archive = {
    artist: { name: "Alpha", key: "alpha" }, topShows: [], tours: [], shows: [], upcoming: [], totals: {}, truncated: false,
  };
  assert.equal(artistEventArchiveFromResponse({ archive }), archive);
  assert.throws(() => artistEventArchiveFromResponse({ archive: { ...archive, shows: null } }), /response is invalid/);
  assert.deepEqual(artistEventReviewsFromResponse({ reviews: [], nextCursor: null, total: 0 }), { reviews: [], nextCursor: null, total: 0 });
  assert.throws(() => artistEventReviewsFromResponse({ reviews: [], total: 0 }), /response is invalid/);
  assert.throws(() => artistEventReviewsFromResponse({ reviews: [], nextCursor: 2, total: 0 }), /cursor response is invalid/);
  assert.throws(() => artistEventReviewsFromResponse({ reviews: [], nextCursor: null, total: -1 }), /total is invalid/);
});
