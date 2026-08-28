import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeTopRatedShows,
  topRatedShowCities,
  topRatedShowMatchesCity,
  topRatedShowNavigation,
} from "./topRatedShows.mjs";

const row = {
  key: "show-1",
  artist: "Artist",
  venue: "Venue",
  city: "Toronto, Ontario, Canada",
  place: "Toronto, Ontario, Canada",
  date: "2026-08-01",
  avgRating: 4.75,
  ratingCount: 12,
  reviewCount: 8,
  venueCity: "Toronto",
  venueCountryCode: "ca",
  providerVenueId: "venue-7",
  source: "ticketmaster",
};

test("top-rated show normalization rejects thin or invalid aggregate rows", () => {
  const result = normalizeTopRatedShows([
    row,
    { ...row },
    { ...row, key: "zero", ratingCount: 0 },
    { ...row, key: "bad-score", avgRating: 0 },
    { ...row, key: "missing-date", date: "" },
  ]);
  assert.equal(result.length, 1);
  assert.equal(result[0].venueCountryCode, "CA");
  assert.equal(result[0].providerVenueId, "venue-7");
});

test("real result cities filter without an unrelated fallback and navigate as an aggregate performance", () => {
  const normalized = normalizeTopRatedShows([
    row,
    { ...row, key: "show-2", venueCity: "Montréal", city: "Montréal, Quebec, Canada" },
  ]);
  assert.deepEqual(topRatedShowCities(normalized), ["Montréal", "Toronto"]);
  assert.equal(topRatedShowMatchesCity(normalized[0], "Toronto"), true);
  assert.equal(topRatedShowMatchesCity(normalized[0], "Chicago"), false);
  const navigation = topRatedShowNavigation(normalized[0]);
  assert.equal(navigation.performanceEvent, true);
  assert.equal(navigation.overall, 4.75);
  assert.equal(navigation.ratingCount, 12);
  assert.equal(navigation.user, undefined, "an aggregate never pretends to be a community account post");
});
