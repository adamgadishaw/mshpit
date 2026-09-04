import test from "node:test";
import assert from "node:assert/strict";

import {
  IN_PERSON_REVIEW_EXPERIENCE,
  ONLINE_REVIEW_EXPERIENCE,
  canonicalYouTubeReviewUrl,
  isInPersonConcertReview,
  isOnlineReview,
  isValidYouTubeSourceUrl,
  normalizeOnlineRating,
  normalizeReviewExperienceType,
  reviewCardPerformance,
  youtubeReviewThumbnailUrl,
  youtubeReviewVideoId,
} from "./onlineReview.mjs";

test("review experience defaults to in person and only accepts the online value", () => {
  assert.equal(normalizeReviewExperienceType(), IN_PERSON_REVIEW_EXPERIENCE);
  assert.equal(normalizeReviewExperienceType("online"), ONLINE_REVIEW_EXPERIENCE);
  assert.equal(normalizeReviewExperienceType("virtual"), IN_PERSON_REVIEW_EXPERIENCE);
});

test("attendance helpers keep online reviews out of show and shared-attendance counts", () => {
  assert.equal(isOnlineReview({ experienceType: "online", artist: "Little Simz" }), true);
  assert.equal(isOnlineReview({ experience_type: "online", artist: "Little Simz" }), true);
  assert.equal(isInPersonConcertReview({ experienceType: "online", artist: "Little Simz", venue: "YouTube" }), false);
  assert.equal(isInPersonConcertReview({ artist: "Little Simz", venue: "History" }), true, "legacy venue reviews remain in-person");
  assert.equal(isInPersonConcertReview({ kind: "status", artist: "Little Simz", venue: "History" }), false);
});

test("online ratings are finite half-star values between zero and five", () => {
  assert.equal(normalizeOnlineRating("4.7"), 4.5);
  assert.equal(normalizeOnlineRating(99), 5);
  assert.equal(normalizeOnlineRating(-1), 0);
  assert.equal(normalizeOnlineRating("not a rating"), 0);
});

test("online reviews accept links to individual YouTube videos", () => {
  for (const url of [
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://m.youtube.com/watch?v=dQw4w9WgXcQ&feature=share",
    "https://youtu.be/dQw4w9WgXcQ?t=30",
    "https://youtube.com/shorts/dQw4w9WgXcQ",
    "https://youtube.com/live/dQw4w9WgXcQ",
  ]) assert.equal(isValidYouTubeSourceUrl(url), true, url);
});

test("review links canonicalize to a safe parameter-free YouTube watch URL", () => {
  assert.equal(
    canonicalYouTubeReviewUrl("https://youtu.be/dQw4w9WgXcQ?t=30"),
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  );
  assert.equal(canonicalYouTubeReviewUrl("https://example.com/watch?v=dQw4w9WgXcQ"), "");
  assert.equal(canonicalYouTubeReviewUrl("https://youtube.com/embed/dQw4w9WgXcQ"), "");
  assert.equal(canonicalYouTubeReviewUrl("https://youtu.be/dQw4w9WgXcQ", "aaaaaaaaaaa"), "");
  assert.equal(
    canonicalYouTubeReviewUrl("https://youtu.be/dQw4w9WgXcQ", "dQw4w9WgXcQ"),
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  );
});

test("review thumbnails are derived only from a validated canonical video id", () => {
  assert.equal(
    youtubeReviewVideoId("https://youtu.be/dQw4w9WgXcQ?t=30"),
    "dQw4w9WgXcQ",
  );
  assert.equal(
    youtubeReviewThumbnailUrl("https://youtu.be/dQw4w9WgXcQ?t=30"),
    "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
  );
  assert.equal(youtubeReviewThumbnailUrl("https://example.com/watch?v=dQw4w9WgXcQ"), "");
  assert.equal(youtubeReviewThumbnailUrl("https://youtu.be/dQw4w9WgXcQ", "aaaaaaaaaaa"), "");
});

test("review cards lead with the artist for online and festival-set reviews only", () => {
  assert.deepEqual(
    reviewCardPerformance({
      experienceType: "online",
      artist: "Little Simz",
      onlineTitle: "Live at Glastonbury",
    }),
    {
      festivalSet: false,
      primary: "Little Simz",
      primaryIsArtist: true,
      secondary: "Live at Glastonbury",
      showArtistInMeta: false,
    },
  );
  assert.deepEqual(
    reviewCardPerformance({ artist: "50 Cent", tour: "Festival set" }),
    {
      festivalSet: true,
      primary: "50 Cent",
      primaryIsArtist: true,
      secondary: "Festival set",
      showArtistInMeta: false,
    },
  );
  assert.deepEqual(
    reviewCardPerformance({ artist: "Beyoncé", tour: "Renaissance World Tour" }),
    {
      festivalSet: false,
      primary: "Renaissance World Tour",
      primaryIsArtist: false,
      secondary: "",
      showArtistInMeta: true,
    },
  );
});

test("online reviews reject non-video and lookalike links", () => {
  for (const url of [
    "",
    "youtube.com/watch?v=dQw4w9WgXcQ",
    "https://youtube.com/",
    "https://youtube.com/@mshpit",
    "https://youtube.com/embed/dQw4w9WgXcQ",
    "https://youtube.com/watch?v=too-short",
    "https://youtu.be/dQw4w9WgXcQ/extra",
    "https://youtube.com/shorts/dQw4w9WgXcQ/extra",
    "https://user@youtube.com/watch?v=dQw4w9WgXcQ",
    "https://youtube.example/watch?v=dQw4w9WgXcQ",
    "https://example.com/watch?v=dQw4w9WgXcQ",
  ]) assert.equal(isValidYouTubeSourceUrl(url), false, url);
});
