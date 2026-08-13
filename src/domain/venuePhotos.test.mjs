import assert from "node:assert/strict";
import test from "node:test";
import {
  cleanVenuePhotoResponse,
  isFreshVenuePhotoEntry,
  mergeVenuePhotoSources,
  venuePhotoStateFor,
  withBoundedVenuePhotoCache,
} from "./venuePhotos.mjs";

test("venue photo responses are URL-safe, unique, normalized, and bounded", () => {
  const input = Array.from({ length: 30 }, (_, index) => ({
    uri: `https://images.example/${index}.jpg`,
    by: index === 0 ? "  Photographer  " : "Credit",
    source: index % 2 ? "openverse" : "commons",
  }));
  input.unshift({ uri: "javascript:alert(1)", by: "bad", source: "web" });
  input.push(input[5]);

  const result = cleanVenuePhotoResponse(input);
  assert.equal(result.length, 24);
  assert.equal(result[0].by, "Photographer");
  assert.ok(result.every((photo) => /^https?:\/\//.test(photo.uri)));
  assert.equal(new Set(result.map((photo) => photo.uri)).size, result.length);
});

test("venue photo memory cache is LRU-bounded and expires", () => {
  let cache = new Map();
  cache = withBoundedVenuePhotoCache(cache, "a", { status: "ready", loadedAt: 100 }, 2);
  cache = withBoundedVenuePhotoCache(cache, "b", { status: "ready", loadedAt: 200 }, 2);
  cache = withBoundedVenuePhotoCache(cache, "c", { status: "ready", loadedAt: 300 }, 2);
  assert.deepEqual([...cache.keys()], ["b", "c"]);
  assert.equal(isFreshVenuePhotoEntry(cache.get("c"), 300 + 14 * 60 * 1000), true);
  assert.equal(isFreshVenuePhotoEntry(cache.get("c"), 300 + 16 * 60 * 1000), false);
});

test("venue photo merge preserves official, fan, backfill priority", () => {
  const remote = [
    { uri: "https://img/backfill.jpg", source: "openverse" },
    { uri: "https://img/official.jpg", source: "commons" },
  ];
  const fan = [
    { uri: "https://img/fan.jpg", source: "fan" },
    { uri: "https://img/official.jpg", source: "fan" },
  ];
  assert.deepEqual(
    mergeVenuePhotoSources(remote, fan, (uri) => uri.endsWith("backfill.jpg")).map((photo) => photo.uri),
    ["https://img/official.jpg", "https://img/fan.jpg"],
  );
});

test("a venue without a catalog key settles as an empty result instead of loading forever", () => {
  assert.deepEqual(venuePhotoStateFor(null, {}), { status: "ready", photos: [], error: null });
  assert.deepEqual(venuePhotoStateFor("known", {}), { status: "idle", photos: [], error: null });
  const ready = { status: "ready", photos: [{ uri: "https://img/venue.jpg" }], error: null };
  assert.equal(venuePhotoStateFor("known", { known: ready }), ready);
});
