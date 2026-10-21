import test from "node:test";
import assert from "node:assert/strict";
import { buildVenueMapCatalogue, filterVenueMapCatalogue, venueMapCatalogueCities } from "./venueMapCatalogue.mjs";

const now = Date.parse("2026-10-21T12:00:00Z");
const row = (name, place = "Toronto, Ontario, Canada", extra = {}) => ({ name, place, lat: 43.65, lng: -79.38, ...extra });
const event = extra => ({ id: "event-1", venue: "First Room", place: "Toronto, Ontario, Canada", date: "2026-11-03", artist: "Fixture artist", source: "fixture", providerVenueId: "room-1", ...extra });

test("complete catalogue has no legacy index or 50-result cap and retains missing/invalid coordinates", () => {
  const catalogueVenues = Object.fromEntries(Array.from({ length: 8001 }, (_, i) => [`room-${i}`, row(`Room ${i}`, undefined, i === 8000 ? { lat: null, lng: null } : i === 7999 ? { lat: 999 } : {})]));
  const venues = buildVenueMapCatalogue({ catalogueVenues, now });
  assert.equal(venues.length, 8001);
  assert.equal(filterVenueMapCatalogue(venues, { query: "Room" }).length, 8001);
  assert.equal(venues.find(venue => venue.name === "Room 8000").coord, null);
  assert.equal(venues.find(venue => venue.name === "Room 7999").coord, null);
  assert.equal(venues.reduce((count, venue) => count + venue.catalogueKeys.length, 0), 8001);
});

test("merge keeps coordinate provenance with its original witness and attaches unique provider shows", () => {
  const provenance = { source: "MusicBrainz", sourceUrl: "https://musicbrainz.org/place/example" };
  const catalogueVenues = { first: row("First Room", undefined, { coordinateProvenance: provenance, mbid: "mb-fixture" }) };
  const venues = buildVenueMapCatalogue({ catalogueVenues, venueDirectoryIndex: [{ row: row("First Room", undefined, { identity: "provider:fixture:room-1", source: "fixture", providerVenueId: "room-1", lat: 43.66, coordinateProvenance: { source: "fixture" } }) }], tourDates: [event({}), event({})], now });
  assert.equal(venues.length, 1);
  assert.equal(venues[0].id, "catalogue:first");
  assert.equal(venues[0].shows.length, 1);
  assert.deepEqual(venues[0].coordinateProvenance, provenance);
  assert.equal(venues[0].source, undefined);
  assert.deepEqual(venues[0].coord, { lat: 43.65, lng: -79.38 });
  assert.ok(venues[0].mapCoordinateCandidates.some(candidate => candidate.source === "fixture" && candidate.coord.lat === 43.66));
  assert.deepEqual(venues[0].mapCoordinateCandidates.map(candidate => candidate.mapCoordinateInput), ["catalogue", "index", "event"]);
  assert.equal(venues[0].mapCoordinateInput, "catalogue");
  assert.deepEqual(venues[0].providerIdentities, ["provider:fixture:room-1"]);
});

test("same-named rooms in different countries and distinct provider rooms remain separate", () => {
  const venues = buildVenueMapCatalogue({ catalogueVenues: [row("Shared Room", "London, England, United Kingdom"), row("Shared Room", "London, Ontario, Canada")], tourDates: [event({ id: "a", venue: "Shared Room", providerVenueId: "a" }), event({ id: "b", venue: "Shared Room", providerVenueId: "b" })], now });
  assert.equal(venues.length, 4);
  assert.equal(venues.filter(venue => venue.providerIdentities.length).length, 2);
  assert.equal(venueMapCatalogueCities(venues).length, 3);
  assert.equal(filterVenueMapCatalogue(venues, { region: "Canada" }).length, 3);
});

test("qualified matching never guesses from city-only or absent place and unknown rows remain listable", () => {
  const venues = buildVenueMapCatalogue({ catalogueVenues: [row("First Room", "Toronto"), row("First Room", ""), row("First Room")], tourDates: [event({})], now });
  assert.equal(venues.length, 3);
  assert.equal(venues.filter(venue => venue.shows.length).length, 1);
  assert.ok(venues.some(venue => venue.place === ""));
});

test("all upcoming events are inspected, while future release, expired and cancelled shows stay private or absent", () => {
  const tourDates = Array.from({ length: 6001 }, (_, i) => event({ id: `event-${i}`, venue: `Room ${i}`, providerVenueId: `room-${i}` }));
  tourDates.push(event({ id: "private", releaseAt: now + 1 }), event({ id: "expired", date: "2020-01-01" }), event({ id: "cancelled", eventStatus: "cancelled" }));
  const venues = buildVenueMapCatalogue({ tourDates, now });
  assert.equal(venues.length, 6001);
  assert.equal(venues.reduce((count, venue) => count + venue.shows.length, 0), 6001);
  assert.equal(venues.at(-1).shows.length, 1);
});

test("identical coordinates do not merge distinct IDs and conflicting explicit IDs do not join places", () => {
  const venues = buildVenueMapCatalogue({ catalogueVenues: [
    row("First Room", undefined, { id: "first" }), row("Second Room", undefined, { id: "second" }),
    row("Other Room", "Paris, France", { id: "first" }),
  ], now });
  assert.equal(venues.length, 3);
  assert.ok(venues.some(venue => venue.id === "first"));
  assert.ok(venues.some(venue => venue.id === "second"));
  assert.ok(venues.some(venue => venue.id === "first:2"));
});

test("country codes match named countries and filtering does not change source rows", () => {
  const original = row("Café Room", "", { venueCity: "Montreal", venueRegion: "Quebec", venueCountryCode: "CA", lat: "45.5", lng: "-73.56" });
  const venues = buildVenueMapCatalogue({ catalogueVenues: [original], now });
  assert.equal(venues[0].place, "Montreal, Quebec, Canada");
  assert.equal(filterVenueMapCatalogue(venues, { query: "cafe", cityId: venues[0].cityId, region: "CA" }).length, 1);
  assert.equal(original.place, "");
  assert.equal(original.coord, undefined);
});

test("compact next-show records preserve complete venue upcoming counts", () => {
  const venues = buildVenueMapCatalogue({ tourDates: [event({ venueUpcomingCount: 60 }), event({ id: "other-witness", lat: 43.7, venueUpcomingCount: 60 })], now });
  assert.equal(venues.length, 1); assert.equal(venues[0].shows.length, 2); assert.equal(venues[0].venueUpcomingCount, 60);
});

test("case-distinct opaque provider ids retain separate venues, coordinates and shows", () => {
  const berry = event({ id: "berry-show", source: "Ticketmaster", providerVenueId: "KovZ917A-EJ", venue: "Berry Room", place: "Berry, New South Wales, Australia", venueCity: "Berry", venueRegion: "New South Wales", venueCountry: "Australia", venueCountryCode: "AU", lat: -34.775, lng: 150.694 });
  const stadium = event({ id: "stadium-show", source: "ticketmaster", providerVenueId: "KovZ917A-Ej", venue: "Queensland Stadium", place: "Brisbane, Queensland, Australia", venueCity: "Brisbane", venueRegion: "Queensland", venueCountry: "Australia", venueCountryCode: "AU", lat: -27.465, lng: 153.009 });
  const index = [berry, stadium].map(value => ({ row: { ...value, name: value.venue, identity: "provider:ticketmaster:kovz917a-ej" } }));
  const venues = buildVenueMapCatalogue({ venueDirectoryIndex: index, tourDates: [berry, stadium], now });
  assert.equal(venues.length, 2);
  const first = venues.find(row => row.providerVenueId === "KovZ917A-EJ"), second = venues.find(row => row.providerVenueId === "KovZ917A-Ej");
  assert.equal(first.id, "provider:ticketmaster:KovZ917A-EJ"); assert.equal(first.identity, first.id);
  assert.equal(second.id, "provider:ticketmaster:KovZ917A-Ej"); assert.equal(second.identity, second.id);
  assert.deepEqual(first.coord, { lat: -34.775, lng: 150.694 }); assert.deepEqual(second.coord, { lat: -27.465, lng: 153.009 });
  assert.deepEqual(first.shows.map(row => row.id), ["berry-show"]); assert.deepEqual(second.shows.map(row => row.id), ["stadium-show"]);
});

test("actual Cluny 2 provider city prefix preserves its postal component once and keeps original place", () => {
  const captured = { id: "tm_LvZ18QrrH11XAzYZ0qJ7l", venue: "Cluny 2", place: "Newcastle upon Tyne, NE1 2PQ, Great Britain",
    venueCity: "Newcastle upon Tyne, NE1 2PQ", venueRegion: null, venueCountry: "Great Britain", venueCountryCode: "GB", source: "ticketmaster",
    providerVenueId: "KovZ9177_5V", lat: 54.974933, lng: -1.59238, date: "2026-10-21" };
  const venues = buildVenueMapCatalogue({ tourDates: [captured], now });
  assert.equal(venues.length, 1); assert.equal(venues[0].name, "Cluny 2");
  assert.equal(venues[0].place, captured.place); assert.equal(venues[0].venueCity, captured.venueCity); assert.equal(venues[0].venueRegion, null);
  assert.equal(venues[0].mapCoordinateCandidates[0].place, captured.place);
  assert.deepEqual(venues[0].coord, { lat: captured.lat, lng: captured.lng });
  assert.equal(captured.venueRegion, null);
});
