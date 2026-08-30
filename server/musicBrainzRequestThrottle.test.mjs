import assert from "node:assert/strict";
import test from "node:test";

import { createMusicBrainzRequestThrottle } from "./musicBrainzRequestThrottle.js";

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
