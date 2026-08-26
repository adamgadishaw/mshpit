import {
  MEDIA_PHOTO_SOURCE_MAX_BYTES,
  MEDIA_VIDEO_SOURCE_MAX_BYTES,
  mediaUploadLimitLabel,
} from "./mediaUploadPolicy.mjs";
import {
  VIDEO_MAX_DURATION_MS,
  mediaImageAnimationUnsupported,
  mediaImageNeedsNativeDecode,
  mediaSourceSizeAllowed,
  mediaVideoSourceCompatible,
} from "./mediaEdit.mjs";

export const MEDIA_PREFLIGHT_CODES = Object.freeze({
  imageTooLarge: "IMAGE_TOO_LARGE",
  videoTooLarge: "VIDEO_TOO_LARGE",
  animatedImageUnsupported: "ANIMATED_IMAGE_UNSUPPORTED",
  webImageDecodeUnsupported: "WEB_IMAGE_DECODE_UNSUPPORTED",
  videoContainerUnsupported: "VIDEO_CONTAINER_UNSUPPORTED",
  videoDurationMissing: "VIDEO_DURATION_MISSING",
  videoTooLong: "VIDEO_TOO_LONG",
  videoDimensionsMissing: "VIDEO_DIMENSIONS_MISSING",
});

const issue = (code, message) => ({ code, message });

// Picker metadata is only an early UX boundary. The server still measures the
// immutable upload and authoritatively verifies video duration/dimensions and
// codecs before publishing. This check prevents known-dead-end files from
// entering Studio while allowing native staging to measure a missing size.
export function mediaPublishingPreflightIssue(asset = {}, { platform = "web" } = {}) {
  const kind = asset?.kind === "video" ? "video" : "image";
  if (!mediaSourceSizeAllowed(asset)) {
    return kind === "video"
      ? issue(MEDIA_PREFLIGHT_CODES.videoTooLarge, ("That clip is over PIT's " + mediaUploadLimitLabel(MEDIA_VIDEO_SOURCE_MAX_BYTES) + " limit. Export a shorter or smaller MP4 before opening it in PIT Studio."))
      : issue(MEDIA_PREFLIGHT_CODES.imageTooLarge, ("That photo is over PIT's " + mediaUploadLimitLabel(MEDIA_PHOTO_SOURCE_MAX_BYTES) + " limit. Export a smaller copy before opening it in PIT Studio."));
  }

  if (kind === "image") {
    if (mediaImageAnimationUnsupported(asset)) {
      return issue(MEDIA_PREFLIGHT_CODES.animatedImageUnsupported, "PIT will not silently flatten an animated GIF into one frame. Export it as a short MP4 clip once verified clip publishing is available.");
    }
    if (platform === "web" && mediaImageNeedsNativeDecode(asset)) {
      return issue(MEDIA_PREFLIGHT_CODES.webImageDecodeUnsupported, "This browser cannot safely decode HEIC or HEIF for PIT Studio. Choose a JPEG, PNG, or WebP, or add the photo from the PIT mobile app so it can create a web-safe rendition.");
    }
    return null;
  }

  if (!mediaVideoSourceCompatible(asset)) {
    return issue(MEDIA_PREFLIGHT_CODES.videoContainerUnsupported, "PIT accepts MP4 and iPhone MOV clips. Export WebM or another container as MP4 before opening it in PIT Studio.");
  }
  const durationMs = Number(asset?.durationMs);
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    return issue(MEDIA_PREFLIGHT_CODES.videoDurationMissing, "PIT could not verify this clip's duration from the picker. Export it as a 10-minute-or-shorter MP4 and choose it again.");
  }
  if (durationMs > VIDEO_MAX_DURATION_MS) {
    return issue(MEDIA_PREFLIGHT_CODES.videoTooLong, "Clips are limited to 10 minutes. Choose a shorter MP4; PIT will not silently publish the full file.");
  }
  if (Number(asset?.width) <= 1 || Number(asset?.height) <= 1) {
    return issue(MEDIA_PREFLIGHT_CODES.videoDimensionsMissing, "PIT could not read this clip's dimensions. Export a standard MP4 and choose it again.");
  }
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
  const first = failures[0]?.message || "That media item is not ready for PIT Studio.";
  return failures.length === 1 ? first : `${first} ${failures.length} selected items were skipped.`;
}
