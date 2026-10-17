import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parse } from "@babel/parser";
import { nearbyInitialTab, nearbyLocationPrompt } from "./nearbyEntry.mjs";

test("Nearby defaults to shows and explicit venue links retain venues", () => {
  assert.equal(nearbyInitialTab("shows"), "shows");
  assert.equal(nearbyInitialTab("venues"), "venues");
  for (const value of [undefined, null, "unknown", {}, 1]) assert.equal(nearbyInitialTab(value), "shows");
});

test("skipping the optional city asks for a location without claiming that a city is unmapped", () => {
  for (const center of [null, undefined, {}, { city: "" }, { city: "  " }]) {
    assert.deepEqual(nearbyLocationPrompt(center), {
      title: "Choose a city to find shows",
      body: "Choose a city for upcoming shows and venues.",
    });
  }
  assert.equal(nearbyLocationPrompt({ city: "Toronto", lat: null, lng: null }).title, "This city is not mapped yet");
});

test("welcome navigation and Nearby render the intended initial tab and missing-city prompt", () => {
  const app = readFileSync(new URL("../../App.js", import.meta.url), "utf8");
  const nearby = readFileSync(new URL("../screens/NearbyScreen.jsx", import.meta.url), "utf8");
  assert.match(app, /<NearbyScreen[^>]*initialTab=\{nav\.nearbyTab\}/);
  assert.match(app, /onOpenNearby=\{\(\) => replace\(\{ nearby: true, nearbyTab: "shows" \}\)\}/);
  assert.match(nearby, /locationPrompt\.title/);
  assert.match(nearby, /locationPrompt\.body/);
  assert.doesNotThrow(() => parse(nearby, { sourceType: "module", plugins: ["jsx"] }));
});
