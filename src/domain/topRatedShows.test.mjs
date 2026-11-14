import assert from "node:assert/strict";
import test from "node:test";
import { projectTopRatedShows } from "../../server/features/discovery/topRatedShowService.js";
import { archiveShowKey, decodeArchiveShowKey } from "../../server/features/artistArchive/artistArchiveKeys.js";
import { prepareShowNavigation } from "./showNavigation.mjs";
import { createArtistArchiveService } from "../../server/features/artistArchive/artistArchiveService.js";

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

test("real ranking rows open the post archive identity, never the provider ranking identity", () => {
  for (const keyed of [true, false]) {
    const post = { id: "real-review", user_id: "fan", artist: "Björk 東京", artist_key: keyed ? "björk-東京" : null,
      venue: "L’Olympia", venue_key: keyed ? "olympia-paris" : null, city: "Paris, France", date: "2026-08-01", overall: 4.7, review: "Encore" };
    const provider = { ...post, source: "ticketmaster", venue_provider_id: "different-provider-id", venue_country: "France" };
    const [ranked] = projectTopRatedShows([post], [provider]);
    assert.match(ranked.key, /^show:/);
    const canonical = post.artist_key || "canonical-artist-key";
    const service = createArtistArchiveService({ repository: { findReviewRows: () => [post], findUpcomingRows: () => [], findReactionCounts: () => new Map(),
      findScopedReviewRows: () => [post], countScopedReviewRows: () => 1 },
      projectMediaState: () => ({ linkedPostIds: new Set(), assetsByPost: new Map() }), today: () => "2026-11-12" });
    const archive = service.readArchive({ artistKey: canonical, name: post.artist });
    const target = prepareShowNavigation(topRatedShowNavigation(normalizeTopRatedShows([ranked])[0], archive)).destination;
    assert.equal(target.archiveShowKey, archiveShowKey({ artistIdentity: canonical, venueIdentity: post.venue_key || post.venue, date: post.date }));
    assert.ok(decodeArchiveShowKey(target.archiveShowKey));
    assert.deepEqual(service.readReviews({ artistKey: canonical, name: post.artist, showKey: target.archiveShowKey }).reviews.map(post => post.id), [post.id]);
    assert.equal(target.overall, 4.7);
    assert.equal(target.userId, undefined);
  }
});

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
  const navigation = topRatedShowNavigation(normalized[0], { shows: [{ ...row, key: "show.canonical" }] });
  assert.equal(navigation.performanceEvent, true);
  assert.equal(navigation.overall, 4.75);
  assert.equal(navigation.ratingCount, 12);
  assert.equal(navigation.user, undefined, "an aggregate never pretends to be a community account post");
});

test("archive matching rejects missing or ambiguous nights and preserves exact archive keys", () => {
  assert.equal(topRatedShowNavigation(row, { shows: [] }), null);
  assert.equal(topRatedShowNavigation(row, { shows: [{ ...row, key: "one" }, { ...row, key: "two" }] }), null);
  assert.equal(topRatedShowNavigation({ ...row, venueKey: "right" }, { shows: [{ ...row, key: "one", venueKey: "wrong" }] }), null);
  const target = topRatedShowNavigation({ ...row, archiveShowKey: "two" }, { shows: [{ ...row, key: "one" }, { ...row, key: "two", avgRating: 3.2 }] });
  assert.equal(target.archiveShowKey, "two");
  assert.equal(target.overall, 3.2, "author or ranking scores cannot replace the resolved aggregate");
});
