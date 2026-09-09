import assert from "node:assert/strict";
import test from "node:test";
import { buildArtistSummary } from "./artistSummary.mjs";
import { artistOverviewRequest } from "../features/artistOverview/artistOverviewRequest.mjs";

const evidenced = (genre) => ({
  genre,
  genreClaims: [{ value: genre, source: "staff", at: 1 }],
});

test("artistSummary preserves a matching persisted catalog key instead of reconstructing punctuation", () => {
  const summary = buildArtistSummary({
    name: "A$AP Rocky", key: "a$ap rocky",
    remoteArtist: { name: "A$AP Rocky", key: "artist/verified-rocky", transient: false },
  });
  assert.equal(summary.profileKey, "artist/verified-rocky");
  assert.equal(artistOverviewRequest({ artistKey: summary.profileKey }).path,
    "/api/artists/artist%2Fverified-rocky/live-summary?limit=12");
  assert.equal(artistOverviewRequest({ artistKey: "a$ap rocky" }).path,
    "/api/artists/a%24ap%20rocky/live-summary?limit=12");
});

test("artistSummary accepts a matching persisted norm after delayed catalog hydration", () => {
  const input = { name: "  Earth,  Wind & Fire ", key: "earth,  wind & fire" };
  assert.equal(buildArtistSummary(input).profileKey, input.key);
  assert.equal(buildArtistSummary({ ...input,
    catalogArtist: { name: "Earth, Wind & Fire", norm: "earth-wind-fire" },
  }).profileKey, "earth-wind-fire");
});

test("artistSummary never promotes transient, mismatched, or malformed catalog identities", () => {
  const input = { name: "Twin Act", key: "twin act" };
  for (const remoteArtist of [
    { name: "Twin Act", key: "provider-preview", transient: true },
    { name: "Another Twin Act", key: "different-artist" },
    { key: "nameless-artist" },
    { name: "Twin Act", publicSlug: "public-link-only" },
    { name: "Twin Act", key: {} },
    { name: "Twin Act", key: "invalid\nkey" },
    { name: "Twin Act", key: "x".repeat(181) },
  ]) assert.equal(buildArtistSummary({ ...input, remoteArtist }).profileKey, input.key);
  assert.equal(buildArtistSummary({ ...input,
    remoteArtist: { name: "Twin Act", key: "provider-preview", transient: true },
    catalogArtist: { name: "Twin Act", key: "persisted-twin" },
  }).profileKey, "persisted-twin");
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
