import assert from "node:assert/strict";
import test from "node:test";

import { screenTransitionDirection, screenTransitionKey } from "./screenTransition.mjs";

test("each screen has a stable key; updating a screen in place keeps it", () => {
  assert.equal(screenTransitionKey({}, "discover"), "tab:discover");
  assert.equal(screenTransitionKey({ artistName: "Wet Leg", artistPublicSlug: "wet-leg" }, "feed"), "artistName:Wet Leg");
  assert.equal(screenTransitionKey({ openLog: { id: "tm_1", artist: "Wet Leg" } }), "openLog:tm_1");
  assert.equal(screenTransitionKey({ auth: true, authMode: "signup" }), "auth:");
  assert.equal(screenTransitionKey({ auth: true, authMode: "login" }), "auth:", "switching log in and sign up does not re-animate");
  assert.notEqual(screenTransitionKey({ artistName: "Wet Leg" }), screenTransitionKey({ artistName: "Idles" }));
  assert.equal(screenTransitionKey(null, "you"), "tab:you");
});

test("moves read as forward, back or a fade", () => {
  assert.equal(screenTransitionDirection(1, 2), "forward");
  assert.equal(screenTransitionDirection(3, 2), "back");
  assert.equal(screenTransitionDirection(2, 2), "fade");
  assert.equal(screenTransitionDirection(undefined, 2), "fade");
});
