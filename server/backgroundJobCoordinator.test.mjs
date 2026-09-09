import assert from "node:assert/strict";
import test from "node:test";

import { createBackgroundJobCoordinator } from "./backgroundJobCoordinator.js";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

test("maintenance background jobs run FIFO and never overlap", async () => {
  const run = createBackgroundJobCoordinator();
  const firstGate = deferred();
  const order = [];
  let active = 0;
  let maximumActive = 0;

  const first = run(async () => {
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    order.push("tour:start");
    await firstGate.promise;
    order.push("tour:end");
    active -= 1;
  });
  const second = run(async () => {
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    order.push("cache:start");
    await Promise.resolve();
    order.push("cache:end");
    active -= 1;
  });

  await Promise.resolve();
  assert.deepEqual(order, ["tour:start"], "the later timer waits behind the active job");
  firstGate.resolve();
  await Promise.all([first, second]);

  assert.equal(maximumActive, 1);
  assert.deepEqual(order, ["tour:start", "tour:end", "cache:start", "cache:end"]);
});

test("a rejected job reaches its safe boundary and does not poison the queue", async () => {
  const run = createBackgroundJobCoordinator();
  const expected = new Error("provider unavailable");
  const first = run(async () => { throw expected; });
  const second = run(async () => "continued");

  await assert.rejects(first, (error) => error === expected);
  assert.equal(await second, "continued");
});

test("a synchronous throw releases the coordinator for the next job", async () => {
  const run = createBackgroundJobCoordinator();
  await assert.rejects(run(() => { throw new Error("sync failure"); }), /sync failure/);
  assert.equal(await run(() => 42), 42);
});

test("memory pressure defers maintenance before work starts and does not poison later attempts", async () => {
  let available = false;
  let releases = 0;
  const run = createBackgroundJobCoordinator({ acquireMemoryLease: () =>
    available ? { release() { releases += 1; } } : null });
  let calls = 0;
  await assert.rejects(run(() => { calls += 1; }), { code: "MEMORY_PRESSURE" });
  assert.equal(calls, 0);
  available = true;
  assert.equal(await run(() => "recovered"), "recovered");
  await assert.rejects(run(() => { throw new Error("failed"); }), /failed/);
  assert.equal(releases, 2);
});

test("coordinator bounds pending work and retains its lease until actual task settlement", async () => {
  const gate = deferred();
  let released = false;
  const run = createBackgroundJobCoordinator({ maxPending: 1,
    acquireMemoryLease: () => ({ release() { released = true; } }) });
  const first = run(() => gate.promise);
  await Promise.resolve();
  await assert.rejects(run(() => {}), { code: "MEMORY_PRESSURE" });
  assert.equal(released, false);
  gate.resolve();
  await first;
  assert.equal(released, true);
  assert.equal(await run(() => "next"), "next");
});
