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
  assert.match(app, /<SignupOnboardingScreen key=\{session.id\} session=\{session\} onComplete=\{finishSignupOnboarding\}/);
  assert.match(app, /completeSignupOnboarding\(\{ expectedAccountId, signal \}\)/);
  assert.match(app, /expectedAccountId === sessionRef.current\?\.id/);
  assert.doesNotMatch(app, /save\("pit\.welcomePending"/);
  assert.doesNotMatch(app, /load\("pit\.welcomePending"/);
});

test("signup enters real account setup or a password-proven choice, never a false confirmation", () => {
  assert.match(auth, /handle/);
  assert.match(auth, /profile photo/i);
  assert.match(auth, /banner/);
  assert.doesNotMatch(auth, /same message either way|signupSubmitted|result.pending/);
  assert.match(auth, /result.needsAccountChoice/);
  assert.match(auth, /Create a second account/);
  assert.match(store, /response\?\.created === true && response.user\?\.id/);
  assert.match(app, /rightRailLayout.visible && !nav.auth/);
  assert.doesNotMatch(auth, /radius\.xl/);
});

test("the profile dropdown and settings offer an account-bound selector", () => {
  assert.match(app, /label: "Switch account"/);
  assert.match(app, /accountAction: "switch"/);
  const settings = read("../screens/SettingsScreen.jsx");
  const selector = read("../features/signupOnboarding/AccountSwitcher.jsx");
  assert.match(settings, /<AccountSwitcher/);
  assert.match(selector, /expectedAccountId: sourceId/);
  assert.match(store, /result\?\.user\?\.id !== targetId/);
  assert.match(store, /accountMutationEpochRef.current !== epoch/);
});

test("the walkthrough saves both profile images with account-bound confirmation and an explicit discard choice", () => {
  assert.match(onboarding, /STEP \{step\} OF \{TOTAL_STEPS\}/);
  assert.match(onboarding, /pickPhoto\("banner"\)/);
  assert.match(onboarding, /pickPhoto\("avatar"\)/);
  assert.match(onboarding, /expectedAccountId: task.accountId/);
  assert.match(onboarding, /confirmSignupProfile\(result, task.accountId, patch\)/);
  assert.match(onboarding, /Finish setup without these changes/);
  assert.match(onboarding, /Cancel signup/);
  assert.doesNotMatch(onboarding, /void finish\("feed"\)/);
  assert.match(onboarding, /WelcomeGuide/);
  assert.match(onboarding, /controller.abort\(\)/);
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
