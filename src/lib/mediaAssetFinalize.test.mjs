import assert from "node:assert/strict";
import test from "node:test";

import {
  MEDIA_SOURCE_FINALIZE_V1_TIMEOUT_MS,
  finalizeMediaSourceV1,
} from "./mediaAssetFinalize.mjs";

const input = Object.freeze({
  assetId: "ma_abcdefgh12345678",
  body: Object.freeze({ width: 1080, height: 1920, durationMs: 25_000, orientation: 0, editRecipe: {}, altText: "" }),
});

test("private-derivative-v1 source finalization allows the bounded slow verifier without changing global API defaults", async () => {
  let release;
  let captured;
  const pending = finalizeMediaSourceV1({
    ...input,
    apiCall: (path, options) => {
      captured = { path, options };
      return new Promise((resolve) => { release = resolve; });
    },
  });
  assert.equal(captured.path, "/api/media/assets/ma_abcdefgh12345678/finalize");
  assert.equal(captured.options.timeoutMs, MEDIA_SOURCE_FINALIZE_V1_TIMEOUT_MS);
  assert.ok(captured.options.timeoutMs > 55_000);
  release({ asset: { id: input.assetId, status: "ready" } });
  assert.equal((await pending).asset.status, "ready");
});

test("verified source finalization preserves immediate caller cancellation", async () => {
  const controller = new AbortController();
  const pending = finalizeMediaSourceV1({
    ...input,
    signal: controller.signal,
    apiCall: (_path, options) => new Promise((resolve, reject) => {
      if (options.signal.aborted) reject(Object.assign(new Error("cancelled"), { name: "AbortError" }));
      else options.signal.addEventListener("abort", () => reject(Object.assign(new Error("cancelled"), { name: "AbortError" })), { once: true });
    }),
  });
  controller.abort();
  await assert.rejects(pending, (error) => error?.name === "AbortError");
});

test("a lost finalize response retries the identical asset operation safely", async () => {
  const calls = [];
  let committed = false;
  const apiCall = async (path, options) => {
    calls.push({ path, body: options.body, timeoutMs: options.timeoutMs });
    if (!committed) {
      committed = true;
      throw new Error("response lost after commit");
    }
    return { asset: { id: input.assetId, status: "ready" }, duplicate: true };
  };
  await assert.rejects(finalizeMediaSourceV1({ ...input, apiCall }), /response lost/);
  const retry = await finalizeMediaSourceV1({ ...input, apiCall });
  assert.equal(retry.duplicate, true);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1], calls[0]);
});
