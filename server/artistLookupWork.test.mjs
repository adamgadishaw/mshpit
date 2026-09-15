import assert from "node:assert/strict";
import test from "node:test";
import { createArtistLookupWork } from "./artistLookupWork.js";

test("successful misses cache briefly but expire and remain distinct from failures", async () => {
  let now = 1_000, calls = 0;
  const run = createArtistLookupWork({ clock: () => now, resultTtlMs: 100 });
  const work = async () => { calls += 1; return []; };
  assert.deepEqual(await run("missing", work), []);
  assert.deepEqual(await run("missing", work), []);
  assert.equal(calls, 1);
  now += 101;
  await run("missing", work);
  assert.equal(calls, 2);
  const outage = Object.assign(new Error("provider down"), { status: 503, retryAfterMs: 80_000 });
  const failing = async () => { calls += 1; throw outage; };
  await assert.rejects(run("unavailable", failing), (error) => error === outage);
  await assert.rejects(run("unavailable", failing), (error) => error === outage);
  assert.equal(calls, 3);
  now += 80_001;
  assert.deepEqual(await run("unavailable", work), []);
});

test("coalescing isolates caller cancellation and saves the result for remaining callers", async () => {
  const run = createArtistLookupWork();
  let release, sharedSignal, calls = 0;
  const controller = new AbortController();
  const work = (signal) => { calls += 1; sharedSignal = signal; return new Promise((resolve) => { release = resolve; }); };
  const first = run("same", work, { signal: controller.signal });
  const second = run("same", work);
  await Promise.resolve();
  controller.abort();
  await assert.rejects(first, { name: "AbortError" });
  assert.equal(sharedSignal.aborted, false);
  release([{ name: "Same" }]);
  assert.deepEqual(await second, [{ name: "Same" }]);
  assert.deepEqual(await run("same", work), [{ name: "Same" }]);
  assert.equal(calls, 1);
});

test("last caller leaving cancels provider work without poisoning a later lookup", async () => {
  const run = createArtistLookupWork();
  const controller = new AbortController();
  let signal;
  const pending = run("leaving", (workSignal) => {
    signal = workSignal;
    return new Promise((_resolve, reject) => workSignal.addEventListener("abort", () => reject(workSignal.reason), { once: true }));
  }, { signal: controller.signal });
  await Promise.resolve();
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(signal.aborted, true);
  assert.deepEqual(await run("leaving", async () => ["recovered"]), ["recovered"]);
});

test("capacity is reserved before remote work and settled cache size is capped", async () => {
  const run = createArtistLookupWork({ maxActive: 1, maxEntries: 2 });
  let release;
  const first = run("held", () => new Promise((resolve) => { release = resolve; }));
  await assert.rejects(run("overflow", async () => assert.fail("must not fetch")), { code: "queue_saturated" });
  release([]);
  await first;
  await run("second", async () => []);
  await run("third", async () => []);
  assert.deepEqual(run.status(), { active: 0, cached: 2 });
});

test("deadline includes waiting for capacity and aborts unfinished provider work", async () => {
  const run = createArtistLookupWork({ deadlineMs: 15 });
  await assert.rejects(run("slow", (signal) => new Promise((_resolve, reject) =>
    signal.addEventListener("abort", () => reject(signal.reason), { once: true }))),
  { name: "ArtistLookupTimeoutError", code: "provider_timeout" });
  assert.equal(run.status().active, 0);
});

test("already cancelled callers do not reuse or start work", async () => {
  const run = createArtistLookupWork();
  await run("known", async () => []);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(run("known", async () => assert.fail("must not run"), { signal: controller.signal }), { name: "AbortError" });
});

test("eight different lookups cap reservations and the ninth never reaches remote work", async () => {
  const run = createArtistLookupWork();
  const controllers = Array.from({ length: 8 }, () => new AbortController());
  const jobs = controllers.map((controller, index) => run("distinct-" + index, (signal) => new Promise((_resolve, reject) =>
    signal.addEventListener("abort", () => reject(signal.reason), { once: true })), { signal: controller.signal }));
  await assert.rejects(run("ninth", () => assert.fail("capacity must reject before work")), { code: "queue_saturated" });
  assert.equal(run.status().active, 8);
  controllers.forEach((controller) => controller.abort());
  await Promise.all(jobs.map((job) => assert.rejects(job, { name: "AbortError" })));
});

test("invalid limits cannot create an unbounded map or infinite eviction loop", () => {
  for (const options of [{ maxActive: Infinity }, { maxEntries: -1 }, { resultTtlMs: NaN }, { deadlineMs: 60_000 }]) {
    assert.throws(() => createArtistLookupWork(options), RangeError);
  }
});
