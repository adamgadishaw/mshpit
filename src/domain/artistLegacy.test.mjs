import assert from "node:assert/strict";
import test from "node:test";

import {
  LEGACY_ARTIST_DEATH_DATE_CUTOFF,
  isLegacyArtistMemorial,
} from "./artistLegacy.mjs";

test("legacy artist classification uses the published pre-1970 death boundary", () => {
  assert.equal(LEGACY_ARTIST_DEATH_DATE_CUTOFF, "1970-01-01");
  assert.equal(isLegacyArtistMemorial({ deceased: true, deathDate: "1969-12-31" }), true);
  assert.equal(isLegacyArtistMemorial({ status: "published", death_date: "1958-08-14" }), true);
  assert.equal(isLegacyArtistMemorial({ deceased: true, deathDate: "1970-01-01" }), false);
  assert.equal(isLegacyArtistMemorial({ deceased: true, deathDate: "2024-05-17" }), false);
});

test("legacy artist classification fails closed for unverified records", () => {
  assert.equal(isLegacyArtistMemorial({ status: "draft", deathDate: "1960-01-01" }), false);
  assert.equal(isLegacyArtistMemorial({ deathDate: "1960-01-01" }), false);
  assert.equal(isLegacyArtistMemorial({ deceased: false, deathDate: "1960-01-01" }), false);
  assert.equal(isLegacyArtistMemorial({ deceased: true, deathDate: "1969-02-29" }), false);
  assert.equal(isLegacyArtistMemorial({ deceased: true, deathDate: "not-a-date" }), false);
  assert.equal(isLegacyArtistMemorial(null), false);
});
