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
      // A locally decoded cover is an optional preview only. Its timestamp is
      // still useful: commit the reviewed frame time into the recipe so the
      // private verifier generates the durable poster from the source video.
      edit: { ...(asset.edit || {}), coverMs: posterTimeMs },
      posterAsset,
      posterUri: posterAsset.uri,
      posterTimeMs,
      durationMs: Math.max(0, Math.round(Number(posterAsset.durationMs ?? asset.durationMs) || 0)),
    };
  }
  return { ...asset };
}
