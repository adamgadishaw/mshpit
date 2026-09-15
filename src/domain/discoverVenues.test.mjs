import test from "node:test";
import assert from "node:assert/strict";
import { buildDiscoverVenueCities, clusterDiscoverVenuePins, discoverVenueCoordinate, discoverVenueMap, filterDiscoverVenueCities, findDiscoverVenueMatch } from "./discoverVenues.mjs";

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
// Compute provider pixels from the returned geographic center, independently
// of the overlay fit: in-bounds pins alone cannot catch a detached basemap.
function providerPixel(map, point) {
  let longitudeDelta = point.lng - map.center.lng;
  while (longitudeDelta > 180) longitudeDelta -= 360;
  while (longitudeDelta < -180) longitudeDelta += 360;
  const worldSize = 256 * 2 ** map.zoom;
  const northing = lat => {
    const sine = Math.sin(lat * Math.PI / 180);
    return Math.log((1 + sine) / (1 - sine)) / (4 * Math.PI);
  };
  return {
    x: map.width / 2 + longitudeDelta * worldSize / 360,
    y: map.height / 2 + (northing(map.center.lat) - northing(point.lat)) * worldSize,
  };
}

function assertProviderAlignment(map, coords) {
  for (const coord of coords) {
    const overlay = map.project(coord);
    const provider = providerPixel(map, coord);
    assert.ok(Math.abs(overlay.x * map.width - provider.x) < 1e-7, "pin longitude must match the requested basemap center");
    assert.ok(Math.abs(overlay.y * map.height - provider.y) < 1e-7, "pin latitude must match the requested basemap center");
  }
}

for (const [city, coords] of [
  ["London", [{ lat: 51.5074, lng: -0.1278 }, { lat: 51.539, lng: -0.1426 }, { lat: 51.503, lng: -0.019 }]],
  ["Toronto", [{ lat: 43.6387, lng: -79.3806 }, { lat: 43.6655, lng: -79.4112 }, { lat: 43.6656, lng: -79.3114 }]],
]) {
  test(`${city} basemap centers on the venue cluster and its pixels match the overlay`, () => {
    for (const [width, height] of [[640, 420], [320, 210]]) {
      const map = discoverVenueMap(coords, width, height);
      const midpointLng = (Math.min(...coords.map(p => p.lng)) + Math.max(...coords.map(p => p.lng))) / 2;
      assert.ok(Math.abs(map.center.lng - midpointLng) < 1e-9, "map must not request the opposite hemisphere");
      assert.ok(map.center.lat >= Math.min(...coords.map(p => p.lat)) && map.center.lat <= Math.max(...coords.map(p => p.lat)));
      assertProviderAlignment(map, coords);
    }
  });
}

for (const [direction, coords, expectedLng] of [
  ["east", [{ lat: -16.5, lng: 179.8 }, { lat: -16.4, lng: -179.4 }], -179.8],
  ["west", [{ lat: -16.5, lng: 179.4 }, { lat: -16.4, lng: -179.8 }], 179.8],
]) {
  test(`antimeridian ${direction} wrap keeps the provider center and pins aligned in either input order`, () => {
    for (const points of [coords, [...coords].reverse()]) {
      const map = discoverVenueMap(points);
      assert.ok(Math.abs(map.center.lng - expectedLng) < 1e-9);
      assert.ok(map.center.lng >= -180 && map.center.lng < 180);
      assertProviderAlignment(map, points);
      for (const point of points) {
        const pixel = providerPixel(map, point);
        assert.ok(pixel.x > 0 && pixel.x < map.width);
        assert.ok(pixel.y > 0 && pixel.y < map.height);
      }
    }
  });
}
test("new provider rooms can surface from fresh event data without mutating the index", () => {
  const rows = [venue("Room", "a")]; const before = structuredClone(rows);
  const cities = build(rows, [event("new", "new", "New room", { city: "Ottawa, Ontario, Canada", lat: 45.42, lng: -75.7 })]);
  assert.equal(cities.length, 2); assert.deepEqual(rows, before);
});

const pinProjection = { width: 1000, height: 1000, project: coord => ({ x: coord.lng / 100, y: coord.lat / 100 }) };
const pin = (id, x, y = .5) => ({ id, coord: { lat: y * 100, lng: x * 100 } });

test("venue pin clustering combines overlapping square hit targets but leaves separated buttons alone", () => {
  const points = [pin("a", .2), pin("b", .23, .53), pin("c", .4), pin("d", .23, .7)];
  const before = structuredClone(points);
  const groups = clusterDiscoverVenuePins(points, pinProjection);
  assert.deepEqual(groups.map(group => group.venues.map(v => v.id)), [["a", "b"], ["c"], ["d"]]);
  assert.ok(Math.abs(groups[0].position.x - .215) < 1e-12);
  assert.ok(Math.abs(groups[0].position.y - .515) < 1e-12);
  assert.equal(groups[0].venues[0], points[0]);
  assert.deepEqual(points, before);
});

test("colocated venue pins remain individually available in one stable cluster", () => {
  const points = Array.from({ length: 24 }, (_, index) => pin(`room-${index}`, .5));
  const groups = clusterDiscoverVenuePins(points, pinProjection);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].venues, points);
  assert.deepEqual(groups[0].position, { x: .5, y: .5 });
});

test("rendered mobile size recomputes collisions without changing geographic centroids", () => {
  const points = [pin("a", .2), pin("b", .3)];
  assert.equal(clusterDiscoverVenuePins(points, pinProjection).length, 2);
  const mobile = clusterDiscoverVenuePins(points, pinProjection, { width: 390, height: 260 });
  assert.equal(mobile.length, 1);
  assert.deepEqual(mobile[0].position, { x: .25, y: .5 });
  assert.deepEqual(mobile[0].venues, points);
});

test("chain collisions terminate with weighted centroids and no overlapping group hit targets", () => {
  const points = [pin("a", .2), pin("b", .23), pin("c", .26), pin("d", .5), pin("e", .525), pin("f", .6)];
  const groups = clusterDiscoverVenuePins(points, pinProjection);
  assert.deepEqual(groups.map(group => group.venues.map(v => v.id)), [["a", "b", "c"], ["d", "e"], ["f"]]);
  assert.ok(Math.abs(groups[0].position.x - .23) < 1e-12, "merged groups must weight all original venues equally");
  assert.deepEqual(clusterDiscoverVenuePins(points, pinProjection), groups);
  assert.deepEqual(groups.flatMap(group => group.venues), points);
  for (let i = 0; i < groups.length; i += 1) {
    for (let j = i + 1; j < groups.length; j += 1) {
      const dx = Math.abs(groups[i].position.x - groups[j].position.x) * pinProjection.width;
      const dy = Math.abs(groups[i].position.y - groups[j].position.y) * pinProjection.height;
      assert.ok(dx >= 48 || dy >= 48);
    }
  }
});

test("clustering preserves source order after merging interleaved groups", () => {
  const points = [pin("a", .2), pin("b", .25), pin("c", .22)];
  const groups = clusterDiscoverVenuePins(points, pinProjection);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].venues, points);
});

test("clustering skips invalid coordinates and refuses unusable geometry", () => {
  const points = [pin("real", .5), { id: "missing" }, { coord: { lat: null, lng: 0 } }, { coord: { lat: 100, lng: 0 } }];
  assert.deepEqual(clusterDiscoverVenuePins(points, pinProjection)[0].venues, [points[0]]);
  for (const options of [{ width: 0 }, { height: -1 }, { diameter: 0 }, { width: NaN }]) {
    assert.deepEqual(clusterDiscoverVenuePins(points, pinProjection, options), []);
  }
  assert.deepEqual(clusterDiscoverVenuePins(points, { project: () => ({ x: Infinity, y: .5 }) }, { width: 640, height: 420 }), []);
  assert.deepEqual(clusterDiscoverVenuePins(points, null), []);
});

test("real city clusters fit the projected image at mobile and desktop sizes", () => {
  const points = [{ id: "a", coord: { lat: 51.5074, lng: -.1278 } }, { id: "b", coord: { lat: 51.5075, lng: -.128 } }, { id: "c", coord: { lat: 51.539, lng: -.1426 } }];
  const projection = discoverVenueMap(points);
  for (const width of [320, 390, 640]) {
    const groups = clusterDiscoverVenuePins(points, projection, { width, height: width * projection.height / projection.width });
    assert.equal(groups.reduce((sum, group) => sum + group.venues.length, 0), points.length);
    for (const { position } of groups) assert.ok(position.x > 0 && position.x < 1 && position.y > 0 && position.y < 1);
  }
});
