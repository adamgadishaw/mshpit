import assert from "node:assert/strict";
import test from "node:test";

import { createAlertDrainScheduler } from "./alertDrainScheduler.js";

function controlledTasks() {
  const tasks = [];
  let unrefs = 0;
  return {
    tasks,
    unrefs: () => unrefs,
    scheduleTask(task) {
      tasks.push(task);
      return { unref() { unrefs += 1; } };
    },
  };
}

test("an error burst owns one pending alert timer and one digest drain", async () => {
  const clock = controlledTasks();
  let drains = 0;
  const scheduler = createAlertDrainScheduler({
    drain: async () => { drains += 1; },
    scheduleTask: clock.scheduleTask,
  });

  assert.equal(scheduler.schedule(), true);
  for (let index = 0; index < 100; index += 1) assert.equal(scheduler.schedule(), false);
  assert.equal(clock.tasks.length, 1);
  assert.equal(clock.unrefs(), 1);
  assert.deepEqual(scheduler.state(), { pending: true, draining: false, replayRequested: false });

  await clock.tasks.shift()();
  assert.equal(drains, 1);
  assert.deepEqual(scheduler.state(), { pending: false, draining: false, replayRequested: false });
});

test("an error recorded during delivery requests one replay without timer fan-out", async () => {
  const clock = controlledTasks();
  let releaseFirst;
  let drains = 0;
  const scheduler = createAlertDrainScheduler({
    drain: async () => {
      drains += 1;
      if (drains === 1) await new Promise((resolve) => { releaseFirst = resolve; });
    },
    scheduleTask: clock.scheduleTask,
  });

  scheduler.schedule();
  const firstDrain = clock.tasks.shift()();
  while (!releaseFirst) await new Promise((resolve) => setImmediate(resolve));
  for (let index = 0; index < 100; index += 1) scheduler.schedule();
  assert.equal(clock.tasks.length, 0);
  assert.deepEqual(scheduler.state(), { pending: true, draining: true, replayRequested: true });

  releaseFirst();
  await firstDrain;
  assert.equal(clock.tasks.length, 1, "all delivery-time requests collapse into one replay");
  await clock.tasks.shift()();
  assert.equal(drains, 2);
  assert.deepEqual(scheduler.state(), { pending: false, draining: false, replayRequested: false });
});

test("a failed alert drain clears the latch for later incidents", async () => {
  const clock = controlledTasks();
  const scheduler = createAlertDrainScheduler({
    drain: async () => { throw new Error("mail unavailable"); },
    scheduleTask: clock.scheduleTask,
  });

  scheduler.schedule();
  await clock.tasks.shift()();
  assert.equal(scheduler.state().pending, false);
  assert.equal(scheduler.schedule(), true);
  assert.equal(clock.tasks.length, 1);
});

test("only an eligible cooldown result owns one bounded wake-up", async () => {
  let now = 1000;
  const tasks = [];
  let drains = 0;
  const scheduler = createAlertDrainScheduler({
    clock: () => now,
    scheduleTask(task, delay) { const timer = { task, delay, unref() {} }; tasks.push(timer); return timer; },
    drain: async () => (++drains === 1
      ? { sent: false, reason: "cooling-down", retryAt: 6000 } : { sent: true }),
  });
  scheduler.schedule();
  await tasks.shift().task();
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].delay, 5000);
  for (let index = 0; index < 100; index += 1) assert.equal(scheduler.schedule(), false);
  assert.equal(tasks.length, 1);
  now = 6000;
  await tasks.shift().task();
  assert.equal(drains, 2);
  assert.equal(tasks.length, 0);
});

test("failed, disabled, empty and invalid deadline results never poll or retry themselves", async () => {
  for (const result of [
    { sent: false, reason: "provider-unavailable" },
    { sent: false, reason: "alert-failed" },
    { sent: false, reason: "disabled" },
    { sent: false, reason: "nothing-serious" },
    { sent: false, reason: "cooling-down", retryAt: 1000 },
    { sent: false, reason: "cooling-down", retryAt: Infinity },
  ]) {
    const tasks = [];
    const scheduler = createAlertDrainScheduler({
      clock: () => 1000, scheduleTask: (task) => { tasks.push(task); }, drain: async () => result,
    });
    scheduler.schedule();
    await tasks.shift()();
    assert.equal(tasks.length, 0, result.reason);
  }
});

test("long cooldowns cannot overflow Node timers into a hot loop", async () => {
  const tasks = [];
  const scheduler = createAlertDrainScheduler({
    clock: () => 1000,
    scheduleTask(task, delay) { tasks.push({ task, delay }); },
    drain: async () => ({ sent: false, reason: "cooling-down", retryAt: 9_000_000_000 }),
  });
  scheduler.schedule();
  await tasks.shift().task();
  assert.equal(tasks[0].delay, 2_147_483_647);
});

test("shutdown cancels a deferred wake-up and ignores its late callback", async () => {
  const tasks = [];
  const cancelled = [];
  let drains = 0;
  const scheduler = createAlertDrainScheduler({
    clock: () => 1000,
    scheduleTask(task, delay) { const timer = { task, delay }; tasks.push(timer); return timer; },
    cancelTask: (timer) => cancelled.push(timer),
    drain: async () => { drains += 1; return { sent: false, reason: "cooling-down", retryAt: 2000 }; },
  });
  scheduler.schedule();
  await tasks.shift().task();
  const deferred = tasks.shift();
  await scheduler.stop();
  assert.deepEqual(cancelled, [deferred]);
  await deferred.task();
  assert.equal(scheduler.schedule(), false);
  assert.equal(drains, 1);
  assert.deepEqual(scheduler.state(), { pending: false, draining: false, replayRequested: false });
});

test("shutdown waits for active delivery and cancels any requested replay", async () => {
  const tasks = [];
  let finish;
  const scheduler = createAlertDrainScheduler({
    scheduleTask: (task) => { tasks.push(task); },
    drain: () => new Promise((resolve) => { finish = resolve; }),
  });
  scheduler.schedule();
  const running = tasks.shift()();
  await Promise.resolve();
  scheduler.schedule();
  let stopped = false;
  const stop = scheduler.stop().then(() => { stopped = true; });
  await Promise.resolve();
  assert.equal(stopped, false);
  finish({ sent: false, reason: "cooling-down", retryAt: Date.now() + 30_000 });
  await Promise.all([running, stop]);
  assert.equal(stopped, true);
  assert.equal(tasks.length, 0);
});

test("a backwards clock preserves a still-future cooldown deadline", async () => {
  let now = 2000;
  const tasks = [];
  const scheduler = createAlertDrainScheduler({
    clock: () => now,
    scheduleTask(task, delay) { tasks.push({ task, delay }); },
    drain: async () => { now = 1000; return { sent: false, reason: "cooling-down", retryAt: 1500 }; },
  });
  scheduler.schedule();
  await tasks.shift().task();
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].delay, 500);
});

test("a deadline elapsed during a drain gets one immediate recheck without stale polling", async () => {
  let now = 1000;
  const tasks = [];
  const scheduler = createAlertDrainScheduler({
    clock: () => now,
    scheduleTask(task, delay) { tasks.push({ task, delay }); },
    drain: async () => { now = 2000; return { sent: false, reason: "cooling-down", retryAt: 1500 }; },
  });
  scheduler.schedule();
  await tasks.shift().task();
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].delay, 0);
  await tasks.shift().task();
  assert.equal(tasks.length, 0);
});
