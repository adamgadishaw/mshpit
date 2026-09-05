import assert from "node:assert/strict";
import test from "node:test";
import { needsSignupOnboarding, SIGNUP_ONBOARDING_VERSION } from "./signupOnboarding.mjs";

test("only a verified account explicitly marked incomplete enters signup onboarding", () => {
  assert.equal(needsSignupOnboarding({ id: "new", emailVerified: true, onboardingVersion: 0 }), true);
  assert.equal(needsSignupOnboarding({ id: "new", emailVerified: false, onboardingVersion: 0 }), false);
  assert.equal(needsSignupOnboarding({ id: "done", emailVerified: true, onboardingVersion: SIGNUP_ONBOARDING_VERSION }), false);
});

test("legacy and signed-out sessions are not unexpectedly placed in onboarding", () => {
  assert.equal(needsSignupOnboarding(null), false);
  assert.equal(needsSignupOnboarding({ id: "legacy", emailVerified: true }), false);
  assert.equal(needsSignupOnboarding({ id: "unproven", onboardingVersion: 0 }), false);
  assert.equal(needsSignupOnboarding({ id: "bad", emailVerified: true, onboardingVersion: "0" }), false);
});
