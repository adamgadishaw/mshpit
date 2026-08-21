export async function stageMediaDraftAssets(assets) {
  return Array.isArray(assets) ? assets : [];
}

export async function recoverMediaDraftAssets(assets) {
  return (Array.isArray(assets) ? assets : []).filter((asset) => !!asset?.sourceUrl
    || Number(asset?.runtimeFile?.size || asset?.file?.size) > 0
    || /^blob:/i.test(String(asset?.uri || "")));
}

export async function releaseMediaDraftAsset() { return false; }
export async function releaseMediaDraftAssets() {}
export async function deleteMediaDraftsForOwner() { return false; }
