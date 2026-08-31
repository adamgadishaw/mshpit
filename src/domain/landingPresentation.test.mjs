import assert from "node:assert/strict";
import test from "node:test";

import {
  LANDING_IDENTITY_COPY,
  landingKicker,
  landingLayoutMode,
  landingProofItems,
} from "./landingPresentation.mjs";

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
  assert.deepEqual(items.map(({ title }) => title), ["VENUES", "ARTISTS", "ARTIST + VENUE"]);
  assert.deepEqual(items.map(({ detail }) => detail), [
    "123 concert venues",
    "456 artists",
    "Rate the artist and venue separately",
  ]);
  const copy = JSON.stringify(items).toLowerCase();
  assert.equal(/\bmembers?\b/.test(copy), false);
  assert.equal(/\busers?\b/.test(copy), false);
});

test("landing identity describes the product in plain language", () => {
  assert.equal(landingKicker(false), "REMEMBER THE NIGHT. FIND WHAT'S NEXT.");
  assert.equal(landingKicker(true), "REMEMBER. RATE. DISCOVER.");
  assert.equal(LANDING_IDENTITY_COPY.signupAction, "Create an account");
  assert.equal(LANDING_IDENTITY_COPY.browseAction, "Browse shows and artists");
  assert.match(LANDING_IDENTITY_COPY.body, /remember every show/i);
  assert.match(LANDING_IDENTITY_COPY.body, /photos, ratings/i);
  assert.match(LANDING_IDENTITY_COPY.body, /fans whose taste you trust/i);
  assert.match(LANDING_IDENTITY_COPY.headline, /shows/i);
  assert.match(LANDING_IDENTITY_COPY.headlineAccent, /taste/i);

  const identity = Object.values(LANDING_IDENTITY_COPY).join(" ");
  assert.doesNotMatch(identity, /\b(?:diary|journal|social network|musical journey)\b/i);
});
