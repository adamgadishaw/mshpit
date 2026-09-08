import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createJsonPersistence } from "../lib/persistenceAdapter.mjs";
import { hiddenRecommendationIds, restoredMainTab } from "./startupCacheState.mjs";
import { landingLiveItems } from "./landingPresentation.mjs";

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

test("invalid optional landing events are skipped before the preview limit", () => {
  const events = [1, 2, 3, 4].map((id) => ({ id: String(id), artist: "Fixture artist" }));
  assert.deepEqual(landingLiveItems([null, 42, [], ...events]), events.slice(0, 3));
  for (const value of [null, {}, 42]) assert.deepEqual(landingLiveItems(value), []);
  assert.equal(landingLiveItems(events)[0], events[0], "valid event detail fields remain unchanged");
});

test("the actual startup and landing callers use their validated projections", () => {
  const store = readFileSync(new URL("../store.js", import.meta.url), "utf8");
  const app = readFileSync(new URL("../../App.js", import.meta.url), "utf8");
  const landing = readFileSync(new URL("../screens/LandingScreen.jsx", import.meta.url), "utf8");
  assert.match(store, /loadRecommendationHiddenIds = .*new Set\(hiddenRecommendationIds\(/);
  assert.match(store, /if \(!Array\.isArray\(hiddenPostIds\)\) return/);
  assert.match(app, /useState\(\(\) => restoredMainTab\(/);
  assert.match(landing, /landingLiveItems\(discoverySidebar\?\.upcomingEvents\)/);
});
