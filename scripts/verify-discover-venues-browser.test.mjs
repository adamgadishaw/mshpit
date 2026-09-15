import assert from "node:assert/strict";
import test from "node:test";
import { assertVenueBasemapCity, discoverVenueFixture, discoverVenueEvents, requestedVenueBasemap, requestedVenueGroupPixel, requestedVenuePixel, venuePinLabelPattern, venuePinMembers } from "./verify-discover-venues-browser.mjs";

test("venue browser fixtures use public source identities across three cities without real accounts", () => {
  assert.equal(discoverVenueFixture("/api/me").user, null);
  assert.deepEqual(discoverVenueFixture("/api/tourdates").tourDates, discoverVenueEvents);
  assert.deepEqual(new Set(discoverVenueEvents.map(row => row.venueCountry)), new Set(["Canada", "Portugal", "United Kingdom"]));
  const london = discoverVenueEvents.filter(row => row.venueCity === "London");
  assert.equal(london.length, 3);
  assert.ok(london.every(row => row.venueCountryCode === "GB" && row.lat > 51 && row.lng < 0));
  assert.ok(discoverVenueEvents.every(row => row.source === "ticketmaster" && row.providerVenueId && row.releaseAt === 0));
  assert.ok(discoverVenueEvents.some(row => row.lat === null && row.lng === null));
  assert.ok(discoverVenueEvents.some(row => row.venue.includes("Écho")));
});

const googleMap = (lat, lng, zoom = 12) => `https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lng}&zoom=${zoom}&size=640x420&scale=2&key=fixture-only`;

test("map fixture validates real outgoing centers rather than accepting any synthetic image", () => {
  for (const [city, lat, lng] of [["Toronto", 43.65, -79.38], ["Lisbon", 38.735, -9.14], ["London", 51.51, -.13]]) {
    const request = requestedVenueBasemap(googleMap(lat, lng));
    assertVenueBasemapCity(request, city);
    assert.deepEqual(request, { provider: "google", lat, lng, zoom: 12, width: 640, height: 420 });
    // Reproduce the shipped bad transform: its pins look local but request an
    // image from a longitude half a world away. The old generic grid hid this.
    const antipode = requestedVenueBasemap(googleMap(lat, ((lng + 360) % 360) - 180));
    assert.throws(() => assertVenueBasemapCity(antipode, city), /not another part of Earth/);
  }
  assert.throws(() => assertVenueBasemapCity(requestedVenueBasemap(googleMap(51.51, -.13, 0)), "London"), /usable city\/street zoom/);
  assert.throws(() => requestedVenueBasemap("https://example.com/map.png"), /Unexpected basemap/);
});

test("independent overlay check uses provider logical pixels and handles the dateline", () => {
  const request = requestedVenueBasemap(googleMap(0, 0, 1));
  assert.deepEqual(requestedVenuePixel(request, { lat: 0, lng: 0 }), { x: 320, y: 210 });
  assert.deepEqual(requestedVenuePixel(request, { lat: 0, lng: 90 }), { x: 448, y: 210 });
  const london = requestedVenueBasemap(googleMap(51.51, -.13));
  const mapbox = requestedVenueBasemap("https://api.mapbox.com/styles/v1/mapbox/dark-v11/static/-0.13,51.51,11,0/640x420@2x?access_token=fixture-only");
  assertVenueBasemapCity(mapbox, "London");
  const venue = { lat: 51.5019, lng: -.018 };
  assert.deepEqual(requestedVenuePixel(mapbox, venue), requestedVenuePixel(london, venue));
  const dateline = requestedVenuePixel(requestedVenueBasemap(googleMap(0, 179, 1)), { lat: 0, lng: -179 });
  assert.ok(dateline.x > 320 && dateline.x < 324);
});

test("cluster browser selectors require complete venue names and preserve punctuation", () => {
  const label = "Map pin 3: Fixture London River Room, The O2 Arena. Tap to cycle venues";
  assert.match(label, venuePinLabelPattern("Fixture London River Room"));
  assert.match(label, venuePinLabelPattern("The O2 Arena"));
  assert.deepEqual(venuePinMembers(label), ["Fixture London River Room", "The O2 Arena"]);
  assert.deepEqual(venuePinMembers("Map pin 1: Room (A+)"), ["Room (A+)"]);
  assert.throws(() => venuePinMembers(null), /identify its venues accessibly/);
  assert.doesNotMatch(label, venuePinLabelPattern("O2 Arena"));
  assert.doesNotMatch(label, venuePinLabelPattern("Fixture London River"));
  assert.match("Map pin 1: Room (A+)", venuePinLabelPattern("Room (A+)"));
  assert.doesNotMatch("Map pin 1: Room AAA", venuePinLabelPattern("Room (A+)"));
});

test("cluster basemap checks use member pixel centroid, not an arbitrary selected venue", () => {
  const request = requestedVenueBasemap(googleMap(0, 0, 1));
  const group = [{ lat: 0, lng: 0 }, { lat: 0, lng: 90 }];
  assert.deepEqual(requestedVenueGroupPixel(request, group), { x: 384, y: 210 });
  assert.deepEqual(requestedVenueGroupPixel(request, [...group].reverse()), { x: 384, y: 210 });
  assert.throws(() => requestedVenueGroupPixel(request, []), /at least one coordinate/);
});

test("venue browser fixture refuses anonymous mutations and unexpected API reads", () => {
  assert.throws(() => discoverVenueFixture("/api/posts", { method: "POST" }), /must not mutate/);
  assert.throws(() => discoverVenueFixture("/api/feed"), /Guests must never/);
  assert.throws(() => discoverVenueFixture("/api/unknown"), /Missing navigation fixture/);
});
