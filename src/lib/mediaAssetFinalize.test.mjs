import assert from "node:assert/strict";
import test from "node:test";

import {
  MEDIA_SOURCE_FINALIZE_REQUEST_TIMEOUT_MS,
  MEDIA_SOURCE_FINALIZE_V1_TIMEOUT_MS,
  finalizeMediaSourceV1,
  resumeExistingMediaSourceV1,
} from "./mediaAssetFinalize.mjs";
import { resolveRequestTimeout } from "./requestControl.mjs";

const input = Object.freeze({
  assetId: "ma_abcdefgh12345678",
  kind: "video",
  body: Object.freeze({ width: 1080, height: 1920, durationMs: 25_000, orientation: 0, editRecipe: {}, altText: "" }),
});

const ready = () => ({ asset: { id: input.assetId, status: "ready" }, finalize: { state: "completed" } });
const processing = () => ({ asset: { id: input.assetId, status: "upload_pending" }, finalize: { state: "processing" } });

test("an immediately ready source uses a bounded request inside the longer resumable processing envelope", async () => {
  let captured;
  const result = await finalizeMediaSourceV1({
    ...input,
    apiCall: async (path, options) => {
      captured = { path, options };
      return ready();
    },
  });
  assert.equal(result.asset.status, "ready");
  assert.equal(captured.path, "/api/media/assets/ma_abcdefgh12345678/finalize");
  assert.equal(captured.options.timeoutMs, MEDIA_SOURCE_FINALIZE_REQUEST_TIMEOUT_MS);
  assert.ok(MEDIA_SOURCE_FINALIZE_V1_TIMEOUT_MS > captured.options.timeoutMs);
  assert.equal(resolveRequestTimeout("POST", captured.options.timeoutMs), captured.options.timeoutMs,
    "the shared request controller must not silently shorten the rolling-deploy request budget");
});

test("accepted video finalization polls until the authoritative asset is ready", async () => {
  const calls = [];
  let clock = 1_000;
  let reads = 0;
  const result = await finalizeMediaSourceV1({
    ...input,
    now: () => clock,
    wait: async (ms) => { clock += ms; },
    apiCall: async (path, options) => {
      calls.push({ path, method: options.method, body: options.body });
      if (options.method === "POST") return processing();
      reads += 1;
      return reads === 1 ? processing() : ready();
    },
  });
  assert.equal(result.asset.status, "ready");
  assert.deepEqual(calls.map((call) => call.method), ["POST", "GET", "GET"]);
  assert.deepEqual(calls[0].body, { ...input.body, async: true });
});

test("metadata-poor video still polls by media kind without inventing dimensions or duration", async () => {
  const calls = [];
  let clock = 1_000;
  const body = { orientation: 0, editRecipe: {}, altText: "" };
  const result = await finalizeMediaSourceV1({
    assetId: input.assetId,
    kind: "video",
    body,
    now: () => clock,
    wait: async (ms) => { clock += ms; },
    apiCall: async (_path, options) => {
      calls.push(options);
      return options.method === "POST" ? processing() : ready();
    },
  });
  assert.equal(result.asset.status, "ready");
  assert.deepEqual(calls.map(({ method }) => method), ["POST", "GET"]);
  assert.deepEqual(calls[0].body, { ...body, async: true });
  assert.equal("width" in calls[0].body, false);
  assert.equal("height" in calls[0].body, false);
  assert.equal("durationMs" in calls[0].body, false);
});

test("photo source finalization returns render-pending work to the rendition step", async () => {
  let waits = 0;
  const result = await finalizeMediaSourceV1({
    assetId: input.assetId,
    body: { width: 1_080, height: 1_920, orientation: 0, editRecipe: {}, altText: "" },
    wait: async () => { waits += 1; },
    apiCall: async (_path, options) => {
      assert.equal(options.method, "POST");
      return {
        asset: { id: input.assetId, status: "render_pending" },
      };
    },
  });
  assert.equal(result.asset.status, "render_pending");
  assert.equal(waits, 0, "photo rendition creation must not wait on video-ready state");
});

test("a lost photo POST recovers from a prior server's metadata-free GET", async () => {
  const calls = [];
  let clock = 5_000;
  const result = await finalizeMediaSourceV1({
    assetId: input.assetId,
    body: { width: 1_080, height: 1_920, orientation: 0, editRecipe: {}, altText: "" },
    now: () => clock,
    wait: async (ms) => { clock += ms; },
    apiCall: async (path, options) => {
      calls.push({ path, method: options.method });
      if (options.method === "POST") throw new Error("response lost after photo finalize");
      return { asset: { id: input.assetId, status: "render_pending" } };
    },
  });
  assert.equal(result.asset.status, "render_pending");
  assert.deepEqual(calls.map(({ method }) => method), ["POST", "GET"]);
});

test("a pending remote video resumes GET plus finalize polling without another source PUT", async () => {
  const calls = [];
  let reads = 0;
  const result = await resumeExistingMediaSourceV1({
    asset: { assetId: input.assetId, status: "selected" },
    kind: "video",
    body: input.body,
    apiCall: async (path, options = {}) => {
      calls.push({ path, method: options.method || "GET" });
      if (!options.method || options.method === "GET") {
        reads += 1;
        return reads === 1
          ? { asset: { id: input.assetId, status: "upload_pending" }, finalize: { state: "idle" } }
          : ready();
      }
      if (options.method === "POST") return processing();
      throw new Error(`Unexpected media resume method: ${options.method}`);
    },
  });
  assert.equal(result.asset.status, "ready");
  assert.deepEqual(calls.map(({ method }) => method), ["GET", "POST", "GET"]);
  assert.equal(calls.every(({ path }) => path.includes(`/api/media/assets/${input.assetId}`)), true);
  assert.equal(calls.some(({ method }) => method === "PUT"), false);
  assert.equal(calls.some(({ path }) => path === "/api/media/assets"), false,
    "resume never creates a second source ticket");
});

test("a genuinely ready video remains blocked from unsupported cover re-edit", async () => {
  let calls = 0;
  await assert.rejects(() => resumeExistingMediaSourceV1({
    asset: { assetId: input.assetId, status: "ready" },
    kind: "video",
    body: input.body,
    apiCall: async () => { calls += 1; return ready(); },
  }), (error) => error.code === "VIDEO_COVER_REEDIT_UNAVAILABLE");
  assert.equal(calls, 0, "ready video re-edit fails before storage or API work");
});

test("a stable background failure preserves its public code and retryability", async () => {
  let clock = 2_000;
  await assert.rejects(() => finalizeMediaSourceV1({
    ...input,
    now: () => clock,
    wait: async (ms) => { clock += ms; },
    apiCall: async (_path, options) => options.method === "POST"
      ? processing()
      : {
        asset: { id: input.assetId, status: "upload_pending" },
        finalize: {
          state: "failed",
          error: { code: "RATE_LIMITED", status: 429, message: "Clip verification is busy.", retryable: true },
        },
      },
  }), (error) => error.code === "RATE_LIMITED" && error.status === 429
    && error.retryable === true && error.message === "Clip verification is busy.");
});

test("caller cancellation stops polling immediately", async () => {
  const controller = new AbortController();
  await assert.rejects(() => finalizeMediaSourceV1({
    ...input,
    signal: controller.signal,
    apiCall: async () => processing(),
    wait: async () => {
      controller.abort();
      throw Object.assign(new Error("cancelled"), { name: "AbortError" });
    },
  }), (error) => error?.name === "AbortError");
});

test("the overall processing deadline is bounded and leaves the resumable source intact", async () => {
  let clock = 10_000;
  let reads = 0;
  await assert.rejects(() => finalizeMediaSourceV1({
    ...input,
    pollIntervalMs: 5_000,
    now: () => clock,
    wait: async (ms) => { clock += ms; },
    apiCall: async (_path, options) => {
      if (options.method === "GET") reads += 1;
      return processing();
    },
  }), (error) => error.code === "MEDIA_STORAGE_UNAVAILABLE" && error.status === 503
    && error.retryable === true && /upload is saved/u.test(error.message));
  assert.equal(reads, MEDIA_SOURCE_FINALIZE_V1_TIMEOUT_MS / 5_000, "polling remains bounded instead of hot-looping");
});

test("an idle coordinator after restart resubmits the identical finalize operation once", async () => {
  let clock = 20_000;
  let submissions = 0;
  let reads = 0;
  const submittedBodies = [];
  const result = await finalizeMediaSourceV1({
    ...input,
    now: () => clock,
    wait: async (ms) => { clock += ms; },
    apiCall: async (_path, options) => {
      if (options.method === "POST") {
        submissions += 1;
        submittedBodies.push(options.body);
        return processing();
      }
      reads += 1;
      if (reads === 1) {
        return { asset: { id: input.assetId, status: "upload_pending" }, finalize: { state: "idle" } };
      }
      return ready();
    },
  });
  assert.equal(result.asset.status, "ready");
  assert.equal(submissions, 2);
  assert.deepEqual(submittedBodies, [
    { ...input.body, async: true },
    { ...input.body, async: true },
  ]);
});

test("a lost acknowledgement recovers by polling instead of duplicating source bytes", async () => {
  let clock = 30_000;
  let calls = 0;
  const result = await finalizeMediaSourceV1({
    ...input,
    now: () => clock,
    wait: async (ms) => { clock += ms; },
    apiCall: async (_path, options) => {
      calls += 1;
      if (options.method === "POST") throw new Error("response lost after acceptance");
      return ready();
    },
  });
  assert.equal(result.asset.status, "ready");
  assert.equal(calls, 2);
});
