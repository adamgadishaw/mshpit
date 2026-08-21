import assert from "node:assert/strict";
import test from "node:test";

import {
  mediaReactionsForAccountTransition,
  replaceVenueReviewSnapshot,
  venueReviewStorageKey,
  withoutVenueReviewsByUser,
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
});
