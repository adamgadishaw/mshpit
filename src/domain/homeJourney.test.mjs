import assert from "node:assert/strict";
import test from "node:test";
import { HOME_JOURNEY_LINE, HOME_JOURNEY_STEPS, homeGuideStorageKey } from "./homeJourney.mjs";

test("the home journey teaches the complete concert-social loop in plain order", () => {
  assert.equal(HOME_JOURNEY_LINE, "Find → Attend → Log → Share → Connect");
  assert.deepEqual(HOME_JOURNEY_STEPS.map((step) => step.key), ["find", "attend", "log", "share", "connect"]);
  assert.ok(HOME_JOURNEY_STEPS.every((step) => step.label && step.detail));
});

test("feed guide dismissal is scoped to the signed-in account", () => {
  assert.equal(homeGuideStorageKey(" fan-a "), "pit.home.guide.v1.fan-a");
  assert.equal(homeGuideStorageKey("fan-b"), "pit.home.guide.v1.fan-b");
  assert.notEqual(homeGuideStorageKey("fan-a"), homeGuideStorageKey("fan-b"));
  assert.equal(homeGuideStorageKey(null), "pit.home.guide.v1.guest");
});
