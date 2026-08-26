import { MEDIA_POST_MAX_ATTACHMENTS } from "./mediaUploadPolicy.mjs";

export function postMediaPickerOptions({ platform, remaining, iosH264Preset, allowPhotos = true, allowVideos = false }) {
  // The composer owns the shared post capacity and passes only the open
  // slots. Do not add a smaller picker-only ceiling: it made an empty post
  // stop early even though Studio and publishing had more open slots.
  const selectionLimit = Math.max(1, Math.min(MEDIA_POST_MAX_ATTACHMENTS, Math.floor(Number(remaining) || 1)));
  const mediaTypes = [
    ...(allowPhotos === true ? ["images"] : []),
    ...(allowVideos === true ? ["videos"] : []),
  ];
  return {
    // Each type is an explicit server capability. The composer never calls the
    // picker when both are disabled; the image fallback is only a defensive
    // valid SDK option for direct helper callers.
    mediaTypes: mediaTypes.length ? mediaTypes : ["images"],
    quality: 0.6,
    videoQuality: 1,
    allowsMultipleSelection: true,
    selectionLimit,
    // SDK 56 only guarantees the user's multi-select order on iOS when this
    // flag is enabled. PIT preserves that order through Studio and publishing.
    ...(platform === "ios" ? {
      orderedSelection: true,
      // SDK 56 otherwise leaves iCloud-only assets remote and unreadable.
      shouldDownloadFromNetwork: true,
    } : {}),
    // Expo SDK 56 otherwise uses Passthrough on iOS, preserving a QuickTime
    // MOV container that has uneven desktop-browser support. This preset emits
    // an actual H.264/AAC MP4 and caps giant phone captures at 1080p.
    ...(platform === "ios" && allowVideos === true && iosH264Preset != null
      ? { videoExportPreset: iosH264Preset }
      : {}),
  };
}
