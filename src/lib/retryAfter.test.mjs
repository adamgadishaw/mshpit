import assert from "node:assert/strict";
import test from "node:test";
import { retryAfterDelayMs } from "./retryAfter.mjs";

test("retry hints accept finite seconds and HTTP dates only for retryable transport statuses", () => {
  const now = Date.parse("Wed, 16 Sep 2026 01:00:00 GMT");
  for (const status of [429, 502, 503, 504]) {
    assert.equal(retryAfterDelayMs("30", { status, now }), 30_000);
    assert.equal(retryAfterDelayMs("0", { status, now }), 0);
    assert.equal(retryAfterDelayMs("Wed, 16 Sep 2026 01:00:45 GMT", { status, now }), 45_000);
    assert.equal(retryAfterDelayMs("9999999999", { status, now }), 3_600_000);
    assert.equal(retryAfterDelayMs("30", { status, retryable: false, now }), null);
  }
  for (const status of [200, 400, 401, 403, 404, 409, 500]) assert.equal(retryAfterDelayMs("30", { status, now }), null);
  assert.equal(retryAfterDelayMs("2026", { status: 502, now }), 2_026_000, "numeric text is seconds, not an implicitly parsed year");
  assert.equal(retryAfterDelayMs("86400", { status: 429, code: "ARTIST_CAMPAIGN_LIMIT", now }), 86_400_000);
  assert.equal(retryAfterDelayMs("9999999999", { status: 429, code: "ARTIST_CAMPAIGN_LIMIT", now }), 86_400_000);
  for (const value of [null, undefined, "", "NaN", "Infinity", "-1", "1e9", "x".repeat(200), "Tue, 15 Sep 2026 01:00:00 GMT"]) {
    assert.equal(retryAfterDelayMs(value, { status: 502, now }), null);
  }
});
