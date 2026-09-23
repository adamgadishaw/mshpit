import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createJsonPersistence } from "../lib/persistenceAdapter.mjs";
import { hiddenRecommendationIds, restoredMainTab } from "./startupCacheState.mjs";

test("malformed saved preference JSON cannot throw while creating the hidden-post set", () => {
  for (const value of [null, {}, 42, true, "post-1", { hiddenPostIds: [] }]) {
    const persistence = createJsonPersistence();
    persistence.save("account-a", value);
    assert.deepEqual([...new Set(hiddenRecommendationIds(persistence.load("account-a", [])))], []);
    assert.deepEqual(persistence.load("account-a", []), value, "normalization does not delete stored data");
  }
});

test("valid hidden-post choices are preserved, deduplicated and never coerced from objects", () => {
  assert.deepEqual(hiddenRecommendationIds(["post-a", null, {}, 42, "post-b", "post-a", "", "bad\u0000id"]), ["post-a", "post-b"]);
  const persistence = createJsonPersistence();
  persistence.save("account-a", ["post-a"]);
  persistence.save("account-b", ["post-b"]);
  assert.deepEqual(hiddenRecommendationIds(persistence.load("account-a", [])), ["post-a"]);
  assert.deepEqual(persistence.load("account-b", []), ["post-b"]);
});

test("unknown saved tabs recover to the feed instead of an empty app shell", () => {
  for (const value of [null, {}, [], 42, true, "retired-screen", ""]) assert.equal(restoredMainTab(value), "feed");
  for (const value of ["feed", "search", "discover", "you"]) assert.equal(restoredMainTab(value), value);
});

test("the actual startup callers use their validated projections", () => {
  const store = readFileSync(new URL("../store.js", import.meta.url), "utf8");
  const app = readFileSync(new URL("../../App.js", import.meta.url), "utf8");
  assert.match(store, /loadRecommendationHiddenIds = .*new Set\(hiddenRecommendationIds\(/);
  assert.match(store, /if \(!Array\.isArray\(hiddenPostIds\)\) return/);
  assert.match(app, /useState\(\(\) => \(web && mainTabForPath\(window\.location\.pathname\)\) \|\| restoredMainTab\(/);
});
