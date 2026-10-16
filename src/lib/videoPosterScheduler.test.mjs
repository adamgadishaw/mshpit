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

test("editor cover cancellation shares the feed limit until native decoder cleanup settles", async () => {
  const { registerHooks } = await import("node:module");
  const { scheduleVideoPosterGeneration } = await import("./videoPosterScheduler.mjs");
  const nativePosterUrl = new URL("./videoPoster.native.js", import.meta.url).href;
  const nativeCoverUrl = new URL("./mediaEditVideoCover.native.js", import.meta.url).href;
  const fixtureKey = "__pitNativeCoverSchedulerFixture";
  const native = { alive: 0, peak: 0, released: 0, filesDeleted: 0, gates: [] };
  const settleTurns = async () => { for (let turn = 0; turn < 30; turn += 1) await Promise.resolve(); };
  globalThis[fixtureKey] = native;
  native.createVideoPlayer = () => {
    native.alive += 1;
    native.peak = Math.max(native.peak, native.alive);
    let released = false;
    return {
      status: "readyToPlay", duration: 10, muted: false,
      generateThumbnailsAsync() {
        const gate = deferred();
        native.gates.push(gate);
        return gate.promise;
      },
      release() {
        assert.equal(released, false, "a player is released once");
        released = true;
        native.alive -= 1;
        native.released += 1;
      },
    };
  };
  const fixture = `globalThis.${fixtureKey}`;
  const stubs = {
    "expo-video": `export const createVideoPlayer = (...args) => ${fixture}.createVideoPlayer(...args);`,
    "expo-file-system": `export class File { constructor(uri) { this.uri = uri; } get exists() { return true; } get size() { return 64; } delete() { ${fixture}.filesDeleted++; } }`,
    "expo-image-manipulator": `export const SaveFormat = { JPEG: 'jpeg' }; export const ImageManipulator = { manipulate() { return { resize() {}, release() {}, async renderAsync() { return { release() {}, async saveAsync() { return { uri: 'file:///synthetic-cover.jpg', width: 320, height: 320 }; } }; } }; } };`,
    "@shopify/react-native-skia": "export const Skia = {};",
  };
  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      if (context.parentURL === nativeCoverUrl && specifier === "./videoPoster") {
        return { shortCircuit: true, url: nativePosterUrl };
      }
      if (context.parentURL === nativePosterUrl && Object.hasOwn(stubs, specifier)) {
        return { shortCircuit: true, url: `data:text/javascript,${encodeURIComponent(stubs[specifier])}` };
      }
      return nextResolve(specifier, context);
    },
  });
  const controllers = [];
  const jobs = [];
  const feedGate = deferred();
  let feedStarted = false;
  try {
    // Actual cover + native poster modules; only native platform operations are
    // inert substitutes. No decoder, media file, or network request is opened.
    const { generateVideoCover } = await import(nativeCoverUrl);
    for (let index = 0; index < 6; index += 1) {
      const controller = new AbortController();
      controllers.push(controller);
      const job = generateVideoCover({ uri: `file:///synthetic-${index}.mp4`, durationMs: 10_000 }, {
        coverMode: "auto", signal: controller.signal,
      });
      const outcome = job.catch((error) => error);
      jobs.push(outcome);
      await settleTurns();
      controller.abort();
      assert.equal((await outcome).code, "PIT_POSTER_ABORTED");
    }
    assert.equal(native.alive, 2, "queued cancellations cannot create additional players");
    assert.equal(native.peak, 2);
    assert.equal(native.gates.length, 2);

    const feed = scheduleVideoPosterGeneration(() => {
      feedStarted = true;
      return feedGate.promise;
    });
    jobs.push(feed);
    await settleTurns();
    assert.equal(feedStarted, false, "feed and editor must share the same two permits");
    native.gates[0].resolve([]);
    await settleTurns();
    assert.equal(feedStarted, true);
    assert.equal(native.alive, 1);
    native.gates[1].resolve([]);
    feedGate.resolve();
    await feed;
    await settleTurns();
    assert.equal(native.alive, 0);
    assert.equal(native.released, 2);

    const asset = { uri: "file:///synthetic-retry.mp4", durationMs: 10_000 };
    const failed = generateVideoCover(asset, { coverMode: "manual", coverMs: 500 });
    const failure = failed.catch((error) => error);
    jobs.push(failure);
    await settleTurns();
    native.gates[2].resolve([]);
    assert.equal((await failure).code, "PIT_POSTER_FRAME_FAILED");
    await settleTurns();
    assert.equal(native.alive, 0);

    const retried = generateVideoCover(asset, { coverMode: "manual", coverMs: 500 });
    jobs.push(retried.catch(() => {}));
    await settleTurns();
    native.gates[3].resolve([{ width: 320, height: 320, actualTime: 0.5, release() {} }]);
    const cover = await retried;
    assert.equal(cover.actualTimeMs, 500);
    assert.equal(cover.release(), true);
    assert.equal(cover.release(), false);
    await settleTurns();
    assert.equal(native.alive, 0);
    assert.equal(native.released, 4);
    assert.equal(native.filesDeleted, 1);
  } finally {
    controllers.forEach((controller) => controller.abort());
    native.gates.forEach((gate) => gate.resolve([]));
    feedGate.resolve();
    await Promise.allSettled(jobs);
    await settleTurns();
    hooks.deregister();
    delete globalThis[fixtureKey];
  }
});

test("web editor covers join the shared poster scheduler before creating media work", async () => {
  const { registerHooks } = await import("node:module");
  const { scheduleVideoPosterGeneration } = await import("./videoPosterScheduler.mjs");
  const coverUrl = new URL("./mediaEditVideoCover.web.js", import.meta.url).href;
  let calls = 0;
  const fixtureKey = "__pitWebCoverSchedulerFixture";
  globalThis[fixtureKey] = () => {
    calls += 1;
    return Promise.resolve({ asset: { uri: "blob:synthetic-cover" }, timeMs: 300, durationMs: 10_000 });
  };
  const stub = `export const generateVideoPosterAsset = (...args) => globalThis.${fixtureKey}(...args); export const releaseVideoPosterAsset = () => true;`;
  const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
    if (context.parentURL === coverUrl && specifier === "./videoPoster") {
      return { shortCircuit: true, url: `data:text/javascript,${encodeURIComponent(stub)}` };
    }
    return nextResolve(specifier, context);
  } });
  const gates = [deferred(), deferred()];
  const feed = gates.map((gate) => scheduleVideoPosterGeneration(() => gate.promise));
  try {
    const { generateVideoCover } = await import(coverUrl);
    const controller = new AbortController();
    const cancelled = generateVideoCover({ uri: "blob:synthetic-video" }, { signal: controller.signal });
    await flush();
    assert.equal(calls, 0);
    controller.abort();
    await assert.rejects(cancelled, { code: "PIT_POSTER_ABORTED" });
    const retry = generateVideoCover({ uri: "blob:synthetic-video" });
    gates[0].resolve();
    const cover = await retry;
    assert.equal(calls, 1);
    assert.equal(cover.release(), true);
  } finally {
    gates.forEach((gate) => gate.resolve());
    await Promise.all(feed);
    await flush();
    hooks.deregister();
    delete globalThis[fixtureKey];
  }
});
