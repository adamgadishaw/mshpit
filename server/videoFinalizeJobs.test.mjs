import assert from "node:assert/strict";
import test, { afterEach } from "node:test";

import {
  cancelVideoFinalizeJob,
  resetVideoFinalizeJobsForTests,
  startVideoFinalizeJob,
  videoFinalizeState,
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
