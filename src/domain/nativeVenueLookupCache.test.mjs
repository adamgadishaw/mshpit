import assert from "node:assert/strict";
import test from "node:test";
import { nativeVenueLookupCache } from "./nativeVenueLookupCache.mjs";

test("derived venue indexes reuse identical catalogues and invalidate replacements", () => {
  const catalogue = { "room one": { name: "Room One" } }, curated = {};
  const first = nativeVenueLookupCache(catalogue, curated);
  first.keyCacheRef.current.set("Room One", "room one");
  assert.equal(nativeVenueLookupCache(catalogue, curated), first);
  assert.equal(first.resolveCatalog("Room One"), "room one");
  const replacement = nativeVenueLookupCache({ "room two": {} }, curated);
  assert.notEqual(replacement, first);
  assert.equal(replacement.resolveCatalog("Room Two"), "room two");
  assert.equal(replacement.keyCacheRef.current.size, 0);
  assert.equal(replacement.coordinatesRef.current, null);
  assert.notEqual(nativeVenueLookupCache(catalogue, { "curated room": {} }), first);
});
