import * as Clipboard from "expo-clipboard";
import { File, Paths } from "expo-file-system";
import { Linking, Platform } from "react-native";

import { socialShareFileName } from "../domain/socialShareCard.mjs";
import { apiBinary } from "./api";

const INSTAGRAM_STORY_APP_ID = String(process.env.EXPO_PUBLIC_META_APP_ID || "").trim();
const INSTAGRAM_PACKAGE = "com.instagram.android";
const INSTAGRAM_STORY_SCHEME = "instagram-stories://share";
const SOCIAL_PLATFORMS = new Set(["x", "facebook"]);
let shareCacheSequence = 0;
const shareAssetLeases = new WeakMap();
const DIRECT_ANDROID_TARGETS = Object.freeze({
  x: Object.freeze({ androidPackage: "com.twitter.android", socialKey: "TWITTER" }),
  facebook: Object.freeze({ androidPackage: "com.facebook.katana", socialKey: "FACEBOOK" }),
});
const NATIVE_SHARE_CANCEL_CODES = new Set([
  "CANCEL",
  "CANCELED",
  "CANCELLED",
  "ECANCELLED",
  "USER_CANCELLED",
]);
const NATIVE_SHARE_CANCEL_MESSAGES = new Set([
  "CANCELED",
  "CANCELLED",
  "PICKER_WAS_CANCELLED",
  "USER DID NOT SHARE",
]);

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

function normalizedNativeShareValue(value) {
  return typeof value === "string"
    ? value.normalize("NFKC").trim().replace(/\s+/gu, " ").toUpperCase()
    : "";
}

function nativeShareWasCancelled(error) {
  const codeValues = [
    error?.code,
    error?.errorCode,
    error?.name,
    error?.error?.code,
  ].map(normalizedNativeShareValue);
  if (codeValues.some((value) => NATIVE_SHARE_CANCEL_CODES.has(value))) return true;
  const messageValues = [
    typeof error === "string" ? error : null,
    error?.message,
    error?.error?.message,
  ].map(normalizedNativeShareValue);
  return messageValues.some((value) => NATIVE_SHARE_CANCEL_MESSAGES.has(value));
}

function assertShareCurrent(isCurrent) {
  if (isCurrent()) return;
  const error = new Error("Share presentation was cancelled.");
  error.name = "AbortError";
  throw error;
}

// Once the OS accepts a handoff it may still be reading the PNG. Closing the
// modal retires commands immediately, but its file is released after that
// dispatched handoff settles, not while the native sheet is using it.
async function withShareCardAsset(asset, dispatch) {
  const lease = shareAssetLeases.get(asset) || { count: 0, release: false };
  shareAssetLeases.set(asset, lease);
  lease.count++;
  try {
    return await dispatch();
  } finally {
    lease.count--;
    if (!lease.count) {
      shareAssetLeases.delete(asset);
      if (lease.release) releaseShareCardAsset(asset);
    }
  }
}

async function openNativeShareSheet(RNShare, options, platform, isCurrent, preparedAsset) {
  assertShareCurrent(isCurrent);
  try {
    const result = await withShareCardAsset(preparedAsset, () => RNShare.open({ ...options, failOnCancel: false }));
    return {
      mode: result?.dismissedAction || nativeShareWasCancelled(result)
        ? "dismissed"
        : "native-share-sheet",
      platform,
    };
  } catch (error) {
    if (nativeShareWasCancelled(error)) return { mode: "dismissed", platform };
    throw error;
  }
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
  const assertActive = () => {
    if (!signal?.aborted) return;
    if (signal.reason instanceof Error) throw signal.reason;
    const error = new Error("Share preparation was cancelled.");
    error.name = "AbortError";
    throw error;
  };
  assertActive();
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
  assertActive();
  // Every preparation owns a separate cache file. A cancelled/late render must
  // never overwrite or delete another account's card or the successful retry.
  // The friendly export filename is still supplied to the share sheet below.
  const cacheName = `mshpit-share-${Date.now().toString(36)}-${(++shareCacheSequence).toString(36)}-${Math.random().toString(36).slice(2)}.png`;
  const file = new File(Paths.cache, cacheName);
  let created = false;
  try {
    file.create({ overwrite: false });
    created = true;
    file.write(response.bytes);
  } catch (error) {
    if (created) releaseShareCardAsset({ file });
    throw error;
  }
  return {
    file,
    fileUri: file.uri,
    previewUri: file.uri,
    photoCreditUrl: response.photoCreditUrl || null,
  };
}

export function releaseShareCardAsset(asset) {
  const lease = asset && shareAssetLeases.get(asset);
  if (lease) { lease.release = true; return; }
  try {
    if (asset?.file?.exists) asset.file.delete();
  } catch {
    // architecture: allow-empty-catch -- cache cleanup is best-effort after the share modal releases its private temporary card.
  }
}

export async function copyShareLink(url, { isCurrent = () => true } = {}) {
  assertShareCurrent(isCurrent);
  const copied = await Clipboard.setStringAsync(String(url || ""));
  if (!copied) throw new Error("COPY_UNAVAILABLE");
  return { mode: "copied" };
}

export async function openExternalShareUrl(url, { isCurrent = () => true } = {}) {
  assertShareCurrent(isCurrent);
  await Linking.openURL(url);
  return { mode: "external" };
}

export async function shareCardToSocialPlatform(platform, model, { preparedAsset = null, isCurrent = () => true } = {}) {
  assertShareCurrent(isCurrent);
  if (!SOCIAL_PLATFORMS.has(platform) || !model?.url || !preparedAsset?.fileUri) {
    throw new Error("SOCIAL_ARTWORK_UNAVAILABLE");
  }
  const target = DIRECT_ANDROID_TARGETS[platform] || null;
  const RNShare = await loadNativeShare();
  assertShareCurrent(isCurrent);
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
    assertShareCurrent(isCurrent);
    try {
      const result = await withShareCardAsset(preparedAsset, () => RNShare.shareSingle({
        ...options,
        social: directSocial,
      }));
      if (result?.success !== false) return { mode: "targeted-social", platform };
      if (nativeShareWasCancelled(result)) return { mode: "dismissed", platform };
    } catch (error) {
      if (nativeShareWasCancelled(error)) return { mode: "dismissed", platform };
    }
    // Package detection can race an uninstall, an Android intent can be
    // rejected, or the direct handoff can fail before the target opens. Keep
    // the image and link usable through the system share sheet in those cases.
    return openNativeShareSheet(RNShare, options, platform, isCurrent, preparedAsset);
  }

  return openNativeShareSheet(RNShare, options, platform, isCurrent, preparedAsset);
}

export async function shareCardToInstagramStory(model, { preparedAsset = null, isCurrent = () => true } = {}) {
  assertShareCurrent(isCurrent);
  if (!instagramStorySharingConfigured()) throw new Error("INSTAGRAM_STORY_NOT_CONFIGURED");
  if (!preparedAsset?.fileUri) throw new Error("STORY_ARTWORK_UNAVAILABLE");
  const RNShare = await loadNativeShare("INSTAGRAM_STORY_UNAVAILABLE");
  assertShareCurrent(isCurrent);

  if (Platform.OS === "ios") {
    const installed = await Linking.canOpenURL(INSTAGRAM_STORY_SCHEME);
    if (!installed) throw new Error("INSTAGRAM_NOT_INSTALLED");
  } else if (Platform.OS === "android") {
    const installed = await RNShare.isPackageInstalled(INSTAGRAM_PACKAGE);
    if (!installed?.isInstalled) throw new Error("INSTAGRAM_NOT_INSTALLED");
  } else {
    throw new Error("INSTAGRAM_STORY_UNAVAILABLE");
  }

  assertShareCurrent(isCurrent);
  const result = await withShareCardAsset(preparedAsset, () => RNShare.shareSingle({
    social: RNShare.Social.INSTAGRAM_STORIES,
    appId: INSTAGRAM_STORY_APP_ID,
    backgroundImage: preparedAsset.fileUri,
    backgroundTopColor: "#0D0B10",
    backgroundBottomColor: "#0D0B10",
    attributionURL: preparedAsset.photoCreditUrl || model?.url || undefined,
    linkUrl: model?.url || undefined,
    linkText: "Open on Mshpit",
    type: "image/png",
    useInternalStorage: true,
  }));
  if (result?.success === false) throw new Error("INSTAGRAM_STORY_NOT_OPENED");
  return { mode: "instagram-story" };
}

export async function downloadShareCard() {
  throw new Error("DOWNLOAD_UNAVAILABLE");
}
