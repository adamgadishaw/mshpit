import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";

import { createMusicBrainzRequestThrottle } from "./musicBrainzRequestThrottle.js";

test("a CLI process stays alive until its awaited queued MusicBrainz request completes", () => {
  const moduleUrl = new URL("./musicBrainzRequestThrottle.js", import.meta.url).href;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", `
    import { createMusicBrainzRequestThrottle } from ${JSON.stringify(moduleUrl)};
    const run = createMusicBrainzRequestThrottle();
    await run(async () => {});
    await run(async () => { process.stdout.write("second request completed"); });
  `], { encoding: "utf8", timeout: 10_000 });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "second request completed");
});

test("all callers share at least one second between MusicBrainz request starts", async () => {
  let now = 10_000;
  const waits = [];
  const starts = [];
  const run = createMusicBrainzRequestThrottle({
    minimumIntervalMs: 1_100,
    clock: () => now,
    wait: async (milliseconds) => {
      waits.push(milliseconds);
      now += milliseconds;
    },
  });

  await run(async () => { starts.push(now); });
  await run(async () => { starts.push(now); });
  assert.deepEqual(starts, [10_000, 11_100]);
  assert.deepEqual(waits, [1_100]);
});

test("a failed provider request does not remove the cooldown for the next feature", async () => {
  let now = 20_000;
  const starts = [];
  const run = createMusicBrainzRequestThrottle({
    clock: () => now,
    wait: async (milliseconds) => { now += milliseconds; },
  });
  await assert.rejects(run(async () => {
    starts.push(now);
    throw new Error("provider failed");
  }), /provider failed/);
  await run(async () => { starts.push(now); });
  assert.deepEqual(starts, [20_000, 21_100]);
});

test("an aborted queued request never reaches the provider", async () => {
  let release;
  const first = new Promise((resolve) => { release = resolve; });
  const run = createMusicBrainzRequestThrottle();
  const active = run(() => first);
  const controller = new AbortController();
  const queued = run(() => { throw new Error("aborted work must not run"); }, { signal: controller.signal });
  controller.abort(new DOMException("cancelled", "AbortError"));
  release();
  await active;
  await assert.rejects(queued, { name: "AbortError" });
});

test("admission control rejects excess work instead of retaining an unbounded outage queue", async () => {
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  const run = createMusicBrainzRequestThrottle({
    maxPendingRequests: 2,
    interactiveReservedSlots: 0,
    maxQueueWaitMs: 5_000,
  });
  const active = run(() => held);
  const queued = run(async () => "queued");
  await assert.rejects(
    run(async () => "must never be retained"),
    (error) => error?.name === "MusicBrainzThrottleError" && error?.code === "queue_saturated",
  );
  assert.deepEqual(run.status(), {
    active: true,
    queued: 1,
    capacity: 2,
    circuitOpen: false,
    retryAt: null,
    consecutiveFailures: 0,
  });
  release();
  assert.equal(await active, undefined);
  assert.equal(await queued, "queued");
});

test("a queued caller gets a bounded timeout while the active provider request is stuck", async () => {
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  const run = createMusicBrainzRequestThrottle({
    maxPendingRequests: 3,
    interactiveReservedSlots: 0,
    maxQueueWaitMs: 15,
  });
  const active = run(() => held);
  const queued = run(async () => "must not run");
  await assert.rejects(
    queued,
    (error) => error?.name === "MusicBrainzThrottleError" && error?.code === "queue_timeout",
  );
  assert.equal(run.status().queued, 0);
  release();
  await active;
});

test("two upstream failures open the circuit and one successful half-open probe restores service", async () => {
  let now = 50_000;
  let outbound = 0;
  const run = createMusicBrainzRequestThrottle({
    clock: () => now,
    wait: async (milliseconds) => { now += milliseconds; },
    breakerBaseMs: 30_000,
    breakerMaxMs: 30_000,
  });
  const unavailable = () => {
    outbound += 1;
    const error = new Error("upstream unavailable");
    error.status = 503;
    throw error;
  };
  await assert.rejects(run(unavailable), { status: 503 });
  await assert.rejects(run(unavailable), { status: 503 });
  assert.equal(outbound, 2);
  assert.equal(run.status().circuitOpen, true);
  await assert.rejects(
    run(async () => { outbound += 1; }),
    (error) => error?.code === "circuit_open",
  );
  assert.equal(outbound, 2, "an open circuit performs no provider request");

  now = run.status().retryAt;
  assert.equal(await run(async () => { outbound += 1; return "recovered"; }), "recovered");
  assert.equal(outbound, 3);
  assert.equal(run.status().circuitOpen, false);
  assert.equal(run.status().consecutiveFailures, 0);
});

test("a deterministic half-open response closes the outage circuit without hiding the response", async () => {
  let now = 60_000;
  const run = createMusicBrainzRequestThrottle({
    clock: () => now,
    wait: async (milliseconds) => { now += milliseconds; },
    breakerFailureThreshold: 1,
    breakerBaseMs: 30_000,
    breakerMaxMs: 30_000,
  });
  const outage = new Error("outage");
  outage.status = 503;
  await assert.rejects(run(async () => { throw outage; }), { status: 503 });
  now = run.status().retryAt;
  const notFound = new Error("not found");
  notFound.status = 404;
  await assert.rejects(run(async () => { throw notFound; }), { status: 404 });
  assert.equal(run.status().circuitOpen, false);
  assert.equal(run.status().consecutiveFailures, 0);
});

test("an aborted half-open probe cannot falsely close the provider outage circuit", async () => {
  let now = 65_000;
  let outbound = 0;
  const run = createMusicBrainzRequestThrottle({
    clock: () => now,
    wait: async (milliseconds) => { now += milliseconds; },
    breakerFailureThreshold: 1,
    breakerBaseMs: 30_000,
    breakerMaxMs: 30_000,
  });
  const outage = Object.assign(new Error("outage"), { status: 503 });
  await assert.rejects(run(async () => { outbound += 1; throw outage; }), { status: 503 });
  now = run.status().retryAt;
  await assert.rejects(
    run(async () => {
      outbound += 1;
      throw new DOMException("caller left", "AbortError");
    }),
    { name: "AbortError" },
  );
  assert.equal(run.status().consecutiveFailures, 1, "caller cancellation is not provider recovery evidence");
  await assert.rejects(run(async () => { outbound += 1; throw outage; }), { status: 503 });
  assert.equal(outbound, 3);
  assert.equal(run.status().circuitOpen, true, "the next bounded probe reopens the outage cooldown");
});

test("an explicit provider refusal opens the circuit immediately instead of fanning out", async () => {
  let now = 70_000;
  let outbound = 0;
  const run = createMusicBrainzRequestThrottle({
    clock: () => now,
    wait: async (milliseconds) => { now += milliseconds; },
    breakerBaseMs: 30_000,
    breakerMaxMs: 30_000,
  });
  const refused = Object.assign(new Error("provider refused this process"), {
    status: 403,
    code: "quota_or_forbidden",
  });
  await assert.rejects(run(async () => { outbound += 1; throw refused; }), { status: 403 });
  assert.equal(run.status().circuitOpen, true);
  await assert.rejects(
    run(async () => { outbound += 1; }),
    (error) => error?.code === "circuit_open",
  );
  assert.equal(outbound, 1, "queued and subsequent work performs no refused provider request");
});

test("interactive work advances ahead of queued background work without interrupting the active slot", async () => {
  let now = 80_000;
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  const order = [];
  const run = createMusicBrainzRequestThrottle({
    clock: () => now,
    wait: async (milliseconds) => { now += milliseconds; },
  });
  const active = run(async () => { order.push("active"); await held; });
  const background = run(async () => { order.push("background"); });
  const interactive = run(async () => { order.push("interactive"); }, { priority: "interactive" });
  release();
  await Promise.all([active, background, interactive]);
  assert.deepEqual(order, ["active", "interactive", "background"]);
});

test("background work cannot consume the slots reserved for interactive artist lookups", async () => {
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  const run = createMusicBrainzRequestThrottle({
    maxPendingRequests: 4,
    interactiveReservedSlots: 2,
    maxQueueWaitMs: 5_000,
  });
  const activeBackground = run(() => held);
  const queuedBackground = run(async () => "background");
  await assert.rejects(
    run(async () => "excess background"),
    (error) => error?.code === "queue_saturated",
  );
  const interactiveA = run(async () => "interactive-a", { priority: "interactive" });
  const interactiveB = run(async () => "interactive-b", { priority: "interactive" });
  await assert.rejects(
    run(async () => "excess interactive", { priority: "interactive" }),
    (error) => error?.code === "queue_saturated",
  );
  release();
  assert.deepEqual(
    await Promise.all([activeBackground, queuedBackground, interactiveA, interactiveB]),
    [undefined, "background", "interactive-a", "interactive-b"],
  );
});
