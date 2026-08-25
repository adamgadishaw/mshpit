import assert from "node:assert/strict";
import test from "node:test";
import {
  GUEST_SEARCH_RETENTION_DAYS,
  guestSearchResultBucket,
  guestSearchRetentionCutoffDay,
  guestSearchUtcDay,
  sanitizeGuestSearchPayload,
} from "./guestSearchAnalytics.mjs";

test("guest search payloads retain only categorical measurement fields", () => {
  assert.deepEqual(sanitizeGuestSearchPayload({
    kind: "all",
    resultBucket: "one_to_five",
    outcome: "success",
    query: "private search words",
    q: "more private words",
    userId: "u_private",
    deviceId: "device_private",
    ip: "203.0.113.10",
    url: "https://example.test/search?q=private",
    at: 123456789,
  }), {
    kind: "all",
    resultBucket: "one_to_five",
    outcome: "success",
  });

  assert.deepEqual(sanitizeGuestSearchPayload({
    kind: "all",
    resultBucket: "unknown",
    outcome: "failed",
    query: "never leaves the device",
  }), {
    kind: "all",
    resultBucket: "unknown",
    outcome: "failed",
  });
});

test("guest search payloads reject invalid or misleading combinations", () => {
  assert.equal(sanitizeGuestSearchPayload(null), null);
  assert.equal(sanitizeGuestSearchPayload([]), null);
  assert.equal(sanitizeGuestSearchPayload({ kind: "all", resultBucket: "zero", outcome: "failed" }), null);
  assert.equal(sanitizeGuestSearchPayload({ kind: "all", resultBucket: "unknown", outcome: "success" }), null);
  assert.equal(sanitizeGuestSearchPayload({ kind: "private text", resultBucket: "zero", outcome: "success" }), null);
  assert.equal(sanitizeGuestSearchPayload({ kind: "all", resultBucket: "1 result", outcome: "success" }), null);
  assert.equal(sanitizeGuestSearchPayload({ kind: "all", resultBucket: "zero", outcome: "cancelled" }), null);
});

test("guest search result buckets have stable boundaries", () => {
  assert.equal(guestSearchResultBucket(0), "zero");
  assert.equal(guestSearchResultBucket(1), "one_to_five");
  assert.equal(guestSearchResultBucket(5), "one_to_five");
  assert.equal(guestSearchResultBucket(6), "six_to_twenty");
  assert.equal(guestSearchResultBucket(20), "six_to_twenty");
  assert.equal(guestSearchResultBucket(21), "over_twenty");
  assert.equal(guestSearchResultBucket(-1), null);
  assert.equal(guestSearchResultBucket(1.5), null);
  assert.equal(guestSearchResultBucket(Number.POSITIVE_INFINITY), null);
});

test("guest search day keys are UTC and retention is exactly 90 calendar days", () => {
  const now = Date.parse("2026-08-25T23:59:59.999Z");
  assert.equal(GUEST_SEARCH_RETENTION_DAYS, 90);
  assert.equal(guestSearchUtcDay(now), "2026-08-25");
  assert.equal(guestSearchRetentionCutoffDay(now), "2026-05-28");
  assert.equal(guestSearchRetentionCutoffDay(now, 1), "2026-08-25");
  assert.throws(() => guestSearchRetentionCutoffDay(now, 91), /between 1 and 90/);
  assert.throws(() => guestSearchUtcDay(Number.NaN), /valid time/);
});
