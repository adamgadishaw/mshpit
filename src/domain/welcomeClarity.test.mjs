import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const welcome = readFileSync(new URL("../screens/WelcomeScreen.jsx", import.meta.url), "utf8");
const menu = readFileSync(new URL("../screens/MenuScreen.jsx", import.meta.url), "utf8");
const app = readFileSync(new URL("../../App.js", import.meta.url), "utf8");
const guide = readFileSync(new URL("../features/signupOnboarding/WelcomeGuide.jsx", import.meta.url), "utf8");

test("first-run guidance states the product and its complete social concert loop", () => {
  assert.match(welcome, /social network for live music/);
  assert.match(welcome, /How MSHpit works/);
  assert.match(
    guide,
    /Find a show[\s\S]*Pick your artists[\s\S]*Remember the night/,
  );
  assert.match(welcome, /Find your people/);
  assert.match(welcome, /attend and log it/);
  assert.match(welcome, /Share the night/);
  assert.doesNotMatch(welcome, /joinFanClub\(/);
  assert.match(welcome, /do not need to fill out everything before exploring/i);
  assert.doesNotMatch(welcome, /Two quick things/);
});

test("the main menu keeps the product guide available after onboarding", () => {
  assert.match(menu, /title:\s*"How MSHpit works"/);
  assert.match(menu, /Discover a show, attend, log the night, and find your people\./);
  assert.match(app, /onHowItWorks=\{\(\) => go\(\{ welcomeGuide: true \}\)\}/);
  assert.match(app, /nav.welcomeGuide && session\) overlay = <WelcomeScreen onClose=\{back\}/);
  assert.doesNotMatch(app, /setWelcome\(/);
});
