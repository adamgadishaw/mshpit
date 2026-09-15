import assert from "node:assert/strict";
import test from "node:test";
import { apiRetryAfterHeaders, createApiResponseHeaders } from "./responseHeaders.js";

test("retry timing on provider errors is bounded and keeps responses uncached", () => {
  assert.deepEqual(apiRetryAfterHeaders({ status: 502, retryAfterMs: 1500 }), { "Retry-After": "2" });
  assert.deepEqual(apiRetryAfterHeaders({ status: 429, retryAfterMs: 0.5 }), { "Retry-After": "1" });
  assert.deepEqual(apiRetryAfterHeaders({ status: 503, retryAfterMs: 90000000 }), { "Retry-After": "3600" });
  assert.equal(createApiResponseHeaders(apiRetryAfterHeaders({ status: 502, retryAfterMs: 1000 }))["Cache-Control"], "no-store");
});

test("untrusted, missing and non-retryable timing cannot enter headers", () => {
  for (const delay of [undefined, null, -1, 0, NaN, Infinity, "1000", "1\r\nX-Leak:secret"]) {
    assert.deepEqual(apiRetryAfterHeaders({ status: 503, retryAfterMs: delay }), {});
  }
  assert.deepEqual(apiRetryAfterHeaders({ status: 401, retryAfterMs: 1000 }), {});
});
