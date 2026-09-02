import * as Clipboard from "expo-clipboard";
import { File, Paths } from "expo-file-system";
import { Linking, Platform } from "react-native";

import { socialShareFileName } from "../domain/socialShareCard.mjs";
import { apiBinary } from "./api";

const INSTAGRAM_STORY_APP_ID = String(process.env.EXPO_PUBLIC_META_APP_ID || "").trim();
const INSTAGRAM_PACKAGE = "com.instagram.android";
const INSTAGRAM_STORY_SCHEME = "instagram-stories://share";

export const instagramStorySharingConfigured = () => /^\d{5,32}$/u.test(INSTAGRAM_STORY_APP_ID);

async function loadInstagramStoryShare() {
  try {
    return (await import("react-native-share")).default;
  } catch {
    throw new Error("INSTAGRAM_STORY_UNAVAILABLE");
  }
}

export async function createShareCardAsset(model, { accountId, signal } = {}) {
  if (!accountId || !model?.renderRequest) return null;
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
  const file = new File(Paths.cache, socialShareFileName(model));
  file.create({ overwrite: true });
  file.write(response.bytes);
  return { file, fileUri: file.uri, previewUri: file.uri };
}

export function releaseShareCardAsset(asset) {
  try {
    if (asset?.file?.exists) asset.file.delete();
  } catch {
    // architecture: allow-empty-catch -- cache cleanup is best-effort after the share modal releases its private temporary card.
  }
}

export async function copyShareLink(url) {
  const copied = await Clipboard.setStringAsync(String(url || ""));
  if (!copied) throw new Error("COPY_UNAVAILABLE");
  return { mode: "copied" };
}

export async function openExternalShareUrl(url) {
  await Linking.openURL(url);
  return { mode: "external" };
}

export async function shareCardToInstagramStory(model, { preparedAsset = null } = {}) {
  if (!instagramStorySharingConfigured()) throw new Error("INSTAGRAM_STORY_NOT_CONFIGURED");
  if (!preparedAsset?.fileUri) throw new Error("STORY_ARTWORK_UNAVAILABLE");
  const RNShare = await loadInstagramStoryShare();

  if (Platform.OS === "ios") {
    const installed = await Linking.canOpenURL(INSTAGRAM_STORY_SCHEME);
    if (!installed) throw new Error("INSTAGRAM_NOT_INSTALLED");
  } else if (Platform.OS === "android") {
    const installed = await RNShare.isPackageInstalled(INSTAGRAM_PACKAGE);
    if (!installed?.isInstalled) throw new Error("INSTAGRAM_NOT_INSTALLED");
  } else {
    throw new Error("INSTAGRAM_STORY_UNAVAILABLE");
  }

  const result = await RNShare.shareSingle({
    social: RNShare.Social.INSTAGRAM_STORIES,
    appId: INSTAGRAM_STORY_APP_ID,
    backgroundImage: preparedAsset.fileUri,
    backgroundTopColor: "#0D0B10",
    backgroundBottomColor: "#0D0B10",
    attributionURL: model?.url || undefined,
    linkUrl: model?.url || undefined,
    linkText: "Open on Mshpit",
    type: "image/png",
    useInternalStorage: true,
  });
  if (result?.success === false) throw new Error("INSTAGRAM_STORY_NOT_OPENED");
  return { mode: "instagram-story" };
}

export async function downloadShareCard() {
  throw new Error("DOWNLOAD_UNAVAILABLE");
}
