import { api } from "../../lib/api";

const clientAssetId = (asset) => `news-photo:${String(asset?.id || "photo")
  .replace(/[^A-Za-z0-9._:-]/g, "-")}`.slice(0, 120);

export async function uploadSelfWrittenPhoto({ accountId, asset, signal }) {
  const { prepareMediaUploadAsset, uploadPreparedMediaAsset } = await import("../../lib/mediaUpload.js");
  const prepared = await prepareMediaUploadAsset(asset, { optimizeWeb: false, context: "Preparing your article photo", signal });
  const created = await api("/api/media/assets", {
    method: "POST", context: "Preparing your Mshpit article photo", silent: true, expectedAccountId: accountId, signal,
    body: { clientAssetId: clientAssetId(asset), purpose: "post", contentType: prepared.contentType, fileSize: prepared.fileSize, name: prepared.name },
  });
  if (!created?.asset?.id) throw new Error("Mshpit could not prepare that article photo.");
  if (created.upload) await uploadPreparedMediaAsset(prepared, created.upload, { signal, context: "Uploading your article photo" });
  const assetId = created.asset.id;
  const result = created.asset.status === "ready" && created.asset.url ? created
    : await api(`/api/media/assets/${encodeURIComponent(assetId)}/finalize`, {
      method: "POST", context: "Verifying your Mshpit article photo", silent: true, expectedAccountId: accountId, signal,
      body: { orientation: [0, 90, 180, 270].includes(Number(asset.orientation)) ? Number(asset.orientation) : 0,
        deliveryMode: "server", altText: typeof asset.altText === "string" ? asset.altText : "" },
    });
  const verified = result?.asset;
  if (verified?.id !== assetId || verified.status !== "ready" || !/^https?:\/\//i.test(String(verified.url || ""))) {
    throw new Error("Mshpit is still preparing that article photo. Try the final step again.");
  }
  return { ...asset, kind: "image", assetId, uri: verified.url, status: "ready" };
}

export async function loadSelfWrittenPhoto({ accountId, assetId, signal }) {
  const result = await api("/api/media/assets/" + encodeURIComponent(assetId), {
    context: "Restoring your article photo", silent: true, expectedAccountId: accountId, signal,
  });
  const asset = result?.asset;
  if (asset?.id !== assetId || asset.kind !== "image" || asset.status !== "ready" || !/^https:\/\//iu.test(String(asset.url || ""))) {
    throw new Error("The saved article photo is no longer available. Choose another photo.");
  }
  return { assetId, kind: "image", uri: asset.url, status: "ready" };
}
