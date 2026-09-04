import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = (relative) => readFileSync(new URL(relative, import.meta.url), "utf8");

test("posts and exact event attendance share through one reusable studio", () => {
  const ticket = source("../components/TicketStub.jsx");
  const attendance = source("../features/showSocial/ShowAttendanceControls.jsx");
  const show = source("../screens/ShowScreen.jsx");
  const studio = source("../components/SocialShareStudio.jsx");

  assert.match(ticket, /useMemo\([\s\S]*?buildPostShareModel\(log, \{ author \}\)[\s\S]*?\[author, log\]/);
  assert.ok((ticket.match(/<SocialShareButton/g) || []).length >= 2);
  assert.match(ticket, /statusFooter:\s*\{[^}]*flexWrap:\s*"wrap"/s,
    "Going-ticket actions wrap instead of crossing a narrow iPhone boundary");
  assert.match(ticket, /footer:\s*\{[^}]*flexWrap:\s*"wrap"/s,
    "Review actions wrap instead of crossing a narrow iPhone boundary");
  assert.match(attendance, /attendance\?\.state === "going" \|\| attendance\?\.state === "interested"/);
  assert.match(attendance, /useMemo\([\s\S]*?buildAttendanceShareModel\(\{ show, state: shareState, author: account \}\)[\s\S]*?\[account, shareState, show\]/);
  assert.match(attendance, /const shareState = accountId && !pending/,
    "Attendance sharing waits for the canonical saved state instead of exposing the optimistic mutation");
  assert.match(show, /<ShowAttendanceControls[\s\S]*?account=\{session\}/);
  assert.match(studio, /apps can open Instagram’s Story editor/);
  assert.match(studio, /assetState\.status !== "ready"/,
    "Instagram Story sharing stays disabled until its PNG exists");
  assert.match(studio, /nativeStory && !storyConfigured/,
    "Native Story sharing fails closed until its public Meta App ID is built in");
  assert.match(studio, /socialShareIntentUrl\(platform, model\)/);
  assert.doesNotMatch(studio, /LocalShareCard|model\.artworkUri/,
    "raw client artwork must not masquerade as the final server-rendered card");
  assert.match(studio, /<AuthoritativeShareCardPlaceholder status=\{assetState\.status\} \/>/);
  assert.match(studio, /accessibilityLabel="Retry share artwork"/);
  assert.match(studio, /setRenderAttempt\(\(attempt\) => attempt \+ 1\)/);
  assert.match(studio, /\[accountId, renderAttempt, renderModel\]/,
    "Retry starts one new authoritative render without changing the shared item");
  assert.match(studio, /source=\{\{ uri: preparedAsset\.previewUri \}\}/,
    "the visible final preview is the exact prepared PNG used by sharing actions");
  assert.match(studio, /shareAction:\s*\{[^}]*minWidth:\s*0[^}]*flexBasis:\s*230/s,
    "Share destinations shrink or wrap inside narrow phone boundaries");
});

test("share artwork is created only after an explicit share action and stays private", () => {
  const studio = source("../components/SocialShareStudio.jsx");
  const native = source("../lib/socialShare.native.js");
  const web = source("../lib/socialShare.web.js");
  const api = source("../lib/api.js");

  assert.match(studio, /onPress=\{\(\) => setOpen\(true\)\}/);
  assert.match(studio, /createShareCardAsset\(renderModel, \{ accountId, signal: controller\.signal \}\)/);
  assert.match(studio, /\}, \[accountId, renderAttempt, renderModel\]\);/);
  assert.doesNotMatch(studio, /\}, \[accountId, model\]\);/,
    "An unrelated post refresh must not restart the private PNG render");
  for (const adapter of [native, web]) {
    assert.match(adapter, /apiBinary\("\/api\/share-cards\/render"/);
    assert.match(adapter, /body: model\.renderRequest/);
    assert.match(adapter, /expectedAccountId: accountId/);
    assert.doesNotMatch(adapter, /\/share\/card\/post|\/share\/card\/event/);
  }
  assert.match(api, /export async function apiBinary/);
  assert.match(api, /apiIdentityBarrierDecision/);
  assert.match(api, /"X-Pit-Expected-Account"/);
  assert.match(api, /new Uint8Array\(buffer\)/);
});

test("Instagram uses the Story composer in native builds and an honest browser share fallback", () => {
  const studio = source("../components/SocialShareStudio.jsx");
  const native = source("../lib/socialShare.native.js");
  const web = source("../lib/socialShare.web.js");
  const app = JSON.parse(source("../../app.json")).expo;

  assert.match(native, /RNShare\.shareSingle\(/);
  assert.match(native, /RNShare\.Social\.INSTAGRAM_STORIES/);
  assert.match(native, /backgroundImage: preparedAsset\.fileUri/);
  assert.match(native, /appId: INSTAGRAM_STORY_APP_ID/);
  assert.match(native, /INSTAGRAM_NOT_INSTALLED/);
  assert.doesNotMatch(native, /Sharing\.shareAsync|\bShare\.share\(/,
    "Story sharing must never fall back to a feed-capable generic share sheet");
  assert.match(web, /navigator\.canShare\(\{ files: \[preparedAsset\.file\] \}\)/,
    "The browser checks whether the prepared image file can be shared");
  assert.match(web, /navigator\.share\(\{[\s\S]*files: \[preparedAsset\.file\][\s\S]*text: socialShareMessage\(model\)[\s\S]*\}\)/,
    "Supported browsers open the system share sheet with the image and Mshpit text/link");
  assert.match(web, /shareCardToInstagramStory[\s\S]*openBrowserShareSheet\(model, options\.preparedAsset, "instagram"\)[\s\S]*downloadShareCard\(model, options\)/,
    "Unsupported browsers download the Instagram card without claiming to target the app");
  assert.match(web, /anchor\.download = socialShareFileName\(model\)/);
  assert.match(native, /Clipboard\.setStringAsync/);
  assert.match(web, /Clipboard\.setStringAsync/);
  assert.match(studio, /Instagram Story/);
  assert.doesNotMatch(studio, /Instagram \/ apps|system share menu/);
  assert.doesNotMatch(studio, /instagram\.com\/(?:share|intent|create)/i);

  const plugin = app.plugins.find((entry) => Array.isArray(entry) && entry[0] === "react-native-share");
  assert.deepEqual(plugin?.[1]?.ios, ["instagram-stories"]);
  assert.deepEqual(plugin?.[1]?.android, ["com.instagram.android", "com.facebook.katana", "com.twitter.android"]);
  assert.doesNotMatch(studio, /9:16|photo frame|frame size/i,
    "Share controls describe the action without exposing artwork dimensions");
});

test("native preview and Instagram handoff use one immutable prepared PNG", () => {
  const studio = source("../components/SocialShareStudio.jsx");
  const native = source("../lib/socialShare.native.js");

  assert.match(native, /return \{ file, fileUri: file\.uri, previewUri: file\.uri \};/,
    "the preview and native handoff point at the same generated cache file");
  assert.match(studio, /source=\{\{ uri: preparedAsset\.previewUri \}\}/,
    "the visible preview renders that exact generated file");
  assert.match(studio, /shareCardToInstagramStory\(model, \{ preparedAsset \}\)/,
    "the unchanged prepared asset is passed to the Story handoff");
  assert.match(native, /backgroundImage: preparedAsset\.fileUri/,
    "Instagram receives the same PNG that was previewed");
});

test("X and Facebook share the finished card when supported and retain the desktop fallback", () => {
  const studio = source("../components/SocialShareStudio.jsx");
  const native = source("../lib/socialShare.native.js");
  const web = source("../lib/socialShare.web.js");

  assert.match(studio, /const preparedAsset = assetState\.status === "ready" && assetState\.asset\?\.previewUri/);
  assert.match(studio, /shareCardToInstagramStory\(model, \{ preparedAsset \}\)/);
  assert.match(studio, /shareCardToSocialPlatform\(platform, model, \{ preparedAsset, intentUrl: url \}\)/);
  assert.match(studio, /downloadShareCard\(model, \{ preparedAsset \}\)/);
  assert.match(studio, /Your share options opened with the card and Mshpit link\. Choose an available app and post when ready\./,
    "Browser share feedback does not claim a specific app opened or that anything was posted");
  assert.match(studio, /web composer opened and the card download started\. Attach the downloaded card before posting\./,
    "Desktop fallback feedback explains that the user still needs to attach the downloaded card");
  assert.match(studio, /Choose an app, review it, and post when ready\./,
    "A generic share sheet must not promise that an unavailable requested app can be chosen");
  assert.match(studio, /Share card download started\./,
    "Browser code can observe that a download began, not that it completed");
  assert.ok((studio.match(/disabled=\{!!busyAction \|\| assetState\.status !== "ready"\}/g) || []).length >= 2,
    "X and Facebook stay disabled until the unique PNG is ready");

  assert.match(native, /model\?\.shareText, model\?\.url/,
    "Native share text includes both the action detail and canonical Mshpit URL");
  assert.match(native, /url: preparedAsset\.fileUri/);
  assert.match(native, /RNShare\.Social\?\.\[target\.socialKey\]/);
  assert.match(native, /RNShare\.open\(\{ \.\.\.options, failOnCancel: false \}\)/,
    "Native sharing preserves an image-capable system share-sheet fallback");
  assert.match(native, /x:\s*Object\.freeze\(\{ androidPackage: "com\.twitter\.android", socialKey: "TWITTER" \}\)/,
    "Android sends the prepared PNG and message directly to the installed X package");
  assert.match(native, /com\.facebook\.katana/);
  assert.match(native, /if \(Platform\.OS !== "android"\) return false;/,
    "iOS avoids react-native-share's retired Social-framework target and keeps the image-capable share sheet");
  for (const cancelCode of [
    "CANCEL", "CANCELED", "CANCELLED", "ECANCELLED", "USER_CANCELLED",
  ]) assert.match(native, new RegExp(`NATIVE_SHARE_CANCEL_CODES[\\s\\S]*?"${cancelCode}"`, "u"));
  for (const cancelMessage of [
    "PICKER_WAS_CANCELLED", "USER DID NOT SHARE",
  ]) assert.match(native, new RegExp(`NATIVE_SHARE_CANCEL_MESSAGES[\\s\\S]*?"${cancelMessage}"`, "u"));
  assert.match(native, /if \(nativeShareWasCancelled\(error\)\) return \{ mode: "dismissed", platform \};/);
  assert.match(native, /return openNativeShareSheet\(RNShare, options, platform\);/,
    "a failed Android direct handoff retains the prepared image through the system share sheet");
  assert.match(native, /result\?\.success !== false\) return \{ mode: "targeted-social", platform \};/,
    "a successful direct Android handoff remains targeted");
  assert.doesNotMatch(native, /includes\([^\n]*cancel/iu,
    "cancellation classification uses exact normalized values instead of swallowing unrelated failures");

  assert.match(web, /const composer = openExternalShareUrl\(intentUrl\);\s*const download = downloadShareCard\(model, \{ preparedAsset \}\);\s*await Promise\.all\(\[composer, download\]\);/s,
    "The composer popup opens before any awaited boundary, followed by the PNG download in the same tap");
  assert.match(web, /const shared = await openBrowserShareSheet\(model, preparedAsset, platform\);\s*if \(shared\) return shared;/,
    "A supported browser uses the image-capable system share sheet before the composer/download fallback");
  assert.match(web, /openHttpsSharePopup\(url\)/,
    "Web sharing delegates popup behavior to the unit-tested synchronous helper");
  assert.doesNotMatch(web, /anchor\.target\s*=/,
    "The Blob download must not compete with the social composer for a second popup");
});
