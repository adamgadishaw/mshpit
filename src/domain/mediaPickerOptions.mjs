export function postMediaPickerOptions({ platform, remaining, iosH264Preset, allowVideos = false }) {
  const selectionLimit = Math.max(1, Math.min(6, Math.floor(Number(remaining) || 1)));
  return {
    // Video is an explicit server capability. Defaulting to images keeps stale,
    // offline, and not-yet-hydrated clients on the honest production boundary.
    mediaTypes: allowVideos === true ? ["images", "videos"] : ["images"],
    quality: 0.6,
    videoQuality: 1,
    allowsMultipleSelection: true,
    selectionLimit,
    // SDK 56 only guarantees the user's multi-select order on iOS when this
    // flag is enabled. PIT preserves that order through Studio and publishing.
    ...(platform === "ios" ? { orderedSelection: true } : {}),
    // Expo SDK 56 otherwise uses Passthrough on iOS, preserving a QuickTime
    // MOV container that has uneven desktop-browser support. This preset emits
    // an actual H.264/AAC MP4 and caps giant phone captures at 1080p.
    ...(platform === "ios" && allowVideos === true && iosH264Preset != null
      ? { videoExportPreset: iosH264Preset }
      : {}),
  };
}
