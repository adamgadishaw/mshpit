import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PROVIDER_COORDINATE_CONTEXT_SOURCE, PROVIDER_COUNTRY_RING_BOUNDS, providerCoordinateContextIssue } from "./providerCoordinateContext.mjs";

const context = (countryCode, region, lat, lng) => ({ venueCountryCode: countryCode, venueRegion: region,
  venueCountry: { US: "United States Of America", CA: "Canada", PL: "Poland", NZ: "New Zealand", MX: "Mexico" }[countryCode], lat, lng });

test("small ring bounds retain exact existing Natural Earth snapshot provenance", () => {
  const bytes = readFileSync(new URL("../features/concertHistory/worldGeography.json", import.meta.url));
  const geography = JSON.parse(bytes);
  assert.equal(createHash("sha256").update(bytes).digest("hex"), PROVIDER_COORDINATE_CONTEXT_SOURCE.snapshotSha256);
  assert.equal(geography.source, PROVIDER_COORDINATE_CONTEXT_SOURCE.sourceUrl);
  assert.equal(geography.sourceSha256, PROVIDER_COORDINATE_CONTEXT_SOURCE.sourceSha256);
  assert.equal(geography.license, PROVIDER_COORDINATE_CONTEXT_SOURCE.license);
  assert.equal(geography.licenseUrl, PROVIDER_COORDINATE_CONTEXT_SOURCE.licenseUrl);
  for (const [code, boxes] of Object.entries(PROVIDER_COUNTRY_RING_BOUNDS)) {
    const path = geography.countries.find((country) => country.code === code).d;
    const derived = path.match(/M[^Z]*Z/gu).map((ring) => {
      const points = [...ring.matchAll(/[ML](-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/gu)].map((match) => [+match[1] - 180, 90 - (+match[2])]);
      return [Math.min(...points.map((p) => p[0])), Math.min(...points.map((p) => p[1])), Math.max(...points.map((p) => p[0])), Math.max(...points.map((p) => p[1]))].map((n) => Number(n.toFixed(3)));
    });
    assert.deepEqual(boxes, derived, code);
  }
});

// Actual numeric-valid source tuples captured from the public MSHPIT venue-map
// projection on 2026-10-21. Names/IDs remain distinct; no point is sign/axis-fixed.
const contradictoryFixtures = [
  ["rZ7HnEZ171A7V", "Albatross", "US", "FL", -81.656423, 30.326208],
  ["rZ7HnEZ17_taS", "Crossroads Christian Church", "US", "CA", 33.8511, 117.55648],
  ["KovZpZA67EaA", "Edgemen", "US", "MI", -40.354117, 175.609856],
  ["Z198xZQpZeF7", "Klub Proxima", "PL", "Mazowieckie", 1, 1],
  ["KovZ917ARm4", "Double Whammy", "NZ", "NZ", 36.85769303, 174.76013853],
  ["KovZ917AVVr", "Estadio River Plate", "MX", "QRO", -34.545358, -58.449662],
  ["rZ7HnEZ17p_Az", "Stardust Video & Coffee", "US", "FL", 28.5684439, 81.3465159],
  ["KovZpZAJA7dA", "Rat King Studios", "US", "CA", 53.537623, -113.508765],
  ["Za98xZQpZae", "Polska Filharmonia Baltycka", "PL", "Pomorskie", 54.3524, 54.3524],
  ["rZ7HnEZ17pppF", "The Homestead", "US", "NJ", 40.7949024, 74.4806335],
  ["rZ7HnEZ17jbGS", "Las Rosas", "US", "FL", 25.8034008, 80.2075047],
  ["KovZpZAJ7JeA", "Autodromo Hermanos Rodriguez - Redirect", "US", "CA", 19.40345, -99.088778],
];

test("twelve actual gross country contradictions are withheld without editing source tuples", () => {
  for (const [providerVenueId, venue, code, region, lat, lng] of contradictoryFixtures) {
    const row = Object.freeze({ ...context(code, region, lat, lng), providerVenueId, venue });
    const result = providerCoordinateContextIssue(row);
    assert.equal(result?.reason, "provider-coordinate-country-context", venue);
    assert.equal(result?.countryCode, code);
    assert.equal(row.lat, lat);
    assert.equal(row.lng, lng);
    assert.equal(row.providerVenueId, providerVenueId);
    assert.equal(result.lat, undefined);
    assert.equal(result.lng, undefined);
  }
});

test("country-qualified state and province aliases are screened without ambiguous code reuse", () => {
  for (const region of ["CA", "California", "FL", "Florida", "MI", "Michigan", "NJ", "New Jersey"]) {
    assert.ok(providerCoordinateContextIssue(context("US", region, 40, 110)), region);
  }
  for (const region of ["ON", "Ontario", "QC", "Quebec", "Québec", "BC", "British Columbia", "NT", "Northwest Territories", "NU", "Nunavut"]) {
    assert.ok(providerCoordinateContextIssue(context("CA", region, 40, 110)), region);
  }
  assert.equal(providerCoordinateContextIssue(context("US", "Ontario", 40, 110)), null);
  assert.equal(providerCoordinateContextIssue(context("CA", "California", 40, 110)), null);
});

test("two-degree padding accepts border/coast context without asserting an exact country or venue", () => {
  const [west, south, east, north] = PROVIDER_COUNTRY_RING_BOUNDS.PL[0];
  const padding = PROVIDER_COORDINATE_CONTEXT_SOURCE.paddingDegrees;
  for (const [lat, lng] of [[south - padding, west - padding], [north + padding, east + padding], [52.23, 21.01]]) {
    assert.equal(providerCoordinateContextIssue(context("PL", "Mazowieckie", lat, lng)), null);
  }
  assert.ok(providerCoordinateContextIssue(context("PL", "Mazowieckie", north + padding + 0.001, east)));
  for (const row of [context("US", "FL", 24.55, -81.78), context("US", "HI", 21.3, -157.8),
    context("CA", "ON", 43.65, -79.38), context("CA", "NU", 82.5, -62.3), context("MX", "CMX", 19.4, -99.1)]) {
    assert.equal(providerCoordinateContextIssue(row), null);
  }
});

test("coarse coverage exceptions do not exclude Aleutian, northwestern Hawaiian or New Zealand islands", () => {
  for (const row of [context("US", "AK", 51.88, -176.64), context("US", "Alaska", 51.95, 179.6),
    context("US", "HI", 28.4167, -178.3333), context("US", "Hawaii", 23.87, -166.28),
    context("NZ", "NZ", -43.95, -176.55), context("NZ", "NZ", -52.55, 169.15), context("NZ", "NZ", -29.25, -177.9167)]) {
    assert.equal(providerCoordinateContextIssue(row), null);
  }
  assert.ok(providerCoordinateContextIssue(context("US", "AK", -40, 175)));
});

test("unknown, incomplete and unsupported contexts are explicitly unassessed", () => {
  for (const row of [null, [], {}, context("US", "PR", 18.4, -66.1), context("US", "Puerto Rico", 18.4, -66.1),
    context("US", "DC", 38.9, -77), context("US", "GU", 13.4, 144.7), context("US", "", 40, 110),
    context("CA", "unknown", 40, 110), context("US", "constructor", 40, 110), context("CA", "__proto__", 40, 110),
    { ...context("US", "FL", 40, 110), venueCountryCode: "USA" },
    { ...context("US", "FL", 40, 110), venueCountry: "Canada" }, { venueCountryCode: "US", venueRegion: "FL", lat: 40, lng: 110 },
    { venueCountryCode: "FR", venueCountry: "France", lat: 1, lng: 1 }, context("CA", "ON", null, null),
    context("US", "FL", "", ""), context("US", "FL", NaN, 1), context("US", "FL", 999, 1)]) {
    assert.equal(providerCoordinateContextIssue(row), null, JSON.stringify(row));
  }
});

test("an explicitly supplied candidate is screened while caller identity and raw values remain intact", () => {
  const row = Object.freeze({ ...context("US", "FL", 28, -81), providerVenueId: "CaseSensitiveID" });
  assert.equal(providerCoordinateContextIssue(row), null);
  assert.ok(providerCoordinateContextIssue(row, { lat: "28", lng: "81" }));
  assert.deepEqual([row.lat, row.lng, row.providerVenueId], [28, -81, "CaseSensitiveID"]);
});
