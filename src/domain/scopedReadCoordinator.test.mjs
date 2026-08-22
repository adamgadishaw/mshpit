import test from "node:test";
import assert from "node:assert/strict";
import { createScopedReadCoordinator } from "./scopedReadCoordinator.mjs";

test("scoped read coordinators require an explicit scope policy", () => {
  assert.throws(() => createScopedReadCoordinator(), /scope function/);
});

test("scoped read coordinators isolate kinds, scopes, and reset epochs", () => {
  const coordinator = createScopedReadCoordinator((subject) => subject?.scope || null);
  assert.equal(coordinator.claim("profile", null), null);

  const profileA = coordinator.claim("profile", { scope: "a" });
  const inboxA = coordinator.claim("inbox", { scope: "a" });
  const profileB = coordinator.claim("profile", { scope: "b" });
  assert.equal(coordinator.isCurrent(profileA, { scope: "a" }), true);
  assert.equal(coordinator.isCurrent(inboxA, { scope: "a" }), true);
  assert.equal(coordinator.isCurrent(profileB, { scope: "b" }), true);
  assert.equal(coordinator.isCurrent(profileA, { scope: "b" }), false);

  assert.equal(coordinator.invalidate("profile", { scope: "a" }), true);
  assert.equal(coordinator.isCurrent(profileA, { scope: "a" }), false);
  assert.equal(coordinator.isCurrent(inboxA, { scope: "a" }), true);
  assert.equal(coordinator.invalidate("profile", null), false);

  coordinator.reset();
  assert.equal(coordinator.epoch, 1);
  assert.equal(coordinator.isCurrent(profileB, { scope: "b" }), false);
  const nextProfileB = coordinator.claim("profile", { scope: "b" });
  assert.equal(coordinator.isCurrent(nextProfileB, { scope: "b" }), true);
});
