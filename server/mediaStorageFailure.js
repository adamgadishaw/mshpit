import { ApiError } from "./errors.js";

const REASONS = new Set([
  "configuration_invalid",
  "privacy_not_ready",
  "service_capacity",
]);
const CONTROL_OPERATIONS = new Set([
  "source_upload_signing",
  "source_download_signing",
  "head_signing",
  "video_delivery_signing",
  "photo_delivery_signing",
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

// Capability signing is local control-plane work, not a provider request. Map
// all underlying implementation exceptions to one fixed operation token so an
// alert is actionable without retaining credentials, object keys, URLs, or a
// raw TypeError whose origin cannot be distinguished from network transport.
export function mediaStorageControlFailure(operation) {
  if (!CONTROL_OPERATIONS.has(operation)) throw new TypeError("Unknown media storage control operation");
  const cause = new Error("Media storage control operation failed");
  cause.name = "MediaStorageControl";
  cause.code = operation;
  return cause;
}
