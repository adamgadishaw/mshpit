import assert from "node:assert/strict";
import test from "node:test";

import { verificationPromptCopy, verifiedMutationDecision } from "./emailVerificationUx.mjs";

test("verification-first mutations preserve guest auth and verified access", () => {
  assert.equal(verifiedMutationDecision(null), "authenticate");
  assert.equal(verifiedMutationDecision({}), "authenticate");
  assert.equal(verifiedMutationDecision({ id: "member", emailVerified: false }), "verify");
  assert.equal(verifiedMutationDecision({ id: "member", emailVerified: true }), "allow");
  assert.equal(verifiedMutationDecision({ id: "legacy" }), "allow");
});

test("verification prompts are action-specific and do not echo unknown input", () => {
  assert.match(verificationPromptCopy("post").title, /post/i);
  assert.match(verificationPromptCopy("artist").body, /artist page/i);
  assert.match(verificationPromptCopy("report").body, /safety report/i);
  const fallback = verificationPromptCopy("<private user text>");
  assert.match(fallback.title, /confirm your email/i);
  assert.doesNotMatch(`${fallback.title} ${fallback.body}`, /private user text/i);
});
