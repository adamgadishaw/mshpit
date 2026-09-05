import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parse } from "@babel/parser";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const app = read("../../App.js");
const auth = read("../screens/AuthScreen.jsx");
const onboarding = read("../screens/SignupOnboardingScreen.jsx");
const editProfile = read("../screens/EditProfileScreen.jsx");
const store = read("../store.js");

test("signup onboarding UI and integration files remain parseable", () => {
  for (const [name, source] of Object.entries({ app, auth, onboarding, editProfile, store })) {
    assert.doesNotThrow(() => parse(source, { sourceType: "module", plugins: ["jsx"] }), `${name} must parse`);
  }
});

test("verified server account state opens the walkthrough on web and native", () => {
  assert.match(app, /needsSignupOnboarding\(session\)/);
  assert.match(app, /<SignupOnboardingScreen session=\{session\} onComplete=\{finishSignupOnboarding\}/);
  assert.match(app, /completeSignupOnboarding\(\)/);
  assert.doesNotMatch(app, /save\("pit\.welcomePending"/);
  assert.doesNotMatch(app, /load\("pit\.welcomePending"/);
});

test("signup clearly continues into public profile setup after confirmation", () => {
  assert.match(auth, /public @username and optional banner/);
  assert.match(auth, /then take a quick tour/);
  assert.match(auth, /same message either way/);
});

test("the walkthrough saves a banner and authoritative username before teaching the app", () => {
  assert.match(onboarding, /STEP \{step\} OF \{TOTAL_STEPS\}/);
  assert.match(onboarding, /profileImagePickerOptions\("banner"/);
  assert.match(onboarding, /uploadMediaAsset\(result\.assets\[0\], "banner"\)/);
  assert.match(onboarding, /saveProfile\(patch\)/);
  assert.match(onboarding, /result\?\.user/);
  assert.match(onboarding, /Find a show/);
  assert.match(onboarding, /Make plans/);
  assert.match(onboarding, /Remember the night/);
  assert.match(onboarding, /accessibilityRole="progressbar"/);
  assert.match(onboarding, /accessibilityLiveRegion="assertive"/);
});

test("profile editing never calls a partial local member cache username availability", () => {
  assert.doesNotMatch(editProfile, /handleTaken/);
  assert.doesNotMatch(editProfile, />available</);
  assert.match(editProfile, /ready to save/);
  assert.match(editProfile, /result\?\.error\?\.message/);
  assert.match(store, /let the server\/unique index own collisions/);
});
