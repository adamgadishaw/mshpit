import assert from "node:assert/strict";
import test from "node:test";
import { createGoingIntentCoordinator } from "./goingIntent.mjs";

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

test("rapid Going intents reach the server in tap order and only the last remains current", async () => {
  const coordinator = createGoingIntentCoordinator();
  const firstGate = deferred();
  const calls = [];
  const first = coordinator.begin({
    accountId: "a", showKey: "show", desired: true,
    send: async () => { calls.push(true); await firstGate.promise; return { going: true }; },
  });
  const second = coordinator.begin({
    accountId: "a", showKey: "show", desired: false,
    send: async () => { calls.push(false); return { going: false }; },
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, [true]);
  assert.equal(coordinator.isLatest(first, "a"), false);
  assert.equal(coordinator.isLatest(second, "a"), true);
  firstGate.resolve();
  await Promise.all([first.result, second.result]);
  assert.deepEqual(calls, [true, false]);
});

test("account reset invalidates an in-flight completion and skips its queued write", async () => {
  const coordinator = createGoingIntentCoordinator();
  const gate = deferred();
  let queuedCalls = 0;
  const first = coordinator.begin({ accountId: "a", showKey: "show", desired: true, send: () => gate.promise });
  const second = coordinator.begin({
    accountId: "a", showKey: "show", desired: false,
    send: async () => { queuedCalls += 1; return { going: false }; },
  });
  await Promise.resolve();
  coordinator.reset();
  gate.resolve({ going: true });
  const [firstResult, secondResult] = await Promise.all([first.result, second.result]);
  assert.equal(firstResult.stale, true);
  assert.deepEqual(secondResult, { ok: false, stale: true, skipped: true });
  assert.equal(queuedCalls, 0);
  assert.equal(coordinator.isLatest(second, "b"), false);
});
