import { api } from "./api";
import { isDurableMediaUrl, prepareMediaUploadAsset, uploadPreparedMediaAsset } from "./mediaUpload";
import { finalizeMediaSourceV1, resumeExistingMediaSourceV1 } from "./mediaAssetFinalize.mjs";
import { defaultMediaEdit, mediaSourceMaxBytes, mediaSourceSizeAllowed } from "../domain/mediaEdit.mjs";
import { mediaUploadLimitLabel } from "../domain/mediaUploadPolicy.mjs";
import { mediaSourceClientAssetId } from "../domain/mediaUploadIdentity.mjs";
import { boundedMediaRequest, recoverMediaRequest } from "../domain/mediaRequestRecovery.mjs";
import { mediaUploadTimeoutMs } from "../domain/mediaUploadDeadline.mjs";

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
  expectedAccountId,
  onStage,
  onProgress,
  onRemoteDraft,
} = {}, services = {}) {
  if (typeof expectedAccountId !== "string" || !expectedAccountId.trim()) {
    throw mediaPipelineError("MEDIA_ACCOUNT_REQUIRED", "An account identity is required to upload media.");
  }
  const accountId = expectedAccountId.trim();
  const abortIfNeeded = () => {
    if (!signal?.aborted) return;
    const error = mediaPipelineError("MEDIA_UPLOAD_CANCELLED", "Media upload was cancelled.");
    error.name = "AbortError";
    throw error;
  };
  const transport = services.apiCall || api;
  const apiCall = async (path, options) => {
    abortIfNeeded();
    const result = await transport(path, { ...options, signal: options?.signal || signal, expectedAccountId: accountId });
    abortIfNeeded();
    return result;
  };
  const prepareAsset = services.prepareAsset || prepareMediaUploadAsset;
  const uploadPrepared = services.uploadPrepared || uploadPreparedMediaAsset;
  abortIfNeeded();
  // Saved drafts intentionally omit temporary camera-roll/blob URLs. Once the
  // source PUT completed, its account-scoped server ID is enough to resume.
  if (!asset?.id || (!asset?.assetId && !asset?.uri)) {
    throw mediaPipelineError("MEDIA_SOURCE_INVALID", "Choose that media again before uploading.");
  }

  let kind = asset.kind === "video" ? "video" : "image";
  let sourceRecipe = defaultMediaEdit(kind, { durationMs: asset.durationMs });
  const sourceWidth = optionalSourceDimension(asset.width);
  const sourceHeight = optionalSourceDimension(asset.height);
  const sourceDurationMs = optionalSourceDuration(asset.durationMs);
  let sourceFinalizeBody = {
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
    try {
      result = await resumeExistingMediaSourceV1({
        apiCall,
        asset,
        kind,
        body: sourceFinalizeBody,
        signal,
        onStage,
        onRemoteDraft,
        recovery: services.recovery,
      });
    } catch (error) {
      abortIfNeeded();
      const localUri = String(asset.durableLocalUri || asset.uri || "");
      const file = asset.runtimeFile || asset.file;
      const hasDeviceOriginal = (typeof Blob !== "undefined" && file instanceof Blob && file.size > 0)
        || /^(?:blob:|file:\/\/|content:\/\/)/i.test(localUri);
      if (error?.code !== "MEDIA_SOURCE_MISSING" || !hasDeviceOriginal) throw error;
      onRemoteDraft?.({ retiredAssetId: assetId });
      assetId = null;
    }
  }
  if (!assetId) {
    const sourcePrepared = await boundedMediaRequest(() => prepareAsset({ ...asset, file: asset.runtimeFile || asset.file }, {
      optimizeWeb: false,
      context: "Preparing the original media",
    }), { signal, timeoutMs: 30_000 });
    abortIfNeeded();
    // Safari/iCloud may omit MIME metadata, and a file extension is only a
    // hint. Preparation sniffs source bytes; use that result for the original
    // recipe and required video poster rather than sending an image recipe
    // for a real clip (or the reverse). Server probing remains authoritative.
    if (["image", "video"].includes(sourcePrepared.kind) && sourcePrepared.kind !== kind) {
      kind = sourcePrepared.kind;
      sourceRecipe = defaultMediaEdit(kind, { durationMs: kind === "video" ? asset.durationMs : 0 });
      sourceFinalizeBody = { ...sourceFinalizeBody, editRecipe: sourceRecipe };
      delete sourceFinalizeBody.durationMs;
      delete sourceFinalizeBody.deliveryMode;
      if (kind === "image") sourceFinalizeBody.deliveryMode = "server";
      else if (sourceDurationMs !== null) sourceFinalizeBody.durationMs = sourceDurationMs;
    }
    if (!mediaSourceSizeAllowed({ kind }, sourcePrepared.fileSize)) {
      const error = mediaPipelineError("MEDIA_TOO_LARGE", `That ${kind === "video" ? "clip" : "photo"} is over the ${mediaUploadLimitLabel(mediaSourceMaxBytes({ kind }))} upload limit. Choose a smaller copy.`);
      error.status = 413;
      error.retryable = false;
      throw error;
    }
    const clientAssetId = mediaSourceClientAssetId({
      localId: asset.id,
      fileSize: sourcePrepared.fileSize,
      contentType: sourcePrepared.contentType,
      name: sourcePrepared.name,
    });
    onStage?.("preparing-source");
    const createBody = {
      clientAssetId,
      purpose: "post",
      contentType: sourcePrepared.contentType,
      fileSize: sourcePrepared.fileSize,
      name: sourcePrepared.name,
    };
    const created = await recoverMediaRequest(({ signal: requestSignal }) => apiCall("/api/media/assets", {
      method: "POST",
      context: "Preparing your Mshpit media",
      signal: requestSignal,
      timeoutMs: 10_000,
      silent: true,
      body: createBody,
    }), { ...services.recovery, signal, onRetry: () => onStage?.("reconnecting-source") });
    if (!created?.asset?.id) {
      throw mediaPipelineError("MEDIA_ASSET_INVALID", "Mshpit could not prepare that media item.");
    }
    assetId = created.asset.id;
    if (created.asset.status !== "ready") {
      onRemoteDraft?.({ assetId, kind, duplicate: !!created.duplicate, sourceUploaded: false });
    }
    if (created.upload) {
      onStage?.("uploading-source");
      await boundedMediaRequest(({ signal: transferSignal }) => uploadPrepared(sourcePrepared, created.upload, {
        signal: transferSignal,
        context: "Uploading the original media",
        onProgress: (progress) => { if (!signal?.aborted && !transferSignal.aborted) onProgress?.({ ...progress, stage: "uploading-source" }); },
      }), { signal, timeoutMs: mediaUploadTimeoutMs(sourcePrepared) });
      abortIfNeeded();
      onRemoteDraft?.({ assetId, kind, duplicate: !!created.duplicate, sourceUploaded: true });
    }

    result = await finalizeMediaSourceV1({
      apiCall,
      assetId,
      kind,
      signal,
      body: sourceFinalizeBody,
      onStage,
    });
  }

  // Finalization already persisted the normalized original recipe and alt text
  // in the same transaction that made the delivery ready. Do not gate a
  // successfully verified upload on a second identical PATCH that can fail or
  // be cancelled after all expensive work has completed.
  const finalAsset = result?.asset || (await recoverMediaRequest(({ signal: requestSignal }) => apiCall(`/api/media/assets/${encodeURIComponent(assetId)}`, {
    context: "Checking your Mshpit media",
    signal: requestSignal,
    timeoutMs: 10_000,
    silent: true,
  }), { ...services.recovery, signal, onRetry: () => onStage?.("reconnecting-source") }))?.asset;
  abortIfNeeded();
  if (finalAsset?.id !== assetId || finalAsset.status !== "ready" || !isDurableMediaUrl(finalAsset.url)) {
    throw mediaPipelineError("MEDIA_FINALIZE_PENDING", "Mshpit is still preparing that media item. Try the final step again.");
  }
  if (["image", "video"].includes(finalAsset.kind)) kind = finalAsset.kind;
  if (kind === "video" && !finalAsset.posterUrl) {
    throw mediaPipelineError("VIDEO_POSTER_REQUIRED", "The video preview was not verified. Try that upload again.");
  }
  const authoritativeDurationMs = finalAsset.durationMs ?? sourceDurationMs ?? asset.durationMs;
  const authoritativeOriginalRecipe = finalAsset.editRecipe
    || defaultMediaEdit(kind, { durationMs: authoritativeDurationMs });
  onStage?.("ready");
  return {
    ...asset,
    kind,
    edit: authoritativeOriginalRecipe,
    assetId: finalAsset.id,
    uri: finalAsset.sourceUrl || finalAsset.url,
    // Verified delivery and the owner-scoped asset id replace the transient
    // File. Retaining it pins entire iPhone albums in memory after upload.
    runtimeFile: null,
    file: null,
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
