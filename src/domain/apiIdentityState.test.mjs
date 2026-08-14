import assert from "node:assert/strict";
import test from "node:test";
import { apiIdentityBarrierDecision } from "./apiIdentityState.mjs";

test("a locked established account is rejected instead of replayed under the next identity", () => {
  assert.equal(apiIdentityBarrierDecision({ accountId: "u_a", ready: false }), "reject");
  assert.equal(apiIdentityBarrierDecision({ accountId: null, ready: false }), "wait");
  assert.equal(apiIdentityBarrierDecision({ accountId: "u_b", ready: true }), "proceed");
  assert.equal(apiIdentityBarrierDecision({ accountId: "u_a", ready: false }, { expectedAccountId: "u_a" }), "proceed");
  assert.equal(apiIdentityBarrierDecision({ accountId: "u_a", ready: false }, { skipIdentityCheck: true }), "proceed");
});
