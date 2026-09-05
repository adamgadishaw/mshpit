import assert from "node:assert/strict";
import test from "node:test";

import {
  discoverySidebarRangeRequestPath,
  mergeDiscoverRangePages,
  mergeStartupTourDatePages,
  parseTourDateRangeResponse,
  selectDiscoverRangeEvents,
  tourDateRangeRequestPath,
} from "./discoverEventRange.mjs";

const NOW = Date.UTC(2026, 7, 28, 12);

test("Discover range keeps day 30 and excludes day 31", () => {
  const rows = [
    { id: "day-30", date: "2026-09-27", releaseAt: 0 },
    { id: "day-31", date: "2026-09-28", releaseAt: 0 },
  ];
  assert.deepEqual(selectDiscoverRangeEvents(rows, { days: 30, now: NOW }).map(({ id }) => id), ["day-30"]);
});

test("Discover range extends predictably to 60 and 90 days", () => {
  const rows = [
    { id: "day-60", date: "2026-10-27", releaseAt: 0 },
    { id: "day-61", date: "2026-10-28", releaseAt: 0 },
    { id: "day-90", date: "2026-11-26", releaseAt: 0 },
  ];
  assert.deepEqual(selectDiscoverRangeEvents(rows, { days: 60, now: NOW }).map(({ id }) => id), ["day-60"]);
  assert.deepEqual(selectDiscoverRangeEvents(rows, { days: 90, now: NOW }).map(({ id }) => id), ["day-60", "day-61", "day-90"]);
});

test("Discover range preserves active multi-day events and removes ended events", () => {
  const rows = [
    { id: "ended", date: "2026-08-20", eventEndDate: "2026-08-27", releaseAt: 0 },
    { id: "active", date: "2026-08-20", eventEndDate: "2026-09-02", releaseAt: 0 },
    { id: "future", date: "2026-08-29", releaseAt: 0 },
  ];
  assert.deepEqual(selectDiscoverRangeEvents(rows, { now: NOW }).map(({ id }) => id), ["active", "future"]);
});

test("Discover range parses legacy and paged server responses defensively", () => {
  const first = parseTourDateRangeResponse({
    tourDates: [{ id: "one" }],
    nextCursor: "next cursor",
    range: { through: "2026-11-26" },
  });
  const second = parseTourDateRangeResponse({ items: [{ id: "two" }, { id: "one" }], nextCursor: null });
  assert.deepEqual(first, { tourDates: [{ id: "one" }], nextCursor: "next cursor", through: "2026-11-26" });
  assert.deepEqual(second, { tourDates: [{ id: "two" }, { id: "one" }], nextCursor: null, through: null });
  assert.deepEqual(
    parseTourDateRangeResponse([{ id: "legacy" }]),
    { tourDates: [{ id: "legacy" }], nextCursor: null, through: null },
  );
  assert.equal(parseTourDateRangeResponse({ range: { through: "2026-02-30" } }).through, null);
  assert.equal(parseTourDateRangeResponse({ range: { through: "2026-11-26-extra" } }).through, null);
  assert.deepEqual(mergeDiscoverRangePages(first.tourDates, second.tourDates).map(({ id }) => id), ["one", "two"]);
  const path = tourDateRangeRequestPath({ days: 90, limit: 250, after: "next cursor/+", city: "Toronto", country: "Canada" });
  assert.match(path, /^\/api\/tourdates\?days=90&limit=250&after=next\+cursor%2F%2B&country=CA$/);
  assert.doesNotMatch(path, /[?&]city=/);
  assert.doesNotMatch(tourDateRangeRequestPath({ days: 90, country: "Worldwide" }), /[?&]country=/);
  assert.equal(
    discoverySidebarRangeRequestPath({ days: 90, city: "Toronto", country: "Canada" }),
    "/api/discovery/sidebar?days=90&limit=500",
  );
  assert.deepEqual(
    parseTourDateRangeResponse({ upcomingEvents: [{ id: "nearby" }] }),
    { tourDates: [{ id: "nearby" }], nextCursor: null, through: null },
  );
});

test("startup combines global and home-country pages without duplicate events", () => {
  const global = Array.from({ length: 500 }, (_, index) => ({ id: `global-${index}` }));
  const canada = [
    { id: "global-20" },
    { id: "rbc-pitbull", venue: "RBC Amphitheatre", venueCountryCode: "CA" },
    { id: "rbc-wutang", venue: "RBC Amphitheatre", venueCountryCode: "CA" },
  ];
  const merged = mergeStartupTourDatePages([global, canada]);
  assert.equal(merged.length, 502);
  assert.equal(merged.filter((event) => event.id === "global-20").length, 1);
  assert.deepEqual(merged.slice(-2).map((event) => event.id), ["rbc-pitbull", "rbc-wutang"]);
});

test("Discover range sends supported European country names as ISO filters", () => {
  const europeanCountries = {
    Austria: "AT", Belgium: "BE", Czechia: "CZ", Denmark: "DK", Finland: "FI",
    France: "FR", Germany: "DE", Greece: "GR", Hungary: "HU", Ireland: "IE",
    Italy: "IT", Netherlands: "NL", Norway: "NO", Poland: "PL", Portugal: "PT",
    Romania: "RO", Spain: "ES", Sweden: "SE", Switzerland: "CH", Turkey: "TR",
    "United Kingdom": "GB",
  };
  for (const [country, code] of Object.entries(europeanCountries)) {
    const url = new URL(tourDateRangeRequestPath({ days: 60, country }), "https://pit.test");
    assert.equal(url.searchParams.get("country"), code, `${country} must use its ISO country code`);
    assert.doesNotMatch(url.search, new RegExp(`country=${encodeURIComponent(country)}(?:&|$)`));
  }
});

test("Discover range uses a UTC calendar boundary on every device", () => {
  const lateUtc = Date.UTC(2026, 7, 28, 23, 30);
  const rows = [
    { id: "utc-day-30", date: "2026-09-27", releaseAt: 0 },
    { id: "utc-day-31", date: "2026-09-28", releaseAt: 0 },
  ];
  assert.deepEqual(selectDiscoverRangeEvents(rows, { days: 30, now: lateUtc }).map(({ id }) => id), ["utc-day-30"]);
});

test("Discover range honors a valid server-authoritative through date", () => {
  const rows = [
    { id: "inside-server-range", date: "2026-09-05", releaseAt: 0 },
    { id: "outside-server-range", date: "2026-09-06", releaseAt: 0 },
  ];
  assert.deepEqual(
    selectDiscoverRangeEvents(rows, { days: 90, through: "2026-09-05", now: NOW }).map(({ id }) => id),
    ["inside-server-range"],
  );
});
