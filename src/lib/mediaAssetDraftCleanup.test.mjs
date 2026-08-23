import assert from "node:assert/strict";
import test from "node:test";
import { retireMediaAssetDrafts } from "./mediaAssetDraftCleanup.mjs";

test("draft cleanup deletes each exact owner draft once and accepts idempotent missing responses", async () => {
  const calls = [];
  const result = await retireMediaAssetDrafts({
    assetIds: ["ma_one", "ma_one", "ma_missing"],
    apiCall: async (path, options) => {
      calls.push({ path, options });
      return path.endsWith("ma_one") ? { removed: true } : { removed: false };
    },
  });
  assert.deepEqual(result, { retired: ["ma_one", "ma_missing"], pending: [] });
  assert.deepEqual(calls.map((call) => call.path), [
    "/api/media/assets/ma_one",
    "/api/media/assets/ma_missing",
  ]);
  assert.ok(calls.every((call) => call.options.method === "DELETE" && call.options.silent === true));
});

test("draft cleanup keeps failed identities available for retry or orphan sweeping", async () => {
  const result = await retireMediaAssetDrafts({
    assetIds: ["ma_retry"],
    apiCall: async () => { throw new Error("offline"); },
  });
  assert.deepEqual(result.retired, []);
  assert.deepEqual(result.pending, ["ma_retry"]);
});
