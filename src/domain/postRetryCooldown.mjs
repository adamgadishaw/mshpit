export const POST_RATE_LIMIT_FALLBACK_MS = 60_000;
export const POST_RATE_LIMIT_MAX_MS = 60 * 60_000;
export const ARTIST_CAMPAIGN_LIMIT_FALLBACK_MS = 24 * 60 * 60_000;
export const ARTIST_CAMPAIGN_LIMIT_MAX_MS = 24 * 60 * 60_000;
const POST_RATE_LIMIT_MIN_MS = 1_000;

function postErrorCode(error) {
  return error?.serverCode || error?.body?.code || error?.code;
}

export function isArtistCampaignLimitError(error) {
  return postErrorCode(error) === "ARTIST_CAMPAIGN_LIMIT";
}

function boundedCooldownMs(value, fallbackMs, maxMs) {
  const fallback = Number.isFinite(Number(fallbackMs)) && Number(fallbackMs) > 0
    ? Number(fallbackMs)
    : POST_RATE_LIMIT_FALLBACK_MS;
  const ceiling = Number.isFinite(Number(maxMs)) && Number(maxMs) > 0
    ? Number(maxMs)
    : POST_RATE_LIMIT_MAX_MS;
  const delay = Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : fallback;
  return Math.max(POST_RATE_LIMIT_MIN_MS, Math.min(ceiling, Math.ceil(delay)));
}

export function artistCampaignLimitCooldownMs(error, {
  fallbackMs = ARTIST_CAMPAIGN_LIMIT_FALLBACK_MS,
  maxMs = ARTIST_CAMPAIGN_LIMIT_MAX_MS,
} = {}) {
  if (!isArtistCampaignLimitError(error)) return 0;
  return boundedCooldownMs(error?.retryAfterMs, fallbackMs, maxMs);
}

export function postRateLimitCooldownMs(error, {
  fallbackMs = POST_RATE_LIMIT_FALLBACK_MS,
  maxMs = POST_RATE_LIMIT_MAX_MS,
} = {}) {
  const status = Number(error?.status || error?.body?.status);
  const code = postErrorCode(error);
  // Featured treatment has its own daily allowance. It must never disable the
  // ordinary composer: the artist can turn Featured off and publish now.
  if (isArtistCampaignLimitError(error)) return 0;
  if (status !== 429 && code !== "RATE_LIMITED") return 0;
  const hinted = Number(error?.retryAfterMs);
  return boundedCooldownMs(hinted, fallbackMs, maxMs);
}

export function postRetryRemainingSeconds(retryAt, at = Date.now()) {
  const remaining = Number(retryAt) - Number(at);
  return Number.isFinite(remaining) && remaining > 0 ? Math.ceil(remaining / 1000) : 0;
}

export function postRetryCooldownMessage(seconds) {
  const safe = Math.max(1, Math.ceil(Number(seconds) || 1));
  const minutes = Math.ceil(safe / 60);
  const wait = safe >= 60
    ? `${minutes} ${minutes === 1 ? "minute" : "minutes"}`
    : `${safe} ${safe === 1 ? "second" : "seconds"}`;
  return `Posting is paused for ${wait}. Your post is still here.`;
}

export const POST_RETRY_READY_MESSAGE = "Your post is still here. You can try posting again now.";
export const FEATURED_RETRY_READY_MESSAGE = "Featured posting is available again. Your post is still here.";
