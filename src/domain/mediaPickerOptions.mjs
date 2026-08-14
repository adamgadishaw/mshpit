export function postMediaPickerOptions({ platform, remaining, iosH264Preset }) {
  const selectionLimit = Math.max(1, Math.min(6, Math.floor(Number(remaining) || 1)));
  return {
    mediaTypes: ["images", "videos"],
    quality: 0.6,
    videoQuality: 1,
    allowsMultipleSelection: true,
    selectionLimit,
    // Expo SDK 56 otherwise uses Passthrough on iOS, preserving a QuickTime
    // MOV container that has uneven desktop-browser support. This preset emits
    // an actual H.264/AAC MP4 and caps giant phone captures at 1080p.
    ...(platform === "ios" && iosH264Preset != null
      ? { videoExportPreset: iosH264Preset }
      : {}),
  };
}
