import assert from "node:assert/strict";
import test from "node:test";
import { independentMapPoint, independentMapPoints, independentProviderCoordinateIssue } from "./independentMapCoordinates.mjs";
import { independentMapVenueRegistry } from "./independentMapVenueRegistry.mjs";

const toronto = "Toronto, Ontario, Canada";
const massey = (extra = {}) => ({ id: "original-room-id", name: "Massey Hall", place: toronto, ...extra });

test("the original four independently checked rooms retain authoritative coordinate overrides", () => {
  const expected = [
    ["Massey Hall", 43.65396694444444, -79.37898194444443],
    ["Horseshoe Tavern", 43.64943, -79.39592],
    ["Roy Thomson Hall", 43.646615, -79.386443],
    ["Danforth Music Hall", 43.67630555555555, -79.357],
  ];
  for (const [name, lat, lng] of expected) {
    const original = Object.freeze({ id: `stored:${name}`, name, place: toronto,
      lat: 1, lng: 2, coord: Object.freeze({ lat: 1, lng: 2 }), source: "ticketmaster", providerVenueId: "original-provider-id" });
    const point = independentMapPoint(original);
    assert.equal(point.id, original.id);
    assert.equal(point.providerVenueId, original.providerVenueId);
    assert.equal(point.source, "ticketmaster");
    assert.deepEqual(point.coord, { lat, lng });
    assert.equal(point.lat, lat);
    assert.equal(point.lng, lng);
    assert.equal(point.locationPrecision, "venue");
    assert.equal(point.coordinateProvenance.checkedAt, "2026-10-21");
    assert.notEqual(point.coordinateProvenance.source, "ticketmaster");
    assert.deepEqual(original.coord, { lat: 1, lng: 2 });
  }
  assert.equal(independentMapVenueRegistry.length, 8);
});

test("four qualified US identities use published Wikidata points without inventing legacy coordinates", () => {
  const expected = [
    ["Orpheum Theatre", "Los Angeles, California, United States", "Q2491086", 34.04277777777778, -118.25527777777778, 1],
    ["The Wiltern", "Los Angeles, California, United States", "Q7161584", 34.06111111111111, -118.30805555555555, 1],
    ["Webster Hall", "New York, New York, United States", "Q7978928", 40.73169444444444, -73.98919444444445, 0.1],
    ["The Roxy Theatre", "West Hollywood, California, United States", "Q1565972", 34.090805555555555, -118.388, 0.1],
  ];
  for (const [name, place, sourceId, lat, lng, resolution] of expected) {
    const row = Object.freeze({ id: `original:${name}`, name, place, lat: null, lng: null });
    const point = independentMapPoint(row);
    assert.ok(point, name);
    assert.equal(point.id, row.id);
    assert.deepEqual(point.coord, { lat, lng });
    assert.equal(point.coordinateProvenance.sourceId, sourceId);
    assert.equal(point.coordinateProvenance.coordinateClaim, "P625");
    assert.equal(point.coordinateProvenance.publishedResolutionArcseconds, resolution);
    assert.match(point.coordinateProvenance.coordinateReference, /P143.*Q328/u);
    assert.match(point.coordinateProvenance.sourceUrl, /oldid=\d+/u);
    assert.equal(row.lat, null);
  }
  assert.ok(independentMapPoint({ name: "The Wiltern", place: "Los Angeles, CA, USA" }));
  assert.ok(independentMapPoint({ name: "Webster Hall", venueCity: "New York", venueRegion: "NY", venueCountryCode: "US" }));
  for (const row of [
    { name: "Orpheum Theatre", place: "Vancouver, British Columbia, Canada" },
    { name: "Orpheum Theatre", place: "Los Angeles, California, Canada" },
    { name: "The Roxy Theatre", place: "Los Angeles, California, United States" },
    { name: "Roxy Theatre-CA", place: "West Hollywood, California, United States" },
    { name: "The Wiltern", place: "Los Angeles, California, United States", venueCountryCode: "CA" },
    { name: "The Wiltern", place: "Los Angeles, California, United States", wikidataId: "Q1565972" },
    { name: "The Wiltern", place: "Los Angeles, California, United States", musicbrainzPlaceId: "unreviewed" },
  ]) assert.equal(independentMapPoint(row), null, JSON.stringify(row));
});

test("the reviewed Roxy provider point issue matches only its source, case-sensitive ID and exact point", () => {
  const row = { source: "ticketmaster", providerVenueId: "ZFr9jZeA6a", lat: 34.0942, lng: -118.3815 };
  const issue = independentProviderCoordinateIssue(row);
  assert.equal(issue.reason, "conflicts-with-reviewed-venue-location");
  assert.equal(issue.distanceApproxMeters, 708);
  assert.match(issue.reviewedCoordinateSourceUrl, /Q1565972/u);
  assert.equal(issue.identitySourceUrl, "https://www.theroxy.com/venue-info/");
  assert.ok(Object.isFrozen(issue));
  assert.ok(independentProviderCoordinateIssue({ ...row, lat: "34.0942", lng: "-118.3815" }));
  for (const extra of [
    { lat: 34.090805555555555, lng: -118.388 }, { source: "bandsintown" },
    { providerVenueId: "zfr9jzea6a" }, { providerVenueId: "another" },
    { venue_provider_id: "contradictory" }, { lat: null },
  ]) assert.equal(independentProviderCoordinateIssue({ ...row, ...extra }), null);
  for (const invalid of [null, undefined, [], "venue"]) assert.equal(independentProviderCoordinateIssue(invalid), null);
});

test("normalization accepts qualified Toronto aliases without fuzzy venue matching", () => {
  for (const row of [
    massey({ name: " MASSEY   HALL ", place: " TORONTO , ON , CA " }),
    { id: "structured", venue: "The Danforth Music Hall", venueCity: "Toronto", venueRegion: "ON", venueCountryCode: "CA" },
    { name: "The Horseshoe Tavern", city: "Toronto", region: "Ontario", country: "Canada" },
  ]) assert.ok(independentMapPoint(row));
  for (const name of ["Massey", "Roy Thompson Hall", "Massey Hall Annex", "Unknown Toronto Venue"]) {
    assert.equal(independentMapPoint(massey({ name })), null);
  }
});

test("same names in other cities and incomplete or contradictory locality stay unmapped", () => {
  for (const extra of [
    { place: "Toronto" }, { place: "Toronto, Canada" }, { place: "Toronto, Ontario" },
    { place: "Toronto, Kansas, United States" }, { place: "Guelph, Ontario, Canada" },
    { place: "Toronto, Ontario, Canada, M5B 1T6" }, { place: "Toronto, Ontario, CA", country: "US" },
    { venueCity: "Guelph" }, { venueCountryCode: "CA", venueCountry: "United States" },
    { place: null, city: "Toronto" }, { place: null, city: "Toronto", country: "Canada" },
  ]) assert.equal(independentMapPoint(massey(extra)), null, JSON.stringify(extra));
});

test("known source IDs must agree with the qualified room and retain the original stable ID", () => {
  const sourceUrl = "https://www.wikidata.org/wiki/Q1122776#P625";
  assert.ok(independentMapPoint(massey({ source: "Wikidata", sourceId: "Q1122776", sourceUrl })));
  assert.ok(independentMapPoint(massey({ musicbrainzPlaceId: "7fb2039c-5c15-47b8-a4b2-915bc1034eca" })));
  assert.equal(independentMapPoint(massey({ id: "wikidata:Q1122776" })).id, "wikidata:Q1122776");
  for (const extra of [
    { source: "Wikidata", sourceId: "Q5906075" }, { wikidataId: "Q5906075" },
    { musicbrainzPlaceId: "unknown" }, { id: "wikidata:Q7752734" },
    { id: "WikiData:Q7752734" },
    { source: "MusicBrainz", providerVenueId: "unknown" },
    { source: "Wikidata", sourceId: "Q1122776", providerVenueId: "Q5906075" },
    { source: "Wikidata", sourceId: "Q1122776", venue_provider_id: "Q5906075" },
    { coordinateProvenance: { source: "Wikidata", sourceId: "Q5906075" } },
    { coordinateProvenance: { source: "Wikidata", sourceId: "Q1122776", providerVenueId: "Q5906075" } },
  ]) assert.equal(independentMapPoint(massey(extra)), null);
});

test("spoofed official-source claims and URLs cannot admit an unknown room or another record", () => {
  const claim = { source: "Wikidata", sourceId: "Q1122776", sourceUrl: "https://www.wikidata.org/wiki/Q1122776", checkedAt: "2026-10-21" };
  assert.equal(independentMapPoint({ ...massey(claim), name: "Unverified Venue", lat: 43.65, lng: -79.38 }), null);
  assert.equal(independentMapPoint({ ...massey(claim), place: "Toronto" }), null);
  assert.equal(independentMapPoint({ name: "Unverified Venue", place: toronto, source: "MusicBrainz", lat: 43.65, lng: -79.38 }), null);
  for (const sourceUrl of [
    "https://www.wikidata.org.evil.example/wiki/Q1122776", "https://evil.example/wiki/Q1122776",
    "https://www.wikidata.org@evil.example/wiki/Q1122776", "http://www.wikidata.org/wiki/Q1122776",
    "https://www.wikidata.org:444/wiki/Q1122776", "https://www.wikidata.org/wiki/Q5906075",
    "https://www.wikidata.org/w/index.php?title=Q5906075&oldid=1", "not-a-url",
    "https://www.wikidata.org/w/index.php?title=Q1122776&title=Q5906075",
    "https://www.wikidata.org/w/index.php?title=Q1122776&oldid=1&oldid=2",
  ]) assert.equal(independentMapPoint(massey({ ...claim, sourceUrl })), null, sourceUrl);
});

test("explicit Google coordinate evidence remains unmapped even for a registered venue", () => {
  for (const extra of [
    { source: "Google" }, { source: "google_places" }, { coordinateSource: "google-geocoding" },
    { coordinateProvenance: { source: "Google Maps" } }, { coord: { lat: 43.65, lng: -79.38, source: "Google" } },
    { sourceUrl: "https://maps.googleapis.com/maps/api/geocode/json" },
    { coordinateProvenance: { sourceUrl: "https://maps.google.ca/maps" } },
  ]) assert.equal(independentMapPoint(massey(extra)), null);
});

test("city precision is excluded by default and remains explicitly marked when opted in", () => {
  const city = massey({ locationPrecision: "city", lat: 43.7, lng: -79.4 });
  assert.equal(independentMapPoint(city), null);
  const point = independentMapPoint(city, { allowCityPrecision: true });
  assert.equal(point.locationPrecision, "city");
  assert.equal(point.coordinateProvenance.locationPrecision, "city");
  assert.equal(independentMapPoint(massey({ locationPrecision: "venue", coordinatePrecision: "city" })), null);
  assert.equal(independentMapPoint(massey({ coord: { locationPrecision: "city" } })), null);
  assert.equal(independentMapPoint(massey({ coord: { coordinatePrecision: "city" } })), null);
  assert.equal(independentMapPoint(massey({ coordinateProvenance: { coordinatePrecision: "city" } })), null);
  for (const locationPrecision of ["unknown", "country", "", false]) {
    assert.equal(independentMapPoint(massey({ locationPrecision }), { allowCityPrecision: true }), null);
  }
});

test("missing, invalid and null-island legacy coordinates never create eligibility", () => {
  for (const coord of [null, {}, { lat: null, lng: null }, { lat: "", lng: false },
    { lat: 0, lng: 0 }, { lat: NaN, lng: Infinity }, { lat: 91, lng: 181 }]) {
    assert.equal(independentMapPoint({ name: "Unverified Venue", place: toronto, coord }), null);
    // Verified identity uses the checked point, never the invalid legacy value.
    const point = independentMapPoint(massey({ coord }));
    assert.equal(point.lat, 43.65396694444444);
    assert.equal(point.lng, -79.37898194444443);
  }
  for (const row of [null, undefined, [], false, "venue"]) assert.equal(independentMapPoint(row), null);
});

test("provenance keeps checked date, exact source URL, coordinate encoding and source precision", () => {
  for (const venue of independentMapVenueRegistry) {
    const point = independentMapPoint({ id: "original", name: venue.name, place: venue.place,
      coordinateProvenance: { checkedAt: "2099-01-01" } });
    assert.equal(point.coordinateProvenance.sourceUrl, venue.sourceUrl);
    assert.equal(point.coordinateProvenance.sourceId, venue.sourceId);
    assert.equal(point.coordinateProvenance.checkedAt, "2026-10-21");
    assert.equal(point.coordinateProvenance.coordinateEncoding, venue.coordinateEncoding);
    if (venue.publishedCoordinate) assert.equal(point.coordinateProvenance.publishedCoordinate, venue.publishedCoordinate);
    assert.ok(Object.isFrozen(point.coord));
    assert.ok(Object.isFrozen(point.coordinateProvenance));
    assert.ok(Object.isFrozen(venue));
  }
});

test("bulk mapping preserves listable input rows and maps no unverified coordinates", () => {
  const rows = Object.freeze([Object.freeze(massey()), Object.freeze({ id: "unknown", name: "Unverified Venue", place: toronto, lat: 43.7, lng: -79.4 })]);
  assert.deepEqual(independentMapPoints(rows).map((point) => point.id), ["original-room-id"]);
  assert.equal(rows.length, 2);
  assert.equal(rows[1].id, "unknown");
  assert.deepEqual(independentMapPoints(null), []);
});
