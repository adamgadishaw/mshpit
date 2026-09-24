import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  PORTAL_HOLD_MS,
  PORTAL_INNER_FIGURES,
  PORTAL_OUTER_FIGURES,
  PORTAL_SPEED_INPUT,
  PORTAL_TURNS,
} from "./landingPortal.mjs";

const component = readFileSync(new URL("../components/LandingPortalMark.jsx", import.meta.url), "utf8");
const landing = readFileSync(new URL("../screens/LandingScreen.jsx", import.meta.url), "utf8");

test("the portal is the community mark and nothing else: twelve figures outside, eight inside", () => {
  assert.equal(PORTAL_OUTER_FIGURES.length, 12);
  assert.equal(PORTAL_INNER_FIGURES.length, 8);
  assert.doesNotMatch(component, /<Line|Polygon|strokeDasharray|RadialGradient|spark/i,
    "no ticks, rings, glow or sparks around the logo");
});

test("every run is whole turns, so each pause shows the logo upright, and it holds long enough to read", () => {
  assert.ok(Number.isInteger(PORTAL_TURNS) && PORTAL_TURNS === 10);
  assert.ok(PORTAL_HOLD_MS >= 1_500);
  assert.deepEqual([PORTAL_SPEED_INPUT[0], PORTAL_SPEED_INPUT.at(-1)], [0, PORTAL_TURNS], "solid at both stops");
});

test("the two rings turn against each other at the same time", () => {
  assert.match(component, /outputRange: \["0deg", `\$\{degrees\}deg`\]/);
  assert.match(component, /outputRange: \["0deg", `-\$\{degrees\}deg`\]/);
});

test("the portal sits above the headline, is decorative, and stays still with Reduce Motion", () => {
  assert.match(landing, /<LandingPortalMark[\s\S]*?animate=\{appActive && !reduceMotion\}/);
  assert.ok(landing.indexOf("<LandingPortalMark") < landing.indexOf("LANDING_IDENTITY_COPY.headline"));
  assert.match(component, /pointerEvents="none"/);
  assert.match(component, /aria-hidden/);
  assert.match(component, /if \(!animate\) \{\s*open\.setValue\(1\);\s*return undefined;/);
});
