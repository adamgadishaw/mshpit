import test from "node:test";
import assert from "node:assert/strict";
import { discoverVenueCityChoices, discoverVenueCityMatches, discoverVenueExplorerRows, discoverVenueMapPoints } from "./discoverVenueExplorer.mjs";

const venues = [
  { id: "a", name: "REBEL", coord: { lat: 43.64, lng: -79.34 } },
  { id: "b", name: "Écho Hall", coord: null },
  { id: "c", name: "Rebel Basement", coord: { lat: 43.63, lng: -79.33 } },
];
const toronto = { id: "toronto-ca", city: "Toronto", region: "Ontario, Canada", venues };

test("venue-name queries narrow the same rows used by the list and map", () => {
  const results = discoverVenueExplorerRows(toronto, " rebel ");
  assert.deepEqual(results.map(row => row.id), ["a", "c"]);
  assert.deepEqual(discoverVenueMapPoints(results, "a").points, results);
  assert.deepEqual(discoverVenueExplorerRows(toronto, "echo"), [venues[1]]);
  assert.deepEqual(discoverVenueExplorerRows(toronto, "missing"), []);
  assert.deepEqual(discoverVenueExplorerRows(null, "rebel"), []);
});

test("city selection and venue-name search stay separate without changing venue identities", () => {
  assert.equal(discoverVenueExplorerRows(toronto, ""), venues);
  for (const query of ["toronto", "ONTARIO", "Canada"]) assert.deepEqual(discoverVenueExplorerRows(toronto, query), []);
  assert.equal(discoverVenueExplorerRows(toronto, "REBEL")[0], venues[0]);
  const cities = [toronto, { id: "montreal", city: "Montréal", region: "Quebec, Canada", venues: [] }];
  assert.equal(discoverVenueCityMatches(cities, ""), cities);
  assert.deepEqual(discoverVenueCityMatches(cities, " Ontario "), [toronto]);
  assert.deepEqual(discoverVenueCityMatches(cities, "montreal"), [cities[1]]);
  assert.deepEqual(discoverVenueCityMatches(cities, "canada"), cities);
  assert.deepEqual(discoverVenueCityMatches(cities, "REBEL"), []);
  assert.deepEqual(discoverVenueCityMatches([], "toronto"), []);
});

test("city buttons keep their order when switching instead of jumping under a second tap", () => {
  const cities = Array.from({ length: 9 }, (_, i) => ({ id: String(i) }));
  assert.deepEqual(discoverVenueCityChoices(cities, "0"), cities.slice(0, 6));
  assert.deepEqual(discoverVenueCityChoices(cities, "3"), cities.slice(0, 6));
  assert.deepEqual(discoverVenueCityChoices(cities, "8"), [...cities.slice(0, 5), cities[8]]);
  assert.deepEqual(discoverVenueCityChoices([], null), []);
});

test("map point window stays bounded and reports omitted and unmapped venues honestly", () => {
  const rows = Array.from({ length: 30 }, (_, i) => ({ id: String(i), coord: { lat: 43 + i / 100, lng: -79 } }));
  rows.push({ id: "unknown", coord: null });
  const result = discoverVenueMapPoints(rows, "29");
  assert.equal(result.points.length, 24);
  assert.equal(result.points.at(-1).id, "29");
  assert.equal(result.mappedCount, 30);
  assert.equal(result.unmappedCount, 1);
  assert.equal(rows.length, 31);
  assert.equal(discoverVenueMapPoints(rows, "unknown").points.some(row => row.id === "unknown"), false);
  assert.deepEqual(discoverVenueMapPoints([{ id: "none", coord: null }], "none"), { points: [], mappedCount: 0, unmappedCount: 1 });
});
