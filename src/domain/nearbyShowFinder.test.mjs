import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { nearbyToday, nearbyDateWindow, nearbyShowResults, nearbyDirectionsUrl, nearbyEventImage, nearbyEventDate, nearbyPlaceMatches } from "./nearbyShowFinder.mjs";
const now = Date.parse("2026-10-15T02:00:00Z");
const event = (id, date, extra = {}) => ({
  id,
  date,
  artist: "Band",
  venue: "Real room",
  releaseAt: 0,
  eventTimezone: "America/Toronto",
  ...extra
});
test("Tonight uses each venue's calendar day rather than the browser or UTC date", () => {
  const rows = [event("Toronto", "2026-10-14"), event("Tokyo", "2026-10-15", {
    eventTimezone: "Asia/Tokyo"
  }), event("tomorrow", "2026-10-15")];
  assert.deepEqual(nearbyShowResults(rows, {
    mode: "tonight",
    now
  }).map(e => e.id), ["Toronto", "Tokyo"]);
  assert.equal(nearbyToday(now, "America/Toronto"), "2026-10-14");
  assert.equal(nearbyToday(now, "invalid-zone"), "2026-10-15");
});
test("weekends cross months/years and retain the current Friday-Sunday window", () => {
  assert.deepEqual(nearbyDateWindow("weekend", "", Date.parse("2026-12-31T20:00Z"), "UTC"), {
    from: "2027-01-01",
    to: "2027-01-03"
  });
  for (const date of ["2026-10-16", "2026-10-17", "2026-10-18"]) assert.deepEqual(nearbyDateWindow("weekend", "", Date.parse(date + "T12:00Z"), "UTC"), {
    from: "2026-10-16",
    to: "2026-10-18"
  });
});
test("picked dates include overlapping multi-day events; invalid dates, cancelled, past and unreleased rows fail closed", () => {
  const rows = [event("festival", "2026-10-13", {
    eventEndDate: "2026-10-17"
  }), event("single", "2026-10-16"), event("cancelled", "2026-10-16", {
    eventStatus: "cancelled"
  }), event("hidden", "2026-10-16", {
    releaseAt: now + 1000
  }), event("bad", "2026-02-31"), event("past", "2026-10-01")];
  assert.deepEqual(nearbyShowResults(rows, {
    mode: "date",
    picked: "2026-10-16",
    now
  }).map(e => e.id), ["festival", "single"]);
  assert.deepEqual(nearbyShowResults(rows, {
    mode: "date",
    picked: "2026-02-31",
    now
  }), []);
  assert.deepEqual(nearbyShowResults([rows[1], rows[1]], {
    now
  }).map(e => e.id), ["single"]);
});
test("date boundaries remain correct across DST and missing zones use UTC", () => {
  assert.equal(nearbyToday(Date.parse("2026-11-01T04:30Z"), "America/Toronto"), "2026-11-01");
  assert.equal(nearbyToday(Date.parse("2026-11-01T07:30Z"), "America/Toronto"), "2026-11-01");
  assert.equal(nearbyShowResults([event("unknown", "2026-10-15", {
    eventTimezone: null
  })], {
    mode: "tonight",
    now
  }).length, 1);
});
test("directions contain only the venue destination, never the selected/user location", () => {
  const url = new URL(nearbyDirectionsUrl({
    venue: "Room",
    coord: {
      lat: 43.65,
      lng: -79.4
    },
    home: {
      lat: 1,
      lng: 2
    }
  }));
  assert.deepEqual([...url.searchParams.keys()], ["api", "destination"]);
  assert.equal(url.searchParams.get("destination"), "43.65,-79.4");
  const fallback = new URL(nearbyDirectionsUrl({
    name: "Room",
    place: "Toronto",
    coord: {
      lat: null,
      lng: null
    }
  }));
  assert.equal(fallback.searchParams.get("destination"), "Room, Toronto");
  assert.equal(nearbyDirectionsUrl({}), null);
});
test("manual city-only results distinguish same-name cities and never fabricate coordinates", () => {
  const center = {
    city: "London",
    state: "Ontario",
    country: "Canada"
  };
  assert.equal(nearbyPlaceMatches({
    place: "London, Ontario, Canada"
  }, center), true);
  assert.equal(nearbyPlaceMatches({
    place: "London, England, United Kingdom"
  }, center), false);
  assert.equal(nearbyPlaceMatches({
    place: "Toronto, Ontario, Canada"
  }, center), false);
});
test("images come only from a genuine HTTPS event image; date labels do not shift stored calendar days", () => {
  assert.equal(nearbyEventImage({
    eventImage: "https://images.example/event.jpg"
  }), "https://images.example/event.jpg");
  for (const eventImage of [null, "javascript:alert(1)", "https://user:secret@example.com/image", "not-a-url"]) assert.equal(nearbyEventImage({
    eventImage
  }), null);
  assert.match(nearbyEventDate(event("x", "2026-10-14", {
    startLocalTime: "19:30:00"
  })), /Wed.*Oct 14.*2026.*7:30 PM/);
});
test("Nearby never imports a map and routes events through the existing event callback", () => {
  const screen = readFileSync(new URL("../screens/NearbyScreen.jsx", import.meta.url), "utf8"),
    app = readFileSync(new URL("../../App.js", import.meta.url), "utf8");
  assert.doesNotMatch(screen, /ConcertMap|LiveMap|NearbyVenueMap|mapConfig|geolocation/);
  assert.match(app, /<NearbyScreen[^>]*onOpenEvent=\{openShow\}/);
});

 test('Directions prefer the explicit provider venue coordinates over a same-name catalog fallback', () => { const url = new URL(nearbyDirectionsUrl({ venue: 'Same name', lat: 51.5, lng: -0.1, coord: { lat: 43.65, lng: -79.4 } })); assert.equal(url.searchParams.get('destination'), '51.5,-0.1'); });

test('manual center rejects ambiguous city names and never averages borrowed venue points', async () => {
  const { nearbyManualCenter } = await import('./nearbyShowFinder.mjs');
  const geo = { America: { Canada: { Ontario: ['Toronto', 'London'] }, USA: { Ohio: ['London'] } } };
  const coordinates = { Toronto: { lat: 43.6532, lng: -79.3832 }, London: { lat: 39.8, lng: -83.4 } };
  assert.deepEqual(nearbyManualCenter({ city: 'Toronto', state: 'Ontario', country: 'Canada' }, geo, coordinates), { city: 'Toronto', state: 'Ontario', country: 'Canada', lat: 43.6532, lng: -79.3832 });
  assert.equal(nearbyManualCenter({ city: 'London', state: 'Ontario', country: 'Canada' }, geo, coordinates).lat, null);
  assert.equal(nearbyManualCenter({ city: 'Toronto', state: 'Ohio', country: 'USA' }, geo, coordinates).lat, null);
  assert.equal(nearbyManualCenter({ city: 'Unknown', state: 'Ontario', country: 'Canada' }, geo, coordinates).lat, null);
});
