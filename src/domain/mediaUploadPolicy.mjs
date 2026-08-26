const MEBIBYTE = 1024 * 1024;

// Upload policy is shared by the Expo client, API, structural probes, and
// isolated workers. These are abuse/resource boundaries, not account quotas:
// PIT does not meter a member's lifetime uploads.
export const MEDIA_PHOTO_SOURCE_MAX_BYTES = 30 * MEBIBYTE;
export const MEDIA_VIDEO_SOURCE_MAX_BYTES = 500 * MEBIBYTE;
export const MEDIA_VIDEO_MAX_DURATION_MS = 10 * 60_000;
export const MEDIA_VIDEO_MIN_DURATION_MS = 1_000;
export const MEDIA_POST_MAX_ATTACHMENTS = 20;
export const MEDIA_VIDEO_MAX_FRAME_RATE = 60;
export const MEDIA_VIDEO_MAX_SAMPLES = Math.floor(
  (MEDIA_VIDEO_MAX_DURATION_MS * MEDIA_VIDEO_MAX_FRAME_RATE) / 1_000,
) + 2;

export function mediaUploadLimitLabel(bytes) {
  const value = Number(bytes);
  return Number.isFinite(value) && value > 0
    ? `${Math.round(value / MEBIBYTE)} MB`
    : "the supported size";
}

// `If-None-Match: *` turns each signed object key into create-only storage.
// A retry after a lost successful response receives 412 because the exact key
// already exists; finalization then verifies that existing object. No other
// non-2xx storage response is success.
export function mediaPutStatusAccepted(status) {
  const value = Number(status);
  return (value >= 200 && value < 300) || value === 412;
}
