import assert from "node:assert/strict";
import test from "node:test";
import { createAccountTaskScope } from "./accountTaskScope.mjs";

test("device tasks require a mounted, matching signed-in account", () => {
  const scope = createAccountTaskScope();
  assert.equal(scope.begin("a"), null);
  scope.mount();
  assert.equal(scope.begin(null), null);
  scope.setAccount("a");
  assert.equal(scope.begin("b"), null);
  assert.equal(scope.begin("a").isCurrent(), true);
});

for (const boundary of ["logout", "switch", "unmount", "round-trip"]) {
  test(`${boundary} aborts every pending device task and never revives its result`, () => {
    const scope = createAccountTaskScope(); scope.setAccount("a"); scope.mount();
    const first = scope.begin("a"), second = scope.begin("a");
    if (boundary === "unmount") scope.dispose();
    else scope.setAccount(boundary === "logout" ? null : "b");
    if (boundary === "round-trip") scope.setAccount("a");
    assert.equal(first.controller.signal.aborted, true);
    assert.equal(second.isCurrent(), false);
    scope.setAccount("a"); scope.mount();
    assert.equal(first.isCurrent(), false);
    assert.equal(scope.begin("a").isCurrent(), true);
  });
}

test("manual cancellation retains scope ownership for busy-state cleanup", () => {
  const scope = createAccountTaskScope(); scope.setAccount("a"); scope.mount();
  const task = scope.begin("a"); task.controller.abort();
  assert.equal(task.isCurrent(), false);
  assert.equal(task.ownsScope(), true);
  task.finish();
});
