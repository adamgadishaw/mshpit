import assert from "node:assert/strict";
import test from "node:test";

import {
  createUnifiedEventSearchIndex,
  createUnifiedVenueSearchIndex,
  memoizedUnifiedVenueSearchIndex,
  searchUnifiedEventIndex,
  searchUnifiedVenueIndex,
  UNIFIED_EVENT_SEARCH_INDEX_LIMIT,
  UNIFIED_LOCATION_SEARCH_RESULT_LIMIT,
} from "./unifiedLocationSearch.mjs";
import { arenaVenues } from "../seed/arenas.js";
import { buildDiscoverVenueCities } from "./discoverVenues.mjs";

const providerRows = [
  {
    id: "pt-1",
    artist: "Ana Moura",
    venue: "MEO Arena",
    date: "2099-09-01",
    releaseAt: 0,
    source: "ticketmaster",
    providerVenueId: "meo-lisbon",
    venueCity: "Lisbon",
    venueCountryCode: "PT",
  },
  {
    id: "es-1",
    artist: "Rosalía",
    venue: "Palau Sant Jordi",
    date: "2099-09-02",
    releaseAt: 0,
    source: "ticketmaster",
    providerVenueId: "palau-barcelona",
    venueCity: "Barcelona",
    venueCountryCode: "ES",
  },
];

test("country and city searches use structured provider locations without fake rows", () => {
  const events = createUnifiedEventSearchIndex(providerRows);
  assert.deepEqual(searchUnifiedEventIndex(events, "Portugal").map((row) => row.id), ["pt-1"]);
  assert.deepEqual(searchUnifiedEventIndex(events, "lisbon").map((row) => row.id), ["pt-1"]);
  assert.deepEqual(searchUnifiedEventIndex(events, "Spain").map((row) => row.id), ["es-1"]);
  assert.deepEqual(searchUnifiedEventIndex(events, "Ana Moura").map((row) => row.id), ["pt-1"], "artist matching remains available");

  const venues = createUnifiedVenueSearchIndex({ tourDates: providerRows, now: Date.UTC(2098, 0, 1) });
  assert.deepEqual(searchUnifiedVenueIndex(venues, "Portugal").map((row) => row.name), ["MEO Arena"]);
  assert.deepEqual(searchUnifiedVenueIndex(venues, "Barcelona").map((row) => row.name), ["Palau Sant Jordi"]);
  assert.deepEqual(searchUnifiedVenueIndex(venues, "Portugal")[0], {
    identity: "provider:ticketmaster:meo-lisbon",
    name: "MEO Arena",
    place: "Lisbon, Portugal",
    coord: null,
    source: "ticketmaster",
    providerVenueId: "meo-lisbon",
    venueCity: "Lisbon",
    venueRegion: null,
    venueCountryCode: "PT",
    venueCountry: "Portugal",
    capacity: null,
    upcoming: 1,
  });
});

test("location indexes and returned sections stay bounded", () => {
  const rows = Array.from({ length: UNIFIED_EVENT_SEARCH_INDEX_LIMIT + 25 }, (_, index) => ({
    id: `pt-${index}`,
    artist: `Artist ${index}`,
    venue: `Venue ${index}`,
    venueCountryCode: "PT",
  }));
  const index = createUnifiedEventSearchIndex(rows);
  assert.equal(index.length, UNIFIED_EVENT_SEARCH_INDEX_LIMIT);
  assert.equal(searchUnifiedEventIndex(index, "Portugal", { limit: 24 }).length, 24);

  const venues = createUnifiedVenueSearchIndex({ tourDates: rows });
  assert.equal(searchUnifiedVenueIndex(venues, "Portugal", { limit: 999 }).length, UNIFIED_LOCATION_SEARCH_RESULT_LIMIT);
});

test("same-named provider venues keep distinct provider identities", () => {
  const venues = createUnifiedVenueSearchIndex({
    tourDates: [
      { ...providerRows[0], id: "room-a-event", venue: "The Arena", providerVenueId: "room-a" },
      { ...providerRows[0], id: "room-b-event", venue: "The Arena", providerVenueId: "room-b" },
    ],
    now: Date.UTC(2098, 0, 1),
  });
  assert.deepEqual(searchUnifiedVenueIndex(venues, "The Arena").map((row) => row.identity), [
    "provider:ticketmaster:room-a",
    "provider:ticketmaster:room-b",
  ]);
});

test("current venue names absorb historical aliases while both remain searchable", () => {
  const venues = createUnifiedVenueSearchIndex({
    tourDates: [{
      id: "rbc-event",
      artist: "Pitbull",
      venue: "RBC Amphitheatre",
      date: "2099-09-05",
      releaseAt: 0,
      source: "ticketmaster",
      providerVenueId: "KovZpZAEkkIA",
      venueCity: "Toronto",
      venueCountryCode: "CA",
    }],
    curatedVenues: [{ name: "Budweiser Stage", place: "Toronto, Ontario, Canada", capacity: 16000 }],
    now: Date.UTC(2098, 0, 1),
  });
  assert.deepEqual(searchUnifiedVenueIndex(venues, "RBC").map((row) => row.name), ["RBC Amphitheatre"]);
  assert.deepEqual(searchUnifiedVenueIndex(venues, "Budweiser").map((row) => row.name), ["RBC Amphitheatre"]);
  assert.equal(searchUnifiedVenueIndex(venues, "Toronto").length, 1, "the historical anchor cannot duplicate the renamed room");
});

test("the production-safe venue index exposes Portugal's five real arena anchors", () => {
  const venues = createUnifiedVenueSearchIndex({ curatedVenues: arenaVenues });
  assert.deepEqual(
    searchUnifiedVenueIndex(venues, "Portugal").map((row) => row.name),
    ["Estádio da Luz", "Estádio do Dragão", "Estádio José Alvalade", "MEO Arena", "Super Bock Arena"],
  );
  const portugal = searchUnifiedVenueIndex(venues, "Portugal");
  assert.ok(portugal.every((row) => row.upcoming === 0), "venue anchors never invent shows");
  assert.ok(portugal.every((row) => row.capacity > 0), "verified anchor capacity survives the search projection");
});

test("one tour-date snapshot reuses its venue index without retaining old arrays", () => {
  const tourDates = [...providerRows];
  const first = memoizedUnifiedVenueSearchIndex({ tourDates, curatedVenues: arenaVenues });
  const second = memoizedUnifiedVenueSearchIndex({ tourDates, curatedVenues: arenaVenues });
  assert.equal(first, second);
  assert.notEqual(first, memoizedUnifiedVenueSearchIndex({ tourDates: [...tourDates], curatedVenues: arenaVenues }));
});

test("missing, invalid, and out-of-range venue coordinates stay absent in the shared index", () => {
  const project = (fields) => createUnifiedVenueSearchIndex({
    tourDates: [{ ...providerRows[0], ...fields }], now: Date.UTC(2098, 0, 1),
  })[0].row.coord;
  for (const invalid of [null, undefined, "", "  ", false, true, [], {}, NaN, Infinity, "not a coordinate"]) {
    assert.equal(project({ lat: invalid, lng: 1 }), null);
    assert.equal(project({ lat: 1, lng: invalid }), null);
    assert.equal(project({ coord: { lat: invalid, lng: invalid } }), null);
  }
  for (const [lat, lng] of [[91, 0], [-91, 0], [0, 181], [0, -181]]) {
    assert.equal(project({ lat, lng }), null);
  }
  assert.deepEqual(project({ lat: 0, lng: "0" }), { lat: 0, lng: 0 }, "real zero coordinates are not fabricated absences");
  assert.deepEqual(project({ coord: { lat: "43.64", lng: "-79.38" } }), { lat: 43.64, lng: -79.38 });
});

test("the Discover map never turns an index venue with null coordinates into an ocean pin", () => {
  const event = { ...providerRows[0], venue: "Toronto Test Room", place: "Toronto, Ontario, Canada",
    venueCity: "Toronto", venueCountryCode: "CA", lat: null, lng: null };
  const now = Date.UTC(2098, 0, 1);
  const index = createUnifiedVenueSearchIndex({ tourDates: [event], now });
  const cities = buildDiscoverVenueCities(index, [event], { now });
  assert.equal(cities.length, 1);
  assert.equal(cities[0].mapped, 0);
  assert.equal(cities[0].venues[0].coord, null);
  assert.equal(cities[0].venues[0].shows.length, 1, "an unmapped venue and its real show remain browsable");
});
