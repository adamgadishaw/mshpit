import { MEDIA_POST_MAX_ATTACHMENTS } from "./mediaUploadPolicy.mjs";

export function postMediaPickerOptions({
  platform,
  remaining,
  iosPassthroughPreset,
  iosCurrentRepresentation,
  allowPhotos = true,
  allowVideos = false,
}) {
  // The composer owns the shared post capacity and passes only the open
  // slots. Do not add a smaller picker-only ceiling: it made an empty post
  // stop early even though publishing had more open slots.
  const selectionLimit = Math.max(1, Math.min(MEDIA_POST_MAX_ATTACHMENTS, Math.floor(Number(remaining) || 1)));
  const mediaTypes = [
    ...(allowPhotos === true ? ["images"] : []),
    // Request the paired asset explicitly on iOS. LogScreen projects a Live
    // Photo to its motion clip when clip publishing is healthy, and otherwise
    // keeps the still photo, so selecting one never becomes a dead end.
    ...(platform === "ios" && allowPhotos === true ? ["livePhotos"] : []),
    ...(allowVideos === true ? ["videos"] : []),
  ];
  return {
    // Each type is an explicit server capability. The composer never calls the
    // picker when both are disabled; the image fallback is only a defensive
    // valid SDK option for direct helper callers.
    mediaTypes: mediaTypes.length ? mediaTypes : ["images"],
    // Expo preserves animated GIF bytes on Android only at quality 1 with its
    // system editor disabled. Compression/normalization belongs after selection,
    // where PIT can sniff the actual bytes and retain the original safely.
    quality: 1,
    allowsEditing: false,
    videoQuality: 1,
    allowsMultipleSelection: true,
    selectionLimit,
    // SDK 56 only guarantees the user's multi-select order on iOS when this
    // flag is enabled. Mshpit preserves that order through publishing.
    ...(platform === "ios" ? {
      orderedSelection: true,
      // SDK 56 otherwise leaves iCloud-only assets remote and unreadable.
      shouldDownloadFromNetwork: true,
      // Keep the exact representation selected in Photos. The authenticated
      // media pipeline sniffs and normalizes the original bytes after upload;
      // asking iOS for a compatible copy first adds a large export delay.
      ...(iosCurrentRepresentation != null
        ? { preferredAssetRepresentationMode: iosCurrentRepresentation }
        : {}),
    } : {}),
    // SDK 56 Passthrough returns the original without an eager H.264 export.
    // The server verifier owns codec compatibility and public derivatives.
    ...(platform === "ios" && allowVideos === true && iosPassthroughPreset != null
      ? { videoExportPreset: iosPassthroughPreset }
      : {}),
  };
}
