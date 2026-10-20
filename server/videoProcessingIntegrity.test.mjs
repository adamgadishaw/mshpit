import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after, beforeEach } from "node:test";

const directory = mkdtempSync(join(tmpdir(), "pit-video-processing-integrity-"));
const secret = "video-processing-synthetic-test-secret-at-least-thirty-two-bytes";
Object.assign(process.env, {
  NODE_ENV: "test",
  PIT_DATA_DIR: directory,
  PIT_VIDEO_PUBLISHING_ENABLED: "true",
  PIT_VIDEO_VERIFIER_HOSTPORT: "pit-video-verifier:10001",
  PIT_VIDEO_VERIFIER_SECRET: secret,
  MEDIA_ENDPOINT: "https://objects.example.com/s3",
  MEDIA_BUCKET: "pit-media",
  MEDIA_SOURCE_BUCKET: "pit-media-private",
  MEDIA_REGION: "auto",
  MEDIA_ACCESS_KEY_ID: "media-test-access",
  MEDIA_SECRET_ACCESS_KEY: "media-test-secret",
  MEDIA_PUBLIC_BASE_URL: "https://media.example.com/cdn",
});
const { db, q } = await import("./db.js");
const { resetRateLimitsForTests } = await import("./auth.js");
const { createMediaAsset } = await import("./mediaAssets.js");
const { ApiError, reserveVideoPublishingDemand, resumeVideoProcessing, startDurableVideoFinalize, startVideoProcessingRetries } = await import("./api.js");
const { resetVideoFinalizeJobsForTests, startVideoFinalizeJob, videoFinalizeState } = await import("./videoFinalizeJobs.js");
const { recordVideoProcessingRequest, recoverInterruptedVideoProcessing } = await import("./videoProcessingQueue.js");
const { refreshVideoVerifierHealth, resetVideoVerifierStateForTests } = await import("./videoVerifier.js");
const {
  signVideoVerifierResponse, verifyVideoVerifierRequest, VIDEO_VERIFIER_PROTOCOL_VERSION,
  VIDEO_VERIFIER_UNIVERSAL_ADMISSION, VIDEO_VERIFIER_UNIVERSAL_SOURCE_TYPES,
} = await import("./videoVerifierProtocol.js");
const realFetch = globalThis.fetch;
let fetches = [];

beforeEach(async () => {
  resetRateLimitsForTests();
  resetVideoFinalizeJobsForTests();
  resetVideoVerifierStateForTests();
  fetches = [];
  await refreshVideoVerifierHealth({
    env: process.env,
    fetchImpl: async (url, request) => {
      const path = new URL(url).pathname;
      const authenticated = verifyVideoVerifierRequest({ secret, path, body: request.body, headers: request.headers });
      const signed = signVideoVerifierResponse({ secret, path, requestNonce: authenticated.nonce, payload: {
        ok: true, protocol: VIDEO_VERIFIER_PROTOCOL_VERSION, pipeline: "private-derivative-v1",
        decoder: { ffmpeg: true, ffprobe: true, version: "synthetic verifier" },
        poster: { generated: true, decoded: true }, storage: { privateInput: true, sanitizedOutput: true },
        sourceTypes: ["video/mp4", "video/quicktime"],
        sourceCodecs: { "video/mp4": ["h264", "hevc"], "video/quicktime": ["h264", "hevc"] },
        universalAdmission: VIDEO_VERIFIER_UNIVERSAL_ADMISSION,
        universalSourceTypes: [...VIDEO_VERIFIER_UNIVERSAL_SOURCE_TYPES], concurrency: 1,
      } });
      return new Response(signed.body, { status: 200, headers: signed.headers });
    },
  });
  globalThis.fetch = async (url, request = {}) => {
    fetches.push({ path: new URL(url).pathname, method: request.method || "GET" });
    if (request.method === "HEAD") {
      return new Response(null, { status: 200, headers: {
        "content-type": "video/webm", "content-length": "2048", etag: '"synthetic-generation"',
      } });
    }
    return new Response(null, { status: 503 });
  };
});

after(() => {
  globalThis.fetch = realFetch;
  resetVideoFinalizeJobsForTests();
  db.close();
  rmSync(directory, { recursive: true, force: true });
});

function queuedClip(suffix) {
  const ownerId = `u_processing_${suffix}`;
  q.insertUser.run(ownerId, `${ownerId}@example.com`, ownerId, ownerId, "test-hash", "fan", "", null, null, "MP", "#123456", Date.now());
  db.prepare("UPDATE users SET email_verified_at=? WHERE id=?").run(Date.now(), ownerId);
  const created = createMediaAsset(db, { ownerId, body: {
    clientAssetId: `processing-clip-${suffix}`, purpose: "post", contentType: "video/webm", fileSize: 2_048, name: "clip.webm",
  } });
  recordVideoProcessingRequest(db, { ownerId, assetId: created.asset.id, body: { editRecipe: { kind: "video", coverMs: 0 } }, fingerprint: "a".repeat(64) });
  recoverInterruptedVideoProcessing(db);
  return db.prepare("SELECT * FROM media_processing_jobs WHERE asset_id=?").get(created.asset.id);
}

test("automatic recovery cannot bypass an exhausted owner decoder allowance", async () => {
  const job = queuedClip("quota");
  for (let count = 0; count < 240; count += 1) {
    reserveVideoPublishingDemand({ ip: "synthetic-quota" }, { id: job.owner_id }, "verify").commit();
  }
  const resumed = resumeVideoProcessing(job);
  await assert.rejects(resumed.completion, (error) => error instanceof ApiError && error.status === 429);
  assert.equal(fetches.some((entry) => entry.path === "/v2/verify"), false,
    "a restart or automatic retry must not reach the converter outside the owner allowance");
  const recorded = db.prepare("SELECT state,attempts FROM media_processing_jobs WHERE asset_id=?").get(job.asset_id);
  assert.equal(recorded.state, "failed", "an admission denial requires the owner's request to recheck its original network gate");
  assert.equal(recorded.attempts, 0, "waiting for quota is not a failed file conversion");
});

test("automatic recovery checks current account restrictions before any storage request", async () => {
  for (const [suffix, restriction] of [
    ["banned", "is_banned=1"],
    ["suspended", `suspended_until=${Date.now() + 60_000}`],
    ["dormant", `dormant_at=${Date.now()}`],
    ["unverified", "email_verified_at=0"],
  ]) {
    const job = queuedClip(suffix);
    db.prepare(`UPDATE users SET ${restriction} WHERE id=?`).run(job.owner_id);
    const resumed = resumeVideoProcessing(job);
    await assert.rejects(resumed.completion, (error) => error instanceof ApiError && error.status === 403, suffix);
    assert.equal(db.prepare("SELECT state FROM media_processing_jobs WHERE asset_id=?").get(job.asset_id).state, "failed", suffix);
  }
  assert.deepEqual(fetches, [], "restricted accounts must not spend storage or decoder resources");
});

test("a deleted account's interrupted conversion cannot be resurrected", () => {
  const job = queuedClip("deleted");
  db.prepare("DELETE FROM users WHERE id=?").run(job.owner_id);
  assert.equal(resumeVideoProcessing(job), undefined);
  assert.equal(db.prepare("SELECT 1 FROM media_processing_jobs WHERE asset_id=?").get(job.asset_id), undefined);
  assert.equal(db.prepare("SELECT 1 FROM media_assets WHERE id=?").get(job.asset_id), undefined);
  assert.deepEqual(fetches, []);
});

test("a member's network admission denial cannot become an automatic unmetered retry", async () => {
  const job = queuedClip("network");
  for (let count = 0; count < 480; count += 1) {
    reserveVideoPublishingDemand({ ip: "synthetic-full-network" }, { id: `synthetic-actor-${count}` }, "verify").commit();
  }
  const started = startDurableVideoFinalize({
    ownerId: job.owner_id, assetId: job.asset_id, contentType: "video/webm",
    body: JSON.parse(job.body), fingerprint: job.fingerprint, member: { ip: "synthetic-full-network" },
  });
  await assert.rejects(started.completion, (error) => error.status === 429 && error.videoAdmissionDenied === true);
  assert.equal(db.prepare("SELECT state FROM media_processing_jobs WHERE asset_id=?").get(job.asset_id).state, "failed");
  assert.equal(fetches.some((entry) => entry.path === "/v2/verify"), false);
});

test("a background conversion rechecks account state after asynchronous storage inspection", async () => {
  for (const remove of [false, true]) {
    const job = queuedClip(remove ? "deleted_during_head" : "banned_during_head");
    const storageFetch = globalThis.fetch;
    globalThis.fetch = async (url, request) => {
      const result = await storageFetch(url, request);
      if (request.method === "HEAD") {
        if (remove) db.prepare("DELETE FROM users WHERE id=?").run(job.owner_id);
        else db.prepare("UPDATE users SET is_banned=1 WHERE id=?").run(job.owner_id);
      }
      return result;
    };
    try {
      await assert.rejects(resumeVideoProcessing(job).completion, (error) => error.status === (remove ? 404 : 403));
      assert.equal(fetches.some((entry) => entry.path === "/v2/verify"), false);
      if (remove) {
        assert.equal(db.prepare("SELECT 1 FROM media_assets WHERE id=?").get(job.asset_id), undefined);
        assert.equal(db.prepare("SELECT 1 FROM media_processing_jobs WHERE asset_id=?").get(job.asset_id), undefined);
      }
    } finally {
      globalThis.fetch = storageFetch;
    }
  }
});

test("coordinator overload preserves durable retries and rejects new work before recording or dispatch", async () => {
  const retry = queuedClip("capacity_retry");
  const fresh = queuedClip("capacity_new");
  db.prepare("DELETE FROM media_processing_jobs WHERE asset_id=?").run(fresh.asset_id);
  const previous = db.prepare("SELECT * FROM media_processing_jobs WHERE asset_id=?").get(retry.asset_id);
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const held = [];
  try {
    for (let index = 0; index < 32; index += 1) {
      held.push(startVideoFinalizeJob({
        ownerId: `synthetic-capacity-owner-${index}`, assetId: `synthetic-capacity-asset-${index}`,
        fingerprint: "c".repeat(64),
        run: async () => { await gate; return { asset: { status: "ready" } }; },
      }));
    }
    assert.throws(() => resumeVideoProcessing(retry),
      { status: 503, code: "MEDIA_STORAGE_UNAVAILABLE" });
    assert.deepEqual(db.prepare("SELECT * FROM media_processing_jobs WHERE asset_id=?").get(retry.asset_id), previous,
      "overload must not consume an attempt or strand a retry as running");
    assert.throws(() => startDurableVideoFinalize({
      ownerId: fresh.owner_id, assetId: fresh.asset_id, contentType: "video/webm",
      body: JSON.parse(fresh.body), fingerprint: fresh.fingerprint,
    }), { status: 503, code: "MEDIA_STORAGE_UNAVAILABLE" });
    assert.equal(db.prepare("SELECT 1 FROM media_processing_jobs WHERE asset_id=?").get(fresh.asset_id), undefined);
    assert.equal(db.prepare("SELECT status FROM media_assets WHERE id=?").get(fresh.asset_id).status, "upload_pending",
      "the uploaded source remains available for an explicit retry");
    assert.deepEqual(fetches, [], "rejected work must not reach storage or the converter");
  } finally {
    release();
    await Promise.allSettled(held.map(job => job.completion));
  }

  const resumed = resumeVideoProcessing(retry);
  assert.equal(resumed.joined, false, "the durable retry remains eligible after capacity returns");
  await assert.rejects(resumed.completion, { status: 503 });
  const recorded = db.prepare("SELECT state,attempts FROM media_processing_jobs WHERE asset_id=?").get(retry.asset_id);
  assert.equal(recorded.state, "retry");
  assert.equal(recorded.attempts, 1, "only the actual attempt consumes the durable retry budget");
});

test("a failed durable acceptance write cannot dispatch an orphan conversion or mutate an existing retry", async () => {
  for (const existing of [false, true]) {
    const job = queuedClip(existing ? "persist_retry" : "persist_new");
    if (!existing) db.prepare("DELETE FROM media_processing_jobs WHERE asset_id=?").run(job.asset_id);
    const previous = db.prepare("SELECT * FROM media_processing_jobs WHERE asset_id=?").get(job.asset_id);
    db.exec(`CREATE TEMP TRIGGER reject_video_acceptance BEFORE INSERT ON media_processing_jobs
      BEGIN SELECT RAISE(ABORT, 'synthetic durable acceptance failure'); END`);
    try {
      assert.throws(() => resumeVideoProcessing(job), /synthetic durable acceptance failure/);
      await new Promise(resolve => setImmediate(resolve));
      assert.deepEqual(fetches, [], "no storage or verifier work may start after persistence failed");
      assert.deepEqual(db.prepare("SELECT * FROM media_processing_jobs WHERE asset_id=?").get(job.asset_id), previous);
      assert.deepEqual(videoFinalizeState({ ownerId: job.owner_id, assetId: job.asset_id }), { state: "idle" });
    } finally { db.exec("DROP TRIGGER reject_video_acceptance"); }
    const accepted = resumeVideoProcessing(job);
    assert.equal(accepted.joined, false);
    await assert.rejects(accepted.completion, { status: 503 });
    assert.equal(db.prepare("SELECT attempts FROM media_processing_jobs WHERE asset_id=?").get(job.asset_id).attempts, 1);
    fetches = [];
  }
});

test("video shutdown aborts storage and settles bookkeeping while preserving interrupted accepted work", async () => {
  const activeJob = queuedClip("shutdown_active");
  const queuedJob = queuedClip("shutdown_queued");
  db.prepare("UPDATE media_processing_jobs SET attempts=2 WHERE asset_id=?").run(queuedJob.asset_id);
  const scheduler = startVideoProcessingRetries();
  const storageFetch = globalThis.fetch;
  let releaseHead, enteredHead, headSignal;
  const headEntered = new Promise(resolve => { enteredHead = resolve; });
  const headGate = new Promise(resolve => { releaseHead = resolve; });
  globalThis.fetch = async (url, request) => {
    if (request.method === "HEAD") {
      headSignal = request.signal;
      enteredHead();
      await headGate; // Model a transport that takes time to acknowledge abort.
    }
    return storageFetch(url, request);
  };
  const active = resumeVideoProcessing(activeJob);
  const queued = resumeVideoProcessing(queuedJob);
  const completions = [active, queued].map(job => job.completion.catch(error => error));
  try {
    await headEntered;
    const stopping = scheduler.stop({ abortActive: true });
    assert.equal(typeof stopping?.then, "function", "stop must expose an owned drain");
    assert.equal(headSignal.aborted, true);
    assert.throws(() => startVideoFinalizeJob({
      ownerId: "late-owner", assetId: "late-asset", fingerprint: "f".repeat(64),
      run: () => assert.fail("shutdown must refuse new work"),
    }), { status: 503 });
    await stopping;
    const outcomes = await Promise.all(completions);
    assert.ok(outcomes.every(error => error.name === "AbortError"));
    assert.equal(fetches.some(entry => entry.path === "/v2/verify"), false);
    assert.equal(db.prepare("SELECT attempts FROM media_processing_jobs WHERE asset_id=?").get(activeJob.asset_id).attempts, 0);
    assert.equal(db.prepare("SELECT attempts FROM media_processing_jobs WHERE asset_id=?").get(queuedJob.asset_id).attempts, 2,
      "shutdown must not subtract an attempt from a job that never dispatched");
    recoverInterruptedVideoProcessing(db);
    for (const job of [activeJob, queuedJob]) {
      assert.equal(db.prepare("SELECT state FROM media_processing_jobs WHERE asset_id=?").get(job.asset_id).state, "retry");
      assert.equal(db.prepare("SELECT status FROM media_assets WHERE id=?").get(job.asset_id).status, "upload_pending");
    }
    assert.equal(scheduler.tick(), false);
    assert.equal(scheduler.stop({ abortActive: true }), stopping, "stop is idempotent");
    const beforeLateResponse = db.prepare("SELECT * FROM media_processing_jobs WHERE asset_id=?").get(activeJob.asset_id);
    releaseHead();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(db.prepare("SELECT * FROM media_processing_jobs WHERE asset_id=?").get(activeJob.asset_id), beforeLateResponse,
      "the existing storage adapter discards a late response without returning to database work");
    assert.equal(fetches.some(entry => entry.path === "/v2/verify"), false);
  } finally {
    releaseHead();
    await Promise.all(completions);
    scheduler.stop();
    globalThis.fetch = storageFetch;
  }
});
