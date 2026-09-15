import assert from "node:assert/strict";
import test from "node:test";

import {
  canonicalVenueCountry,
  eventDateMeta,
  isVenuePlaceActionable,
  LIVE_SHOW_COUNTDOWN_DAYS,
  locationCenterFromVenues,
  nearestMapPoints,
  optionalDistanceKm,
  splitVenuePlace,
  venueDirectoryTotals,
  venueHomePlaceId,
  venuePlaceIdentity,
  venueRowWindow,
} from "./venueDiscovery.mjs";

test("missing event coordinates never become a fake zero-kilometre distance", () => {
  assert.equal(optionalDistanceKm(null), null);
  assert.equal(optionalDistanceKm(undefined), null);
  assert.equal(optionalDistanceKm(""), null);
  assert.equal(optionalDistanceKm(false), null);
  assert.equal(optionalDistanceKm(-1), null);
  assert.equal(optionalDistanceKm("0"), 0);
  assert.equal(optionalDistanceKm(12.5), 12.5);
});

test("venue place parsing keeps the city useful without inventing missing geography", () => {
  assert.deepEqual(splitVenuePlace("Toronto, Ontario, Canada"), { city: "Toronto", region: "Ontario, Canada" });
  assert.deepEqual(splitVenuePlace(""), { city: "Location unavailable", region: "" });
  assert.notEqual(
    venuePlaceIdentity("London, Ontario, Canada").id,
    venuePlaceIdentity("London, England, United Kingdom").id,
  );
});

test("venue place identity merges country aliases but preserves genuinely different cities", () => {
  assert.equal(canonicalVenueCountry("United States Of America"), "United States");
  assert.equal(
    venuePlaceIdentity("Chicago, Illinois, United States").id,
    venuePlaceIdentity("Chicago, Illinois, United States Of America").id,
  );
  assert.equal(
    splitVenuePlace("Boston, Massachusetts, USA").region,
    "Massachusetts, United States",
  );
  assert.notEqual(
    venuePlaceIdentity("London, Ontario, Canada").id,
    venuePlaceIdentity("London, England, United Kingdom").id,
  );
});

test("the directory excludes missing and placeholder places without hiding real city-only rows", () => {
  assert.equal(isVenuePlaceActionable(""), false);
  assert.equal(isVenuePlaceActionable("Unknown, Region unavailable"), false);
  assert.equal(isVenuePlaceActionable("Venue TBA"), false);
  assert.equal(isVenuePlaceActionable("Toronto"), true);
});

test("picked locations resolve against the complete place instead of a same-named city", () => {
  const venues = [
    { place: "London, Ontario, Canada", coord: { lat: 42.98, lng: -81.24 } },
    { place: "London, England, United Kingdom", coord: { lat: 51.50, lng: -0.12 } },
    { place: "London, England, United Kingdom", coord: { lat: 51.52, lng: -0.10 } },
  ];
  const london = locationCenterFromVenues({
    city: "London", state: "England", country: "United Kingdom", label: "London, England, United Kingdom",
  }, venues);
  assert.deepEqual({ ...london, lat: Number(london.lat.toFixed(2)), lng: Number(london.lng.toFixed(2)) }, {
    city: "London", state: "England", country: "United Kingdom", label: "London, England, United Kingdom", lat: 51.51, lng: -0.11,
  });
  assert.equal(locationCenterFromVenues({ city: "Springfield", state: "Queensland", country: "Australia" }, venues).lat, null);
  assert.equal(locationCenterFromVenues({
    city: "Chicago", state: "Illinois", country: "United States",
  }, [{ place: "Chicago, Illinois, United States Of America", coord: { lat: 41.88, lng: -87.67 } }]).lat, 41.88);
});

test("missing or invalid venue coordinates never manufacture a city center at zero", () => {
  const place = { city: "London", state: "England", country: "United Kingdom" };
  const invalid = [null, undefined, "", "   ", false, true, NaN, Infinity, -Infinity, "no-location", [], {}];
  for (const value of invalid) {
    for (const coord of [{ lat: value, lng: -.12 }, { lat: 51.5, lng: value }]) {
      const center = locationCenterFromVenues(place, [{ place: "London, England, United Kingdom", coord }]);
      assert.equal(center.lat, null, `invalid ${String(value)} must not create a latitude`);
      assert.equal(center.lng, null, `invalid ${String(value)} must not create a longitude`);
    }
  }
  for (const coord of [{ lat: 91, lng: 0 }, { lat: -91, lng: 0 }, { lat: 0, lng: 181 }, { lat: 0, lng: -181 }]) {
    const center = locationCenterFromVenues(place, [{ place: "London, England, United Kingdom", coord }]);
    assert.equal(center.lat, null);
    assert.equal(center.lng, null);
  }
});

test("invalid matching venues do not pull a real London center toward the equator", () => {
  const venues = [
    { place: "London, England, United Kingdom", coord: { lat: 51.5, lng: -.12 } },
    { place: "London, England, United Kingdom", coord: { lat: null, lng: null } },
    { place: "London, England, United Kingdom", coord: { lat: "", lng: "" } },
    { place: "London, England, United Kingdom", coord: { lat: false, lng: false } },
  ];
  const before = structuredClone(venues);
  const center = locationCenterFromVenues({ city: "London", state: "England", country: "United Kingdom" }, venues);
  assert.equal(center.lat, 51.5);
  assert.equal(center.lng, -.12);
  assert.deepEqual(venues, before);
});

test("real zero coordinates and numeric provider strings remain valid city positions", () => {
  for (const coord of [{ lat: 0, lng: 0 }, { lat: 51.5, lng: 0 }, { lat: 0, lng: 36.8 }, { lat: " 0 ", lng: "36.8" }]) {
    const center = locationCenterFromVenues({ city: "Fixture" }, [{ place: "Fixture", coord }]);
    assert.equal(center.lat, Number(coord.lat));
    assert.equal(center.lng, Number(coord.lng));
  }
});

test("directory totals are bounded and derived only from supplied city counts", () => {
  assert.deepEqual(venueDirectoryTotals([
    { count: 3, upcoming: 5 },
    { count: 2, upcoming: 0 },
    { count: -9, upcoming: "2" },
  ]), { cities: 3, venues: 5, upcoming: 7 });
});

test("event date metadata creates a compact badge and useful relative timing", () => {
  const now = new Date(2026, 7, 13, 23, 30);
  assert.equal(LIVE_SHOW_COUNTDOWN_DAYS, 30);
  assert.deepEqual(eventDateMeta("2026-08-14", now), {
    iso: "2026-08-14", month: "AUG", day: "14", year: "2026", timing: "Tomorrow",
  });
  assert.equal(eventDateMeta("2026-08-20", now).timing, "In 7 days");
  assert.equal(eventDateMeta("2026-09-12", now).timing, "In 30 days");
  assert.equal(eventDateMeta("2026-09-13", now).timing, "SEP 13");
  assert.equal(eventDateMeta("not-a-date", now).timing, "Date to be announced");
});

test("map points are capped after nearest-first sorting without mutating input", () => {
  const input = [
    { name: "Far", lat: 1, lng: 1, distanceKm: 40 },
    { name: "Missing" },
    { name: "Near", lat: 2, lng: 2, distanceKm: 3 },
  ];
  assert.deepEqual(nearestMapPoints(input, 1).map((point) => point.name), ["Near"]);
  assert.equal(input[0].name, "Far");
});

test("popular venue pages bound their initial review and image mount cost", () => {
  const reviews = Array.from({ length: 200 }, (_, id) => ({ id, photos: Array(8).fill(`photo-${id}`) }));
  const first = venueRowWindow(reviews, 8, 8);
  assert.equal(first.rows.length, 8);
  assert.equal(first.rows.flatMap((review) => review.photos).length, 64);
  assert.equal(first.remaining, 192);
  assert.equal(first.nextCount, 16);
  assert.equal(venueRowWindow(reviews, first.nextCount, 8).rows.length, 16);
});

test("same-named cities produce exactly one home directory match", () => {
  const cities = [
    { id: venuePlaceIdentity("London, Ontario, Canada").id, city: "London", venues: [{ coord: { lat: 42.98, lng: -81.24 } }] },
    { id: venuePlaceIdentity("London, England, United Kingdom").id, city: "London", venues: [{ coord: { lat: 51.50, lng: -0.12 } }] },
  ];
  assert.equal(venueHomePlaceId({ city: "London", lat: 51.5072, lng: -0.1276 }, cities), cities[1].id);
  assert.equal(venueHomePlaceId({ city: "London", state: "Ontario", country: "Canada" }, cities), cities[0].id);
});

test("missing home coordinates do not rank cities by distance from Null Island", () => {
  const cities = [
    { id: "a", city: "Fixture", venues: [{ coord: { lat: 60, lng: 60 } }] },
    { id: "b", city: "Fixture", venues: [{ coord: { lat: 1, lng: 1 } }] },
  ];
  for (const value of [null, "", " ", false, [], {}]) {
    assert.equal(venueHomePlaceId({ city: "Fixture", lat: value, lng: value }, cities), "a");
  }
});

test("invalid venue coordinates cannot win home-city proximity matching", () => {
  const cities = [
    { id: "a-invalid", city: "Fixture", venues: [{ coord: { lat: null, lng: null } }] },
    { id: "b-real", city: "Fixture", venues: [{ coord: { lat: "1", lng: "1" } }] },
  ];
  assert.equal(venueHomePlaceId({ city: "Fixture", lat: 0, lng: 0 }, cities), "b-real");
});

test("nearest map points reject corrupt coordinates before sorting or applying the cap", () => {
  const input = [
    { name: "Empty", lat: "", lng: "", distanceKm: 0 },
    { name: "Boolean", lat: false, lng: false, distanceKm: 0 },
    { name: "Out of range", lat: 100, lng: 200, distanceKm: 0 },
    { name: "Not finite", lat: NaN, lng: 0, distanceKm: 0 },
    { name: "Real zero", lat: 0, lng: 0, distanceKm: 1 },
    { name: "Provider string", lat: "51.5", lng: "0", distanceKm: 2 },
  ];
  const before = structuredClone(input);
  const points = nearestMapPoints(input, 2);
  assert.deepEqual(points.map(point => point.name), ["Real zero", "Provider string"]);
  assert.equal(points[0].lat, 0);
  assert.equal(points[1].lat, 51.5);
  assert.deepEqual(input, before);
});

test("city centers and home proximity remain local across the antimeridian", () => {
  const venues = [
    { place: "Fixture, Fiji", coord: { lat: -16.5, lng: 179.9 } },
    { place: "Fixture, Fiji", coord: { lat: -16.5, lng: -179.9 } },
  ];
  const cities = [
    { id: "a-dateline", city: "Fixture", venues },
    { id: "b-distant", city: "Fixture", venues: [{ coord: { lat: -16.5, lng: 170 } }] },
  ];
  for (const rows of [venues, [...venues].reverse()]) {
    const center = locationCenterFromVenues({ city: "Fixture", country: "Fiji" }, rows);
    assert.equal(center.lat, -16.5);
    assert.equal(Math.abs(center.lng), 180);
  }
  for (const lng of [179.95, -179.95]) {
    assert.equal(venueHomePlaceId({ city: "Fixture", lat: -16.5, lng }, cities), "a-dateline");
  }
});
