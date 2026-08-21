import assert from "node:assert/strict";
import test from "node:test";
import { tasteMatch } from "./tasteMatch.mjs";

test("taste match uses only explicitly shared artists and genres without percentages", () => {
  const result = tasteMatch(
    { id: "me", favoriteArtists: ["SZA", "Mitski", "SZA"], genres: ["R&B", "Indie"] },
    { id: "them", favoriteArtists: ["sza", "Geese"], genres: ["indie", "Punk"], playHistory: [{ artist: "Mitski" }] },
  );
  assert.deepEqual(result.sharedArtists, ["SZA"]);
  assert.deepEqual(result.sharedGenres, ["Indie"]);
  assert.equal(result.basis, "shared-profile-picks");
  assert.doesNotMatch(result.summary, /%|percent|Mitski/);
});

test("taste match stays hidden for self, absent public picks, or no overlap", () => {
  assert.equal(tasteMatch({ id: "me", genres: ["Indie"] }, { id: "me", genres: ["Indie"] }), null);
  assert.equal(tasteMatch({ id: "me", genres: ["Indie"] }, { id: "them" }), null);
  assert.equal(tasteMatch({ id: "me", genres: ["Indie"] }, { id: "them", genres: ["Jazz"] }), null);
});
