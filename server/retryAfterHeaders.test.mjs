import assert from "node:assert/strict";
import test from "node:test";
import { apiRetryAfterHeaders, createApiResponseHeaders } from "./responseHeaders.js";

test("retry timing on provider errors is bounded and keeps responses uncached", () => {
  assert.deepEqual(apiRetryAfterHeaders({ status: 502, retryAfterMs: 1500 }), { "Retry-After": "2" });
  assert.deepEqual(apiRetryAfterHeaders({ status: 429, retryAfterMs: 0.5 }), { "Retry-After": "1" });
  assert.deepEqual(apiRetryAfterHeaders({ status: 503, retryAfterMs: 90000000 }), { "Retry-After": "3600" });
  assert.deepEqual(apiRetryAfterHeaders({ status: 429, code: "ARTIST_CAMPAIGN_LIMIT", retryAfterMs: 90000000 }), { "Retry-After": "86400" });
  assert.deepEqual(apiRetryAfterHeaders({ status: 502, code: "PROVIDER_UNAVAILABLE", retryAfterMs: 7_200_000 }), { "Retry-After": "7200" });
  assert.deepEqual(apiRetryAfterHeaders({ status: 502, code: "PROVIDER_UNAVAILABLE", retryAfterMs: 90000000 }), { "Retry-After": "86400" });
  assert.equal(createApiResponseHeaders(apiRetryAfterHeaders({ status: 502, retryAfterMs: 1000 }))["Cache-Control"], "no-store");
});

test("replayed provider errors count down their original absolute deadline", () => {
  const error = { status: 502, code: "PROVIDER_UNAVAILABLE", retryAt: 7_201_000, retryAfterMs: 7_200_000 };
  assert.deepEqual(apiRetryAfterHeaders(error, { now: 1_000 }), { "Retry-After": "7200" });
  assert.deepEqual(apiRetryAfterHeaders(error, { now: 3_601_000 }), { "Retry-After": "3600" });
  assert.deepEqual(apiRetryAfterHeaders(error, { now: error.retryAt }), {});
  assert.deepEqual(apiRetryAfterHeaders(error, { now: error.retryAt + 1 }), {});
  assert.deepEqual(apiRetryAfterHeaders({ ...error, retryAt: null }, { now: 1_000 }), { "Retry-After": "7200" });
  for (const retryAt of [NaN, Infinity, "7201000"]) {
    assert.deepEqual(apiRetryAfterHeaders({ ...error, retryAt }, { now: 1_000 }), {});
  }
});

test("untrusted, missing and non-retryable timing cannot enter headers", () => {
  for (const delay of [undefined, null, -1, 0, NaN, Infinity, "1000", "1\r\nX-Leak:secret"]) {
    assert.deepEqual(apiRetryAfterHeaders({ status: 503, retryAfterMs: delay }), {});
  }
  assert.deepEqual(apiRetryAfterHeaders({ status: 401, retryAfterMs: 1000 }), {});
});
