import test from "node:test";
import assert from "node:assert/strict";
import { loadVenueMapEvents, venueMapFeedResultState } from "./venueMapCatalogue.web.mjs";

const response = payload => ({ ok: true, status: 200, json: async () => payload });
const row = id => ({ id: String(id), venue: `Room ${id}`, source: "fixture", date: "2026-11-03" });

test("sequential public paging loads more than 5000 events completely without arbitrary caps", async () => {
  const fixtures = Array.from({ length: 12 }, (_, page) => ({ tourDates: Array.from({ length: 500 }, (_, i) => row(page * 500 + i)), nextCursor: page < 11 ? `cursor_${page + 1}` : null }));
  let active = 0, maximumActive = 0, calls = 0;
  const pageCounts = [];
  const result = await loadVenueMapEvents({ compact: false, request: async (url, options) => {
    maximumActive = Math.max(maximumActive, ++active);
    assert.equal(options.credentials, "omit"); assert.equal(options.method, "GET"); assert.equal(options.redirect, "error");
    const params = new URL(url, "http://localhost").searchParams;
    assert.equal(params.get("scope"), "all-upcoming"); assert.equal(params.get("limit"), "500");
    assert.equal(params.get("after"), calls === 0 ? null : `cursor_${calls}`);
    await Promise.resolve(); active -= 1;
    return response(fixtures[calls++]);
  }, onPage: page => pageCounts.push(page.loaded) });
  assert.equal(result.tourDates.length, 6000); assert.equal(result.pages, 12); assert.equal(result.complete, true);
  assert.equal(calls, 12); assert.equal(maximumActive, 1); assert.equal(pageCounts.at(-1), 6000);
});

test("late HTTP failure retains valid deduplicated earlier rows and progress", async () => {
  let calls = 0;
  await assert.rejects(loadVenueMapEvents({ compact: false, request: async () => ++calls === 1
    ? response({ tourDates: [row("a"), row("a"), row("b")], nextCursor: "next" })
    : { ok: false, status: 503 } }), error => error.code === "VENUE_MAP_HTTP" && error.pages === 1 && error.partialRows.map(row => row.id).join() === "a,b");
  assert.equal(calls, 2);
});

test("repeated cursors and pages without new IDs fail explicitly without an infinite crawl", async () => {
  let calls = 0;
  await assert.rejects(loadVenueMapEvents({ compact: false, request: async () => response({ tourDates: [row(++calls)], nextCursor: "same" }) }), error => error.code === "VENUE_MAP_CURSOR" && error.partialRows.length === 2);
  assert.equal(calls, 2);
  calls = 0;
  await assert.rejects(loadVenueMapEvents({ compact: false, request: async () => response({ tourDates: [row("same")], nextCursor: `cursor_${++calls}` }) }), error => error.code === "VENUE_MAP_NO_PROGRESS" && error.partialRows.length === 1);
  assert.equal(calls, 2);
});

test("schema failure retains previous rows while resolved empty completion is valid", async () => {
  let calls = 0;
  await assert.rejects(loadVenueMapEvents({ compact: false, request: async () => response(++calls === 1 ? { tourDates: [row("a")], nextCursor: "next" } : { tourDates: [] }) }), error => error.code === "VENUE_MAP_SCHEMA" && error.partialRows.length === 1);
  const empty = await loadVenueMapEvents({ compact: false, request: async () => response({ tourDates: [], nextCursor: null }) });
  assert.equal(empty.tourDates.length, 0); assert.equal(empty.complete, true);
});

test("abort during an ignored late response publishes no rows and starts no next request", async () => {
  const controller = new AbortController();
  let resolveRequest, calls = 0, progress = 0;
  const loading = loadVenueMapEvents({ signal: controller.signal, request: () => { calls += 1; return new Promise(resolve => { resolveRequest = resolve; }); }, onPage: () => { progress += 1; } });
  controller.abort();
  await assert.rejects(loading, error => error.name === "AbortError" && error.partialRows.length === 0);
  resolveRequest(response({ tourDates: [row("late")], nextCursor: "next" }));
  await Promise.resolve(); await Promise.resolve();
  assert.equal(calls, 1); assert.equal(progress, 0);
});

test("per-page deadline ends a stalled request while preserving earlier pages", async () => {
  let calls = 0;
  await assert.rejects(loadVenueMapEvents({ compact: false, timeoutMs: 10, request: async () => ++calls === 1
    ? response({ tourDates: [row("a")], nextCursor: "next" }) : new Promise(() => {}) }), error => error.name === "TimeoutError" && error.code === "VENUE_MAP_TIMEOUT" && error.partialRows.length === 1);
  assert.equal(calls, 2);
});

test("default UI accepts one compact complete response with source retrieval time", async () => {
  let calls = 0, progress;
  const fetchedAt = "2026-10-21T12:00:00Z";
  const result = await loadVenueMapEvents({ request: async (url, options) => {
    calls += 1; assert.equal(new URL(url, "http://localhost").searchParams.get("view"), "venue-map"); assert.equal(options.credentials, "omit");
    return response({ tourDates: [row("one")], venueMapCatalogue: true, complete: true, eventCount: 10000, venueCount: 1, pages: 20, fetchedAt });
  }, onPage: page => { progress = page; } });
  assert.equal(calls, 1); assert.equal(result.tourDates.length, 1); assert.equal(result.compact, true); assert.equal(result.eventCount, 10000);
  assert.equal(result.fetchedAt, fetchedAt); assert.equal(progress.loaded, 10000);
});

test("default UI never falls back to the full raw event transfer", async () => {
  for (const rejected of [{ ok: false, status: 400 }, { ok: false, status: 404 }, response({ tourDates: [row("raw")], nextCursor: "next" })]) {
    let calls = 0;
    await assert.rejects(loadVenueMapEvents({ request: async () => { calls += 1; return rejected; } }), error => error.code === "VENUE_MAP_COMPACT_UNAVAILABLE" && error.partialRows.length === 0);
    assert.equal(calls, 1);
  }
});

test("compact schema requires its retrieval timestamp and a complete marked response", async () => {
  await assert.rejects(loadVenueMapEvents({ request: async () => response({ tourDates: [], venueMapCatalogue: true, complete: true, eventCount: 0, venueCount: 0, pages: 1 }) }), error => error.code === "VENUE_MAP_SCHEMA");
});

test("opt-in raw scan can cross an empty filtered page whose cursor advances", async () => {
  let calls = 0;
  const result = await loadVenueMapEvents({ compact: false, request: async () => response(++calls === 1 ? { tourDates: [], nextCursor: "filtered_window" } : { tourDates: [row("a")], nextCursor: null }) });
  assert.equal(result.pages, 2); assert.equal(result.tourDates.length, 1);
});

test("compact witnesses retain contradictory coordinates even for a repeated event id", async () => {
  const result = await loadVenueMapEvents({ request: async () => response({ tourDates: [row("same"), { ...row("same"), lat: 44 }], venueMapCatalogue: true, complete: true, eventCount: 2, venueCount: 1, pages: 1, fetchedAt: "2026-10-21T12:00:00Z" }) });
  assert.equal(result.tourDates.length, 2);
});

test("already aborted requests perform no network read", async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(loadVenueMapEvents({ signal: controller.signal, request: () => { assert.fail("request must not run"); } }), error => error.name === "AbortError" && error.pages === 0);
});

const compactResponse = extra => ({ tourDates: [row("old")], venueMapCatalogue: true, complete: true, eventCount: 1, venueCount: 1, pages: 1, fetchedAt: "2026-10-21T12:00:00Z", ...extra });
const localLocation = { hostname: "127.0.0.1", protocol: "http:" };

test("manual refresh query is restricted to loopback previews", async () => {
  for (const [previewLocation, expected] of [[localLocation, "1"], [{ hostname: "localhost", protocol: "http:" }, "1"], [{ hostname: "www.mshpit.com", protocol: "https:" }, null], [undefined, null]]) {
    await loadVenueMapEvents({ refresh: true, previewLocation, request: async url => {
      assert.equal(new URL(url, "http://localhost").searchParams.get("refresh"), expected); return response(compactResponse());
    } });
  }
});

test("only a loopback response with the opt-in header extends its bounded body deadline", async () => {
  for (const [previewLocation, header, succeeds] of [[localLocation, "1", true], [localLocation, null, false], [{ hostname: "www.mshpit.com", protocol: "https:" }, "1", false]]) {
    let refreshing = 0;
    const loading = loadVenueMapEvents({ previewLocation, timeoutMs: 5, localRefreshTimeoutMs: 60,
      onRefresh: () => { refreshing += 1; }, request: async () => ({ ok: true, status: 200, headers: { get: () => header },
        json: () => new Promise(resolve => setTimeout(() => resolve(compactResponse()), 20)) }) });
    if (succeeds) { assert.equal((await loading).complete, true); assert.equal(refreshing, 1); }
    else { await assert.rejects(loading, error => error.code === "VENUE_MAP_TIMEOUT"); assert.equal(refreshing, 0); }
  }
});

test("local extended wait still times out and aborts its response", async () => {
  let upstream;
  await assert.rejects(loadVenueMapEvents({ previewLocation: localLocation, timeoutMs: 5, localRefreshTimeoutMs: 10,
    request: async (url, options) => { upstream = options.signal; return { ok: true, headers: { get: () => "1" }, json: () => new Promise(() => {}) }; } }), error => error.code === "VENUE_MAP_TIMEOUT");
  assert.equal(upstream.aborted, true);
});

test("failed refresh response retains source clock and exposes failure metadata", async () => {
  const result = await loadVenueMapEvents({ request: async () => response(compactResponse({ localRefresh: true, refreshFailed: true, refreshed: false })) });
  assert.equal(result.refreshFailed, true); assert.equal(result.refreshed, false); assert.equal(result.fetchedAt, "2026-10-21T12:00:00Z");
});

test("stale feed excludes provider coordinates and a real complete refresh recovers them", () => {
  const now = Date.parse("2026-10-21T13:00:00Z");
  const stale = venueMapFeedResultState(compactResponse(), {}, now);
  assert.equal(stale.feedStatus, "stale"); assert.equal(stale.providerFetchedAt, null); assert.equal(stale.remoteEvents.length, 1);
  const fresh = venueMapFeedResultState(compactResponse({ fetchedAt: "2026-10-21T12:59:59Z", tourDates: [row("new")] }), stale, now);
  assert.equal(fresh.feedStatus, "ready"); assert.equal(fresh.providerFetchedAt, "2026-10-21T12:59:59Z"); assert.equal(fresh.remoteEvents[0].id, "new");
});

test("failed refresh keeps existing cards and notice without renewing their freshness", () => {
  const now = Date.parse("2026-10-21T13:00:00Z");
  const previous = { remoteEvents: [row("existing")], providerFetchedAt: null };
  const failed = venueMapFeedResultState(compactResponse({ refreshFailed: true, fetchedAt: "2026-10-21T12:59:59Z" }), previous, now);
  assert.equal(failed.feedStatus, "error"); assert.equal(failed.providerFetchedAt, null); assert.equal(failed.remoteEvents, previous.remoteEvents);
  const reloadFailure = venueMapFeedResultState(compactResponse({ refreshFailed: true }), {}, now);
  assert.equal(reloadFailure.feedStatus, "error"); assert.equal(reloadFailure.providerFetchedAt, null); assert.equal(reloadFailure.remoteEvents.length, 1);
});
