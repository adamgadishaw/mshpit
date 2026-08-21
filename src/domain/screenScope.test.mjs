import assert from "node:assert/strict";
import test from "node:test";
import { accountTargetScope, isCurrentScreenRequest, scopedScreenValue } from "./screenScope.mjs";

test("account-target scopes change across either identity boundary", () => {
  const aliceProfile = accountTargetScope("alice", "profile:alice");
  assert.notEqual(aliceProfile, accountTargetScope("bob", "profile:alice"));
  assert.notEqual(aliceProfile, accountTargetScope("alice", "profile:bob"));
  assert.equal(aliceProfile, accountTargetScope(" alice ", "profile:alice"));
});

test("scoped values are hidden synchronously after an account or target change", () => {
  const state = { scope: accountTargetScope("alice", "dm:bob"), value: "private draft" };
  assert.equal(scopedScreenValue(state, accountTargetScope("alice", "dm:bob"), ""), "private draft");
  assert.equal(scopedScreenValue(state, accountTargetScope("charlie", "dm:bob"), ""), "");
  assert.equal(scopedScreenValue(state, accountTargetScope("alice", "dm:charlie"), ""), "");
});

test("screen requests require the same sequence, account scope, and target", () => {
  const request = { sequence: 4, scope: accountTargetScope("alice", "search"), target: "bjork" };
  assert.equal(isCurrentScreenRequest(request, { ...request }), true);
  assert.equal(isCurrentScreenRequest(request, { ...request, sequence: 5 }), false);
  assert.equal(isCurrentScreenRequest(request, { ...request, scope: accountTargetScope("bob", "search") }), false);
  assert.equal(isCurrentScreenRequest(request, { ...request, target: "beyonce" }), false);
});
