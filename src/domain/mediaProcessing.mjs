import { mediaEditHasChanges, videoEditRequiresExport } from "./mediaEdit.mjs";
import { normalizeMediaProject } from "./mediaProject.mjs";

export const MEDIA_PROCESSING_ERROR = Object.freeze({
  PHOTO_RENDERER_UNAVAILABLE: "PHOTO_RENDERER_UNAVAILABLE",
  VIDEO_RENDERER_UNAVAILABLE: "VIDEO_RENDERER_UNAVAILABLE",
  POSTER_GENERATOR_UNAVAILABLE: "POSTER_GENERATOR_UNAVAILABLE",
  VIDEO_POSTER_REQUIRED: "VIDEO_POSTER_REQUIRED",
  SOURCE_UPLOAD_REQUIRED: "SOURCE_UPLOAD_REQUIRED",
  FINALIZE_REQUIRED: "FINALIZE_REQUIRED",
});

export function mediaAssetProcessingPlan(asset = {}, capabilities = {}) {
  const kind = asset.kind === "video" ? "video" : "image";
  const operations = [];
  if (kind === "image" && mediaEditHasChanges(asset.edit, { kind: "image" })) {
    if (!capabilities.photoRender) return { supported: false, errorCode: MEDIA_PROCESSING_ERROR.PHOTO_RENDERER_UNAVAILABLE, operations: [] };
    operations.push("render-photo");
  }
  if (kind === "video") {
    if (videoEditRequiresExport(asset.edit || {})) {
      if (!capabilities.videoRender) return { supported: false, errorCode: MEDIA_PROCESSING_ERROR.VIDEO_RENDERER_UNAVAILABLE, operations: [] };
      operations.push("render-video");
    }
    if (!asset.posterUrl) {
      if (!capabilities.posterGenerate) return { supported: false, errorCode: MEDIA_PROCESSING_ERROR.POSTER_GENERATOR_UNAVAILABLE, operations: [] };
      operations.push("generate-poster", "upload-poster");
    }
  }
  if (!asset.sourceUrl) operations.push("upload-source");
  if (!asset.assetId || asset.status !== "ready") operations.push("finalize-asset");
  return { supported: true, errorCode: null, operations };
}

export function mediaProjectPublishReadiness(project, { requireVideoPoster = true } = {}) {
  const assets = normalizeMediaProject(project).assets;
  if (!assets.length) return { ready: true, pendingIds: [], errorCodes: [] };
  const pendingIds = [];
  const errorCodes = [];
  for (const asset of assets) {
    let error = null;
    if (asset.status === "failed") error = asset.errorCode || MEDIA_PROCESSING_ERROR.FINALIZE_REQUIRED;
    else if (!asset.sourceUrl) error = MEDIA_PROCESSING_ERROR.SOURCE_UPLOAD_REQUIRED;
    else if (!asset.assetId) error = MEDIA_PROCESSING_ERROR.FINALIZE_REQUIRED;
    else if (requireVideoPoster && asset.kind === "video" && !asset.posterUrl) error = MEDIA_PROCESSING_ERROR.VIDEO_POSTER_REQUIRED;
    else if (asset.status !== "ready") error = MEDIA_PROCESSING_ERROR.FINALIZE_REQUIRED;
    if (error) {
      pendingIds.push(asset.id);
      errorCodes.push(error);
    }
  }
  return { ready: pendingIds.length === 0, pendingIds, errorCodes: [...new Set(errorCodes)] };
}

export function nextMediaProcessingAsset(project) {
  const assets = normalizeMediaProject(project).assets;
  return assets.find((asset) => asset.status !== "ready" || !asset.sourceUrl || !asset.assetId || (asset.kind === "video" && !asset.posterUrl)) || null;
}

export function mediaProcessingMessage(errorCode) {
  switch (errorCode) {
    case MEDIA_PROCESSING_ERROR.PHOTO_RENDERER_UNAVAILABLE:
      return "This device cannot export that photo edit yet. Reset the edit or try another device.";
    case MEDIA_PROCESSING_ERROR.VIDEO_RENDERER_UNAVAILABLE:
      return "PIT can save a video cover now, but trim, color and audio edits need the video renderer before publishing.";
    case MEDIA_PROCESSING_ERROR.POSTER_GENERATOR_UNAVAILABLE:
    case MEDIA_PROCESSING_ERROR.VIDEO_POSTER_REQUIRED:
      return "Choose a video cover before publishing.";
    case MEDIA_PROCESSING_ERROR.SOURCE_UPLOAD_REQUIRED:
      return "Finish uploading the original media before publishing.";
    case MEDIA_PROCESSING_ERROR.FINALIZE_REQUIRED:
      return "PIT is still verifying this media. Your draft is safe.";
    default:
      return "This media is not ready yet. Try the failed step again.";
  }
}
