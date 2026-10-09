import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";

import { createMusicBrainzRequestThrottle } from "./musicBrainzRequestThrottle.js";
import { PROVIDER_RETRY_AFTER_MAX_MS } from "./providerResponsePolicy.js";

test("provider Retry-After immediately pauses all callers for the requested bounded interval", async () => {
  let now = 1_000, calls = 0;
  const run = createMusicBrainzRequestThrottle({ clock: () => now, wait: async (ms) => { now += ms; } });
  const error = Object.assign(new Error("maintenance"), { status: 503, retryAfterMs: 120_000 });
  await assert.rejects(run(async () => { calls += 1; throw error; }), { status: 503 });
  assert.equal(run.status().retryAt, 121_000);
  await assert.rejects(run(async () => { calls += 1; }), { code: "circuit_open" });
  assert.equal(calls, 1);
  now = 121_000;
  assert.equal(await run(async () => "recovered"), "recovered");
});

test("absolute Retry-After from a background feature protects every MusicBrainz caller", async () => {
  let now = 10_000, calls = 0;
  const run = createMusicBrainzRequestThrottle({ clock: () => now, wait: async (ms) => { now += ms; } });
  const error = Object.assign(new Error("memorial provider unavailable"), { status: 503, retryAt: now + 120_000 });
  await assert.rejects(run(async () => { calls++; throw error; }), { status: 503 });
  assert.equal(run.status().retryAt, 130_000);
  await assert.rejects(run(async () => { calls++; }, { priority: "interactive" }), { code: "circuit_open" });
  assert.equal(calls, 1);
});

test("an absolute deadline takes precedence over its stale relative hint", async () => {
  let now = 10_000;
  const retryAt = now + 7_200_000;
  const run = createMusicBrainzRequestThrottle({ clock: () => now });
  await assert.rejects(run(async () => {
    now += 60_000;
    throw Object.assign(new Error("response received earlier"), { status: 503, retryAt, retryAfterMs: 7_200_000 });
  }), { status: 503 });
  assert.equal(run.status().retryAt, retryAt);
  await assert.rejects(run(async () => assert.fail("still paused")), (error) => error.retryAt === retryAt && error.retryAfterMs === 7_140_000);
});

test("unbounded provider hints become one finite 24-hour wait", async () => {
  const now = 10_000;
  const run = createMusicBrainzRequestThrottle({ clock: () => now });
  await assert.rejects(run(async () => { throw Object.assign(new Error("huge wait"), { status: 429, retryAt: Number.MAX_SAFE_INTEGER }); }), { status: 429 });
  assert.equal(run.status().retryAt, now + PROVIDER_RETRY_AFTER_MAX_MS);
});

test("a durable deadline added during pacing is checked again before dispatch", async () => {
  let now = 10_000, deadline = 0, outbound = 0;
  const retryAt = now + 7_200_000;
  const run = createMusicBrainzRequestThrottle({
    clock: () => now,
    wait: async (ms) => { deadline = retryAt; now += ms; },
    cooldownStore: { readDeadline: () => deadline, extendDeadline: (value) => { deadline = Math.max(deadline, value); return deadline; } },
  });
  await run(async () => { outbound += 1; });
  await assert.rejects(run(async () => { outbound += 1; }), { code: "circuit_open" });
  assert.equal(outbound, 1);
  assert.equal(run.status().retryAt, retryAt);
  assert.equal(run.status().consecutiveFailures, 0, "a local rejection is not another provider failure");
});

test("a late successful half-open probe cannot erase another process's newer wait", async () => {
  let now = 10_000, deadline = 0;
  const run = createMusicBrainzRequestThrottle({
    clock: () => now,
    cooldownStore: { readDeadline: () => deadline, extendDeadline: (value) => { deadline = Math.max(deadline, value); return deadline; } },
  });
  await assert.rejects(run(async () => { throw Object.assign(new Error("first refusal"), { status: 429 }); }), { status: 429 });
  now = deadline;
  let release, started;
  const held = new Promise((resolve) => { release = resolve; });
  const entered = new Promise((resolve) => { started = resolve; });
  const probe = run(async () => { started(); await held; return "probe finished"; });
  await entered;
  deadline = now + 7_200_000;
  release();
  assert.equal(await probe, "probe finished");
  await assert.rejects(run(async () => assert.fail("newer wait must hold")), (error) => error.code === "circuit_open" && error.retryAt === deadline);
});

test("caller cancellation with a custom reason cannot open or persist a provider outage", async () => {
  let writes = 0;
  const controller = new AbortController();
  const reason = new Error("caller deadline");
  const run = createMusicBrainzRequestThrottle({
    cooldownStore: { readDeadline: () => 0, extendDeadline: () => { writes += 1; } },
    breakerFailureThreshold: 1,
  });
  await assert.rejects(run(async () => {
    controller.abort(reason);
    throw Object.assign(new Error("transport rejected after cancel"), { status: 502, code: "network" });
  }, { signal: controller.signal }), (error) => error === reason);
  assert.equal(writes, 0);
  assert.equal(run.status().consecutiveFailures, 0);
});

test("a received provider cooldown survives cancellation before the response error settles", async () => {
  const now = 10_000;
  let deadline = 0;
  const controller = new AbortController();
  const reason = new DOMException("caller left", "AbortError");
  const run = createMusicBrainzRequestThrottle({
    clock: () => now,
    cooldownStore: { readDeadline: () => deadline, extendDeadline: (value) => { deadline = value; return deadline; } },
  });
  const retryAt = now + 7_200_000;
  await assert.rejects(run(async () => {
    controller.abort(reason);
    throw Object.assign(new Error("actual response"), { status: 503, retryAt, providerResponse: true });
  }, { signal: controller.signal }), (error) => error === reason);
  assert.equal(deadline, retryAt);
  await assert.rejects(run(async () => assert.fail("other callers must respect the response")), { code: "circuit_open" });
});

test("a failed half-open probe exposes the effective longer circuit wait on the original failure", async () => {
  let now = 10_000;
  const run = createMusicBrainzRequestThrottle({ clock: () => now });
  await assert.rejects(run(async () => { throw Object.assign(new Error("initial refusal"), { status: 429 }); }), { status: 429 });
  now = run.status().retryAt;
  const cause = new Error("provider cause");
  const original = Object.assign(new Error("failed recovery probe", { cause }), { provider: "MusicBrainz", status: 503, code: "upstream_5xx" });
  await assert.rejects(run(async () => { throw original; }), (error) => error === original);
  const retryAt = now + 60_000;
  assert.equal(original.retryAt, retryAt);
  assert.equal(original.retryAfterMs, 60_000);
  assert.equal(original.cause, cause);
  assert.equal(original.status, 503);
  assert.equal(original.code, "upstream_5xx");
  assert.equal(original.provider, "MusicBrainz");
  now += 5_000;
  await assert.rejects(run(async () => assert.fail("probe cooldown is active")), (error) => error.retryAt === retryAt && error.retryAfterMs === 55_000);
  assert.equal(run.status().retryAt, retryAt);
});

test("the triggering rejection carries a newer durable deadline instead of its shorter provider hint", async () => {
  let now = 10_000, durable = 0;
  const retryAt = now + 120_000;
  const run = createMusicBrainzRequestThrottle({
    clock: () => now,
    cooldownStore: {
      readDeadline: () => durable,
      extendDeadline: () => { now += 5_000; durable = retryAt; return durable; },
    },
  });
  const original = Object.assign(new Error("short provider hint"), { status: 503, retryAt: now + 15_000, retryAfterMs: 15_000 });
  await assert.rejects(run(async () => { throw original; }), (error) => error === original);
  assert.equal(original.retryAt, retryAt);
  assert.equal(original.retryAfterMs, 115_000, "remaining delay uses error delivery time, not the earlier receipt");
  assert.equal(run.status().retryAt, retryAt);
});

test("immutable half-open failures preserve provider semantics while exposing the effective deadline", async () => {
  let now = 10_000;
  const run = createMusicBrainzRequestThrottle({ clock: () => now });
  await assert.rejects(run(async () => { throw Object.assign(new Error("initial refusal"), { status: 429 }); }), { status: 429 });
  now = run.status().retryAt;
  const cause = new Error("original cause");
  const original = Object.freeze(Object.assign(new Error("frozen recovery failure", { cause }), { name: "ProviderError", provider: "MusicBrainz", status: 503, code: "upstream_5xx" }));
  await assert.rejects(run(async () => { throw original; }), (error) => {
    assert.notEqual(error, original);
    assert.equal(error.name, original.name);
    assert.equal(error.message, original.message);
    assert.equal(error.status, original.status);
    assert.equal(error.code, original.code);
    assert.equal(error.cause, original.cause);
    assert.equal(error.retryAt, now + 60_000);
    assert.equal(error.retryAfterMs, 60_000);
    return true;
  });
});

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
