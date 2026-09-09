import { ApiError } from "./errors.js";

const REASONS = new Set([
  "configuration_invalid",
  "privacy_not_ready",
  "service_capacity",
]);

// Keep the public status/code unchanged, but let the existing private alert
// classifier distinguish deployment configuration, privacy gating and quotas.
// Only fixed reasons enter telemetry: no bucket names, URLs or user details.
export function mediaStorageUnavailable(message, reason) {
  if (!REASONS.has(reason)) throw new TypeError("Unknown media storage failure reason");
  const cause = new Error("Media upload preparation unavailable");
  cause.name = "MediaStorageFailure";
  cause.code = reason;
  return new ApiError(503, message, "MEDIA_STORAGE_UNAVAILABLE", cause);
}
