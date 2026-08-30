import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  artistReviewEngagement,
  isEligibleArtistTopReview,
  topArtistReviews,
} from "./artistTopReviews.mjs";

const artistScreen = readFileSync(new URL("../screens/ArtistScreen.jsx", import.meta.url), "utf8");
const appSource = readFileSync(new URL("../../App.js", import.meta.url), "utf8");

const review = (id, overrides = {}) => ({
  id,
  kind: "review",
  review: `Review ${id}`,
  date: "2026-06-01",
  overall: 4,
  likes: 0,
  comments: 0,
  createdAt: 1,
  ...overrides,
});

test("artist top reviews exclude aggregate, removed, status, and empty rows", () => {
  const eligible = review("eligible");
  const rows = [
    null,
    review("aggregate", { date: "aggregate" }),
    review("removed", { removed: true }),
    review("removed-numeric", { removed: 1 }),
    review("status", { kind: "status" }),
    review("empty", { review: "   " }),
    eligible,
  ];

  assert.equal(isEligibleArtistTopReview(eligible), true);
  assert.deepEqual(topArtistReviews(rows), [eligible]);
});

test("artist top reviews rank engagement, score, show recency, post recency, then id", () => {
  const rows = [
    review("more-score", { likes: 8, comments: 2, overall: 5, date: "2025-01-01" }),
    review("more-engagement", { likes: 9, comments: 2, overall: 1, date: "2024-01-01" }),
    review("newer-show", { likes: 8, comments: 2, overall: 5, date: "2026-02-01", createdAt: 1 }),
    review("newer-post", { likes: 8, comments: 2, overall: 5, date: "2026-02-01", createdAt: 20 }),
    review("same-b", { likes: 8, comments: 2, overall: 5, date: "2026-02-01", createdAt: 20 }),
    review("same-a", { likes: 8, comments: 2, overall: 5, date: "2026-02-01", createdAt: 20 }),
  ];

  assert.equal(artistReviewEngagement(rows[0]), 10);
  assert.deepEqual(topArtistReviews(rows, { limit: 6 }).map(({ id }) => id), [
    "more-engagement",
    "newer-post",
    "same-a",
    "same-b",
    "newer-show",
    "more-score",
  ]);
  assert.deepEqual(rows.map(({ id }) => id), ["more-score", "more-engagement", "newer-show", "newer-post", "same-b", "same-a"], "selector must not mutate the page's night list");
});

test("artist top reviews bound invalid limits without throwing", () => {
  const rows = Array.from({ length: 12 }, (_, index) => review(`r-${index}`, { likes: index }));
  assert.equal(topArtistReviews(rows, { limit: 50 }).length, 10);
  assert.deepEqual(topArtistReviews(rows, { limit: 0 }), []);
  assert.deepEqual(topArtistReviews(null), []);
});

test("artist page renders ranked review cards beside the fan gallery", () => {
  assert.match(artistScreen, /useArtistTopReviews\(\{/);
  assert.match(artistScreen, /selectArtistReviewsPresentation\(topReviewsResource, a\.nights, \{ limit: 3 \}\)/);
  assert.match(artistScreen, /sectionModel\.condensed \? "TOP REVIEW" : `TOP REVIEWS · \$\{topReviews\.length\}`/);
  assert.match(artistScreen, /visibleTopReviews\.map\(\(review, index\) =>/);
  assert.match(artistScreen, /DEVICE COPY/);
  assert.match(artistScreen, /accessibilityLabel="Retry loading live artist reviews"/);
  assert.match(artistScreen, /href=\{review\.user\?\.handle \? profilePath\(review\.user\.handle\) : null\}/);
  assert.match(artistScreen, /onNavigate=\{\(\) => onOpenProfile\(review\.userId\)\}/);
  assert.match(artistScreen, /accessibilityHint="Opens the concert night and full review"/);
  assert.match(artistScreen, /href=\{postPath\(review\.id\)\}/);
  assert.match(artistScreen, /onNavigate=\{\(\) => onOpenShow\?\.\(review\)\}/);
  assert.match(artistScreen, /review\.photosPublic === true \|\| Number\(review\.photosPublic\) === 1/);
  assert.match(artistScreen, /onPress=\{\(\) => onOpenPhotos\?\.\(publicMedia, 0, review\.id\)\}/);
  assert.match(artistScreen, /topReviewMain: \{ flex: 1, minHeight: 150/);
  assert.match(artistScreen, /topReviewAuthorAction: \{ flex: 1, minWidth: 0, minHeight: 44/);
  assert.match(artistScreen, /topReviewBodyAction: \{ flex: 1, minHeight: 76/);
  assert.match(artistScreen, /topReviewMedia: \{ width: 108, minHeight: 150/);
  assert.equal((appSource.match(/<ArtistScreen[^;]+onOpenProfile=\{openProfile\}/g) || []).length, 2);
});
