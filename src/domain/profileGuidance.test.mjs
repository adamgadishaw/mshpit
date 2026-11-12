import assert from "node:assert/strict";
import test from "node:test";
import { profileGuidance } from "./profileGuidance.mjs";
import { accountFormError as profileSaveError } from "./accountFormError.mjs";

test("guidance separates missing music from optional public details, not onboarding or verification", () => {
  const complete = { genres: ["Rock"], avatarUri: "https://media.example/avatar", bio: "Hi", home: { city: "Toronto" } };
  assert.deepEqual(profileGuidance({ ...complete, emailVerified: false, onboardingVersion: 0 }), { music: false, optional: [], visible: false });
  assert.deepEqual(profileGuidance({ ...complete, genres: [] }), { music: true, optional: [], visible: true });
  assert.deepEqual(profileGuidance({ genres: ["Rock"], bio: "  " }), { music: false, optional: ["a profile photo", "a bio", "your city"], visible: true });
  assert.equal(profileGuidance({ ...complete, genres: ["Rock", "Pop", "Jazz", "Metal"] }).music, true);
});

test("save feedback retains safe actionable API detail and hides internal server failures", () => {
  for (const message of ["That username is taken. Choose another one.", "You can change your username again on January 2.", "Keep the admin role tag in your username."]) {
    assert.equal(profileSaveError({ source: "api", status: 400, message, userMessage: "Check the request." }), message);
  }
  assert.equal(profileSaveError({ source: "api", status: 500, message: "SQL internal", userMessage: "Try again shortly." }), "Try again shortly.");
  assert.doesNotMatch(profileSaveError({ status: 503, message: "SQL internal" }), /SQL/);
  assert.match(profileSaveError({}), /edits are still here/);
  assert.equal(profileSaveError({ userMessage: "Reconnect and try again.", message: "fetch failed" }), "Reconnect and try again.");
});

test("media errors show trusted limits/formats and hide raw browser exceptions", () => {
  for (const [status, message] of [[413, "Choose a photo smaller than 12 MB."], [415, "Choose a JPEG, PNG, HEIC or WebP image."]]) {
    assert.equal(profileSaveError({ source: "api", status, message, userMessage: "Upload failed." }), message);
  }
  assert.equal(profileSaveError("internal canvas path /secret", "Choose another photo and try again."), "Choose another photo and try again.");
  assert.equal(profileSaveError(new Error("internal canvas path /secret"), "Choose another photo and try again."), "Choose another photo and try again.");
});
