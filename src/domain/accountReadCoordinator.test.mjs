import assert from "node:assert/strict";
import test from "node:test";

import { accountScopeFor, createAccountReadCoordinator } from "./accountReadCoordinator.mjs";

test("only signed-in identities receive an account-private read scope", () => {
  assert.equal(accountScopeFor(null), null);
  assert.equal(accountScopeFor({}), null);
  assert.equal(accountScopeFor({ id: "u_1", role: "fan" }), "u_1");
});

test("the newest account read wins and another account cannot reuse it", () => {
  const reads = createAccountReadCoordinator();
  const first = reads.claim("friends", { id: "u_1" });
  const second = reads.claim("friends", { id: "u_1" });
  assert.equal(reads.isCurrent(first, { id: "u_1" }), false);
  assert.equal(reads.isCurrent(second, { id: "u_1" }), true);
  assert.equal(reads.isCurrent(second, { id: "u_2" }), false);
});

test("reset prevents a response from reviving after the same account signs back in", () => {
  const reads = createAccountReadCoordinator();
  const abandoned = reads.claim("friends", { id: "u_1" });
  reads.reset();
  const fresh = reads.claim("friends", { id: "u_1" });
  assert.equal(reads.isCurrent(abandoned, { id: "u_1" }), false);
  assert.equal(reads.isCurrent(fresh, { id: "u_1" }), true);
});

test("invalidation makes an in-flight snapshot stale", () => {
  const reads = createAccountReadCoordinator();
  const snapshot = reads.claim("friends", { id: "u_1" });
  assert.equal(reads.invalidate("friends", { id: "u_1" }), true);
  assert.equal(reads.isCurrent(snapshot, { id: "u_1" }), false);
  assert.equal(reads.invalidate("friends", null), false);
});
