import {
  rateLimit,
  rateLimitAvailable,
  rateLimitRetryAfterMs,
  reserveRateLimits,
} from "./auth.js";
import { ApiError } from "./errors.js";

function rateLimitError(key, windowMs, {
  message = "Too many requests, slow down and try again.",
  code = "RATE_LIMITED",
  retryAfterMaxMs,
} = {}) {
  const error = code === "ARTIST_CAMPAIGN_LIMIT"
    ? new ApiError(429, message, "ARTIST_CAMPAIGN_LIMIT")
    : new ApiError(429, message, "RATE_LIMITED");
  error.retryAfterMs = rateLimitRetryAfterMs(key, windowMs, retryAfterMaxMs);
  return error;
}

// One typed boundary for member-facing HTTP limits. The retry deadline is
// carried on the error so sendApiError can emit a bounded Retry-After header;
// callers never need access to the process-local bucket itself.
export function enforceRateLimit(key, max, windowMs, {
  message = "Too many requests, slow down and try again.",
  code = "RATE_LIMITED",
  retryAfterMaxMs,
} = {}) {
  if (rateLimit(key, max, windowMs)) return;
  throw rateLimitError(key, windowMs, { message, code, retryAfterMaxMs });
}

// All buckets are admitted or none are consumed. A rejected specialized
// action (such as Featured promotion) must not burn the ordinary-post budget.
export function enforceRateLimitGroup(requests = []) {
  const normalized = (Array.isArray(requests) ? requests : []).map((request) => ({
    key: String(request?.key || ""),
    max: Number(request?.max),
    windowMs: Number(request?.windowMs),
    cost: Math.max(1, Math.floor(Number(request?.cost) || 1)),
    options: request?.options || {},
  }));
  if (!normalized.length) throw new TypeError("A rate-limit group requires at least one request.");
  const reservation = reserveRateLimits(normalized);
  if (reservation) {
    reservation.commit();
    return;
  }
  const denied = normalized.find((request) => !rateLimitAvailable(
    request.key,
    request.max,
    request.windowMs,
    request.cost,
  )) || normalized[0];
  throw rateLimitError(denied.key, denied.windowMs, denied.options);
}
