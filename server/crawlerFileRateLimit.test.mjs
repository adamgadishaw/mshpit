import assert from "node:assert/strict";
import test from "node:test";

import {
  crawlerFileRateLimitDefaults,
  crawlerFileRateLimitPolicy,
} from "./crawlerFileRateLimit.js";

test("crawler-file rate limits are isolated per normalized client IP", () => {
  assert.deepEqual(crawlerFileRateLimitPolicy(" 203.0.113.7 "), {
    key: "crawler-file:203.0.113.7",
    max: 300,
    windowMs: 60_000,
  });
  assert.equal(
    crawlerFileRateLimitPolicy("198.51.100.9").key,
    "crawler-file:198.51.100.9",
  );
  assert.equal(crawlerFileRateLimitPolicy("").key, "crawler-file:unknown");
  assert.deepEqual(crawlerFileRateLimitDefaults, {
    max: 300,
    windowMs: 60_000,
  });
});
