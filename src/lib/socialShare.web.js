import * as Clipboard from "expo-clipboard";

import { socialShareFileName } from "../domain/socialShareCard.mjs";
import { apiBinary } from "./api";

export const instagramStorySharingConfigured = () => false;

export async function createShareCardAsset(model, { accountId, signal } = {}) {
  if (!accountId || !model?.renderRequest || typeof File !== "function") return null;
  const response = await apiBinary("/api/share-cards/render", {
    method: "POST",
    body: model.renderRequest,
    context: "Preparing a share card",
    silent: true,
    signal,
    timeoutMs: 15_000,
    expectedAccountId: accountId,
    acceptedContentTypes: ["image/png"],
  });
  const blob = new Blob([response.bytes], { type: response.contentType || "image/png" });
  const file = new File([blob], socialShareFileName(model), { type: blob.type });
  const previewUri = URL.createObjectURL(blob);
  return { blob, file, previewUri };
}

export function releaseShareCardAsset(asset) {
  try {
    if (asset?.previewUri) URL.revokeObjectURL(asset.previewUri);
  } catch {
    // architecture: allow-empty-catch -- object-URL cleanup is best-effort and must never block closing the share modal.
  }
}

export async function copyShareLink(url) {
  const copied = await Clipboard.setStringAsync(String(url || ""));
  if (!copied) throw new Error("COPY_UNAVAILABLE");
  return { mode: "copied" };
}

export async function openExternalShareUrl(url) {
  if (typeof window === "undefined") throw new Error("WINDOW_UNAVAILABLE");
  const opened = window.open(url, "_blank", "noopener,noreferrer");
  if (!opened) throw new Error("POPUP_BLOCKED");
  return { mode: "external" };
}

export async function downloadShareCard(model, { preparedAsset = null } = {}) {
  if (!preparedAsset?.previewUri || typeof document === "undefined") throw new Error("DOWNLOAD_UNAVAILABLE");
  const anchor = document.createElement("a");
  anchor.href = preparedAsset.previewUri;
  anchor.download = socialShareFileName(model);
  anchor.target = "_blank";
  anchor.rel = "noopener noreferrer";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  return { mode: "download" };
}

export async function shareCardToInstagramStory(model, options = {}) {
  await downloadShareCard(model, options);
  return { mode: "story-download" };
}
