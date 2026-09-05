import assert from "node:assert/strict";
import test from "node:test";
import { requestSignupOnboardingCompletion } from "./signupOnboardingApi.mjs";

test("signup onboarding completion is account-scoped and validates the response", async () => {
  const calls = [];
  const result = await requestSignupOnboardingCompletion({ accountId: "u_new", version: 1 }, {
    apiCall: async (...args) => {
      calls.push(args);
      return { ok: true, onboardingVersion: 1, user: { id: "u_new", onboardingVersion: 1 } };
    },
  });
  assert.equal(result.user.id, "u_new");
  assert.deepEqual(calls, [["/api/me/onboarding/complete", {
    method: "POST",
    body: { version: 1 },
    context: "Finishing account setup",
    expectedAccountId: "u_new",
  }]]);
});

test("signup onboarding completion rejects malformed or cross-account responses", async () => {
  await assert.rejects(
    requestSignupOnboardingCompletion({ accountId: "u_new", version: 1 }, {
      apiCall: async () => ({ ok: true, onboardingVersion: 1, user: { id: "u_other" } }),
    }),
    /response was invalid/,
  );
});
