import assert from "node:assert/strict";
import test from "node:test";
import { venueListingProviderIdentity } from "./venueListingIdentity.mjs";
import { createUnifiedVenueSearchIndex, searchUnifiedVenueIndex } from "./unifiedLocationSearch.mjs";
import { buildDiscoverVenueCities } from "./discoverVenues.mjs";
import { projectDiscoverScene } from "./discoverScene.mjs";

const now = Date.parse("2026-09-16T12:00:00Z");
const rebel = (id, providerVenueId, fields = {}) => ({ id, providerVenueId, source: "ticketmaster", venue: "REBEL",
  venueCity: "Toronto", venueRegion: "ON", venueCountryCode: "CA", place: "Toronto, Ontario, Canada",
  lat: 43.641095, lng: -79.354705, date: "2026-10-01", artist: "Fixture performer", releaseAt: 0, ...fields });
const primary = rebel("main-show", "KovZpZAdIFaA");
const partner = rebel("partner-show", "rZ7HnEZae-8");
const noir = rebel("noir-show", "rZ7HnEZ178UZA", { venue: "NOIR (inside REBEL)" });

test("reviewed REBEL provider inventories share one listing without including NOIR", () => {
  assert.equal(venueListingProviderIdentity(primary), venueListingProviderIdentity(partner));
  assert.notEqual(venueListingProviderIdentity(primary), venueListingProviderIdentity(noir));
  for (const rows of [[partner, primary, noir], [primary, noir, partner]]) {
    const before = structuredClone(rows);
    const index = createUnifiedVenueSearchIndex({ tourDates: [...rows, primary], now });
    const results = searchUnifiedVenueIndex(index, "REBEL");
    assert.equal(results.length, 2);
    const main = results.find(row => row.name === "REBEL");
    assert.equal(main.providerVenueId, "KovZpZAdIFaA", "primary navigation is independent of arrival order");
    assert.equal(main.upcoming, 2, "repeated event ids count once; two different shows on the same date both count");
    const [city] = buildDiscoverVenueCities(index, [...rows, primary], { now });
    assert.equal(city.venues.length, 2);
    assert.equal(city.shows.length, 3);
    assert.deepEqual(new Set(city.venues.find(row => row.name === "REBEL").shows.map(row => row.id)), new Set([primary.id, partner.id]));
    assert.deepEqual(rows, before, "source records remain unchanged");
  }
});

test("reviewed aliases apply equally to Discover trending venue summaries", () => {
  const result = projectDiscoverScene([primary, partner, noir], { now });
  assert.equal(result.venues.length, 2);
  assert.equal(result.venues.find(row => row.name === "REBEL").upcoming, 2);
});

test("only the exact reviewed namespace, room, and location may combine", () => {
  for (const fields of [
    { source: "other" }, { venue: "NOIR (inside REBEL)" }, { venueCity: "Ottawa" },
    { venueCountryCode: "US" }, { venueRegion: "BC" },
    { venueCity: "", venueRegion: "", venueCountryCode: "", place: "" },
  ]) {
    const row = { ...partner, ...fields };
    assert.notEqual(venueListingProviderIdentity(row), venueListingProviderIdentity(primary));
  }
  assert.equal(venueListingProviderIdentity({ ...partner, source: "Ticketmaster", providerVenueId: "RZ7HNEZAE-8" }), venueListingProviderIdentity(primary));
  assert.equal(venueListingProviderIdentity({ source: "ticketmaster", providerVenueId: "unreviewed", venue: "REBEL", place: partner.place }), "provider:ticketmaster:unreviewed");
  assert.equal(venueListingProviderIdentity({ venue: "REBEL", place: partner.place }), null);
});

test("a partner-only snapshot retains its existing working provider URL identity", () => {
  const [entry] = createUnifiedVenueSearchIndex({ tourDates: [partner], now });
  assert.equal(entry.row.providerVenueId, partner.providerVenueId);
  assert.equal(entry.row.identity, venueListingProviderIdentity(primary));
  const [city] = buildDiscoverVenueCities([entry], [primary, partner], { now });
  assert.equal(city.venues.length, 1);
  assert.equal(city.shows.length, 2);
});

test("matching names and coordinates never combine unreviewed provider rooms", () => {
  const events = [rebel("a", "room-a"), rebel("b", "room-b")];
  const index = createUnifiedVenueSearchIndex({ tourDates: events, now });
  assert.equal(index.length, 2);
  assert.equal(buildDiscoverVenueCities(index, events, { now })[0].venues.length, 2);
});
