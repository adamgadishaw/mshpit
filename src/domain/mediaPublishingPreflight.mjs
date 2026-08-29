import {
  MEDIA_PHOTO_SOURCE_MAX_BYTES,
  MEDIA_VIDEO_SOURCE_MAX_BYTES,
  mediaUploadLimitLabel,
} from "./mediaUploadPolicy.mjs";
import { mediaSourceSizeAllowed } from "./mediaEdit.mjs";

export const MEDIA_PREFLIGHT_CODES = Object.freeze({
  imageTooLarge: "IMAGE_TOO_LARGE",
  videoTooLarge: "VIDEO_TOO_LARGE",
});

const issue = (code, message) => ({ code, message });

// Picker metadata is only an early UX boundary. The server still measures the
// immutable upload and authoritatively verifies video duration/dimensions and
// codecs before publishing. This check prevents known-dead-end files from
// entering the upload queue while upload preparation can measure a missing size.
export function mediaPublishingPreflightIssue(asset = {}) {
  const kind = asset?.kind === "video" ? "video" : "image";
  if (!mediaSourceSizeAllowed(asset)) {
    return kind === "video"
      ? issue(MEDIA_PREFLIGHT_CODES.videoTooLarge, ("That clip is over the " + mediaUploadLimitLabel(MEDIA_VIDEO_SOURCE_MAX_BYTES) + " upload limit. Choose a shorter or smaller copy before uploading it."))
      : issue(MEDIA_PREFLIGHT_CODES.imageTooLarge, ("That photo is over the " + mediaUploadLimitLabel(MEDIA_PHOTO_SOURCE_MAX_BYTES) + " upload limit. Choose a smaller copy before uploading it."));
  }

  if (kind === "image") {
    // Do not use browser/device decoder support as an admission gate. The
    // immutable source is byte-sniffed and normalized by PIT's server media
    // pipeline; picker metadata is only advisory and may be stale on iOS.
    return null;
  }

  // Picker MIME, container, duration and dimensions are advisory. Upload the
  // readable original and let the authoritative verifier inspect the source.
  return null;
}

export function mediaPublishingPreflightSelection(assets, options) {
  const accepted = [];
  const rejected = [];
  for (const asset of Array.isArray(assets) ? assets : []) {
    const problem = mediaPublishingPreflightIssue(asset, options);
    if (problem) rejected.push({ asset, ...problem });
    else accepted.push(asset);
  }
  return { accepted, rejected };
}

export function mediaPublishingPreflightMessage(rejected) {
  const failures = Array.isArray(rejected) ? rejected : [];
  if (!failures.length) return "";
  const first = failures[0]?.message || "That media item is not ready to upload.";
  return failures.length === 1 ? first : `${first} ${failures.length} selected items were skipped.`;
}
