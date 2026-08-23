import assert from "node:assert/strict";
import test from "node:test";

import { VIDEO_PUBLISHING_PIPELINE_VERSION } from "../domain/mediaPublishingCapabilities.mjs";
import { loadMediaPublishingCapabilities } from "./mediaPublishingHealth.js";

test("media publishing health negotiates the exact pipeline behind a service boundary", async () => {
  const controller = new AbortController();
  const calls = [];
  const result = await loadMediaPublishingCapabilities({
    signal: controller.signal,
    apiCall: async (path, options) => {
      calls.push({ path, options });
      return {
        capabilities: {
          mediaPublishing: {
            photos: true,
            videos: true,
            pipeline: VIDEO_PUBLISHING_PIPELINE_VERSION,
          },
        },
      };
    },
  });

  assert.deepEqual(result, { photos: true, videos: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, `/api/health?mediaPipeline=${VIDEO_PUBLISHING_PIPELINE_VERSION}`);
  assert.equal(calls[0].options.signal, controller.signal);
  assert.equal(calls[0].options.silent, true);
  assert.equal(calls[0].options.skipIdentityCheck, true);
});

test("media publishing health keeps malformed capability responses fail-closed", async () => {
  const result = await loadMediaPublishingCapabilities({
    apiCall: async () => ({
      capabilities: { mediaPublishing: { photos: true, videos: true, pipeline: "verified-v0" } },
    }),
  });
  assert.deepEqual(result, { photos: true, videos: false });
});
