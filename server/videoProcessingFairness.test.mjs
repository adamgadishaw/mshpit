import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test, { afterEach } from "node:test";
import * as coordinator from "./videoFinalizeJobs.js";
import {
  noteVideoProcessingOutcome, recordVideoProcessingRequest, startVideoProcessingScheduler,
} from "./videoProcessingQueue.js";

afterEach(() => coordinator.resetVideoFinalizeJobsForTests());
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { resolve, promise };
};
function queueDatabase() {
  const database = new DatabaseSync(":memory:");
  database.exec(`CREATE TABLE media_processing_jobs (
    asset_id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, body TEXT NOT NULL,
    fingerprint TEXT NOT NULL, state TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at INTEGER, last_error_code TEXT, last_error_status INTEGER,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`);
  return database;
}

test("an older retry claims a released slot before new traffic can refill a saturated video queue", async () => {
  const database = queueDatabase();
  const firstGate = deferred(), tailGate = deferred();
  const accepted = [];
  let retryRuns = 0;
  for (let index = 0; index < 32; index += 1) {
    accepted.push(coordinator.startVideoFinalizeJob({
      ownerId: `new-${index}`, assetId: `new-${index}`, fingerprint: "a".repeat(64),
      run: async () => {
        await (index ? tailGate.promise : firstGate.promise);
        return { asset: { status: "ready" } };
      },
    }));
  }
  recordVideoProcessingRequest(database, {
    ownerId: "old-owner", assetId: "old-retry", body: {}, fingerprint: "b".repeat(64), at: 1,
  });
  const scheduler = startVideoProcessingScheduler({
    database, now: () => 1000, intervalMs: 60_000,
    subscribeCapacity: coordinator.observeVideoFinalizeCapacity,
    resume: job => {
      const started = coordinator.startVideoFinalizeJob({
        ownerId: job.owner_id, assetId: job.asset_id, fingerprint: job.fingerprint,
        accept: () => recordVideoProcessingRequest(database, {
          ownerId: job.owner_id, assetId: job.asset_id, fingerprint: job.fingerprint, body: {}, at: 1000,
        }),
        run: async () => { retryRuns += 1; return { asset: { status: "ready" } }; },
        onSettled: ({ error }) => noteVideoProcessingOutcome(database, { assetId: job.asset_id, error, at: 1000 }),
      });
      accepted.push(started);
      return started;
    },
  });
  try {
    assert.equal(scheduler.tick(), false, "overload preserves the due retry");
    firstGate.resolve();
    await accepted[0].completion;
    assert.equal(database.prepare("SELECT state FROM media_processing_jobs WHERE asset_id='old-retry'").get().state, "running",
      "the old retry must be admitted at the next release without waiting for an idle timer tick");
    assert.throws(() => coordinator.startVideoFinalizeJob({
      ownerId: "later", assetId: "later", fingerprint: "c".repeat(64), run: () => {},
    }), { status: 503 }, "retry admission must preserve the original 32-job ceiling");
    tailGate.resolve();
    await Promise.all(accepted.map(job => job.completion));
    assert.equal(retryRuns, 1);
    assert.equal(database.prepare("SELECT COUNT(*) n FROM media_processing_jobs").get().n, 0);
  } finally {
    firstGate.resolve(); tailGate.resolve();
    await scheduler.stop();
    await Promise.allSettled(accepted.map(job => job.completion));
    database.close();
  }
});

test("retry admission keeps the owner ceiling and stop removes the capacity callback before database close", async () => {
  const database = queueDatabase();
  const firstGate = deferred(), tailGate = deferred();
  const accepted = [];
  for (let index = 0; index < 20; index += 1) {
    accepted.push(coordinator.startVideoFinalizeJob({
      ownerId: "album", assetId: `album-${index}`, fingerprint: "d".repeat(64),
      run: async () => {
        await (index ? tailGate.promise : firstGate.promise);
        return { asset: { status: "ready" } };
      },
    }));
  }
  recordVideoProcessingRequest(database, {
    ownerId: "album", assetId: "old-album-retry", body: {}, fingerprint: "e".repeat(64), at: 1,
  });
  const errors = [];
  const scheduler = startVideoProcessingScheduler({
    database, now: () => 1000, intervalMs: 60_000,
    subscribeCapacity: coordinator.observeVideoFinalizeCapacity,
    onError: error => errors.push(error),
    resume: job => {
      const started = coordinator.startVideoFinalizeJob({
        ownerId: job.owner_id, assetId: job.asset_id, fingerprint: job.fingerprint,
        accept: () => recordVideoProcessingRequest(database, {
          ownerId: job.owner_id, assetId: job.asset_id, body: {}, fingerprint: job.fingerprint, at: 1000,
        }),
        run: async () => ({ asset: { status: "ready" } }),
      });
      accepted.push(started);
    },
  });
  try {
    assert.equal(scheduler.tick(), false, "an owner with 20 retained jobs cannot admit a retry");
    assert.deepEqual(database.prepare("SELECT state,attempts FROM media_processing_jobs").get(),
      Object.assign(Object.create(null), { state: "retry", attempts: 0 }));
    firstGate.resolve();
    await accepted[0].completion;
    assert.equal(database.prepare("SELECT state FROM media_processing_jobs").get().state, "running");
    assert.throws(() => coordinator.startVideoFinalizeJob({
      ownerId: "album", assetId: "too-many", fingerprint: "f".repeat(64), run: () => {},
    }), { status: 503 });
    await scheduler.stop();
    database.close();
    tailGate.resolve();
    await Promise.all(accepted.map(job => job.completion));
    assert.equal(scheduler.tick(), false);
    assert.deepEqual(errors, [], "no observer may query a closed database after scheduler stop");
    const unsubscribe = coordinator.observeVideoFinalizeCapacity(() => {});
    unsubscribe();
  } finally {
    firstGate.resolve(); tailGate.resolve();
    await scheduler.stop();
    await Promise.allSettled(accepted.map(job => job.completion));
    if (database.isOpen) database.close();
  }
});

test("cancelled work releases capacity only on settlement and observer failure cannot change its result", async (t) => {
  const messages = [];
  t.mock.method(console, "error", message => messages.push(message));
  const gate = deferred();
  let notifications = 0;
  const unsubscribe = coordinator.observeVideoFinalizeCapacity(() => {
    notifications += 1;
    throw new Error("synthetic private diagnostic must not be logged");
  });
  const started = coordinator.startVideoFinalizeJob({
    ownerId: "owner", assetId: "cancelled", fingerprint: "a".repeat(64),
    run: async () => { await gate.promise; return { asset: { status: "ready" } }; },
  });
  await Promise.resolve();
  coordinator.cancelVideoFinalizeJob({ ownerId: "owner", assetId: "cancelled" });
  assert.equal(notifications, 0);
  gate.resolve();
  assert.equal((await started.completion).asset.status, "ready");
  assert.equal(notifications, 1);
  assert.deepEqual(messages, ["[media] clip capacity observer failed safely"]);
  assert.deepEqual(coordinator.videoFinalizeState({ ownerId: "owner", assetId: "cancelled" }), { state: "idle" });
  unsubscribe();
});
