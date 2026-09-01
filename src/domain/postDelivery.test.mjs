import assert from "node:assert/strict";
import test from "node:test";

import { deliverPostCreate, shouldRetryPostCreate } from "./postDelivery.mjs";

test("post create retries only ambiguous or temporary failures", () => {
  for (const status of [0, 408, 425, 500, 502, 503, 504]) {
    assert.equal(shouldRetryPostCreate({ status }), true, `status ${status}`);
  }
  for (const status of [400, 401, 403, 409, 422, 429]) {
    assert.equal(shouldRetryPostCreate({ status }), false, `status ${status}`);
  }
});

test("post delivery reuses the exact body and account across a lost response", async () => {
  const calls = [];
  const waits = [];
  const body = Object.freeze({ clientMutationId: "post_retry_12345678", kind: "status", review: "hello" });
  const result = await deliverPostCreate({
    apiCall: async (path, options) => {
      calls.push({ path, options });
      if (calls.length === 1) throw Object.assign(new Error("lost response"), { status: 0 });
      return { id: "p_server", duplicate: true };
    },
    body,
    context: "Posting your update",
    expectedAccountId: "u_1",
    retryDelaysMs: [25],
    wait: async (delay) => waits.push(delay),
  });

  assert.deepEqual(result, { id: "p_server", duplicate: true });
  assert.deepEqual(waits, [25]);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].path, "/api/posts");
  assert.equal(calls[0].options.body, body);
  assert.equal(calls[1].options.body, body);
  assert.equal(calls[1].options.expectedAccountId, "u_1");
  assert.equal(calls[1].options.silent, true);
  assert.equal(calls[1].options.timeoutMs, 12_000);
});

test("post delivery never retries validation, auth, conflict, or rate limits", async () => {
  for (const status of [400, 401, 409, 429]) {
    let calls = 0;
    await assert.rejects(() => deliverPostCreate({
      apiCall: async () => {
        calls += 1;
        throw Object.assign(new Error("definitive"), { status });
      },
      body: { clientMutationId: `post_no_retry_${status}` },
      retryDelaysMs: [0, 0],
      wait: async () => assert.fail("definitive failures must not wait"),
    }));
    assert.equal(calls, 1);
  }
});

test("post delivery stops after its bounded retry budget", async () => {
  let calls = 0;
  const failure = Object.assign(new Error("offline"), { status: 503 });
  await assert.rejects(() => deliverPostCreate({
    apiCall: async () => { calls += 1; throw failure; },
    body: { clientMutationId: "post_bounded_retry_1" },
    retryDelaysMs: [0, 0],
    wait: async () => {},
  }), (error) => error === failure);
  assert.equal(calls, 3);
});
