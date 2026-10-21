import test from "node:test";
import assert from "node:assert/strict";
import { createVenueMapCatalogueCache, VENUE_MAP_CATALOGUE_CACHE_DEFAULTS as DEFAULT } from "./venueMapCatalogueCache.mjs";
import { compactVenueMapEvents } from "./venueMapCatalogueProjection.mjs";

const at = Date.parse("2026-10-21T18:00:00Z");
const event = (id, extra = {}) => ({ id: `tm_${id}`, source: "ticketmaster", providerEventId: String(id), providerVenueId: `room-${id}`,
  venue: `Room ${id}`, place: "Toronto, Ontario, Canada", venueCity: "Toronto", venueCountry: "Canada", lat: 43.65, lng: -79.38,
  date: "2026-11-03", providerActive: true, createdBy: "import", ...extra });
const page = (rows = [event("one")], nextCursor = null) => ({ rows, nextCursor });
const setup = options => {
  let time = at;
  const cache = createVenueMapCatalogueCache({ now: () => time, yieldControl: async () => {}, readPage: () => page(), ...options });
  return { cache, advance: ms => { time += ms; }, setTime: value => { time = value; } };
};
const codeIs = code => error => error.status === 503 && error.code === "VENUE_MAP_CACHE_UNAVAILABLE" && error.failureCode === code;

test("one bounded scan is shared and fresh refresh hints reuse the same frozen projection", async () => {
  let calls = 0, resolvePage;
  const { cache } = setup({ readPage: args => {
    calls += 1; assert.equal(args.limit, 500); assert.equal(args.timestamp, at); assert.equal(args.after, null);
    return new Promise(resolve => { resolvePage = resolve; });
  } });
  const first = cache.get(), second = cache.get({ refresh: true });
  await Promise.resolve(); resolvePage(page());
  const [one, two] = await Promise.all([first, second]);
  assert.equal(one, two); assert.equal(await cache.get({ refresh: true }), one); assert.equal(calls, 1);
  assert.equal(one.fetchedAt, new Date(at).toISOString()); assert.equal(one.expiresAt, new Date(at + 3600000).toISOString());
  assert.equal(Object.isFrozen(one), true); assert.equal(Object.isFrozen(one.tourDates), true); assert.equal(Object.isFrozen(one.tourDates[0]), true);
});

test("full catalogue paging yields, strips metadata, and preserves all counts and witness rules", async () => {
  const rows = Array.from({ length: 6001 }, (_, i) => event(i, { images: ["large unused metadata"], biography: "discard" }));
  rows.push(event("variant", { providerVenueId: "room-0", lat: 44 }));
  let calls = 0, yields = 0;
  const { cache, advance } = setup({ readPage: ({ after, timestamp }) => {
    calls += 1; assert.equal(timestamp, at);
    const offset = after === null ? 0 : Number(after); advance(1);
    return page(rows.slice(offset, offset + 500), offset + 500 < rows.length ? String(offset + 500) : null);
  }, yieldControl: async () => { yields += 1; advance(1); } });
  const value = await cache.get(), expected = compactVenueMapEvents(rows, { fetchedAt: at, pages: 13 });
  assert.equal(value.eventCount, 6002); assert.equal(value.venueCount, 6001); assert.equal(value.pages, 13);
  assert.equal(calls, 13); assert.equal(yields, 12);
  assert.deepEqual(value.tourDates, expected.tourDates); assert.equal(value.tourDates[0].images, undefined); assert.equal(value.tourDates[0].biography, undefined);
  assert.equal(value.tourDates.filter(row => row.providerVenueId === "room-0").length, 2);
});

test("opaque case-distinct ids and final duplicate events retain established projection behavior", async () => {
  let calls = 0;
  const { cache } = setup({ readPage: () => ++calls === 1 ? page([event("A", { providerVenueId: "KovZ917A-EJ" }), event("a", { providerVenueId: "KovZ917A-Ej" })], "next")
    : page([event("A", { providerVenueId: "KovZ917A-EJ" })]) });
  const value = await cache.get(); assert.equal(value.eventCount, 2); assert.equal(value.venueCount, 2); assert.equal(value.pages, 2);
});

test("five-minute cache expiry causes a fresh scan while hints cannot bypass the sixty-second attempt cooldown", async () => {
  let calls = 0;
  const { cache, advance } = setup({ cacheTtlMs: 1000, readPage: () => page([event(++calls)]) });
  const original = await cache.get();
  advance(1000); const cooldown = await cache.get({ refresh: true });
  assert.equal(calls, 1); assert.equal(cooldown.fetchedAt, original.fetchedAt); assert.equal(cooldown.refreshFailed, true);
  advance(59000); const fresh = await cache.get({ refresh: true });
  assert.equal(calls, 2); assert.equal(fresh.fetchedAt, new Date(at + 60000).toISOString());
  const normal = setup({ readPage: () => { calls += 1; return page(); } });
  const before = calls; await normal.cache.get(); normal.advance(299999); await normal.cache.get({ refresh: true }); assert.equal(calls, before + 1);
  normal.advance(1); await normal.cache.get(); assert.equal(calls, before + 2);
});

test("failed refresh retains one memoized immutable complete snapshot without renewing timestamps", async () => {
  let calls = 0;
  const { cache, advance } = setup({ readPage: () => ++calls === 1 ? page() : (() => { throw new Error("source failed"); })() });
  const original = await cache.get(); advance(DEFAULT.cacheTtlMs);
  const failed = await cache.get(), again = await cache.get({ refresh: true });
  assert.equal(calls, 2); assert.equal(failed, again); assert.equal(failed.refreshFailed, true); assert.equal(failed.cacheStale, true);
  assert.equal(failed.fetchedAt, original.fetchedAt); assert.equal(failed.expiresAt, original.expiresAt); assert.equal(failed.tourDates, original.tourDates);
  assert.equal(Object.isFrozen(failed), true); assert.equal(cache.inspect().lastFailureCode, "VENUE_MAP_CACHE_READ_FAILED");
});

test("failure backoff and cooldown prevent anonymous force-hint scan storms, then allow recovery", async () => {
  let calls = 0, failing = true;
  const { cache, advance } = setup({ failureBackoffMs: 120000, readPage: () => { calls += 1; if (failing) throw new Error("offline"); return page(); } });
  await assert.rejects(cache.get(), error => codeIs("VENUE_MAP_CACHE_READ_FAILED")(error) && error.retryAt === at + 120000 && Number.isFinite(error.retryAt));
  for (let i = 0; i < 20; i += 1) await assert.rejects(cache.get({ refresh: true }), error => error.retryAfterMs === 120000);
  advance(60000); await assert.rejects(cache.get({ refresh: true }), error => error.retryAfterMs === 60000); assert.equal(calls, 1);
  failing = false; advance(60000); assert.equal((await cache.get()).complete, true); assert.equal(calls, 2);
});

test("one-hour original expiry and clock rollback forbid stale fallback", async () => {
  let fail = false;
  const { cache, setTime } = setup({ readPage: () => { if (fail) throw new Error("offline"); return page(); } });
  await cache.get(); fail = true;
  setTime(at + 3600000); await assert.rejects(cache.get(), codeIs("VENUE_MAP_CACHE_READ_FAILED"));
  setTime(at - 1); await assert.rejects(cache.get(), error => error.status === 503);
});

test("snapshot expiring during a failed scan is rejected at response time", async () => {
  let calls = 0;
  const { cache, setTime, advance } = setup({ readPage: () => {
    calls += 1; if (calls === 1) return page(); advance(2000); throw new Error("late failure");
  } });
  await cache.get(); setTime(at + 3599000);
  await assert.rejects(cache.get(), codeIs("VENUE_MAP_CACHE_READ_FAILED")); assert.equal(cache.inspect().fetchedAt, new Date(at).toISOString());
});

test("individual cancellation detaches without aborting another shared waiter", async () => {
  let resolvePage, upstream;
  const { cache } = setup({ readPage: ({ signal }) => { upstream = signal; return new Promise(resolve => { resolvePage = resolve; }); } });
  const controller = new AbortController(), one = cache.get({ signal: controller.signal }), two = cache.get();
  await Promise.resolve(); controller.abort(); await assert.rejects(one, error => error.name === "AbortError");
  assert.equal(upstream.aborted, false); resolvePage(page()); assert.equal((await two).eventCount, 1);
});

test("last waiter cancellation aborts work, preserves cooldown, and late ignored completion cannot install", async () => {
  let calls = 0, resolvePage, upstream;
  const { cache, advance } = setup({ readPage: ({ signal }) => {
    upstream = signal; calls += 1; return calls === 1 ? new Promise(resolve => { resolvePage = resolve; }) : page([event("new")]);
  } });
  const controller = new AbortController(), first = cache.get({ signal: controller.signal });
  await Promise.resolve(); controller.abort(); await assert.rejects(first, error => error.name === "AbortError");
  assert.equal(upstream.aborted, true);
  await assert.rejects(cache.get({ refresh: true }), error => error.status === 503); assert.equal(calls, 1);
  advance(60000); const current = await cache.get(); assert.equal(current.tourDates[0].id, "tm_new");
  resolvePage(page([event("late")])); await Promise.resolve(); await Promise.resolve();
  assert.equal(await cache.get(), current); assert.equal(cache.inspect().inflight, false);
});

test("cancellation during yield stops before another page and never publishes a partial catalogue", async () => {
  let calls = 0, resolveYield;
  const { cache } = setup({ readPage: () => { calls += 1; return page([event("first")], "next"); }, yieldControl: () => new Promise(resolve => { resolveYield = resolve; }) });
  const controller = new AbortController(), loading = cache.get({ signal: controller.signal });
  while (!resolveYield) await Promise.resolve();
  controller.abort(); await assert.rejects(loading, error => error.name === "AbortError"); resolveYield();
  await Promise.resolve(); assert.equal(calls, 1); assert.equal(cache.inspect().hasComplete, false);
});

test("async stalled readers and synchronous over-budget work both respect the scan deadline", async () => {
  const asynchronous = setup({ timeoutMs: 10, readPage: () => new Promise(() => {}) });
  await assert.rejects(asynchronous.cache.get(), codeIs("VENUE_MAP_CACHE_TIMEOUT"));
  const synchronous = setup({ readPage: () => { synchronous.advance(8000); return page(); } });
  await assert.rejects(synchronous.cache.get(), codeIs("VENUE_MAP_CACHE_TIMEOUT"));
  assert.equal(synchronous.cache.inspect().hasComplete, false);
});

test("limits fail closed for pages, ALL scanned events, stripped input bytes and final compact bytes", async () => {
  let pageCalls = 0;
  const pages = setup({ maxPages: 1, readPage: () => { pageCalls += 1; return page([], "next"); } });
  await assert.rejects(pages.cache.get(), codeIs("VENUE_MAP_CACHE_PAGE_LIMIT")); assert.equal(pageCalls, 1);
  let eventCalls = 0;
  const events = setup({ maxEvents: 1, readPage: () => ++eventCalls === 1 ? page([event("same")], "next") : page([event("same")]) });
  await assert.rejects(events.cache.get(), codeIs("VENUE_MAP_CACHE_EVENT_LIMIT"));
  const input = setup({ maxInputSerializedBytes: 50 }); await assert.rejects(input.cache.get(), codeIs("VENUE_MAP_CACHE_INPUT_LIMIT"));
  const output = setup({ maxSerializedBytes: 50 }); await assert.rejects(output.cache.get(), codeIs("VENUE_MAP_CACHE_OUTPUT_LIMIT"));
  for (const { cache } of [pages, events, input, output]) assert.equal(cache.inspect().hasComplete, false);
});

test("large discarded metadata does not count against the allowlisted input budget", async () => {
  const { cache } = setup({ maxInputSerializedBytes: 1024, readPage: () => page([event("one", { biography: "x".repeat(50000), images: [{ unused: "x".repeat(50000) }] })]) });
  assert.equal((await cache.get()).eventCount, 1);
});

test("malformed pages, cursor loops, changing witnesses and stalled duplicates fail explicitly", async () => {
  for (const [readPage, expected] of [
    [() => ({ rows: [], nextCursor: 5 }), "VENUE_MAP_CACHE_SCHEMA"],
    [() => page(Array.from({ length: 501 }, (_, i) => event(i))), "VENUE_MAP_CACHE_SCHEMA"],
    [(() => { let i = 0; return () => page([event(++i)], "same"); })(), "VENUE_MAP_CACHE_CURSOR"],
    [(() => { let i = 0; return () => page([event("same", { lat: ++i === 1 ? 43 : 44 })], String(i)); })(), "VENUE_MAP_CACHE_WITNESS_CONFLICT"],
    [(() => { let i = 0; return () => page([event("same")], String(++i)); })(), "VENUE_MAP_CACHE_NO_PROGRESS"],
  ]) await assert.rejects(setup({ readPage }).cache.get(), codeIs(expected));
  let empty = true;
  assert.equal((await setup({ readPage: () => { if (empty) { empty = false; return page([], "advanced"); } return page(); } }).cache.get()).pages, 2);
});

test("source objects remain mutable while nested cached coordinate assertions cannot be poisoned", async () => {
  const source = event("one", { coord: { lat: 43.65, lng: -79.38, source: "fixture" }, coordinateProvenance: { source: "fixture", sourceId: "exact" } });
  const { cache } = setup({ readPage: () => page([source]) });
  const value = await cache.get(); source.coord.lat = 99; source.coordinateProvenance.source = "changed";
  assert.equal(value.tourDates[0].coord.lat, 43.65); assert.equal(value.tourDates[0].coordinateProvenance.source, "fixture");
  assert.throws(() => { value.tourDates[0].coord.lat = 0; }, TypeError);
  assert.throws(() => { value.tourDates.push(event("poison")); }, TypeError);
  assert.equal(await cache.get(), value);
});

test("constructor rejects relaxed hard resource limits and anonymous cooldown bypasses", () => {
  for (const extra of [{ timeoutMs: 8001 }, { maxPages: 257 }, { maxEvents: 100001 }, { sourceMaxAgeMs: 3600001 },
    { refreshCooldownMs: 59999 }, { failureBackoffMs: 29999 }, { cacheTtlMs: 300001 }, { maxSerializedBytes: DEFAULT.maxSerializedBytes + 1 }]) {
    assert.throws(() => setup(extra), RangeError);
  }
});
