import test from "node:test";
import assert from "node:assert/strict";
import { compactVenueMapEvents, readCompactVenueMapCatalogue, venueMapPreviewEnabled } from "./venueMapCatalogueProjection.mjs";
const at = Date.parse("2026-10-21T12:00:00Z");
const event = (id, extra = {}) => ({ id: `tm_${id}`, providerEventId: String(id), source: "ticketmaster", providerVenueId: "room", createdBy: "import", providerActive: true,
  venue: "Fixture Room", venueCity: "Toronto", venueRegion: "Ontario", venueCountry: "Canada", venueCountryCode: "CA", place: "Toronto, Ontario, Canada", lat: 43.65, lng: -79.38,
  artist: "Fixture artist", eventName: "Fixture show", date: "2026-11-03", releaseAt: 0, ...extra });

test("preview projection is off unless both exact development gates are set", () => {
  assert.equal(venueMapPreviewEnabled({ NODE_ENV: "development", MSHPIT_WEB_MAPLIBRE_PREVIEW: "1" }), true);
  for (const env of [{}, { NODE_ENV: "production", MSHPIT_WEB_MAPLIBRE_PREVIEW: "1" }, { NODE_ENV: "test", MSHPIT_WEB_MAPLIBRE_PREVIEW: "1" }, { NODE_ENV: "development" }, { NODE_ENV: "development", MSHPIT_WEB_MAPLIBRE_PREVIEW: "true" }]) assert.equal(venueMapPreviewEnabled(env), false);
});

test("one earliest show per coordinate witness replaces repeated full event metadata", () => {
  const original = [event("later", { date: "2026-12-01", images: ["large-image"], biography: "unused", email: "private-must-not-project" }), event("earlier")];
  const result = compactVenueMapEvents(original, { fetchedAt: at, pages: 3 });
  assert.equal(result.tourDates.length, 1); assert.equal(result.tourDates[0].id, "tm_earlier");
  assert.equal(result.tourDates[0].venueUpcomingCount, 2); assert.equal(result.eventCount, 2); assert.equal(result.venueCount, 1);
  assert.equal(result.tourDates[0].images, undefined); assert.equal(result.tourDates[0].biography, undefined); assert.equal(result.tourDates[0].email, undefined);
  assert.equal(result.complete, true); assert.equal(result.fetchedAt, new Date(at).toISOString()); assert.equal(original[0].images.length, 1);
});

test("conflicting, invalid and Google-derived coordinate/locality witnesses all survive compaction", () => {
  const result = compactVenueMapEvents([event("a"), event("b", { lat: 43.7 }), event("c", { venueCity: "Paris", place: "Paris, France", venueCountry: "France", venueCountryCode: "FR" }),
    event("d", { lat: null, lng: null }), event("e", { coordinateProvenance: { source: "Google", sourceUrl: "https://maps.googleapis.com/", unused: "discard" } }),
    event("f", { createdBy: "member" }), event("g", { providerEventId: null })], { fetchedAt: at });
  assert.equal(result.venueCount, 1); assert.equal(result.tourDates.length, 7);
  assert.equal(result.tourDates.find(row => row.id === "tm_e").coordinateProvenance.source, "Google");
  assert.equal(result.tourDates.find(row => row.id === "tm_e").coordinateProvenance.unused, undefined);
});

test("distinct provider rooms and qualified same-named cities stay distinct beyond any previous cap", () => {
  const rows = Array.from({ length: 8001 }, (_, i) => event(i, { providerVenueId: `room-${i}` }));
  const result = compactVenueMapEvents(rows, { fetchedAt: at, pages: 17 });
  assert.equal(result.venueCount, 8001); assert.equal(result.tourDates.length, 8001); assert.equal(result.eventCount, 8001);
  const names = compactVenueMapEvents([event("a", { source: "member", providerVenueId: null }), event("b", { source: "member", providerVenueId: null, place: "Paris, France", venueCity: "Paris", venueCountry: "France", venueCountryCode: "FR" })], { fetchedAt: at });
  assert.equal(names.venueCount, 2);
});

test("missing qualified locality does not silently merge unrelated name-only rooms", () => {
  const rows = ["a", "b"].map(id => event(id, { source: "member", providerVenueId: null, place: "", venueCity: null, venueCountry: null, venueCountryCode: null }));
  assert.equal(compactVenueMapEvents(rows, { fetchedAt: at }).venueCount, 2);
});

test("server public page reader scans beyond 5000 and retains conflicting witnesses", () => {
  const rows = Array.from({ length: 6001 }, (_, i) => event(i, { providerVenueId: `room-${i}` }));
  rows.push(event("conflict", { providerVenueId: "room-0", lat: 43.7 }));
  let calls = 0;
  const result = readCompactVenueMapCatalogue({ fetchedAt: at, readPage: ({ after }) => {
    const start = after === null ? 0 : Number(after);
    const page = rows.slice(start, start + 500); calls += 1;
    return { rows: page, nextCursor: start + page.length < rows.length ? String(start + page.length) : null };
  } });
  assert.equal(calls, 13); assert.equal(result.pages, 13); assert.equal(result.eventCount, 6002); assert.equal(result.venueCount, 6001);
  assert.equal(result.tourDates.filter(row => row.providerVenueId === "room-0").length, 2);
});

test("server public page reader rejects repeated cursors and stalled duplicate pages", () => {
  let calls = 0;
  assert.throws(() => readCompactVenueMapCatalogue({ readPage: () => ({ rows: [event(++calls)], nextCursor: "repeat" }) }), /repeated a cursor/);
  assert.equal(calls, 2);
  calls = 0;
  assert.throws(() => readCompactVenueMapCatalogue({ readPage: () => ({ rows: [event("same")], nextCursor: String(++calls) }) }), /made no progress/);
  assert.equal(calls, 2);
});

test("server scan continues through an advancing empty filtered page but rejects changing duplicate witnesses", () => {
  let calls = 0;
  const result = readCompactVenueMapCatalogue({ fetchedAt: at, readPage: () => ++calls === 1 ? { rows: [], nextCursor: "filtered_window" } : { rows: [event("a")], nextCursor: null } });
  assert.equal(result.eventCount, 1); assert.equal(result.pages, 2);
  calls = 0;
  assert.throws(() => readCompactVenueMapCatalogue({ readPage: () => ({ rows: [event("same", { lat: ++calls === 1 ? 43 : 44 })], nextCursor: String(calls) }) }), /changed an event coordinate witness/);
});

test("compact provider venue grouping preserves opaque id case", () => {
  const result = compactVenueMapEvents([event("berry", { providerVenueId: "KovZ917A-EJ", venue: "Berry Room", place: "Berry, New South Wales, Australia" }),
    event("stadium", { providerVenueId: "KovZ917A-Ej", venue: "Queensland Stadium", place: "Brisbane, Queensland, Australia" })], { fetchedAt: at });
  assert.equal(result.venueCount, 2); assert.equal(result.tourDates.length, 2);
  assert.deepEqual(result.tourDates.map(row => row.providerVenueId), ["KovZ917A-EJ", "KovZ917A-Ej"]);
});
