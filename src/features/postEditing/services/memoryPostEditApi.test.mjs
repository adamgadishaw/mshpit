import assert from "node:assert/strict";
import test from "node:test";

import { saveMemoryPostEdit } from "./memoryPostEditApi.mjs";

test("fan-memory editing encodes one post id and forwards only the prepared body", async () => {
  const calls = [];
  const body = { review: "Updated memory", version: 4 };
  const saved = { id: "memory / one", kind: "memory", review: body.review };
  const result = await saveMemoryPostEdit("memory / one", body, {
    apiClient: async (...args) => {
      calls.push(args);
      return { post: saved };
    },
  });
  assert.equal(result, saved);
  assert.deepEqual(calls, [["/api/posts/memory%20%2F%20one", {
    method: "PATCH",
    context: "Saving your fan memory",
    body,
    signal: undefined,
    silent: true,
  }]]);
});

test("fan-memory editing rejects missing ids and malformed confirmations", async () => {
  await assert.rejects(() => saveMemoryPostEdit("", {}), /post id/i);
  await assert.rejects(() => saveMemoryPostEdit("memory-1", {}, {
    apiClient: async () => ({ post: null }),
  }), /response was invalid/i);
});
