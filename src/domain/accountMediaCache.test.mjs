import assert from "node:assert/strict";
import test from "node:test";

import {
  mediaReactionsForAccountTransition,
  replaceVenueReviewSnapshot,
  venueReviewStorageKey,
  venueReviewsForPrivacyScope,
  withoutVenueReviewsByUser,
  withoutVenueReviewsByUsers,
} from "./accountMediaCache.mjs";

test("an account handoff clears reaction ownership before any network response", () => {
  const accountA = {
    "https://media.example/photo.jpg": { count: 7, mine: true },
  };
  assert.deepEqual(mediaReactionsForAccountTransition(accountA, "user-a", "user-b"), {
    "https://media.example/photo.jpg": { count: 7, mine: false },
  });
  assert.equal(mediaReactionsForAccountTransition(accountA, "user-a", "user-a"), accountA);
});

test("venue review caches are account-scoped, block-filterable, and accept an authoritative empty snapshot", () => {
  assert.notEqual(venueReviewStorageKey("user-a"), venueReviewStorageKey("user-b"));
  const groups = {
    venue: [
      { id: "a", userId: "blocked", photos: ["blocked.jpg"] },
      { id: "b", userId: "visible", photos: ["visible.jpg"] },
    ],
  };
  assert.deepEqual(withoutVenueReviewsByUser(groups, "blocked"), {
    venue: [{ id: "b", userId: "visible", photos: ["visible.jpg"] }],
  });
  assert.deepEqual(replaceVenueReviewSnapshot(groups, "venue", []), { venue: [] });
  assert.deepEqual(withoutVenueReviewsByUsers(groups, ["blocked", "missing"]), {
    venue: [{ id: "b", userId: "visible", photos: ["visible.jpg"] }],
  });
});

test("persisted venue reviews fail closed until the current account block graph is authoritative", () => {
  const groups = {
    venue: [
      { id: "blocked-review", userId: "blocked", photos: ["blocked.jpg"] },
      { id: "visible-review", userId: "visible", photos: ["visible.jpg"] },
    ],
  };
  const options = {
    cacheAccountId: "account-a",
    viewerAccountId: "account-a",
    blockedIds: ["blocked"],
  };

  assert.deepEqual(venueReviewsForPrivacyScope(groups, "venue", options), [],
    "a persisted snapshot is hidden while block hydration is pending");
  assert.deepEqual(venueReviewsForPrivacyScope(groups, "venue", {
    ...options,
    viewerAccountId: "account-b",
    blockGraphAuthoritative: true,
  }), [], "a cache from another account can never render");
  assert.deepEqual(venueReviewsForPrivacyScope(groups, "venue", {
    ...options,
    blockGraphAuthoritative: true,
  }), [groups.venue[1]], "authoritative hydration reveals only unblocked reviews");
  assert.deepEqual(venueReviewsForPrivacyScope(groups, "venue", {
    cacheAccountId: null,
    viewerAccountId: null,
    blockGraphAuthoritative: true,
  }), groups.venue, "guest continuity contains only the public projection and remains usable");
});
