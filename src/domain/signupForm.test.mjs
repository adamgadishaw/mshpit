import assert from "node:assert/strict";
import test from "node:test";
import { SIGNUP_STEPS, signupAccountError, signupIdentityError, signupStepError, signupStepForField } from "./signupForm.mjs";

const done = { name: "Alex Fixture", handle: "alexfixture", email: "alex@example.test", password: "fixture-password1", genres: ["Rock"], ageBand: "18_plus", agreed: true };

test("signup has four short steps and each checks only its own answers", () => {
  assert.deepEqual(SIGNUP_STEPS, ["You", "Sign-in", "Music", "Finish"]);
  // Step one: name and username, before any email exists.
  assert.equal(signupStepError(1, { name: "Alex Fixture", handle: "alexfixture" }), null);
  assert.equal(signupStepError(1, { name: "", handle: "alexfixture" }).field, "name");
  assert.equal(signupStepError(1, { name: "Alex", handle: "alexfixture" }, { handle: "alexfixture", available: false }).field, "handle", "a taken username stops step one");
  assert.equal(signupStepError(1, { name: "Alex", handle: "al", artistIntent: { artistName: "X" } }).field, "artistName");
  // Step two: sign-in details.
  assert.equal(signupStepError(2, { ...done, email: "nope" }).field, "email");
  assert.equal(signupStepError(2, { ...done, password: "short" }).field, "password");
  assert.equal(signupStepError(2, { ...done, genres: [] }), null, "music is not asked yet");
  // Step three: music, not age or terms yet.
  assert.equal(signupStepError(3, { ...done, genres: [] }).field, "genres");
  assert.equal(signupStepError(3, { ...done, ageBand: null, agreed: false }), null);
  // The last step checks everything.
  assert.equal(signupStepError(4, { ...done, agreed: false }).field, "agreed");
  assert.equal(signupStepError(4, { ...done, email: "" }).field, "email");
  assert.equal(signupStepError(4, done), null);
});

test("a problem sends the member back to the step that asks for it", () => {
  assert.deepEqual(["name", "handle", "artistName", "email", "password", "currentPassword", "genres", "ageBand", "agreed", "unknown"].map(signupStepForField),
    [1, 1, 1, 2, 2, 2, 3, 4, 4, 1]);
});

test("the combined account check keeps its order", () => {
  assert.equal(signupAccountError({ name: "", handle: "x", email: "", password: "" }).field, "name");
  assert.equal(signupAccountError({ ...done, email: "" }, { handle: "alexfixture", available: false }).field, "email");
  assert.equal(signupAccountError(done, { handle: "alexfixture", available: false }).field, "handle");
  assert.equal(signupIdentityError({ name: "Alex", handle: "alexfixture" }, { handle: "someoneelse", available: false }), null);
});
