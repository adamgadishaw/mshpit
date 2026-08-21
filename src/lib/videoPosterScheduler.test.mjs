import assert from "node:assert/strict";
import test from "node:test";
import {
  createVideoPosterGenerationScheduler,
  markVideoPosterPermitUntil,
} from "./videoPosterScheduler.mjs";

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
};

const flush = async () => {
  for (let turn = 0; turn < 6; turn += 1) await Promise.resolve();
};

test("poster generation never exceeds the shared concurrency bound", async () => {
  const scheduler = createVideoPosterGenerationScheduler({ maxConcurrent: 2 });
  const gates = Array.from({ length: 5 }, deferred);
  const started = [];
  let running = 0;
  let peak = 0;
  const jobs = gates.map((gate, index) => scheduler.schedule(async () => {
    started.push(index);
    running += 1;
    peak = Math.max(peak, running);
    await gate.promise;
    running -= 1;
    return index;
  }));

  await flush();
  assert.deepEqual(started, [0, 1]);
  assert.deepEqual(scheduler.snapshot(), { active: 2, queued: 3, limit: 2 });

  gates[0].resolve();
  await flush();
  assert.deepEqual(started, [0, 1, 2]);
  gates[1].resolve();
  gates[2].resolve();
  await flush();
  assert.deepEqual(started, [0, 1, 2, 3, 4]);
  gates[3].resolve();
  gates[4].resolve();
  assert.deepEqual(await Promise.all(jobs), [0, 1, 2, 3, 4]);
  await flush();
  assert.equal(peak, 2);
  assert.deepEqual(scheduler.snapshot(), { active: 0, queued: 0, limit: 2 });
});

test("an aborted queued poster never starts and does not consume a slot", async () => {
  const scheduler = createVideoPosterGenerationScheduler({ maxConcurrent: 1 });
  const gate = deferred();
  const first = scheduler.schedule(() => gate.promise);
  const controller = new AbortController();
  let secondStarted = false;
  const second = scheduler.schedule(() => {
    secondStarted = true;
  }, { signal: controller.signal });

  controller.abort();
  await assert.rejects(second, { code: "PIT_POSTER_ABORTED" });
  assert.equal(secondStarted, false);
  assert.deepEqual(scheduler.snapshot(), { active: 1, queued: 0, limit: 1 });
  gate.resolve("done");
  assert.equal(await first, "done");
  await flush();
  assert.deepEqual(scheduler.snapshot(), { active: 0, queued: 0, limit: 1 });
});

test("a failed poster releases its slot for the next queued job", async () => {
  const scheduler = createVideoPosterGenerationScheduler({ maxConcurrent: 1 });
  const expected = new Error("decode failed");
  const first = scheduler.schedule(() => Promise.reject(expected));
  const second = scheduler.schedule(() => "next");
  await assert.rejects(first, expected);
  assert.equal(await second, "next");
  await flush();
  assert.deepEqual(scheduler.snapshot(), { active: 0, queued: 0, limit: 1 });
});

test("rapid running aborts retain permits until non-cancellable poster work settles", async () => {
  const scheduler = createVideoPosterGenerationScheduler({ maxConcurrent: 2 });
  const controllers = Array.from({ length: 6 }, () => new AbortController());
  const workGates = Array.from({ length: 6 }, deferred);
  const started = [];
  let underlying = 0;
  let peakUnderlying = 0;

  const jobs = controllers.map((controller, index) => scheduler.schedule(() => {
    started.push(index);
    underlying += 1;
    peakUnderlying = Math.max(peakUnderlying, underlying);

    const callerResult = new Promise((resolve, reject) => {
      const onAbort = () => reject(Object.assign(new Error("cancelled"), { code: "PIT_POSTER_ABORTED" }));
      controller.signal.addEventListener("abort", onAbort, { once: true });
      workGates[index].promise.then(resolve, reject);
    });
    const workSettled = workGates[index].promise.then(
      () => { underlying -= 1; },
      () => { underlying -= 1; },
    );
    return markVideoPosterPermitUntil(callerResult, workSettled);
  }, { signal: controller.signal }));
  const observed = jobs.map((job) => job.then(
    (value) => ({ status: "fulfilled", value }),
    (error) => ({ status: "rejected", error }),
  ));

  await flush();
  assert.deepEqual(started, [0, 1]);
  assert.equal(underlying, 2);

  for (const wave of [[0, 1], [2, 3], [4, 5]]) {
    wave.forEach((index) => controllers[index].abort());
    await flush();
    for (const index of wave) {
      const outcome = await observed[index];
      assert.equal(outcome.status, "rejected");
      assert.equal(outcome.error.code, "PIT_POSTER_ABORTED");
    }
    assert.equal(underlying, 2, "aborting callers must not free native work permits");
    assert.equal(peakUnderlying, 2);

    const expectedBeforeRelease = wave[1] + 1;
    assert.deepEqual(started, Array.from({ length: expectedBeforeRelease }, (_, index) => index));
    workGates[wave[0]].resolve();
    workGates[wave[1]].resolve();
    await flush();
  }

  await Promise.all(observed);
  assert.equal(underlying, 0);
  assert.equal(peakUnderlying, 2);
  assert.deepEqual(started, [0, 1, 2, 3, 4, 5]);
  assert.deepEqual(scheduler.snapshot(), { active: 0, queued: 0, limit: 2 });
});
