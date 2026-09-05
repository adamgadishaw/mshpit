import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

const dataDir = mkdtempSync(join(tmpdir(), "pit-artist-popularity-policy-"));
process.env.PIT_DATA_DIR = dataDir;
const {
  artistHasRankedPopularityProvenance,
  eligiblePopularityArtists,
} = await import("./artistPopularityEligibility.js");
const { db } = await import("./db.js");

after(() => {
  db.close();
  rmSync(dataDir, { recursive: true, force: true });
});

const spotifyId = "1234567890ABCDEFGHIJKL";
const row = (overrides = {}) => ({
  norm: "verified artist",
  name: "Verified Artist",
  popularity: 88,
  spotify_id: spotifyId,
  data: JSON.stringify({ name: "Verified Artist", spotifyId }),
  ...overrides,
});

test("checked-in artist identities remain eligible without a provider id", () => {
  const reviewedArtistNorms = new Set(["catalog artist"]);
  assert.equal(artistHasRankedPopularityProvenance(row({
    norm: "catalog artist",
    name: "Catalog Artist",
    spotify_id: null,
    data: "{}",
  }), { reviewedArtistNorms }), true);
});

test("provider-only popularity requires one exact Spotify identity and artist name", () => {
  const reviewedArtistNorms = new Set();
  assert.equal(artistHasRankedPopularityProvenance(row(), { reviewedArtistNorms }), true);
  assert.equal(artistHasRankedPopularityProvenance(row({
    spotify_id: "ABCDEFGHIJKL1234567890",
  }), { reviewedArtistNorms }), false, "typed and rich-data identities must agree");
  assert.equal(artistHasRankedPopularityProvenance(row({
    data: JSON.stringify({ name: "Different Artist", spotifyId }),
  }), { reviewedArtistNorms }), false, "cross-artist enrichment must fail closed");
  assert.equal(artistHasRankedPopularityProvenance(row({
    norm: "d",
    name: "D",
    spotify_id: null,
    data: JSON.stringify({ name: "D", followers: 24_000_000 }),
  }), { reviewedArtistNorms }), false, "collision-prone one-character rows cannot self-verify");
  assert.equal(artistHasRankedPopularityProvenance(row({ popularity: 101 }), { reviewedArtistNorms }), false);
});

test("filtering fills the requested ranking from later verified candidates", () => {
  const reviewedArtistNorms = new Set(["alpha", "bravo"]);
  const rows = [
    row({ norm: "dubious", name: "Dubious", popularity: 100, spotify_id: null, data: "{}" }),
    row({ norm: "alpha", name: "Alpha", popularity: 90, spotify_id: null, data: "{}" }),
    row({ norm: "bravo", name: "Bravo", popularity: 80, spotify_id: null, data: "{}" }),
  ];
  assert.deepEqual(
    eligiblePopularityArtists(rows, { reviewedArtistNorms, limit: 2 }).map(({ name }) => name),
    ["Alpha", "Bravo"],
  );
});
