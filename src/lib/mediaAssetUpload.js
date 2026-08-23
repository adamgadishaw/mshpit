import { api } from "./api";
import { prepareMediaUploadAsset, uploadPreparedMediaAsset } from "./mediaUpload";
import { finalizeMediaSourceV1 } from "./mediaAssetFinalize.mjs";
import { mediaEditFingerprint, mediaImageRequiresRender, normalizeMediaEdit, videoEditRequiresExport } from "../domain/mediaEdit.mjs";
import { mediaSourceClientAssetId, stableMediaUploadToken } from "../domain/mediaUploadIdentity.mjs";

function mediaPipelineError(code, message, cause) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.code = code;
  return error;
}

const safeDimension = (value) => Math.max(1, Math.min(32_768, Math.round(Number(value) || 1)));

async function createAndUploadVariant({
  assetId,
  localId,
  role,
  prepared,
  dimensions,
  timeMs,
  signal,
  onStage,
  onProgress,
  apiCall,
  uploadPrepared,
}) {
  onStage?.(role === "poster" ? "uploading-poster" : "uploading-render");
  const created = await apiCall(`/api/media/assets/${encodeURIComponent(assetId)}/variants`, {
    method: "POST",
    context: role === "poster" ? "Preparing the video cover" : "Preparing the edited photo",
    signal,
    body: {
      // Identity follows the logical edit/cover revision rather than an
      // encoder's nondeterministic byte size. Retrying the same recipe can
      // safely replace an unfinished variant instead of colliding forever.
      clientVariantId: stableMediaUploadToken(`${localId}:${role}`, `studio-${role}`),
      role,
      contentType: prepared.contentType,
      fileSize: prepared.fileSize,
      name: prepared.name,
    },
  });
  if (!created?.variant?.id) throw mediaPipelineError("MEDIA_VARIANT_INVALID", "PIT could not prepare that media rendition.");
  if (created.upload) {
    await uploadPrepared(prepared, created.upload, {
      signal,
      context: role === "poster" ? "Uploading the video cover" : "Uploading the edited photo",
      onProgress: (progress) => onProgress?.({ ...progress, stage: role === "poster" ? "uploading-poster" : "uploading-render" }),
    });
  }
  onStage?.(role === "poster" ? "verifying-poster" : "verifying-render");
  return apiCall(`/api/media/assets/${encodeURIComponent(assetId)}/variants/${encodeURIComponent(created.variant.id)}/finalize`, {
    method: "POST",
    context: role === "poster" ? "Verifying the video cover" : "Verifying the edited photo",
    signal,
    body: {
      width: safeDimension(dimensions?.width),
      height: safeDimension(dimensions?.height),
      ...(role === "poster" ? { timeMs: Math.max(0, Math.round(Number(timeMs) || 0)) } : {}),
    },
  });
}

/**
 * Upload and HEAD-verify one PIT Studio asset plus its required derivative.
 * This never substitutes a preview recipe for rendered bytes: edited photos
 * require `renderedAsset`, clips require `posterAsset`, and destructive video
 * edits fail before the immutable source upload begins.
 */
export async function uploadStudioMediaAsset({
  asset,
  renderedAsset = null,
  posterAsset = null,
  signal,
  onStage,
  onProgress,
  onRemoteDraft,
} = {}, services = {}) {
  const apiCall = services.apiCall || api;
  const prepareAsset = services.prepareAsset || prepareMediaUploadAsset;
  const uploadPrepared = services.uploadPrepared || uploadPreparedMediaAsset;
  if (!asset?.id || !asset?.uri) throw mediaPipelineError("MEDIA_SOURCE_INVALID", "Choose that media again before uploading.");
  const kind = asset.kind === "video" ? "video" : "image";
  const edit = normalizeMediaEdit(asset.edit, { kind, durationMs: asset.durationMs });
  const reusingVerifiedVideoSource = kind === "video" && !!asset.assetId;
  if (reusingVerifiedVideoSource) {
    // private-derivative-v1 posters come from the authoritative source verifier. Until
    // that verifier exposes an idempotent cover-regeneration contract, never
    // PATCH a new cover recipe or substitute client-generated poster bytes on
    // an already verified clip.
    throw mediaPipelineError(
      "VIDEO_COVER_REEDIT_UNAVAILABLE",
      "Verified clip covers cannot be changed yet. Remove the clip and add it again to choose a new cover.",
    );
  }
  const needsPhotoRender = mediaImageRequiresRender(asset, edit);
  if (kind === "video" && videoEditRequiresExport(edit)) {
    throw mediaPipelineError("VIDEO_RENDERER_UNAVAILABLE", "PIT can publish a chosen cover now, but this video edit needs the authoritative encoder.");
  }
  if (needsPhotoRender && !renderedAsset) {
    throw mediaPipelineError("PHOTO_RENDER_REQUIRED", "Render the edited photo before uploading it.");
  }
  if (kind === "video" && !posterAsset) {
    throw mediaPipelineError("VIDEO_POSTER_REQUIRED", "Choose and render a cover before uploading this clip.");
  }

  // Validate every local output before creating any remote ticket. A broken
  // render therefore cannot leave an avoidable orphan source in object storage.
  const renderPrepared = needsPhotoRender
    ? await prepareAsset(renderedAsset, { optimizeWeb: false, context: "Preparing the edited photo" })
    : null;
  const posterPrepared = kind === "video"
    ? await prepareAsset(posterAsset, { optimizeWeb: false, context: "Preparing the video cover" })
    : null;

  const recipeFingerprint = mediaEditFingerprint(edit, { kind, durationMs: asset.durationMs });
  let assetId = asset.assetId || null;
  let result = null;
  if (assetId) {
    // Reopening an already uploaded, still-unattached Studio asset must never
    // require the original device file again. Reconcile its owner-only server
    // descriptor, then mutate only the reversible recipe/derived rendition.
    onStage?.("checking-source");
    result = await apiCall(`/api/media/assets/${encodeURIComponent(assetId)}`, {
      context: "Checking your PIT media source",
      signal,
    });
    if (!result?.asset?.id) throw mediaPipelineError("MEDIA_ASSET_INVALID", "That PIT media source is no longer available.");
  } else {
    const sourcePrepared = await prepareAsset({ ...asset, file: asset.runtimeFile || asset.file }, {
      optimizeWeb: false,
      context: "Preparing the original media",
    });
    // The immutable source is independent from any reversible recipe. Changing
    // a filter or alt text must not upload the same original bytes as a new
    // source asset.
    const clientAssetId = mediaSourceClientAssetId({
      localId: asset.id,
      fileSize: sourcePrepared.fileSize,
      contentType: sourcePrepared.contentType,
      name: sourcePrepared.name,
    });
    onStage?.("preparing-source");
    const created = await apiCall("/api/media/assets", {
      method: "POST",
      context: "Preparing your PIT media",
      signal,
      body: {
        clientAssetId,
        purpose: "post",
        contentType: sourcePrepared.contentType,
        fileSize: sourcePrepared.fileSize,
        name: sourcePrepared.name,
      },
    });
    if (!created?.asset?.id) throw mediaPipelineError("MEDIA_ASSET_INVALID", "PIT could not prepare that media item.");
    assetId = created.asset.id;
    if (created.asset.status !== "ready") {
      // Surface the owner-only draft identity before the potentially long PUT
      // and decoder pass. The composer can then retire the exact source when a
      // user explicitly cancels or discards, without persisting the capability
      // in the recoverable local draft.
      onRemoteDraft?.({ assetId, duplicate: !!created.duplicate });
    }
    if (created.upload) {
      onStage?.("uploading-source");
      await uploadPrepared(sourcePrepared, created.upload, {
        signal,
        context: "Uploading the original media",
        onProgress: (progress) => onProgress?.({ ...progress, stage: "uploading-source" }),
      });
    }

    onStage?.("verifying-source");
    result = await finalizeMediaSourceV1({
      apiCall,
      assetId,
      signal,
      body: {
        width: safeDimension(asset.width),
        height: safeDimension(asset.height),
        ...(kind === "video" ? { durationMs: Math.max(1, Math.round(Number(asset.durationMs) || 0)) } : {}),
        orientation: [0, 90, 180, 270].includes(Number(asset.orientation)) ? Number(asset.orientation) : 0,
        editRecipe: edit,
        altText: typeof asset.altText === "string" ? asset.altText : "",
      },
    });
  }

  // Source finalization seals only the immutable bytes/declared dimensions.
  // Recipe and alt text are owner-mutable while the asset is unattached, so a
  // lost-response retry or a changed caption cannot strand the same source on
  // stale metadata. Attached media remains deliberately view-only; re-editing
  // it requires a fresh source/version rather than mutating a live post.
  result = await apiCall(`/api/media/assets/${encodeURIComponent(assetId)}`, {
    method: "PATCH",
    context: "Saving your PIT media edits",
    signal,
    body: {
      editRecipe: edit,
      altText: typeof asset.altText === "string" ? asset.altText : "",
    },
  });

  // A re-edit keeps the prior verified rendition live while the replacement is
  // staged. `ready + url` can therefore describe the safe fallback, not proof
  // that the newly PATCHed recipe already has matching pixels. The revision
  // flags make retries resume the staged output instead of incorrectly reusing
  // the old public image.
  const photoRevisionPending = !!(result?.revisionPending || result?.asset?.revisionPending || result?.recipeChanged);
  if (renderPrepared && (photoRevisionPending || !(result?.asset?.renderState === "ready" && result?.asset?.url))) {
    result = await createAndUploadVariant({
      assetId,
      localId: `${asset.id}:${recipeFingerprint}`,
      role: "render",
      prepared: renderPrepared,
      dimensions: renderedAsset,
      signal,
      onStage,
      onProgress,
      apiCall,
      uploadPrepared,
    });
  }
  if (posterPrepared && !reusingVerifiedVideoSource && !result?.asset?.posterUrl) {
    result = await createAndUploadVariant({
      assetId,
      localId: `${asset.id}:${recipeFingerprint}:${posterAsset.actualTimeMs ?? asset.posterTimeMs ?? edit.coverMs}`,
      role: "poster",
      prepared: posterPrepared,
      dimensions: posterAsset,
      timeMs: posterAsset.actualTimeMs ?? asset.posterTimeMs ?? edit.coverMs,
      signal,
      onStage,
      onProgress,
      apiCall,
      uploadPrepared,
    });
  }

  const finalAsset = result?.asset || (await apiCall(`/api/media/assets/${encodeURIComponent(assetId)}`, {
    context: "Checking your PIT media",
    signal,
  }))?.asset;
  if (!finalAsset?.id || finalAsset.status !== "ready" || !finalAsset.url) {
    throw mediaPipelineError(finalAsset?.renderState === "unavailable" ? "VIDEO_RENDERER_UNAVAILABLE" : "MEDIA_FINALIZE_PENDING", "PIT is still preparing that media item. Try the final step again.");
  }
  if (kind === "video" && !finalAsset.posterUrl) {
    throw mediaPipelineError("VIDEO_POSTER_REQUIRED", "The video cover was not verified. Try that step again.");
  }
  onStage?.("ready");
  return {
    ...asset,
    assetId: finalAsset.id,
    // Keep the owner's immutable source as the live editing input while the
    // legacy post projection uses only the verified public rendition. A page
    // reload can recover the same source through the owner-only asset route.
    uri: finalAsset.sourceUrl || asset.uri,
    durableLocalUri: null,
    draftManaged: false,
    sourceUrl: finalAsset.url,
    posterUri: finalAsset.posterUrl || null,
    posterUrl: finalAsset.posterUrl || null,
    posterTimeMs: finalAsset.posterTimeMs ?? posterAsset?.actualTimeMs ?? edit.coverMs ?? 0,
    width: finalAsset.width || asset.width,
    height: finalAsset.height || asset.height,
    durationMs: finalAsset.durationMs ?? asset.durationMs,
    mimeType: finalAsset.mimeType || asset.mimeType,
    status: "ready",
    progress: 1,
    errorCode: null,
  };
}
