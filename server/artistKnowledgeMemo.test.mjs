import test from "node:test";
import assert from "node:assert/strict";
import { createArtistKnowledgeMemo } from "./artistKnowledgeMemo.js";

test("knowledge checkpoints are bounded, expire, and cannot be mutated by a consumer", () => {
  const cache = createArtistKnowledgeMemo({ maxEntries: 2, ttlMs: 100 });
  const item = { bio: "verified", source: { id: "Q1" } };
  cache.set("a", item, 10); item.source.id = "wrong";
  const result = cache.get("a", 20); result.source.id = "also wrong";
  assert.equal(cache.get("a", 21).source.id, "Q1");
  cache.set("b", {}, 20); cache.set("c", {}, 20);
  assert.equal(cache.get("a", 22), null);
  assert.deepEqual(cache.get("b", 22), {});
  assert.equal(cache.get("b", 120), null);
  assert.equal(cache.get("c", 19), null, "backward clocks invalidate cached evidence");
  cache.set("huge", { text: "x".repeat(8193) }, 20);
  assert.equal(cache.get("huge", 21), null);
});
