import assert from "node:assert/strict";
import test from "node:test";

import { VIDEO_PUBLISHING_PIPELINE_VERSION } from "../domain/mediaPublishingCapabilities.mjs";
import {
  MEDIA_PUBLISHING_CAPABILITIES_TTL_MS,
  MEDIA_PUBLISHING_VIDEO_STALE_IF_UNAVAILABLE_MS,
  loadMediaPublishingCapabilities,
} from "./mediaPublishingHealth.js";

const healthyPipeline = () => ({
  capabilities: {
    mediaPublishing: {
      photos: true,
      videos: true,
      pipeline: VIDEO_PUBLISHING_PIPELINE_VERSION,
      sourceTypes: ["video/mp4", "video/quicktime"],
    },
  },
});

test("media publishing health negotiates the exact pipeline behind a service boundary", async () => {
  const controller = new AbortController();
  const calls = [];
  const result = await loadMediaPublishingCapabilities({
    signal: controller.signal,
    apiCall: async (path, options) => {
      calls.push({ path, options });
      return healthyPipeline();
    },
  });

  assert.deepEqual(result, { photos: true, videos: true, sourceTypes: ["video/mp4", "video/quicktime"] });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, `/api/health?mediaPipeline=${VIDEO_PUBLISHING_PIPELINE_VERSION}`);
  assert.equal(calls[0].options.signal instanceof AbortSignal, true);
  assert.notEqual(calls[0].options.signal, controller.signal);
  assert.equal(calls[0].options.silent, true);
  assert.equal(calls[0].options.skipIdentityCheck, true);
  assert.equal(calls[0].options.timeoutMs, 3_000);
});

test("media publishing health keeps malformed capability responses fail-closed", async () => {
  const result = await loadMediaPublishingCapabilities({
    apiCall: async () => ({
      capabilities: { mediaPublishing: { photos: true, videos: true, pipeline: "verified-v0" } },
    }),
  });
  assert.deepEqual(result, { photos: true, videos: false, sourceTypes: [] });
});

test("media publishing health reuses one request inside the short TTL and refreshes after it", async () => {
  let requestCount = 0;
  let currentTime = 10_000;
  const apiCall = async () => {
    requestCount += 1;
    return healthyPipeline();
  };
  const options = { apiCall, now: () => currentTime };

  await loadMediaPublishingCapabilities(options);
  currentTime += MEDIA_PUBLISHING_CAPABILITIES_TTL_MS - 1;
  await loadMediaPublishingCapabilities(options);
  assert.equal(requestCount, 1);

  currentTime += 1;
  await loadMediaPublishingCapabilities(options);
  assert.equal(requestCount, 2);
});

test("media publishing health coalesces concurrent stale checks into one request", async () => {
  let requestCount = 0;
  let releaseRequest;
  const apiCall = async () => {
    requestCount += 1;
    return new Promise((resolve) => {
      releaseRequest = () => resolve(healthyPipeline());
    });
  };

  const first = loadMediaPublishingCapabilities({ apiCall });
  const second = loadMediaPublishingCapabilities({ apiCall });
  await Promise.resolve();
  assert.equal(requestCount, 1);

  releaseRequest();
  const [firstResult, secondResult] = await Promise.all([first, second]);
  assert.deepEqual(firstResult, { photos: true, videos: true, sourceTypes: ["video/mp4", "video/quicktime"] });
  assert.deepEqual(secondResult, firstResult);
  assert.equal(requestCount, 1);
});

test("a forced pre-upload check bypasses a fresh cached capability result", async () => {
  let requestCount = 0;
  const apiCall = async () => {
    requestCount += 1;
    return healthyPipeline();
  };

  await loadMediaPublishingCapabilities({ apiCall });
  await loadMediaPublishingCapabilities({ apiCall });
  assert.equal(requestCount, 1);

  await loadMediaPublishingCapabilities({ apiCall, force: true });
  assert.equal(requestCount, 2);
});

test("selection briefly retains the last exact healthy video contract but forced upload checks do not", async () => {
  let currentTime = 20_000;
  let healthy = true;
  const apiCall = async () => healthy
    ? healthyPipeline()
    : { capabilities: { mediaPublishing: { photos: true, videos: false } } };

  assert.deepEqual(await loadMediaPublishingCapabilities({ apiCall, now: () => currentTime }),
    { photos: true, videos: true, sourceTypes: ["video/mp4", "video/quicktime"] });
  healthy = false;
  currentTime += MEDIA_PUBLISHING_CAPABILITIES_TTL_MS;
  assert.deepEqual(
    await loadMediaPublishingCapabilities({ apiCall, now: () => currentTime }),
    { photos: true, videos: true, sourceTypes: ["video/mp4", "video/quicktime"] },
    "a non-forced picker check keeps a recently proven pipeline available",
  );
  assert.deepEqual(
    await loadMediaPublishingCapabilities({ apiCall, now: () => currentTime, force: true }),
    { photos: true, videos: false, sourceTypes: [] },
    "the upload boundary sees the current authoritative outage",
  );

  currentTime += MEDIA_PUBLISHING_VIDEO_STALE_IF_UNAVAILABLE_MS + 1;
  assert.deepEqual(
    await loadMediaPublishingCapabilities({ apiCall, now: () => currentTime }),
    { photos: true, videos: false, sourceTypes: [] },
    "the selection grace is bounded",
  );
});

test("one cancelled consumer does not duplicate or cancel a shared request still in use", async () => {
  let requestCount = 0;
  let releaseRequest;
  const apiCall = async () => {
    requestCount += 1;
    return new Promise((resolve) => {
      releaseRequest = () => resolve(healthyPipeline());
    });
  };
  const controller = new AbortController();

  const cancelled = loadMediaPublishingCapabilities({ apiCall, signal: controller.signal });
  const retained = loadMediaPublishingCapabilities({ apiCall });
  await Promise.resolve();
  controller.abort();
  releaseRequest();

  await assert.rejects(cancelled, { name: "AbortError" });
  assert.deepEqual(await retained, { photos: true, videos: true, sourceTypes: ["video/mp4", "video/quicktime"] });
  assert.equal(requestCount, 1);
});
