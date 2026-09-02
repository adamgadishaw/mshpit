import * as Clipboard from "expo-clipboard";
import { File, Paths } from "expo-file-system";
import { Linking, Platform } from "react-native";

import { socialShareFileName } from "../domain/socialShareCard.mjs";
import { apiBinary } from "./api";

const INSTAGRAM_STORY_APP_ID = String(process.env.EXPO_PUBLIC_META_APP_ID || "").trim();
const INSTAGRAM_PACKAGE = "com.instagram.android";
const INSTAGRAM_STORY_SCHEME = "instagram-stories://share";
const SOCIAL_PLATFORMS = new Set(["x", "facebook"]);
const DIRECT_ANDROID_TARGETS = Object.freeze({
  x: Object.freeze({ androidPackage: "com.twitter.android", socialKey: "TWITTER" }),
  facebook: Object.freeze({ androidPackage: "com.facebook.katana", socialKey: "FACEBOOK" }),
});

export const instagramStorySharingConfigured = () => /^\d{5,32}$/u.test(INSTAGRAM_STORY_APP_ID);

async function loadNativeShare(errorCode = "SOCIAL_SHARE_UNAVAILABLE") {
  try {
    return (await import("react-native-share")).default;
  } catch {
    throw new Error(errorCode);
  }
}

function socialShareMessage(model) {
  return [...new Set([model?.shareText, model?.url].map((value) => String(value || "").trim()).filter(Boolean))].join("\n\n");
}

async function socialTargetAvailable(RNShare, target) {
  // react-native-share 12.3.1 routes iOS X/Facebook single-share through the retired
  // Social framework, which cannot reliably carry this PNG. Use the image-capable
  // system share sheet on iOS and reserve direct targeting for Android packages.
  if (Platform.OS !== "android") return false;
  try {
    const installed = await RNShare.isPackageInstalled(target.androidPackage);
    return !!installed?.isInstalled;
  } catch {
    // architecture: allow-empty-catch -- app detection can fail on restricted devices; the system share sheet is the safe fallback.
  }
  return false;
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

export async function shareCardToSocialPlatform(platform, model, { preparedAsset = null } = {}) {
  if (!SOCIAL_PLATFORMS.has(platform) || !model?.url || !preparedAsset?.fileUri) {
    throw new Error("SOCIAL_ARTWORK_UNAVAILABLE");
  }
  const target = DIRECT_ANDROID_TARGETS[platform] || null;
  const RNShare = await loadNativeShare();
  const options = {
    filename: socialShareFileName(model),
    message: socialShareMessage(model),
    title: `Share ${model?.title || "from Mshpit"}`,
    type: "image/png",
    url: preparedAsset.fileUri,
    useInternalStorage: true,
  };

  const directSocial = target ? RNShare.Social?.[target.socialKey] : null;
  if (directSocial && await socialTargetAvailable(RNShare, target)) {
    const result = await RNShare.shareSingle({
      ...options,
      social: directSocial,
    });
    if (result?.success === false) throw new Error("SOCIAL_SHARE_NOT_OPENED");
    return { mode: "targeted-social", platform };
  }

  const result = await RNShare.open({ ...options, failOnCancel: false });
  return { mode: result?.dismissedAction ? "dismissed" : "native-share-sheet", platform };
}

export async function shareCardToInstagramStory(model, { preparedAsset = null } = {}) {
  if (!instagramStorySharingConfigured()) throw new Error("INSTAGRAM_STORY_NOT_CONFIGURED");
  if (!preparedAsset?.fileUri) throw new Error("STORY_ARTWORK_UNAVAILABLE");
  const RNShare = await loadNativeShare("INSTAGRAM_STORY_UNAVAILABLE");

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
