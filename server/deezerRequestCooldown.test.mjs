import assert from "node:assert/strict";
import test from "node:test";
import { createDeezerRequestCooldown } from "./deezerRequestCooldown.js";
import { PROVIDER_RETRY_AFTER_MAX_MS } from "./providerResponsePolicy.js";

function fixture() {
  let now = 10_000;
  const run = createDeezerRequestCooldown({ clock: () => now,
    unavailable: (retryAt, at) => Object.assign(new Error("cooldown"), { code: "circuit_open", retryAt, retryAfterMs: Math.max(0, retryAt - at) }),
  });
  return { run, time: value => { now = value; } };
}
const refusal = (status, retryAt) => Object.assign(new Error("actual provider reply"), { providerResponse: true, status, retryAt });
const cancelledWork = signal => new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));

for (const status of [429, 503]) test(`${status} Retry-After shares one absolute wait and one recovery probe`, async () => {
  const f = fixture(); let calls = 0, release;
  await assert.rejects(f.run(async () => { calls++; throw refusal(status, 130_000); }), { status });
  f.time(70_000);
  await assert.rejects(f.run(() => { calls++; }), error => error.retryAt === 130_000 && error.retryAfterMs === 60_000);
  f.time(130_000);
  const probe = f.run(() => { calls++; return new Promise(resolve => { release = resolve; }); });
  const concurrent = await Promise.allSettled(Array.from({ length: 31 }, () => f.run(() => { calls++; })));
  assert.ok(concurrent.every(result => result.status === "rejected" && result.reason.code === "circuit_open"));
  release("healthy"); assert.equal(await probe, "healthy");
  assert.equal(calls, 2); assert.equal(f.run.status().retryAt, null);
  assert.equal(await f.run(async () => "next"), "next");
});

test("malformed hints, no-header errors and caller cancellations cannot establish a provider cooldown", async () => {
  const f = fixture();
  for (const error of [refusal(503, null), refusal(503, NaN), refusal(503, Infinity), refusal(503, -1), refusal(503, 10_000),
    refusal(400, 130_000), Object.assign(new Error("caller timeout"), { status: 503, retryAt: 130_000 })]) {
    await assert.rejects(f.run(async () => { throw error; }), value => value === error);
    assert.equal(f.run.status().retryAt, null);
  }
  const controller = new AbortController();
  const pending = f.run(() => cancelledWork(controller.signal), { signal: controller.signal });
  controller.abort(new Error("caller left")); await assert.rejects(pending, error => error === controller.signal.reason);
  assert.equal(f.run.status().retryAt, null);
  await assert.rejects(f.run(() => assert.fail("already cancelled"), { signal: controller.signal }), error => error === controller.signal.reason);
});

test("a concrete cooldown survives cancellation before delivery and an aborted probe leaves recovery pending", async () => {
  const f = fixture(), controller = new AbortController();
  await assert.rejects(f.run(async () => {
    controller.abort(); throw refusal(429, 130_000);
  }, { signal: controller.signal }), { name: "AbortError" });
  assert.equal(f.run.status().retryAt, 130_000);
  f.time(130_000); const probeController = new AbortController();
  const probe = f.run(() => cancelledWork(probeController.signal), { signal: probeController.signal });
  probeController.abort(); await assert.rejects(probe, { name: "AbortError" });
  assert.deepEqual(f.run.status(), { retryAt: 130_000, probing: false });
  assert.equal(await f.run(async () => "recovered"), "recovered");
});

test("late successes cannot erase a newer refusal and shorter hints cannot shorten it", async () => {
  const f = fixture(); let releaseOld, failLate;
  const old = f.run(() => new Promise(resolve => { releaseOld = resolve; }));
  const late = f.run(() => new Promise((_, reject) => { failLate = reject; }));
  await assert.rejects(f.run(async () => { throw refusal(429, 130_000); }));
  releaseOld("older success"); await old; assert.equal(f.run.status().retryAt, 130_000);
  f.time(130_000); let releaseProbe;
  const probe = f.run(() => new Promise(resolve => { releaseProbe = resolve; }));
  failLate(refusal(503, 150_000)); await assert.rejects(late);
  f.time(160_000); releaseProbe("old probe success"); await probe;
  assert.equal(f.run.status().retryAt, 150_000, "even an expired newer refusal still requires a fresh probe");
  assert.equal(await f.run(async () => "new probe"), "new probe");
});

test("overlapping refusals use the longest bounded deadline on the original failure", async () => {
  const f = fixture(); let rejectShort;
  const short = f.run(() => new Promise((_, reject) => { rejectShort = reject; }));
  await assert.rejects(f.run(async () => { throw refusal(503, Number.MAX_SAFE_INTEGER); }));
  const deadline = 10_000 + PROVIDER_RETRY_AFTER_MAX_MS;
  assert.equal(f.run.status().retryAt, deadline);
  rejectShort(Object.freeze(refusal(429, 130_000)));
  await assert.rejects(short, error => error.status === 429 && error.retryAt === deadline);
});
