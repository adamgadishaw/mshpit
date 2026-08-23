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
    const posterTimeMs = Math.max(0, Math.round(Number(posterAsset.actualTimeMs) || 0));
    return {
      ...asset,
      // Auto-cover scoring may land on a better decoded frame than the recipe's
      // initial hint. Commit that exact reviewed frame into the recipe consumed
      // by authoritative finalization; otherwise Studio can preview one cover
      // while the private verifier publishes another.
      edit: { ...(asset.edit || {}), coverMs: posterTimeMs },
      posterAsset,
      posterUri: posterAsset.uri,
      posterTimeMs,
      durationMs: Math.max(0, Math.round(Number(posterAsset.durationMs ?? asset.durationMs) || 0)),
    };
  }
  return { ...asset };
}
