import assert from "node:assert/strict";
import test from "node:test";

import { landingLayoutMode, landingProofItems } from "./landingPresentation.mjs";

test("landing uses scrolling, inline attribution on short and narrow viewports", () => {
  assert.deepEqual(landingLayoutMode({ width: 320, height: 568 }), {
    wide: false,
    compact: true,
    scrollPitch: true,
    overlayCredit: false,
  });
  assert.deepEqual(landingLayoutMode({ width: 390, height: 667 }), {
    wide: false,
    compact: true,
    scrollPitch: true,
    overlayCredit: false,
  });
  assert.deepEqual(landingLayoutMode({ width: 1280, height: 640 }), {
    wide: true,
    compact: false,
    scrollPitch: true,
    overlayCredit: false,
  });
  assert.deepEqual(landingLayoutMode({ width: 1280, height: 720 }), {
    wide: true,
    compact: false,
    scrollPitch: false,
    overlayCredit: true,
  });
  assert.deepEqual(landingLayoutMode({ width: 1280, height: 720, fontScale: 2 }), {
    wide: true,
    compact: false,
    scrollPitch: true,
    overlayCredit: false,
  });
});

test("landing proof is truthful product context and never a member count", () => {
  const items = landingProofItems({ venues: 123.9, artists: 456 });
  assert.deepEqual(items.map(({ title }) => title), ["VENUES", "ARTISTS", "BAND + ROOM"]);
  assert.deepEqual(items.map(({ detail }) => detail), [
    "123 in the PIT catalogue",
    "456 in the PIT catalogue",
    "Rated separately",
  ]);
  const copy = JSON.stringify(items).toLowerCase();
  assert.equal(/\bmembers?\b/.test(copy), false);
  assert.equal(/\busers?\b/.test(copy), false);
});
