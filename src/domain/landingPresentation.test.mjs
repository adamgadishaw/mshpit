import assert from "node:assert/strict";
import test from "node:test";

import {
  LANDING_IDENTITY_COPY,
  LANDING_BROWSE_LINKS,
  landingLayoutMode,
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

test("landing says one plain thing and offers two ways in", () => {
  assert.deepEqual(Object.keys(LANDING_IDENTITY_COPY).sort(), ["body", "browseAction", "compactHeadline", "headline", "signupAction"]);
  assert.equal(LANDING_IDENTITY_COPY.headline, "Remember every show.");
  assert.equal(LANDING_IDENTITY_COPY.compactHeadline.replace("\n", " "), LANDING_IDENTITY_COPY.headline);
  assert.equal(LANDING_IDENTITY_COPY.signupAction, "Create an account");
  assert.equal(LANDING_IDENTITY_COPY.browseAction, "Browse concerts");
  assert.match(LANDING_IDENTITY_COPY.body, /rate the artist and the venue separately/i);

  const identity = Object.values(LANDING_IDENTITY_COPY).join(" ");
  assert.doesNotMatch(identity, /\b(?:diary|journal|social network|musical journey|unleash|elevate|seamless)\b/i);
  assert.doesNotMatch(identity, /\u2014/, "public copy never uses em-dashes");
});

test("public browsing paths are distinct and do not force signup", () => {
  assert.deepEqual(LANDING_BROWSE_LINKS.map(({ href }) => href), ["/artists", "/venues", "/cities"]);
  assert.equal(new Set(LANDING_BROWSE_LINKS.map(({ key }) => key)).size, 3);
  assert.deepEqual(LANDING_BROWSE_LINKS.map(({ label }) => label), ["Artists", "Venues", "Cities"]);
});
