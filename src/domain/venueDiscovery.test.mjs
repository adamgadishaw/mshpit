import assert from "node:assert/strict";
import test from "node:test";

import {
  canonicalVenueCountry,
  eventDateMeta,
  isVenuePlaceActionable,
  locationCenterFromVenues,
  nearestMapPoints,
  splitVenuePlace,
  venueDirectoryTotals,
  venueHomePlaceId,
  venuePlaceIdentity,
  venueRowWindow,
} from "./venueDiscovery.mjs";

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

test("directory totals are bounded and derived only from supplied city counts", () => {
  assert.deepEqual(venueDirectoryTotals([
    { count: 3, upcoming: 5 },
    { count: 2, upcoming: 0 },
    { count: -9, upcoming: "2" },
  ]), { cities: 3, venues: 5, upcoming: 7 });
});

test("event date metadata creates a compact badge and useful relative timing", () => {
  const now = new Date(2026, 7, 13, 23, 30);
  assert.deepEqual(eventDateMeta("2026-08-14", now), {
    iso: "2026-08-14", month: "AUG", day: "14", year: "2026", timing: "Tomorrow",
  });
  assert.equal(eventDateMeta("2026-08-20", now).timing, "In 7 days");
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
