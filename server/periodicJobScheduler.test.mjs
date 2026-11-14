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

test("a failed recovery retry waits for the ordinary interval instead of looping forever", async () => {
  const clock = timers();
  const errors = [];
  let calls = 0;
  const scheduler = startPeriodicJob({
    run: async () => {
      calls += 1;
      throw new Error("provider remains unavailable");
    },
    report: (error, context) => errors.push({ message: error.message, ...context }),
    initialDelayMs: 30_000,
    intervalMs: 12 * 60 * 60_000,
    retryDelayMs: 15 * 60_000,
    ...clock,
  });

  assert.equal(await scheduler.trigger(), false);
  assert.equal(clock.once.length, 2, "the failed scheduled run gets one recovery timer");
  await clock.once[1].callback();
  assert.equal(calls, 2);
  assert.deepEqual(errors, [
    { message: "provider remains unavailable", willRetry: true, retryDelayMs: 15 * 60_000 },
    { message: "provider remains unavailable", willRetry: false, retryDelayMs: null },
  ]);
  assert.equal(clock.once.length, 2, "the failed recovery cannot allocate another retry timer");

  await clock.repeating[0].callback();
  assert.equal(calls, 3, "the ordinary interval opens a new attempt window");
  assert.equal(clock.once.length, 3, "the new interval may schedule one fresh recovery retry");
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

test("a delayed first regular tick anchors the subsequent daily cadence", async () => {
  const clock = timers();
  const day = 24 * 60 * 60_000;
  let calls = 0;
  const scheduler = startPeriodicJob({
    run: async () => { calls += 1; },
    initialDelayMs: 5 * 60_000,
    intervalMs: day,
    initialIntervalDelayMs: 6 * 60 * 60_000,
    ...clock,
  });
  try {
    assert.deepEqual(clock.once.map(({ delay }) => delay), [5 * 60_000, 6 * 60 * 60_000]);
    assert.equal(clock.repeating.length, 0, "the ordinary daily interval must not start at process startup");
    await clock.once[0].callback();
    assert.equal(calls, 1, "the independent startup check still runs");
    assert.equal(clock.repeating.length, 0);
    await clock.once[1].callback();
    assert.equal(calls, 2);
    assert.equal(clock.repeating.length, 1);
    assert.equal(clock.repeating[0].delay, day);
    assert.equal(await clock.once[1].callback(), false, "a duplicate delayed-start callback cannot create another cadence");
    assert.equal(clock.repeating.length, 1);
    await clock.repeating[0].callback();
    assert.equal(calls, 3);
  } finally { await scheduler.stop(); }
});

test("the aligned regular tick gets one retry before waiting for its daily interval", async () => {
  const clock = timers();
  const reports = [];
  let calls = 0;
  const scheduler = startPeriodicJob({
    run: async () => {
      calls += 1;
      if (calls > 1) throw new Error("provider unavailable");
    },
    report: (_error, context) => reports.push(context),
    initialDelayMs: 5 * 60_000,
    intervalMs: 24 * 60 * 60_000,
    initialIntervalDelayMs: 6 * 60 * 60_000,
    retryDelayMs: 15 * 60_000,
    ...clock,
  });
  try {
    await clock.once[0].callback();
    assert.equal(await clock.once[1].callback(), false);
    assert.equal(calls, 2);
    assert.equal(clock.once[2].delay, 15 * 60_000);
    await clock.once[2].callback();
    assert.equal(calls, 3);
    assert.equal(clock.once.length, 3, "failed recovery cannot create another short retry");
    assert.deepEqual(reports.map(({ willRetry }) => willRetry), [true, false]);
    await clock.repeating[0].callback();
    assert.equal(calls, 4);
    assert.equal(clock.once.length, 4, "the next daily slot opens one fresh recovery window");
  } finally { await scheduler.stop(); }
});

test("stopping before an aligned regular tick prevents a stale callback from recreating timers", async () => {
  const clock = timers();
  let calls = 0;
  const scheduler = startPeriodicJob({
    run: async () => { calls += 1; },
    initialDelayMs: 5 * 60_000,
    intervalMs: 24 * 60 * 60_000,
    initialIntervalDelayMs: 6 * 60 * 60_000,
    ...clock,
  });

  await scheduler.stop();
  assert.deepEqual(clock.clearedOnce, clock.once);
  assert.deepEqual(clock.clearedRepeating, []);
  assert.equal(await clock.once[0].callback(), false);
  assert.equal(await clock.once[1].callback(), false);
  assert.equal(clock.repeating.length, 0);
  assert.equal(calls, 0);
});

test("stopping after alignment clears the new daily timer and waits for its active run", async () => {
  const clock = timers();
  const gate = deferred();
  let calls = 0;
  const scheduler = startPeriodicJob({
    run: async () => { calls += 1; await gate.promise; },
    initialDelayMs: 5 * 60_000,
    intervalMs: 24 * 60 * 60_000,
    initialIntervalDelayMs: 6 * 60 * 60_000,
    ...clock,
  });

  const active = clock.once[1].callback();
  await Promise.resolve();
  let stopped = false;
  const stopping = scheduler.stop().then(() => { stopped = true; });
  await Promise.resolve();
  assert.equal(stopped, false);
  assert.deepEqual(clock.clearedOnce, [clock.once[0]]);
  assert.deepEqual(clock.clearedRepeating, [clock.repeating[0]]);
  assert.equal(await clock.once[1].callback(), false);
  assert.equal(await clock.repeating[0].callback(), false);
  gate.resolve();
  await stopping;
  await active;
  assert.equal(stopped, true);
  assert.equal(calls, 1);
  assert.equal(clock.repeating.length, 1);
});

test("absent, invalid, and full-interval alignment preserves the existing timer setup", async () => {
  const day = 24 * 60 * 60_000;
  for (const initialIntervalDelayMs of [undefined, null, 0, -1, NaN, Infinity, day, day * 2]) {
    const clock = timers();
    const scheduler = startPeriodicJob({
      run() {}, initialDelayMs: 5 * 60_000, intervalMs: day, initialIntervalDelayMs, ...clock,
    });
    assert.equal(clock.once.length, 1);
    assert.equal(clock.repeating.length, 1);
    assert.equal(clock.repeating[0].delay, day);
    await scheduler.stop();
  }
  const clock = timers();
  const scheduler = startPeriodicJob({
    run() {}, initialDelayMs: 0, intervalMs: day, initialIntervalDelayMs: 0.1, ...clock,
  });
  assert.equal(clock.once[1].delay, 1_000, "positive alignment has a bounded minimum instead of spinning");
  await scheduler.stop();
});
