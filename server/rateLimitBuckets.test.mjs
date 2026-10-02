import assert from "node:assert/strict";
import test from "node:test";
import { createRateLimitBuckets } from "./rateLimitBuckets.js";

test("full live capacity rejects overflow with constant expiry inspections", () => {
  const buckets = createRateLimitBuckets();
  let reads = 0;
  for (let i = 0; i < 50_000; i += 1) {
    buckets.set(`actor:${i}`, { count: 1, get resetAt() { reads += 1; return 60_000; } });
  }
  reads = 0;
  for (let i = 0; i < 1_000; i += 1) assert.equal(buckets.hasCapacity([`overflow:${i}`], 0), false);
  assert.equal(reads, 1_000, "one earliest-expiry inspection, not 50k inspections per denial");
  assert.equal(buckets.size, 50_000); assert.equal(buckets.expirySize, 50_000);
  assert.equal(buckets.hasCapacity(["actor:0"], 0), true);
  assert.equal(buckets.get("actor:0").count, 1);
});

test("short windows behind long windows reclaim first and each maintenance pass is bounded", () => {
  const buckets = createRateLimitBuckets({ maxEntries: 200, pruneLimit: 64 });
  for (let i = 0; i < 100; i += 1) buckets.set(`long:${i}`, { count: 1, resetAt: 100_000 });
  for (let i = 0; i < 100; i += 1) buckets.set(`short:${i}`, { count: 1, resetAt: 100 });
  assert.equal(buckets.pruneExpired(100), 64);
  assert.equal(buckets.size, 136); assert.equal(buckets.expirySize, 136);
  assert.equal(buckets.pruneExpired(100), 36);
  assert.equal(buckets.pruneExpired(100), 0);
  for (let i = 0; i < 100; i += 1) assert.equal(buckets.get(`long:${i}`).count, 1);
});

test("renewals, rollback replacements and deletion keep exactly one expiry node per key", () => {
  const buckets = createRateLimitBuckets({ maxEntries: 3 });
  const original = { count: 1, resetAt: 20 };
  buckets.set("a", original); buckets.set("b", { count: 1, resetAt: 40 }); buckets.set("c", { count: 1, resetAt: 60 });
  for (let i = 0; i < 2_000; i += 1) {
    buckets.set("a", { count: 2, resetAt: 80 });
    buckets.set("a", original);
  }
  assert.equal(buckets.get("a"), original);
  assert.equal(buckets.size, 3); assert.equal(buckets.expirySize, 3);
  assert.equal(buckets.pruneExpired(20), 1); assert.equal(buckets.has("a"), false);
  buckets.set("a", { count: 1, resetAt: 100 });
  assert.equal(buckets.delete("b"), true); assert.equal(buckets.delete("b"), false);
  assert.equal(buckets.pruneExpired(60), 1); assert.equal(buckets.get("a").resetAt, 100);
  buckets.clear(); assert.equal(buckets.size, 0); assert.equal(buckets.expirySize, 0);
});

test("mixed deterministic mutations agree with a reference expiry map", () => {
  const buckets = createRateLimitBuckets({ maxEntries: 128, pruneLimit: 128 });
  const expected = new Map();
  let random = 17;
  const next = () => { random = (Math.imul(random, 1664525) + 1013904223) >>> 0; return random; };
  for (let at = 0; at < 2_000; at += 1) {
    const key = `actor:${next() % 128}`;
    if (next() % 5 === 0) { buckets.delete(key); expected.delete(key); }
    else { const value = { count: next() % 10, resetAt: at + next() % 200 }; buckets.set(key, value); expected.set(key, value); }
    if (at % 7 === 0) {
      buckets.pruneExpired(at);
      for (const [id, value] of expected) if (value.resetAt <= at) expected.delete(id);
    }
    assert.equal(buckets.size, expected.size); assert.equal(buckets.expirySize, expected.size);
    for (const [id, value] of expected) assert.equal(buckets.get(id), value);
  }
});
