import test from "node:test";
import assert from "node:assert/strict";
import { createVenueMapPreviewRefresh, venueMapLiveRefreshEnabled, PUBLIC_CATALOGUE_ORIGIN } from "./venueMapPreviewRefresh.mjs";

const at = Date.parse("2026-10-21T18:00:00Z");
const row = id => ({ id, venue: `Room ${id}`, source: "fixture", place: "Toronto, Ontario, Canada", date: "2026-11-01" });
const snapshot = (capturedAt = new Date(at - 3600001).toISOString()) => ({ tourDates: [row("old")], complete: true, pages: 1, capturedAt });
const response = payload => ({ ok: true, status: 200, json: async () => payload });
const page = (id = "new", nextCursor = null) => response({ tourDates: [row(id)], nextCursor });

test("public refresh requires all exact development and opt-in preview flags", () => {
  const env = { NODE_ENV: "development", MSHPIT_WEB_MAPLIBRE_PREVIEW: "1", MSHPIT_MAPLIBRE_CATALOGUE_PREVIEW: "1", MSHPIT_MAPLIBRE_LIVE_REFRESH: "1" };
  assert.equal(venueMapLiveRefreshEnabled(env), true);
  for (const key of Object.keys(env)) assert.equal(venueMapLiveRefreshEnabled({ ...env, [key]: undefined }), false);
  for (const NODE_ENV of ["production", "test", "development "]) assert.equal(venueMapLiveRefreshEnabled({ ...env, NODE_ENV }), false);
  assert.equal(venueMapLiveRefreshEnabled({ ...env, MSHPIT_MAPLIBRE_LIVE_REFRESH: "true" }), false);
});

test("stale reload retrieves every new public page, saves receipt, and preserves original capture", async () => {
  const original = snapshot(); let calls = 0, saved;
  const manager = createVenueMapPreviewRefresh({ snapshot: original, now: () => at,
    request: async (url, options) => {
      const target = new URL(url); assert.equal(target.origin, PUBLIC_CATALOGUE_ORIGIN);
      assert.equal(options.credentials, "omit"); assert.equal(options.redirect, "error");
      assert.equal(target.searchParams.get("after"), calls ? "next" : null);
      return ++calls === 1 ? page("one", "next") : page("two");
    }, saveSnapshot: async (value, receipt) => { saved = { value, receipt }; } });
  const value = await manager.get();
  assert.equal(calls, 2); assert.equal(value.refreshed, true); assert.equal(value.refreshFailed, false);
  assert.deepEqual(value.tourDates.map(row => row.id), ["one", "two"]);
  assert.equal(value.fetchedAt, new Date(at).toISOString()); assert.equal(saved.receipt.requests, 2);
  assert.equal(saved.receipt.catalogueRetrievedAt, value.fetchedAt); assert.equal(saved.receipt.complete, true);
  assert.equal(original.capturedAt, new Date(at - 3600001).toISOString()); assert.deepEqual(original.tourDates.map(row => row.id), ["old"]);
  assert.equal((await manager.get()).refreshed, false); assert.equal(calls, 2);
});

test("fresh capture avoids network until explicit manual Retry", async () => {
  let calls = 0;
  const manager = createVenueMapPreviewRefresh({ snapshot: snapshot(new Date(at - 1000).toISOString()), now: () => at, request: async () => { calls += 1; return page(); } });
  assert.equal((await manager.get()).refreshed, false); assert.equal(calls, 0);
  assert.equal((await manager.get({ refresh: true })).refreshed, true); assert.equal(calls, 1);
});

test("one-hour boundary is unchanged and future clocks cannot renew a witness", async () => {
  for (const capturedAt of [new Date(at - 3600000).toISOString(), new Date(at + 1).toISOString()]) {
    let calls = 0;
    const manager = createVenueMapPreviewRefresh({ snapshot: snapshot(capturedAt), now: () => at, request: async () => { calls += 1; return page(); } });
    assert.equal((await manager.get()).refreshed, true); assert.equal(calls, 1);
  }
});

test("late failure keeps complete old rows and original clock without automatic retry", async () => {
  const original = snapshot(); let calls = 0, saves = 0;
  const manager = createVenueMapPreviewRefresh({ snapshot: original, now: () => at,
    request: async () => ++calls === 1 ? page("partial", "next") : { ok: false, status: 503 }, saveSnapshot: async () => { saves += 1; } });
  const value = await manager.get();
  assert.equal(value.refreshFailed, true); assert.equal(value.refreshErrorCode, "VENUE_MAP_HTTP"); assert.equal(value.refreshed, false);
  assert.equal(value.fetchedAt, original.capturedAt); assert.deepEqual(value.tourDates.map(row => row.id), ["old"]);
  assert.equal(saves, 0); assert.equal(manager.snapshot(), original);
  await new Promise(resolve => setTimeout(resolve, 15)); assert.equal(calls, 2);
});

test("concurrent clients share one crawl and one client's cancellation preserves the other's request", async () => {
  let calls = 0, resolveRequest, upstream;
  const manager = createVenueMapPreviewRefresh({ snapshot: snapshot(), now: () => at, request: (url, options) => {
    calls += 1; upstream = options.signal; return new Promise(resolve => { resolveRequest = resolve; });
  } });
  const controller = new AbortController();
  const one = manager.get({ signal: controller.signal }), two = manager.get();
  controller.abort(); await assert.rejects(one, error => error.name === "AbortError");
  assert.equal(upstream.aborted, false); resolveRequest(page());
  assert.equal((await two).refreshed, true); assert.equal(calls, 1);
});

test("last client cancellation aborts upstream and saves no late ignored response", async () => {
  let resolveRequest, upstream, saves = 0;
  const manager = createVenueMapPreviewRefresh({ snapshot: snapshot(), now: () => at, request: (url, options) => {
    upstream = options.signal; return new Promise(resolve => { resolveRequest = resolve; });
  }, saveSnapshot: async () => { saves += 1; } });
  const controller = new AbortController(), pending = manager.get({ signal: controller.signal });
  controller.abort(); await assert.rejects(pending, error => error.name === "AbortError");
  assert.equal(upstream.aborted, true); resolveRequest(page("late"));
  await new Promise(resolve => setTimeout(resolve, 5)); assert.equal(saves, 0); assert.equal(manager.snapshot().tourDates[0].id, "old");
});

test("whole-crawl and per-page deadlines abort and return old cards with explicit failure", async () => {
  for (const [timeoutMs, pageTimeoutMs, code] of [[10, 100, "VENUE_MAP_REFRESH_TIMEOUT"], [100, 10, "VENUE_MAP_TIMEOUT"]]) {
    let upstream;
    const manager = createVenueMapPreviewRefresh({ snapshot: snapshot(), now: () => at, timeoutMs, pageTimeoutMs,
      request: (url, options) => { upstream = options.signal; return new Promise(() => {}); } });
    const value = await manager.get();
    assert.equal(value.refreshFailed, true); assert.equal(value.refreshErrorCode, code); assert.equal(upstream.aborted, true);
    assert.equal(value.tourDates[0].id, "old");
  }
});

test("archive failure does not publish a new timestamp or replace the old snapshot", async () => {
  const original = snapshot();
  const manager = createVenueMapPreviewRefresh({ snapshot: original, now: () => at, request: async () => page(), saveSnapshot: async () => { throw new Error("disk unavailable"); } });
  const value = await manager.get();
  assert.equal(value.refreshFailed, true); assert.equal(value.fetchedAt, original.capturedAt); assert.equal(manager.snapshot(), original);
});
