import assert from "node:assert/strict";
import test, { afterEach } from "node:test";

import {
  cancelVideoFinalizeJob,
  MAX_PENDING_VIDEO_FINALIZATIONS,
  resetVideoFinalizeJobsForTests,
  startVideoFinalizeJob,
  videoFinalizeState,
  videoFinalizeJobActive,
} from "./videoFinalizeJobs.js";

afterEach(() => resetVideoFinalizeJobsForTests());

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

test("owner-scoped cancellation aborts only the exact detached job and late completion cannot resurrect it", async () => {
  const gate = deferred();
  let jobSignal = null;
  const started = startVideoFinalizeJob({
    ownerId: "owner-a",
    assetId: "asset-a",
    fingerprint: "a".repeat(64),
    run: async ({ signal }) => {
      jobSignal = signal;
      // Deliberately ignore cancellation after admission. This models a storage
      // primitive that cannot be interrupted once dispatched.
      await gate.promise;
      return { asset: { id: "asset-a", status: "ready" } };
    },
  });
  await Promise.resolve();

  assert.equal(jobSignal?.aborted, false);
  assert.equal(cancelVideoFinalizeJob({ ownerId: "owner-b", assetId: "asset-a" }), false);
  assert.equal(cancelVideoFinalizeJob({ ownerId: "owner-a", assetId: "asset-b" }), false);
  assert.equal(jobSignal.aborted, false, "another owner or asset cannot stop this job");
  assert.equal(cancelVideoFinalizeJob({ ownerId: "owner-a", assetId: "asset-a" }), true);
  assert.equal(jobSignal.aborted, true);
  assert.deepEqual(videoFinalizeState({ ownerId: "owner-a", assetId: "asset-a" }), { state: "idle" });

  gate.resolve();
  await started.completion;
  assert.deepEqual(videoFinalizeState({ ownerId: "owner-a", assetId: "asset-a" }), { state: "idle" },
    "a non-cooperative late result cannot recreate cancelled coordinator state");
});

test("completed media remains completed and cannot be retroactively aborted", async () => {
  let jobSignal = null;
  const started = startVideoFinalizeJob({
    ownerId: "owner-ready",
    assetId: "asset-ready",
    fingerprint: "b".repeat(64),
    run: async ({ signal }) => {
      jobSignal = signal;
      return { asset: { id: "asset-ready", status: "ready" } };
    },
  });
  await started.completion;

  assert.equal(jobSignal.aborted, false);
  assert.deepEqual(videoFinalizeState({ ownerId: "owner-ready", assetId: "asset-ready" }), { state: "completed" });
  assert.equal(cancelVideoFinalizeJob({ ownerId: "owner-ready", assetId: "asset-ready" }), false);
  assert.equal(jobSignal.aborted, false);
  assert.deepEqual(videoFinalizeState({ ownerId: "owner-ready", assetId: "asset-ready" }), { state: "completed" });
});

test("the finalization queue bounds distinct jobs while full-queue retries join the exact existing job", async () => {
  const gate = deferred();
  const started = [];
  let ran = 0;
  const request = (index) => ({
    ownerId: `owner-${index}`, assetId: `asset-${index}`, fingerprint: "c".repeat(64),
    run: async () => { ran++; await gate.promise; return { asset: { status: "ready" } }; },
  });
  const isBusy = error => error.status === 503 && error.code === "MEDIA_STORAGE_UNAVAILABLE"
    && error.retryAfterMs === 20_000;
  try {
    for (let i = 0; i < MAX_PENDING_VIDEO_FINALIZATIONS; i++) started.push(startVideoFinalizeJob(request(i)));
    await Promise.resolve();
    assert.equal(ran, 1, "one converter runs while the rest wait");
    assert.throws(() => startVideoFinalizeJob(request(1000)), isBusy);
    assert.deepEqual(videoFinalizeState(request(1000)), { state: "idle" });
    const joined = startVideoFinalizeJob(request(0));
    assert.equal(joined.joined, true);
    assert.equal(joined.completion, started[0].completion);
    assert.throws(() => startVideoFinalizeJob({ ...request(0), fingerprint: "d".repeat(64) }),
      error => error.status === 409, "full capacity must not weaken conflicting-edit protection");
    assert.equal(cancelVideoFinalizeJob(request(1)), true);
    assert.throws(() => startVideoFinalizeJob(request(1001)), isBusy,
      "removing a queued job's public state cannot free its still-retained closure");
  } finally {
    gate.resolve();
    const results = await Promise.allSettled(started.map(job => job.completion));
    assert.equal(results.filter(result => result.status === "rejected").length, 1);
  }
  assert.equal(ran, MAX_PENDING_VIDEO_FINALIZATIONS - 1, "cancelled queued work never runs");
  assert.equal(videoFinalizeJobActive(), false);
  await startVideoFinalizeJob(request(1002)).completion;
  assert.equal(videoFinalizeJobActive(), false, "completed work releases capacity for another request");
});

test("cancelled non-cooperative work stays busy until settlement and failures release capacity", async () => {
  const gate = deferred();
  const started = startVideoFinalizeJob({ ownerId: "cancel-owner", assetId: "cancel-asset",
    fingerprint: "e".repeat(64), run: async () => { await gate.promise; throw new Error("synthetic failure"); } });
  await Promise.resolve();
  assert.equal(cancelVideoFinalizeJob({ ownerId: "cancel-owner", assetId: "cancel-asset" }), true);
  assert.deepEqual(videoFinalizeState({ ownerId: "cancel-owner", assetId: "cancel-asset" }), { state: "idle" });
  assert.equal(videoFinalizeJobActive(), true, "the retry scheduler must still see retained active work");
  gate.resolve();
  await assert.rejects(started.completion, /synthetic failure/);
  assert.equal(videoFinalizeJobActive(), false);
  const jobs = Array.from({ length: MAX_PENDING_VIDEO_FINALIZATIONS }, (_, index) => startVideoFinalizeJob({
    ownerId: "next-owner", assetId: `next-${index}`, fingerprint: "f".repeat(64),
    run: async () => ({ asset: { status: "ready" } }),
  }));
  await Promise.all(jobs.map(job => job.completion));
  assert.equal(videoFinalizeJobActive(), false);
});
