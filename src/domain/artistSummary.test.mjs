import assert from "node:assert/strict";
import test from "node:test";
import { buildArtistSummary } from "./artistSummary.mjs";

const evidenced = (genre) => ({
  genre,
  genreClaims: [{ value: genre, source: "staff", at: 1 }],
});

test("artistSummary returns null instead of a dash or an unverified catalog genre", () => {
  assert.equal(buildArtistSummary({
    name: "Unknown",
    key: "unknown",
    catalogArtist: { genre: "-" },
  }).genre, null);
  assert.equal(buildArtistSummary({
    name: "Eminem",
    key: "eminem",
    catalogArtist: { genre: "Hardcore", spotifyId: "7dGJo4pcD2V6oG8kP0tJRR" },
  }).genre, null);
  assert.equal(buildArtistSummary({
    name: "Michael Jackson",
    key: "michael jackson",
    catalogArtist: { genre: "Hip-Hop", spotifyId: "3fMbdgg4jU18AjLCKBhRSm" },
  }).genre, null);
});

test("artistSummary exposes evidence-backed metadata and preserves page totals", () => {
  const summary = buildArtistSummary({
    name: "Alpha",
    key: "alpha",
    remoteArtist: { ...evidenced("Soul"), photo: "artist.jpg", photoCredit: "Source" },
    nights: [
      { overall: 5, band: 4, room: 3, likes: 8 },
      { overall: 3, band: 2, room: 5, likes: 2 },
    ],
    upcoming: [{ id: "show-1" }],
    profile: { feedEnabled: true },
  });
  assert.equal(summary.genre, "Soul");
  assert.equal(summary.photo, "artist.jpg");
  assert.equal(summary.avgOverall, 4);
  assert.equal(summary.avgBand, 3);
  assert.equal(summary.avgRoom, 4);
  assert.equal(summary.totalRatings, 10);
  assert.equal(summary.upcoming.length, 1);
});
