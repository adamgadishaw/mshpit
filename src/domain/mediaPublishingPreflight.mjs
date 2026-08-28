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
// entering Studio while allowing native staging to measure a missing size.
export function mediaPublishingPreflightIssue(asset = {}) {
  const kind = asset?.kind === "video" ? "video" : "image";
  if (!mediaSourceSizeAllowed(asset)) {
    return kind === "video"
      ? issue(MEDIA_PREFLIGHT_CODES.videoTooLarge, ("That clip is over the " + mediaUploadLimitLabel(MEDIA_VIDEO_SOURCE_MAX_BYTES) + " upload limit. Export a shorter or smaller MP4 before opening it in the photo and video editor."))
      : issue(MEDIA_PREFLIGHT_CODES.imageTooLarge, ("That photo is over the " + mediaUploadLimitLabel(MEDIA_PHOTO_SOURCE_MAX_BYTES) + " upload limit. Export a smaller copy before opening it in the photo and video editor."));
  }

  if (kind === "image") {
    // Do not use browser/device decoder support as an admission gate. The
    // immutable source is byte-sniffed and normalized by PIT's server media
    // pipeline; picker metadata is only advisory and may be stale on iOS.
    return null;
  }

  // Picker MIME, container, duration and dimensions are advisory. Stage the
  // readable bytes and let the authoritative verifier inspect the source.
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
  const first = failures[0]?.message || "That media item is not ready for the photo and video editor.";
  return failures.length === 1 ? first : `${first} ${failures.length} selected items were skipped.`;
}
