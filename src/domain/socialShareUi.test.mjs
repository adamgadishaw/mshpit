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
  assert.deepEqual(plugin?.[1]?.android, ["com.instagram.android"]);
});
