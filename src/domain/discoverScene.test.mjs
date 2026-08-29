import assert from "node:assert/strict";
import test from "node:test";

import {
  DISCOVER_SUPPORTED_EVENT_COUNTRIES,
  discoverCountryCode,
  discoverCountryIdentity,
  discoverEventCountryFacets,
  discoverRowMatchesRegion,
  discoverVenueIdentity,
  filterDiscoverSceneRows,
  projectDiscoverScene,
} from "./discoverScene.mjs";

test("Discover exposes canonical supported country choices before events are ingested", () => {
  assert.deepEqual(DISCOVER_SUPPORTED_EVENT_COUNTRIES.slice(0, 4), [
    "Portugal",
    "Spain",
    "France",
    "Germany",
  ]);
  assert.ok(DISCOVER_SUPPORTED_EVENT_COUNTRIES.includes("Czechia"));
  assert.ok(DISCOVER_SUPPORTED_EVENT_COUNTRIES.includes("Canada"));
  assert.equal(new Set(DISCOVER_SUPPORTED_EVENT_COUNTRIES).size, DISCOVER_SUPPORTED_EVENT_COUNTRIES.length);
  assert.equal(discoverCountryIdentity("PT"), discoverCountryIdentity("Portugal"));
});

const NOW = Date.UTC(2026, 7, 28, 12);

test("Discover scene country matching handles provider codes, names, and city-only community rows", () => {
  assert.equal(discoverCountryCode("Portugal"), "PT");
  assert.equal(discoverCountryCode("Spain"), "ES");
  assert.equal(discoverCountryCode("Great Britain"), "GB");
  assert.equal(discoverCountryCode("pt"), "PT");
  assert.equal(discoverCountryIdentity("USA"), "united states");
  assert.equal(discoverRowMatchesRegion({ place: "Toronto, Ontario, Canada" }, "Canada"), true);
  assert.equal(discoverRowMatchesRegion({ venueCountryCode: "US" }, "United States"), true);
  assert.equal(discoverRowMatchesRegion({ venueCountry: "", venue_country: "France" }, "France"), true);
  assert.equal(discoverRowMatchesRegion({ place: "Dublin, Ireland" }, "Canada"), false);
  assert.equal(discoverRowMatchesRegion({ place: "Athens, Greece" }, "Greece", {
    countryForCity: (city) => city === "Athens" ? "United States" : null,
  }), true, "an explicit country in the place must beat an ambiguous city-name lookup");
  assert.equal(discoverRowMatchesRegion({ place: "Athens, Greece" }, "United States", {
    countryForCity: (city) => city === "Athens" ? "United States" : null,
  }), false);
  assert.equal(discoverRowMatchesRegion({ place: "Toronto, Ontario" }, "Canada", {
    countryForCity: (city) => city === "Toronto" ? "Canada" : null,
  }), true);
  assert.deepEqual(filterDiscoverSceneRows([
    { id: "toronto", city: "Toronto" },
    { id: "chicago", city: "Chicago" },
    { id: "unknown", city: "Atlantis" },
  ], {
    region: "Canada",
    countryForCity: (city) => ({ Toronto: "Canada", Chicago: "United States" })[city],
  }).map((row) => row.id), ["toronto"]);
});

test("live-event country facets contain only current event countries and use event counts", () => {
  const rows = [
    { id: "ca-1", place: "Toronto, Ontario, Canada", date: "2026-09-02", releaseAt: 0 },
    { id: "ca-2", venueCountryCode: "CA", date: "2026-09-03", releaseAt: 0 },
    { id: "us-1", venueCountry: "United States of America", date: "2026-09-04", releaseAt: 0 },
    { id: "gr-1", place: "Athens, Greece", date: "2026-09-05", releaseAt: 0 },
    { id: "hidden", venueCountry: "Canada", date: "2026-09-01", releaseAt: NOW + 1 },
    { id: "past", venueCountry: "France", date: "2026-07-01", releaseAt: 0 },
    { id: "unknown", place: "Mystery room", date: "2026-09-06", releaseAt: 0 },
    { id: "malformed", place: "Mystery, State, ST", date: "2026-09-06", releaseAt: 0 },
  ];
  assert.deepEqual(discoverEventCountryFacets(rows, { now: NOW }), [
    { country: "Canada", count: 2 },
    { country: "Greece", count: 1 },
    { country: "United States", count: 1 },
  ]);
});

test("scene projection changes upcoming events and venues together without leaking another country", () => {
  const rows = [
    { id: "ca-2", artist: "Two", venue: "History", place: "Toronto, Ontario, Canada", date: "2026-09-03", releaseAt: 0 },
    { id: "us-1", artist: "US", venue: "Metro", place: "Chicago, Illinois, United States of America", date: "2026-09-01", releaseAt: 0 },
    { id: "ca-1", artist: "One", venue: "History", place: "Toronto, Ontario, CA", date: "2026-09-02", releaseAt: 0 },
    { id: "hidden", artist: "Later", venue: "Future Hall", place: "Toronto, Ontario, Canada", date: "2026-09-01", releaseAt: NOW + 1 },
    { id: "past", artist: "Past", venue: "Old Hall", place: "Toronto, Ontario, Canada", date: "2026-08-01", releaseAt: 0 },
  ];
  const canada = projectDiscoverScene(rows, { region: "Canada", now: NOW, eventLimit: 4, venueLimit: 3 });
  assert.deepEqual(canada.events.map((row) => row.id), ["ca-1", "ca-2"]);
  assert.equal(canada.eventCount, 2);
  assert.deepEqual(canada.venues, [{
    identity: "place:history:toronto:canada",
    name: "History",
    place: "Toronto, Ontario, Canada",
    source: null,
    providerVenueId: null,
    venueCity: null,
    venueRegion: null,
    venueCountryCode: null,
    venueCountry: null,
    upcoming: 2,
    nextDate: "2026-09-02",
  }]);
  assert.equal(canada.venueCount, 1);

  const unitedStates = projectDiscoverScene(rows, { region: "United States", now: NOW });
  assert.deepEqual(unitedStates.events.map((row) => row.id), ["us-1"]);
  assert.deepEqual(unitedStates.venues.map((row) => row.name), ["Metro"]);
});

test("venue projection keeps same-named rooms separate by provider identity and structured country", () => {
  const canada = {
    id: "ca",
    venue: "The Hall",
    place: "London, Ontario, Canada",
    date: "2026-09-01",
    source: "ticketmaster",
    providerVenueId: "ca-hall",
    venueCity: "London",
    venueCountryCode: "CA",
  };
  const britain = {
    id: "gb",
    venue: "The Hall",
    place: "London, England, United Kingdom",
    date: "2026-09-02",
    source: "ticketmaster",
    providerVenueId: "gb-hall",
    venueCity: "London",
    venueCountryCode: "GB",
  };
  assert.equal(discoverVenueIdentity(canada), "provider:ticketmaster:ca-hall");
  assert.equal(discoverVenueIdentity(britain), "provider:ticketmaster:gb-hall");
  const result = projectDiscoverScene([canada, britain], { region: "Worldwide", now: NOW });
  assert.equal(result.venueCount, 2);
  assert.deepEqual(result.venues.map((venue) => venue.providerVenueId), ["ca-hall", "gb-hall"]);
});

test("scene projection keeps active multi-day events pinned and bounds rendered work", () => {
  const rows = [
    { id: "future-b", venue: "B", place: "Toronto, Canada", date: "2026-09-02", releaseAt: 0 },
    { id: "active", venue: "Fairgrounds", place: "Toronto, Canada", date: "2026-08-20", eventEndDate: "2026-09-07", releaseAt: 0 },
    { id: "future-a", venue: "A", place: "Toronto, Canada", date: "2026-09-01", releaseAt: 0 },
  ];
  const result = projectDiscoverScene(rows, { region: "Canada", now: NOW, eventLimit: 2, venueLimit: 1 });
  assert.deepEqual(result.events.map((row) => row.id), ["active", "future-a"]);
  assert.equal(result.events.length, 2);
  assert.equal(result.venues.length, 1);
  assert.equal(result.eventCount, 3);
  assert.equal(result.venueCount, 3);
});
