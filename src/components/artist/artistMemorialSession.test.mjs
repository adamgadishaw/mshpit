import assert from "node:assert/strict";
import test from "node:test";

import {
  claimArtistMemorialSpotlight,
  resetArtistMemorialSpotlightsForTests,
} from "./artistMemorialSession.mjs";

test("an artist spotlight is claimed once per in-memory app session", () => {
  resetArtistMemorialSpotlightsForTests();
  assert.equal(claimArtistMemorialSpotlight(" Artist Key "), true);
  assert.equal(claimArtistMemorialSpotlight("artist key"), false);
  assert.equal(claimArtistMemorialSpotlight("another artist"), true);
  assert.equal(claimArtistMemorialSpotlight(""), false);
});
