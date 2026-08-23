export async function retireMediaAssetDrafts({ assetIds, apiCall } = {}) {
  if (typeof apiCall !== "function") throw new TypeError("apiCall is required");
  const ids = [...new Set((Array.isArray(assetIds) ? assetIds : [])
    .map((value) => String(value || "").trim())
    .filter(Boolean))];
  const outcomes = await Promise.all(ids.map(async (assetId) => {
    try {
      await apiCall(`/api/media/assets/${encodeURIComponent(assetId)}`, {
        method: "DELETE",
        context: "Discarding the unfinished media upload",
        silent: true,
      });
      // Both `removed:true` and the idempotent `removed:false` response mean
      // the caller no longer has a live owner draft to retain locally.
      return { assetId, retired: true };
    } catch (error) {
      return { assetId, retired: false, error };
    }
  }));
  return {
    retired: outcomes.filter((item) => item.retired).map((item) => item.assetId),
    pending: outcomes.filter((item) => !item.retired).map((item) => item.assetId),
  };
}
