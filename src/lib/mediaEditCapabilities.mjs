export const MEDIA_EDIT_ENGINE_VERSION = 1;

export function createMediaEditCapabilities({
  platform = "unknown",
  imageGeometry = false,
  imageRaster = false,
  videoCover = false,
} = {}) {
  return Object.freeze({
    version: MEDIA_EDIT_ENGINE_VERSION,
    platform,
    image: Object.freeze({
      crop: !!imageGeometry,
      rotate: !!imageGeometry,
      flip: !!imageGeometry,
      resize: !!imageGeometry,
      adjustments: !!imageRaster,
      filters: !!imageRaster,
      export: !!imageGeometry && !!imageRaster,
    }),
    video: Object.freeze({
      cover: !!videoCover,
      trim: false,
      mute: false,
      filters: false,
      destructiveExport: false,
    }),
  });
}

export function mediaCapabilityBlockers(capabilities, kind = "image") {
  if (kind === "video") {
    return capabilities?.video?.cover
      ? []
      : ["A frame-extraction engine is unavailable on this platform."];
  }
  const blockers = [];
  if (!capabilities?.image?.crop) blockers.push("The geometry renderer is unavailable.");
  if (!capabilities?.image?.adjustments) blockers.push("The photo adjustment renderer is unavailable.");
  return blockers;
}

export function canCommitMediaAsset(capabilities, asset) {
  if (asset?.kind === "video") return !!capabilities?.video?.cover;
  return !!capabilities?.image?.export;
}
