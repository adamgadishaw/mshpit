import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { ApiError } from "./errors.js";
import {
  VIDEO_PROCESSING_MAX_ATTEMPTS,
  dueVideoProcessingJob,
  noteVideoProcessingAttemptStarted,
  noteVideoProcessingOutcome,
  postponeVideoProcessing,
  recordVideoProcessingRequest,
  recoverInterruptedVideoProcessing,
  startVideoProcessingScheduler,
  videoProcessingState,
} from "./videoProcessingQueue.js";

// The same columns as server/db.js, without the foreign keys that would need
// the whole schema. The queue only ever touches this one table.
function queueDatabase() {
  const database = new DatabaseSync(":memory:");
  database.exec(`CREATE TABLE media_processing_jobs (
    asset_id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, body TEXT NOT NULL,
    fingerprint TEXT NOT NULL CHECK (length(fingerprint) = 64),
    state TEXT NOT NULL CHECK (state IN ('running','retry','failed')),
    attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at INTEGER,
    last_error_code TEXT, last_error_status INTEGER,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`);
  return database;
}

function started(database, assetId = "ma_clip", at = 1_000) {
  recordVideoProcessingRequest(database, { ownerId: "u_owner", assetId, body: { editRecipe: { coverMs: 0 } }, fingerprint: "a".repeat(64), at });
  noteVideoProcessingAttemptStarted(database, { assetId, at });
}

const storageDown = () => new ApiError(503, "Clip processing is temporarily unavailable.", "MEDIA_STORAGE_UNAVAILABLE");

test("a temporary failure is retried on a growing schedule and finally reported", () => {
  const database = queueDatabase();
  started(database);
  const first = noteVideoProcessingOutcome(database, { assetId: "ma_clip", error: storageDown(), at: 10_000 });
  assert.deepEqual(first, { state: "retry", nextAttemptAt: 40_000, attempts: 1 });
  assert.deepEqual(videoProcessingState(database, { ownerId: "u_owner", assetId: "ma_clip" }),
    { state: "processing", attempts: 1, retryAt: 40_000 }, "the owner sees it is still on its way");
  assert.equal(videoProcessingState(database, { ownerId: "u_someone_else", assetId: "ma_clip" }), null);

  assert.equal(dueVideoProcessingJob(database, { at: 39_999 }), null);
  assert.equal(dueVideoProcessingJob(database, { at: 40_000 }).asset_id, "ma_clip");

  noteVideoProcessingAttemptStarted(database, { assetId: "ma_clip", at: 40_000 });
  const second = noteVideoProcessingOutcome(database, { assetId: "ma_clip", error: storageDown(), at: 50_000 });
  assert.equal(second.nextAttemptAt, 110_000, "the second wait is longer");

  for (let attempt = 3; attempt <= VIDEO_PROCESSING_MAX_ATTEMPTS; attempt += 1) {
    noteVideoProcessingAttemptStarted(database, { assetId: "ma_clip", at: 100_000 * attempt });
    noteVideoProcessingOutcome(database, { assetId: "ma_clip", error: storageDown(), at: 100_000 * attempt });
  }
  const final = videoProcessingState(database, { ownerId: "u_owner", assetId: "ma_clip" });
  assert.equal(final.state, "failed");
  assert.equal(final.error.retryable, true, "the owner can still ask for another try");
  assert.equal(dueVideoProcessingJob(database, { at: Number.MAX_SAFE_INTEGER }), null, "no more automatic attempts");

  recordVideoProcessingRequest(database, { ownerId: "u_owner", assetId: "ma_clip", body: {}, fingerprint: "a".repeat(64), at: 2_000_000 });
  assert.equal(database.prepare("SELECT attempts FROM media_processing_jobs").get().attempts, 0,
    "asking again after a final failure starts a fresh set of attempts");
});

test("a file the converter cannot read stops at once; a busy converter costs no attempt", () => {
  const database = queueDatabase();
  started(database);
  const unreadable = noteVideoProcessingOutcome(database, {
    assetId: "ma_clip",
    error: new ApiError(415, "That clip could not pass authoritative decoding.", "MEDIA_TYPE_UNSUPPORTED"),
    at: 5_000,
  });
  assert.equal(unreadable.state, "failed");
  const state = videoProcessingState(database, { ownerId: "u_owner", assetId: "ma_clip" });
  assert.equal(state.error.retryable, false);
  assert.match(state.error.message, /couldn't be converted/);

  started(database, "ma_busy");
  const busy = noteVideoProcessingOutcome(database, {
    assetId: "ma_busy",
    error: new ApiError(429, "Clip verification is busy.", "RATE_LIMITED"),
    at: 5_000,
  });
  assert.deepEqual(busy, { state: "retry", nextAttemptAt: 25_000, attempts: 0 });

  started(database, "ma_conflict");
  assert.equal(noteVideoProcessingOutcome(database, {
    assetId: "ma_conflict", error: new ApiError(409, "Mismatch.", "CONFLICT"), at: 1,
  }).state, "retry", "one more try after a conflict");
  noteVideoProcessingAttemptStarted(database, { assetId: "ma_conflict", at: 2 });
  assert.equal(noteVideoProcessingOutcome(database, {
    assetId: "ma_conflict", error: new ApiError(409, "Mismatch.", "CONFLICT"), at: 3,
  }).state, "failed", "a repeated conflict will not change with more conversions");

  started(database, "ma_done");
  assert.deepEqual(noteVideoProcessingOutcome(database, { assetId: "ma_done", at: 9 }), { state: "completed" });
  assert.equal(database.prepare("SELECT COUNT(*) count FROM media_processing_jobs WHERE asset_id='ma_done'").get().count, 0);
});

test("a restart makes interrupted conversions due, and the scheduler runs one at a time", () => {
  const database = queueDatabase();
  started(database, "ma_first", 100);
  started(database, "ma_second", 200);
  assert.equal(recoverInterruptedVideoProcessing(database, { at: 1_000 }), 2);
  assert.equal(dueVideoProcessingJob(database, { at: 1_000 }).asset_id, "ma_first", "oldest first");

  postponeVideoProcessing(database, { assetId: "ma_first", delayMs: 5_000, at: 1_000 });
  assert.equal(dueVideoProcessingJob(database, { at: 1_000 }).asset_id, "ma_second");

  const resumed = [];
  let busy = true;
  const scheduler = startVideoProcessingScheduler({
    database,
    resume: (job) => resumed.push(job.asset_id),
    isBusy: () => busy,
    now: () => 10_000,
    intervalMs: 60_000,
  });
  try {
    assert.equal(scheduler.tick(), false, "nothing starts while a clip is converting");
    busy = false;
    assert.equal(scheduler.tick(), true);
    assert.deepEqual(resumed, ["ma_second"], "the clip that has waited longest for its turn goes first");
  } finally {
    scheduler.stop();
  }
});

test("revoked sessions stop automatic publication while converter contention remains retryable", () => {
  const database = queueDatabase();
  started(database, "ma_revoked");
  const outcome = noteVideoProcessingOutcome(database, {
    assetId: "ma_revoked", error: new ApiError(401, "Log in again.", "AUTH_REQUIRED"), at: 5_000,
  });
  assert.equal(outcome.state, "failed");
  assert.equal(dueVideoProcessingJob(database, { at: Number.MAX_SAFE_INTEGER }), null,
    "a fresh automatic retry cannot drop the rejected session context and publish anyway");
  database.close();
});
