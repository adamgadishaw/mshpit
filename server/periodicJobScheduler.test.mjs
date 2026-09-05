import assert from "node:assert/strict";
import test from "node:test";

import { startPeriodicJob } from "./periodicJobScheduler.js";

function timers() {
  const once = [];
  const repeating = [];
  const clearedOnce = [];
  const clearedRepeating = [];
  const handle = (callback, delay) => ({ callback, delay, unref() {} });
  return {
    once,
    repeating,
    clearedOnce,
    clearedRepeating,
    setTimer(callback, delay) { const value = handle(callback, delay); once.push(value); return value; },
    clearTimer(value) { clearedOnce.push(value); },
    setRepeatingTimer(callback, delay) { const value = handle(callback, delay); repeating.push(value); return value; },
    clearRepeatingTimer(value) { clearedRepeating.push(value); },
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

test("periodic jobs coalesce overlapping ticks and shutdown waits for the active run", async () => {
  const clock = timers();
  const gate = deferred();
  let calls = 0;
  const scheduler = startPeriodicJob({
    run: async () => { calls += 1; await gate.promise; },
    initialDelayMs: 5,
    intervalMs: 60_000,
    ...clock,
  });

  const first = scheduler.trigger();
  const duplicate = scheduler.trigger();
  assert.equal(first, duplicate);
  await Promise.resolve();
  assert.equal(calls, 1);

  let stopped = false;
  const stopping = scheduler.stop().then(() => { stopped = true; });
  await Promise.resolve();
  assert.equal(stopped, false, "shutdown must not close shared resources while the job is active");
  gate.resolve();
  await stopping;
  assert.equal(stopped, true);
  assert.equal(await scheduler.trigger(), false);
  assert.deepEqual(clock.clearedOnce, [clock.once[0]]);
  assert.deepEqual(clock.clearedRepeating, [clock.repeating[0]]);
});

test("shutdown can cooperatively abort an active run and still await settlement", async () => {
  const clock = timers();
  let observedSignal = null;
  const reports = [];
  const scheduler = startPeriodicJob({
    run: ({ signal }) => new Promise((_resolve, reject) => {
      observedSignal = signal;
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    }),
    report: (error) => reports.push(error),
    initialDelayMs: 5,
    intervalMs: 60_000,
    ...clock,
  });

  const active = scheduler.trigger();
  await Promise.resolve();
  assert.equal(observedSignal?.aborted, false);
  await scheduler.stop({ abortActive: true });
  assert.equal(observedSignal.aborted, true);
  await active;
  assert.deepEqual(reports, [], "an expected cooperative stop is not reported as a failed job");
  assert.equal(await scheduler.trigger(), false);
});

test("a failed long-interval job gets one bounded retry and success clears it", async () => {
  const clock = timers();
  const errors = [];
  let calls = 0;
  const scheduler = startPeriodicJob({
    run: async () => {
      calls += 1;
      if (calls === 1) throw new Error("temporary provider outage");
    },
    report: (error) => errors.push(error.message),
    initialDelayMs: 30_000,
    intervalMs: 24 * 60 * 60_000,
    retryDelayMs: 15 * 60_000,
    ...clock,
  });

  assert.equal(await scheduler.trigger(), false);
  assert.deepEqual(errors, ["temporary provider outage"]);
  assert.equal(clock.once.length, 2);
  assert.equal(clock.once[1].delay, 15 * 60_000);
  await clock.once[1].callback();
  assert.equal(calls, 2);
  assert.equal(clock.once.length, 2, "a successful retry does not schedule another retry");
  await scheduler.stop();
});

test("false is a contained failure and retry timers do not fan out", async () => {
  const clock = timers();
  const scheduler = startPeriodicJob({
    run: () => false,
    report: () => { throw new Error("diagnostics down"); },
    initialDelayMs: 0,
    intervalMs: 60_000,
    retryDelayMs: 1_000,
    ...clock,
  });

  assert.equal(await scheduler.trigger(), false);
  assert.equal(await scheduler.trigger(), false);
  assert.equal(clock.once.length, 2, "the existing retry is reused instead of allocating another timer");
  await scheduler.stop();
});
