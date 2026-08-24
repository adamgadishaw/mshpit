import assert from "node:assert/strict";
import test from "node:test";
import {
  archiveCoverMedia,
  archiveDateLabel,
  archiveDateRangeLabel,
  archiveRatingLabel,
  archiveReviewMedia,
  artistEventIdentity,
  findArchiveShowForReview,
  selectArchiveTour,
  showsForArchiveTour,
} from "./artistEventArchive.mjs";

test("artist event identities prefer stable artist keys and normalize name fallback", () => {
  assert.equal(artistEventIdentity({ artistKey: "  Artist/MBID  ", name: "Ignored" }), "artist/mbid");
  assert.equal(artistEventIdentity({ name: "  The   National " }), "the national");
  assert.equal(artistEventIdentity(), "");
});

test("archive date copy handles provider years without changing canonical storage", () => {
  assert.equal(archiveDateLabel("2030-03-01"), "2030 · 03 · 01");
  assert.equal(archiveDateLabel("2030-02-31", "Unknown"), "Unknown");
  assert.equal(archiveDateRangeLabel("2024-01-01", "2024-02-02"), "2024 · 01 · 01 — 2024 · 02 · 02");
  assert.equal(archiveDateRangeLabel("2024-01-01", "2024-01-01"), "2024 · 01 · 01");
  assert.equal(archiveRatingLabel(4.76, 12), "4.8");
  assert.equal(archiveRatingLabel(0, 0), "New");
});

test("archive media keeps moderation provenance for viewers and profile links", () => {
  assert.deepEqual(archiveCoverMedia({
    url: "https://media.test/cover.jpg",
    kind: "image",
    by: "Fan One",
    userId: "fan-1",
    postId: "post-1",
  }), {
    url: "https://media.test/cover.jpg",
    uri: "https://media.test/cover.jpg",
    kind: "image",
    posterUri: null,
    by: "Fan One",
    userId: "fan-1",
    postId: "post-1",
  });

  const media = archiveReviewMedia({
    id: "post-2",
    userId: "fan-2",
    user: { name: "Fan Two" },
    photos: ["https://media.test/clip.mp4"],
    media: [{ url: "https://media.test/clip.mp4", kind: "video", posterUrl: "https://media.test/poster.jpg" }],
  });
  assert.equal(media[0].kind, "video");
  assert.equal(media[0].postId, "post-2");
  assert.equal(media[0].userId, "fan-2");
  assert.equal(media[0].by, "Fan Two");
});

test("tour and show selectors stay inside the requested canonical keys", () => {
  const archive = {
    tours: [{ key: "tour-a", name: "A" }, { key: "tour-b", name: "B" }],
    shows: [
      { key: "new", tourKey: "tour-a", venue: "Hall", venueKey: "hall", date: "2025-01-01" },
      { key: "old", tourKey: "tour-a", venue: "Hall", venueKey: "hall", date: "2024-01-01" },
      { key: "other", tourKey: "tour-b", venue: "Club", venueKey: "club", date: "2024-01-01" },
    ],
  };
  assert.equal(selectArchiveTour(archive, "tour-a")?.name, "A");
  assert.deepEqual(showsForArchiveTour(archive, "tour-a").map((show) => show.key), ["new", "old"]);
  assert.equal(findArchiveShowForReview(archive.shows, { venueKey: "hall", venue: "Renamed", date: "2024-01-01" })?.key, "old");
  assert.equal(findArchiveShowForReview(archive.shows, { venue: "Missing", date: "2024-01-01" }), null);
});
