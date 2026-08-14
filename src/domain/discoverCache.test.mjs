import assert from "node:assert/strict";
import test from "node:test";

import { createDiscoverCache, discoverGenreCacheKey, discoverOverviewCacheKey } from "./discoverCache.mjs";

test("Discover cache keys normalize equivalent overview and genre requests", () => {
  assert.equal(
    discoverOverviewCacheKey({ by: "unknown", country: " Canada " }),
    discoverOverviewCacheKey({ by: "popularity", country: "canada" }),
  );
  assert.equal(
    discoverGenreCacheKey({ genre: " R&B ", country: "WORLDWIDE", limit: 12 }),
    discoverGenreCacheKey({ genre: "r&b", country: "Worldwide", limit: "12" }),
  );
});

test("fresh values are reused but expire at the TTL boundary", () => {
  let now = 100;
  const cache = createDiscoverCache({ ttlMs: 60, clock: () => now });
  const ticket = cache.claim("overview");
  assert.equal(cache.commit("overview", ticket, { rows: [1] }), true);
  assert.deepEqual(cache.get("overview"), { rows: [1] });
  now = 159;
  assert.deepEqual(cache.get("overview"), { rows: [1] });
  now = 160;
  assert.equal(cache.get("overview"), null);
});

test("a slower response cannot overwrite a newer request for the same key", () => {
  const cache = createDiscoverCache();
  const old = cache.claim("overview");
  const fresh = cache.claim("overview");
  assert.equal(cache.commit("overview", fresh, "fresh"), true);
  assert.equal(cache.commit("overview", old, "stale"), false);
  assert.equal(cache.get("overview"), "fresh");
});

test("the LRU stays bounded and recently-read values survive eviction", () => {
  const cache = createDiscoverCache({ maxEntries: 2 });
  for (const key of ["a", "b"]) cache.commit(key, cache.claim(key), key);
  assert.equal(cache.get("a"), "a");
  cache.commit("c", cache.claim("c"), "c");
  assert.equal(cache.get("b"), null);
  assert.equal(cache.get("a"), "a");
  assert.equal(cache.get("c"), "c");
  assert.equal(cache.size, 2);
});

test("invalidating a key rejects its abandoned response", () => {
  const cache = createDiscoverCache();
  const request = cache.claim("genre");
  cache.invalidate("genre");
  assert.equal(cache.commit("genre", request, []), false);
  assert.equal(cache.get("genre"), null);
});
