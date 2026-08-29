import { api } from "./api";
import { isDurableMediaUrl, prepareMediaUploadAsset, uploadPreparedMediaAsset } from "./mediaUpload";
import { finalizeMediaSourceV1, resumeExistingMediaSourceV1 } from "./mediaAssetFinalize.mjs";
import { defaultMediaEdit } from "../domain/mediaEdit.mjs";
import { mediaSourceClientAssetId } from "../domain/mediaUploadIdentity.mjs";

function mediaPipelineError(code, message, cause) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.code = code;
  return error;
}

const optionalSourceDimension = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0
    ? Math.min(32_768, Math.round(numeric))
    : null;
};

const optionalSourceDuration = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.round(numeric) : null;
};

/**
 * Upload and verify one original camera-roll asset.
 *
 * This entry point intentionally has no editing or rendered-asset arguments.
 * It never accepts a caller-authored transform recipe: the only recipe sent to
 * the server is a fresh original recipe derived from authoritative hydrated
 * metadata. Server byte sniffing, image normalization, video transcoding and
 * durable poster generation remain mandatory.
 */
export async function uploadOriginalMediaAsset({
  asset,
  signal,
  onStage,
  onProgress,
  onRemoteDraft,
} = {}, services = {}) {
  const apiCall = services.apiCall || api;
  const prepareAsset = services.prepareAsset || prepareMediaUploadAsset;
  const uploadPrepared = services.uploadPrepared || uploadPreparedMediaAsset;
  if (!asset?.id || !asset?.uri) {
    throw mediaPipelineError("MEDIA_SOURCE_INVALID", "Choose that media again before uploading.");
  }

  const kind = asset.kind === "video" ? "video" : "image";
  const sourceRecipe = defaultMediaEdit(kind, { durationMs: asset.durationMs });
  const sourceWidth = optionalSourceDimension(asset.width);
  const sourceHeight = optionalSourceDimension(asset.height);
  const sourceDurationMs = optionalSourceDuration(asset.durationMs);
  const sourceFinalizeBody = {
    ...(sourceWidth === null ? {} : { width: sourceWidth }),
    ...(sourceHeight === null ? {} : { height: sourceHeight }),
    ...(kind === "video" && sourceDurationMs !== null ? { durationMs: sourceDurationMs } : {}),
    ...(kind === "image" ? { deliveryMode: "server" } : {}),
    orientation: [0, 90, 180, 270].includes(Number(asset.orientation)) ? Number(asset.orientation) : 0,
    editRecipe: sourceRecipe,
    altText: typeof asset.altText === "string" ? asset.altText : "",
  };

  let assetId = asset.assetId || null;
  let result = null;
  if (assetId) {
    // Resume an interrupted source verification without reading or uploading
    // the same private device file again.
    result = await resumeExistingMediaSourceV1({
      apiCall,
      asset,
      kind,
      body: sourceFinalizeBody,
      signal,
      onStage,
    });
  } else {
    const sourcePrepared = await prepareAsset({ ...asset, file: asset.runtimeFile || asset.file }, {
      optimizeWeb: false,
      context: "Preparing the original media",
    });
    const clientAssetId = mediaSourceClientAssetId({
      localId: asset.id,
      fileSize: sourcePrepared.fileSize,
      contentType: sourcePrepared.contentType,
      name: sourcePrepared.name,
    });
    onStage?.("preparing-source");
    const created = await apiCall("/api/media/assets", {
      method: "POST",
      context: "Preparing your Mshpit media",
      signal,
      body: {
        clientAssetId,
        purpose: "post",
        contentType: sourcePrepared.contentType,
        fileSize: sourcePrepared.fileSize,
        name: sourcePrepared.name,
      },
    });
    if (!created?.asset?.id) {
      throw mediaPipelineError("MEDIA_ASSET_INVALID", "Mshpit could not prepare that media item.");
    }
    assetId = created.asset.id;
    if (created.asset.status !== "ready") {
      onRemoteDraft?.({ assetId, duplicate: !!created.duplicate, sourceUploaded: false });
    }
    if (created.upload) {
      onStage?.("uploading-source");
      await uploadPrepared(sourcePrepared, created.upload, {
        signal,
        context: "Uploading the original media",
        onProgress: (progress) => onProgress?.({ ...progress, stage: "uploading-source" }),
      });
      onRemoteDraft?.({ assetId, duplicate: !!created.duplicate, sourceUploaded: true });
    }

    onStage?.("verifying-source");
    result = await finalizeMediaSourceV1({
      apiCall,
      assetId,
      kind,
      signal,
      body: sourceFinalizeBody,
    });
  }

  // The verifier owns the real duration. Rebase the constant original recipe
  // onto that measured value before saving metadata, so picker/hydration drift
  // can never become a trim operation.
  const authoritativeDurationMs = result?.asset?.durationMs ?? sourceDurationMs ?? asset.durationMs;
  const authoritativeOriginalRecipe = defaultMediaEdit(kind, { durationMs: authoritativeDurationMs });
  result = await apiCall(`/api/media/assets/${encodeURIComponent(assetId)}`, {
    method: "PATCH",
    context: "Saving original media details",
    signal,
    body: {
      editRecipe: authoritativeOriginalRecipe,
      altText: typeof asset.altText === "string" ? asset.altText : "",
    },
  });

  const finalAsset = result?.asset || (await apiCall(`/api/media/assets/${encodeURIComponent(assetId)}`, {
    context: "Checking your Mshpit media",
    signal,
  }))?.asset;
  if (!finalAsset?.id || finalAsset.status !== "ready" || !isDurableMediaUrl(finalAsset.url)) {
    throw mediaPipelineError("MEDIA_FINALIZE_PENDING", "Mshpit is still preparing that media item. Try the final step again.");
  }
  if (kind === "video" && !finalAsset.posterUrl) {
    throw mediaPipelineError("VIDEO_POSTER_REQUIRED", "The video preview was not verified. Try that upload again.");
  }
  onStage?.("ready");
  return {
    ...asset,
    edit: authoritativeOriginalRecipe,
    assetId: finalAsset.id,
    uri: finalAsset.sourceUrl || asset.uri,
    durableLocalUri: null,
    draftManaged: false,
    sourceUrl: finalAsset.url,
    posterUri: finalAsset.posterUrl || null,
    posterUrl: finalAsset.posterUrl || null,
    posterTimeMs: finalAsset.posterTimeMs ?? authoritativeOriginalRecipe.coverMs ?? 0,
    width: finalAsset.width || asset.width,
    height: finalAsset.height || asset.height,
    durationMs: finalAsset.durationMs ?? asset.durationMs,
    mimeType: finalAsset.mimeType || asset.mimeType,
    status: "ready",
    progress: 1,
    errorCode: null,
  };
}
