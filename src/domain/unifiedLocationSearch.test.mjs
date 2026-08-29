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
