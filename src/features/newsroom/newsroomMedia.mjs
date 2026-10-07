const cancelled = (signal) => {
  if (signal?.aborted) throw Object.assign(new Error("Article media cancelled."), { name: "AbortError" });
};
function verifiedMedia(asset, assetId, kind) {
  if (asset?.id !== assetId || asset.kind !== kind || asset.status !== "ready" || !/^https:\/\//u.test(asset.url || "")
      || (kind === "video" && !/^https:\/\//u.test(asset.posterUrl || ""))) {
    throw new Error(`The article ${kind === "video" ? "video" : "photo"} is not ready. Retry verification or choose its original file again.`);
  }
  return { assetId, kind, uri: asset.url, sourceUrl: asset.url, posterUri: asset.posterUrl || null, status: "ready" };
}
export async function uploadNewsroomMedia({ accountId, asset, kind = "image", signal, onRemoteDraft, onStage }, { uploadOriginal } = {}) {
  cancelled(signal);
  const verified = await uploadOriginal({ asset: { ...asset, kind }, expectedAccountId: accountId, signal,
    postWhileConverting: false, onRemoteDraft, onStage });
  cancelled(signal);
  return verifiedMedia({ id: verified.assetId, kind: verified.kind, status: verified.status,
    url: verified.sourceUrl || verified.uri, posterUrl: verified.posterUri }, verified.assetId, kind);
}
export async function loadNewsroomMedia({ accountId, assetId, kind = "image", signal, onStage }, services = {}) {
  cancelled(signal);
  const result = await services.apiCall(`/api/media/assets/${encodeURIComponent(assetId)}`, {
    context: "Restoring your article media", silent: true, expectedAccountId: accountId, signal,
  });
  cancelled(signal);
  if (result?.asset?.id !== assetId || result.asset.kind !== kind) throw new Error("The saved article media is unavailable. Choose it again.");
  if (result.asset.status === "ready") return verifiedMedia(result.asset, assetId, kind);
  return uploadNewsroomMedia({ accountId, asset: { id: `news-media:${assetId}`, assetId, kind }, kind, signal, onStage }, services);
}
