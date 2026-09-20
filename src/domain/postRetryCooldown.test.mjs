import assert from "node:assert/strict";
import test from "node:test";

import {
  ARTIST_CAMPAIGN_LIMIT_FALLBACK_MS,
  ARTIST_CAMPAIGN_LIMIT_MAX_MS,
  POST_RATE_LIMIT_FALLBACK_MS,
  POST_RATE_LIMIT_MAX_MS,
  artistCampaignLimitCooldownMs,
  isArtistCampaignLimitError,
  postRateLimitCooldownMs,
  postRetryCooldownMessage,
  postRetryRemainingSeconds,
} from "./postRetryCooldown.mjs";

test("post cooldown accepts only rate-limit failures and honors a bounded server hint", () => {
  assert.equal(postRateLimitCooldownMs({ status: 503, retryAfterMs: 30_000 }), 0);
  assert.equal(postRateLimitCooldownMs({ status: 429, retryAfterMs: 1_500 }), 1_500);
  assert.equal(postRateLimitCooldownMs({ serverCode: "RATE_LIMITED" }), POST_RATE_LIMIT_FALLBACK_MS);
  assert.equal(postRateLimitCooldownMs({ status: 429, retryAfterMs: 1 }), 1_000);
  assert.equal(postRateLimitCooldownMs({ status: 429, retryAfterMs: 90_000_000 }), POST_RATE_LIMIT_MAX_MS);
});

test("featured-post quota never blocks an ordinary post", () => {
  const error = {
    status: 429,
    serverCode: "ARTIST_CAMPAIGN_LIMIT",
    retryAfterMs: POST_RATE_LIMIT_MAX_MS,
  };
  assert.equal(isArtistCampaignLimitError(error), true);
  assert.equal(isArtistCampaignLimitError({ status: 429, serverCode: "RATE_LIMITED" }), false);
  assert.equal(postRateLimitCooldownMs(error), 0);
  assert.equal(artistCampaignLimitCooldownMs(error), POST_RATE_LIMIT_MAX_MS);
  assert.equal(artistCampaignLimitCooldownMs({ serverCode: "ARTIST_CAMPAIGN_LIMIT" }), ARTIST_CAMPAIGN_LIMIT_FALLBACK_MS);
  assert.equal(artistCampaignLimitCooldownMs({ serverCode: "ARTIST_CAMPAIGN_LIMIT", retryAfterMs: 90_000_000 }), ARTIST_CAMPAIGN_LIMIT_MAX_MS);
  assert.equal(artistCampaignLimitCooldownMs({ serverCode: "RATE_LIMITED", retryAfterMs: 5_000 }), 0);
});

test("post cooldown countdown is visible, rounded up and expires deterministically", () => {
  assert.equal(postRetryRemainingSeconds(12_001, 10_000), 3);
  assert.equal(postRetryRemainingSeconds(10_000, 10_000), 0);
  assert.equal(postRetryCooldownMessage(1), "Posting is paused for 1 second. Your post is still here.");
  assert.equal(postRetryCooldownMessage(61), "Posting is paused for 2 minutes. Your post is still here.");
});
