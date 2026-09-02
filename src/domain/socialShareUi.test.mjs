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
  assert.match(studio, /Mshpit opens Instagram’s Story editor/);
  assert.match(studio, /assetState\.status !== "ready"/,
    "Instagram Story sharing stays disabled until its PNG exists");
  assert.match(studio, /nativeStory && !storyConfigured/,
    "Native Story sharing fails closed until its public Meta App ID is built in");
  assert.match(studio, /socialShareIntentUrl\(platform, model\)/);
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
  assert.match(studio, /\}, \[accountId, renderModel\]\);/);
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

test("Instagram uses only the Story composer while web downloads a Story card", () => {
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
  assert.match(web, /shareCardToInstagramStory[\s\S]*downloadShareCard\(model, options\)/);
  assert.doesNotMatch(web, /navigator\.share/,
    "The website downloads the Story card instead of pretending it can target Instagram");
  assert.match(web, /anchor\.download = socialShareFileName\(model\)/);
  assert.match(native, /Clipboard\.setStringAsync/);
  assert.match(web, /Clipboard\.setStringAsync/);
  assert.match(studio, /Instagram Story/);
  assert.doesNotMatch(studio, /Instagram \/ apps|system share menu/);
  assert.doesNotMatch(studio, /instagram\.com\/(?:share|intent|create)/i);

  const plugin = app.plugins.find((entry) => Array.isArray(entry) && entry[0] === "react-native-share");
  assert.deepEqual(plugin?.[1]?.ios, ["instagram-stories"]);
  assert.deepEqual(plugin?.[1]?.android, ["com.instagram.android", "com.facebook.katana"]);
});

test("X and Facebook receive each finished card without claiming the website attached it", () => {
  const studio = source("../components/SocialShareStudio.jsx");
  const native = source("../lib/socialShare.native.js");
  const web = source("../lib/socialShare.web.js");

  assert.match(studio, /shareCardToSocialPlatform\(platform, model, \{ preparedAsset: assetState\.asset, intentUrl: url \}\)/);
  assert.match(studio, /card download started\. Attach the downloaded PNG before posting\./,
    "Web success feedback must explain the public composer cannot attach the private Blob");
  assert.match(studio, /Choose an app, review it, and post when ready\./,
    "A generic share sheet must not promise that an unavailable requested app can be chosen");
  assert.match(studio, /Share card download started\./,
    "Browser code can observe that a download began, not that it completed");
  assert.ok((studio.match(/disabled=\{!!busyAction \|\| assetState\.status !== "ready"\}/g) || []).length >= 2,
    "X and Facebook stay disabled until the unique PNG is ready");

  assert.match(native, /model\?\.shareText, model\?\.url/,
    "Native share text includes both the action detail and canonical Mshpit URL");
  assert.match(native, /url: preparedAsset\.fileUri/);
  assert.match(native, /RNShare\.Social\[target\.socialKey\]/);
  assert.match(native, /RNShare\.open\(\{ \.\.\.options, failOnCancel: false \}\)/,
    "Native sharing preserves an image-capable system share-sheet fallback");
  assert.doesNotMatch(native, /com\.twitter\.android/,
    "Android X remains on the supported system image share sheet instead of unsupported shareSingle targeting");
  assert.match(native, /com\.facebook\.katana/);
  assert.match(native, /if \(Platform\.OS !== "android"\) return false;/,
    "iOS avoids react-native-share's retired Social-framework single-share path and uses the image-capable share sheet");

  assert.match(web, /const composer = openExternalShareUrl\(intentUrl\);\s*const download = downloadShareCard\(model, \{ preparedAsset \}\);\s*await Promise\.all\(\[composer, download\]\);/s,
    "The composer popup opens before any awaited boundary, followed by the PNG download in the same tap");
  assert.match(web, /openHttpsSharePopup\(url\)/,
    "Web sharing delegates popup behavior to the unit-tested synchronous helper");
  assert.doesNotMatch(web, /anchor\.target\s*=/,
    "The Blob download must not compete with the social composer for a second popup");
});
