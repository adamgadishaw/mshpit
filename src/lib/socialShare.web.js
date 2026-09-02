import * as Clipboard from "expo-clipboard";

import { socialShareFileName } from "../domain/socialShareCard.mjs";
import { openHttpsSharePopup } from "../domain/socialSharePopup.mjs";
import { apiBinary } from "./api";

const SOCIAL_PLATFORMS = new Set(["x", "facebook"]);

export const instagramStorySharingConfigured = () => false;

function socialShareMessage(model) {
  return [...new Set([model?.shareText, model?.url]
    .map((value) => String(value || "").trim())
    .filter(Boolean))]
    .join("\n\n");
}

function browserCanShareFile(preparedAsset) {
  if (typeof navigator === "undefined"
    || typeof navigator.share !== "function"
    || typeof navigator.canShare !== "function"
    || !preparedAsset?.file) return false;
  try {
    return navigator.canShare({ files: [preparedAsset.file] });
  } catch {
    return false;
  }
}

async function openBrowserShareSheet(model, preparedAsset, platform) {
  if (!browserCanShareFile(preparedAsset)) return null;
  try {
    await navigator.share({
      files: [preparedAsset.file],
      text: socialShareMessage(model),
      title: `Share ${model?.title || "from Mshpit"}`,
    });
    return { mode: "web-share-sheet", platform };
  } catch (error) {
    if (error?.name === "AbortError") return { mode: "dismissed", platform };
    throw new Error("SOCIAL_SHARE_NOT_OPENED");
  }
}

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

export function openExternalShareUrl(url) {
  return openHttpsSharePopup(url);
}

export async function shareCardToSocialPlatform(platform, model, { preparedAsset = null, intentUrl = null } = {}) {
  if (!SOCIAL_PLATFORMS.has(platform) || !model?.url || !preparedAsset?.previewUri || !intentUrl) {
    throw new Error("SOCIAL_ARTWORK_UNAVAILABLE");
  }
  const shared = await openBrowserShareSheet(model, preparedAsset, platform);
  if (shared) return shared;
  // Keep both browser actions inside the original tap. Public social intents cannot receive a private Blob attachment.
  const composer = openExternalShareUrl(intentUrl);
  const download = downloadShareCard(model, { preparedAsset });
  await Promise.all([composer, download]);
  return { mode: "composer-download", platform };
}

export async function downloadShareCard(model, { preparedAsset = null } = {}) {
  if (!preparedAsset?.previewUri || typeof document === "undefined") throw new Error("DOWNLOAD_UNAVAILABLE");
  const anchor = document.createElement("a");
  anchor.href = preparedAsset.previewUri;
  anchor.download = socialShareFileName(model);
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  return { mode: "download" };
}

export async function shareCardToInstagramStory(model, options = {}) {
  const shared = await openBrowserShareSheet(model, options.preparedAsset, "instagram");
  if (shared) return shared;
  await downloadShareCard(model, options);
  return { mode: "story-download" };
}
