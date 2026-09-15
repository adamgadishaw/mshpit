import test from "node:test";
import assert from "node:assert/strict";
import { buildDiscoverVenueCities, discoverVenueCoordinate, discoverVenueMap, filterDiscoverVenueCities, findDiscoverVenueMatch } from "./discoverVenues.mjs";

const now = Date.parse("2026-09-15T12:00:00Z");
const venue = (name, id, place = "Toronto, Ontario, Canada", coord = { lat: 43.65, lng: -79.38 }) => ({ row: {
  name, source: "ticketmaster", providerVenueId: id, place, coord, venueCountry: "Canada",
} });
const event = (id, roomId, name = "Room", extras = {}) => ({ id, source: "ticketmaster", providerVenueId: roomId,
  venue: name, artist: "Fixture band", date: "2026-10-01", city: "Toronto", venueCountry: "Canada", ...extras });
const build = (venues, events = [], options = {}) => buildDiscoverVenueCities(venues, events, { now, ...options });

test("venue explorer retains catalog rooms without dates and joins shows once by provider identity", () => {
  const show = event("e1", "r1");
  const [city] = build([venue("Room", "r1"), venue("Other", "r2")], [show, show]);
  assert.equal(city.venues.length, 2); assert.equal(city.shows.length, 1);
  assert.equal(city.venues[0].name, "Room"); assert.equal(city.venues[0].shows.length, 1);
  assert.equal(city.venues[1].shows.length, 0); assert.equal(city.mapped, 2);
});
test("provider case and snake-case id normalize without duplicate rooms", () => {
  const row = venue("Room", "ABC"); row.row.source = "Ticketmaster";
  const [city] = build([row], [event("e1", undefined, "Room", { venue_provider_id: "abc" })]);
  assert.equal(city.venues.length, 1); assert.equal(city.shows.length, 1);
});
test("same named rooms in different complete places never borrow concerts", () => {
  const ca = venue("Room", "ca", "Richmond, British Columbia, Canada");
  const us = venue("Room", "us", "Richmond, Virginia, United States"); us.row.venueCountry = "United States";
  const cities = build([ca, us], [event("e1", "us", "Room", { venueCountry: "United States" })]);
  assert.equal(cities.length, 2); assert.equal(cities.find(c => c.region.includes("Canada")).shows.length, 0);
  assert.equal(cities.find(c => c.region.includes("Virginia")).shows.length, 1);
});
test("ambiguous name-only events do not attach to either provider room", () => {
  const noId = event("legacy", null, "Room", { city: "Toronto, Ontario, Canada" });
  assert.equal(build([venue("Room", "a"), venue("Room", "b")], [noId])[0].shows.length, 0);
});
test("unreleased, past, invalid-date and wrong-country shows are excluded", () => {
  const [city] = build([venue("Room", "a")], [
    event("past", "a", "Room", { date: "2025-01-01" }),
    event("embargo", "a", "Room", { releaseAt: now + 1 }),
    event("invalid", "a", "Room", { date: "nonsense" }),
    event("outside", "a", "Room", { venueCountry: "United States" }),
  ], { region: "Canada" });
  assert.equal(city.shows.length, 0);
});
test("active multi-day concerts remain in the city calendar", () => {
  const [city] = build([venue("Room", "a")], [event("festival", "a", "Room", { date: "2026-09-14", eventEndDate: "2026-09-16" })]);
  assert.equal(city.shows.length, 1);
});
test("city/venue search is accent-insensitive and never fabricates a city", () => {
  const cities = build([venue("Métropolis", "a", "Montréal, Quebec, Canada")]);
  assert.equal(filterDiscoverVenueCities(cities, "Montreal").length, 1);
  assert.equal(filterDiscoverVenueCities(cities, "metropolis").length, 1);
  assert.equal(findDiscoverVenueMatch(cities[0].venues, "metropolis").name, "Métropolis");
  assert.equal(filterDiscoverVenueCities(cities, "absent").length, 0);
});
test("coordinate validation rejects missing or corrupt values without discarding a real zero", () => {
  for (const value of [null, undefined, "", " ", true, "bad", 200]) assert.equal(discoverVenueCoordinate({ lat: value, lng: 0 }), null);
  assert.deepEqual(discoverVenueCoordinate({ lat: 0, lng: 0 }), { lat: 0, lng: 0 });
  assert.equal(discoverVenueMap([{ coord: null }]), null);
});
test("pins and map share finite in-bounds Mercator projection including antimeridian cities", () => {
  for (const coords of [[{ lat: 43.65, lng: -79.38 }, { lat: 43.7, lng: -79.45 }],
    [{ lat: -16.5, lng: 179.9 }, { lat: -16.4, lng: -179.9 }], [{ lat: 0, lng: 0 }]]) {
    const map = discoverVenueMap(coords);
    assert.ok(Number.isFinite(map.center.lat)); assert.ok(Number.isFinite(map.center.lng));
    for (const coord of coords) { const point = map.project(coord); assert.ok(point.x > 0 && point.x < 1); assert.ok(point.y > 0 && point.y < 1); }
  }
});
test("new provider rooms can surface from fresh event data without mutating the index", () => {
  const rows = [venue("Room", "a")]; const before = structuredClone(rows);
  const cities = build(rows, [event("new", "new", "New room", { city: "Ottawa, Ontario, Canada", lat: 45.42, lng: -75.7 })]);
  assert.equal(cities.length, 2); assert.deepEqual(rows, before);
});
