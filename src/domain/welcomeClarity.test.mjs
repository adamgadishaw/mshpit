import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const welcome = readFileSync(new URL("../screens/WelcomeScreen.jsx", import.meta.url), "utf8");
const menu = readFileSync(new URL("../screens/MenuScreen.jsx", import.meta.url), "utf8");
const app = readFileSync(new URL("../../App.js", import.meta.url), "utf8");
const guide = readFileSync(new URL("../features/signupOnboarding/WelcomeGuide.jsx", import.meta.url), "utf8");

test("first-run guidance states the product and its complete social concert loop", () => {
  assert.match(welcome, /Find concerts, log the shows you attend, and share photos and reviews with other fans/);
  assert.match(welcome, /How Mshpit works/);
  assert.match(
    guide,
    /Find a show[\s\S]*Pick your artists[\s\S]*Remember the night/,
  );
  assert.match(welcome, /Find your people/);
  assert.match(welcome, /When you log a show, tag the friends who came with you/);
  assert.match(welcome, /Share the night/);
  assert.doesNotMatch(welcome, /joinFanClub\(/);
  assert.match(welcome, /Profile setup is optional/);
  assert.doesNotMatch(welcome, /Two quick things/);
});

test("the main menu keeps the product guide available after onboarding", () => {
  assert.match(menu, /title:\s*"How Mshpit works"/);
  assert.match(menu, /Find a show, log it, rate the artist and the venue, and see who else was there\./);
  assert.match(app, /onHowItWorks=\{\(\) => go\(\{ welcomeGuide: true \}\)\}/);
  assert.match(app, /nav.welcomeGuide && session\) overlay = <WelcomeScreen onClose=\{back\}/);
  assert.doesNotMatch(app, /setWelcome\(/);
});
