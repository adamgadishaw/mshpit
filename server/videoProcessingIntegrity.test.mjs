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
const { ApiError, reserveVideoPublishingDemand, resumeVideoProcessing, startDurableVideoFinalize } = await import("./api.js");
const { resetVideoFinalizeJobsForTests } = await import("./videoFinalizeJobs.js");
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
