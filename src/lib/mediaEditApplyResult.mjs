export function mediaEditAssetNeedsPosterArtifact(asset) {
  // A URI can drive preview UI without being an uploadable native file or web
  // Blob. The Studio contract requires a concrete poster artifact per video.
  return asset?.kind === "video";
}

export function attachMediaEditArtifacts(asset, { renderedAsset = null, posterAsset = null } = {}) {
  if (!asset || typeof asset !== "object") return asset;
  if (asset.kind === "image") {
    // The selected local file is the immutable source upload. A rendered photo
    // is a separate server variant; replacing these fields would make source
    // verification and later non-destructive re-edits impossible.
    return renderedAsset ? { ...asset, renderedAsset } : { ...asset };
  }
  if (asset.kind === "video" && posterAsset) {
    return {
      ...asset,
      posterAsset,
      posterUri: posterAsset.uri,
      posterTimeMs: Math.max(0, Math.round(Number(posterAsset.actualTimeMs) || 0)),
      durationMs: Math.max(0, Math.round(Number(posterAsset.durationMs ?? asset.durationMs) || 0)),
    };
  }
  return { ...asset };
}
