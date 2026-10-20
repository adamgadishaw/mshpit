import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { ApiError, errorEnvelope } from "./errors.js";

import {
  cancelVideoFinalizeJob,
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
  assert.equal(videoFinalizeJobActive(), true, "cancelled active work still owns its slot until settlement");
  assert.deepEqual(videoFinalizeState({ ownerId: "owner-a", assetId: "asset-a" }), { state: "idle" });

  gate.resolve();
  await started.completion;
  assert.equal(videoFinalizeJobActive(), false);
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

function heldJobs() {
  const gate = deferred();
  const accepted = [];
  const add = (ownerId, assetId, run = async () => {
    await gate.promise;
    return { asset: { id: assetId, status: "ready" } };
  }) => {
    const job = startVideoFinalizeJob({ ownerId, assetId, fingerprint: "c".repeat(64), run });
    accepted.push(job);
    return job;
  };
  return {
    add,
    async drain() {
      gate.resolve();
      await Promise.allSettled(accepted.map((job) => job.completion));
    },
  };
}

function assertBusy(start) {
  assert.throws(start, (error) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.status, 503);
    assert.equal(error.code, "MEDIA_STORAGE_UNAVAILABLE");
    assert.equal(errorEnvelope(error, "synthetic-request").retryable, true);
    return true;
  });
}

test("video admission bounds retained work to 32 jobs without rejecting an identical join", async () => {
  const held = heldJobs();
  try {
    const first = held.add("owner-0", "asset-0");
    for (let index = 1; index < 32; index += 1) held.add(`owner-${index}`, `asset-${index}`);
    assertBusy(() => held.add("overflow-owner", "overflow-asset"));
    assert.deepEqual(videoFinalizeState({ ownerId: "overflow-owner", assetId: "overflow-asset" }), { state: "idle" });
    const joined = held.add("owner-0", "asset-0", () => assert.fail("a duplicate must not run"));
    assert.equal(joined.joined, true);
    assert.equal(joined.completion, first.completion);
    assert.throws(() => startVideoFinalizeJob({
      ownerId: "owner-0", assetId: "asset-0", fingerprint: "d".repeat(64), run: () => {},
    }), { status: 409, code: "CONFLICT" });
  } finally { await held.drain(); }
  assert.equal(videoFinalizeJobActive(), false);
});

test("one owner can retain a 20-attachment album but cannot occupy the entire queue", async () => {
  const held = heldJobs();
  try {
    for (let index = 0; index < 20; index += 1) held.add("album-owner", `album-${index}`);
    assertBusy(() => held.add("album-owner", "album-overflow"));
    assert.equal(held.add("other-owner", "other-clip").joined, false);
    assert.equal(held.add("album-owner", "album-0").joined, true);
  } finally { await held.drain(); }
});

test("a failed or completed job releases admission for another job", async () => {
  const held = heldJobs();
  const firstGate = deferred();
  try {
    const first = held.add("album-owner", "first", async () => {
      await firstGate.promise;
      throw new ApiError(503, "Synthetic converter outage.", "MEDIA_STORAGE_UNAVAILABLE");
    });
    const failed = assert.rejects(first.completion, { code: "MEDIA_STORAGE_UNAVAILABLE" });
    for (let index = 1; index < 20; index += 1) held.add("album-owner", `queued-${index}`);
    assertBusy(() => held.add("album-owner", "before-failure"));
    firstGate.resolve();
    await failed;
    assert.equal(held.add("album-owner", "after-failure").joined, false);
  } finally {
    firstGate.resolve();
    await held.drain();
  }
  const next = startVideoFinalizeJob({
    ownerId: "album-owner", assetId: "after-completion", fingerprint: "e".repeat(64),
    run: async () => ({ asset: { status: "ready" } }),
  });
  await next.completion;
  assert.equal(videoFinalizeJobActive(), false);
});

test("cancellation retains admission until queued closures and non-cooperative active work settle", async () => {
  const held = heldJobs();
  try {
    held.add("owner-0", "asset-0");
    for (let index = 1; index < 32; index += 1) held.add(`owner-${index}`, `asset-${index}`);
    await Promise.resolve(); // The first job has started and deliberately ignores abort.
    assert.equal(cancelVideoFinalizeJob({ ownerId: "owner-0", assetId: "asset-0" }), true);
    assert.equal(cancelVideoFinalizeJob({ ownerId: "owner-1", assetId: "asset-1" }), true);
    assertBusy(() => held.add("owner-0", "asset-0"));
    assertBusy(() => held.add("owner-1", "asset-1"));
    assert.equal(videoFinalizeJobActive(), true);
  } finally { await held.drain(); }
  assert.equal(videoFinalizeJobActive(), false);
  const retried = startVideoFinalizeJob({
    ownerId: "owner-1", assetId: "asset-1", fingerprint: "f".repeat(64),
    run: async () => ({ asset: { status: "ready" } }),
  });
  await retried.completion;
});
