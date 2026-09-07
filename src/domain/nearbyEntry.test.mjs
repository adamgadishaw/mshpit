import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parse } from "@babel/parser";
import { nearbyInitialTab, nearbyLocationPrompt } from "./nearbyEntry.mjs";

test("Find a show selects upcoming concerts while ordinary nearby links retain venues", () => {
  assert.equal(nearbyInitialTab("shows"), "shows");
  for (const value of [undefined, null, "venues", "unknown", {}, 1]) assert.equal(nearbyInitialTab(value), "venues");
});

test("skipping the optional city asks for a location without claiming that a city is unmapped", () => {
  for (const center of [null, undefined, {}, { city: "" }, { city: "  " }]) {
    assert.deepEqual(nearbyLocationPrompt(center), {
      title: "Choose a city to find shows",
      body: "Pick a city to see its upcoming concerts and venues. You can browse anywhere.",
    });
  }
  assert.equal(nearbyLocationPrompt({ city: "Toronto", lat: null, lng: null }).title, "This city is not mapped yet");
});

test("welcome navigation and Nearby render the intended initial tab and missing-city prompt", () => {
  const app = readFileSync(new URL("../../App.js", import.meta.url), "utf8");
  const nearby = readFileSync(new URL("../screens/NearbyScreen.jsx", import.meta.url), "utf8");
  assert.match(app, /<NearbyScreen[^>]*initialTab=\{nav\.nearbyTab\}/);
  assert.match(app, /onOpenNearby=\{\(\) => \{ setWelcome\(false\); go\(\{ nearby: true, nearbyTab: "shows" \}\); \}\}/);
  assert.match(nearby, /useState\(\(\) => nearbyInitialTab\(initialTab\)\)/);
  assert.match(nearby, /useEffect\(\(\) => \{ setTab\(nearbyInitialTab\(initialTab\)\); \}, \[initialTab\]\)/);
  assert.match(nearby, /\{locationPrompt\.title\}/);
  assert.match(nearby, /\{locationPrompt\.body\}/);
  assert.doesNotThrow(() => parse(nearby, { sourceType: "module", plugins: ["jsx"] }));
});
