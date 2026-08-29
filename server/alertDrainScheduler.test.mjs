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
