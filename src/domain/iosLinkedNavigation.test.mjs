import assert from "node:assert/strict";
import test from "node:test";
import { createIOSLinkedNavigation } from "./iosLinkedNavigation.mjs";

function fixture() {
  const owner = createIOSLinkedNavigation();
  const scope = owner.account("A", 1);
  owner.mount();
  return { owner, scope };
}

test("one owner keeps only the latest claim and consumes it exactly once", () => {
  const { owner, scope } = fixture();
  const first = owner.begin(scope), second = owner.begin(scope);
  assert.equal(first.signal.aborted, true);
  assert.equal(owner.current(first), false);
  owner.release(first);
  assert.equal(owner.current(second), true);
  assert.equal(owner.consume(first), false);
  assert.equal(owner.consume(second), true);
  assert.equal(owner.consume(second), false);
});

test("navigation invalidates pending work and callbacks retained by the old route", () => {
  const { owner, scope } = fixture();
  const claim = owner.begin(scope);
  owner.invalidate();
  assert.equal(claim.signal.aborted, true);
  assert.equal(owner.begin(scope), null);
  const nextScope = owner.account("A", 1);
  assert.notEqual(nextScope, scope);
  assert.ok(owner.begin(nextScope));
});

test("A -> B -> A and same-ID reauthentication never restore old scope", () => {
  const { owner, scope } = fixture();
  const claim = owner.begin(scope);
  owner.account("B", 2);
  const again = owner.account("A", 3);
  assert.equal(claim.signal.aborted, true);
  assert.equal(owner.begin(scope), null);
  const second = owner.begin(again);
  const reauthenticated = owner.account("A", 4);
  assert.equal(second.signal.aborted, true);
  assert.equal(owner.begin(again), null);
  assert.ok(owner.begin(reauthenticated));
});

test("routine account renders keep pending lookup and deliberate retries remain available", () => {
  const { owner, scope } = fixture();
  const claim = owner.begin(scope);
  assert.equal(owner.account("A", 1), scope);
  assert.equal(owner.current(claim), true);
  owner.release(claim);
  assert.equal(owner.current(claim), false);
  assert.ok(owner.begin(scope));
});

test("unmount fences all work; StrictMode setup allows fresh work without reviving old claims", () => {
  const { owner, scope } = fixture();
  const claim = owner.begin(scope);
  owner.unmount();
  assert.equal(claim.signal.aborted, true);
  assert.equal(owner.begin(scope), null);
  assert.equal(owner.consume(claim), false);
  owner.mount();
  assert.equal(owner.current(claim), false);
  assert.ok(owner.begin(scope));
});
