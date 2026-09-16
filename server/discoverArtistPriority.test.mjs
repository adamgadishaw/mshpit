import test from "node:test";
import assert from "node:assert/strict";
import { rememberDiscoverArtists, discoverArtistPriorityKeys, interleaveDiscoverPriority,
  DISCOVER_PRIORITY_LIMIT, DISCOVER_PRIORITY_TTL_MS } from "./discoverArtistPriority.js";

test("Discover hints contain only bounded public keys, expire, and stay database scoped", () => {
  const database = {}, other = {}, at = 1800000000000;
  rememberDiscoverArtists(database, [{ key: "artist", privateMember: "not retained" }, { name: "not a key" },
    { key: "\u0000bad" }, { key: "x".repeat(241) }], at);
  assert.deepEqual(discoverArtistPriorityKeys(database, at), ["artist"]);
  assert.deepEqual(discoverArtistPriorityKeys(other, at), []);
  for (let n = 0; n < 600; n++) rememberDiscoverArtists(database, [{ key: `artist-${n}` }], at);
  assert.equal(discoverArtistPriorityKeys(database, at).length, DISCOVER_PRIORITY_LIMIT);
  assert.equal(discoverArtistPriorityKeys(database, at).includes("artist"), false);
  assert.deepEqual(discoverArtistPriorityKeys(database, at + DISCOVER_PRIORITY_TTL_MS), []);
});

test("priority work is interleaved with catalogue work and never exceeds the pass limit", () => {
  assert.deepEqual(interleaveDiscoverPriority([1, 2, 3, 4, 5], ["a", "b"], 6), [1, 2, 3, "a", 4, 5]);
  assert.deepEqual(interleaveDiscoverPriority([1, 2], ["a", "b"], 2), [1, "a"]);
  assert.deepEqual(interleaveDiscoverPriority([], ["a", "b"], 4), ["a", "b"]);
  assert.deepEqual(interleaveDiscoverPriority([1, 2], [], 4), [1, 2]);
});
