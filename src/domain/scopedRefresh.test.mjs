import assert from "node:assert/strict";
import test from "node:test";

import { createScopedRefreshCoordinator, refreshScope } from "./scopedRefresh.mjs";

test("a new pull aborts its predecessor and only the current request can settle", () => {
  const coordinator = createScopedRefreshCoordinator("account-a::refresh:show:one");
  const first = coordinator.start("account-a::refresh:show:one");
  const second = coordinator.start("account-a::refresh:show:one");

  assert.equal(first.controller.signal.aborted, true);
  assert.equal(coordinator.isCurrent(first), false);
  assert.equal(coordinator.settle(first), false);
  assert.equal(coordinator.isCurrent(second), true);
  assert.equal(coordinator.settle(second), true);
});

test("an account or target change aborts the old refresh generation", () => {
  const coordinator = createScopedRefreshCoordinator();
  const accountA = coordinator.start(refreshScope("account-a", "profile", "member"));
  coordinator.cancel(refreshScope("account-b", "profile", "member"));

  assert.equal(accountA.controller.signal.aborted, true);
  assert.equal(coordinator.isCurrent(accountA), false);
  assert.notEqual(
    refreshScope("account-a", "profile", "member"),
    refreshScope("account-b", "profile", "member"),
  );
  assert.notEqual(
    refreshScope("account-a", "profile", "member"),
    refreshScope("account-a", "profile", "other"),
  );
});
