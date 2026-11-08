import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { parse } from "@babel/parser";
import {
  beginLoadState,
  projectLoadState,
  rejectLoadState,
  resolveLoadState,
} from "./loadState.mjs";
import { accountTargetScope } from "./screenScope.mjs";

const app = readFileSync(new URL("../../App.js", import.meta.url), "utf8");
const menu = readFileSync(new URL("../screens/MenuScreen.jsx", import.meta.url), "utf8");
const you = readFileSync(new URL("../screens/YouScreen.jsx", import.meta.url), "utf8");
const artist = readFileSync(new URL("../screens/ArtistScreen.jsx", import.meta.url), "utf8");
const artistOverview = readFileSync(new URL("../features/artistOverview/useArtistOverview.js", import.meta.url), "utf8");
const artistOverviewRequest = readFileSync(new URL("../features/artistOverview/artistOverviewRequest.mjs", import.meta.url), "utf8");
const hub = readFileSync(new URL("../screens/ArtistHubScreen.jsx", import.meta.url), "utf8");
const artistEditor = readFileSync(new URL("../screens/EditArtistProfileScreen.jsx", import.meta.url), "utf8");
const profile = readFileSync(new URL("../screens/ProfileScreen.jsx", import.meta.url), "utf8");
const settings = readFileSync(new URL("../screens/SettingsScreen.jsx", import.meta.url), "utf8");
const feed = readFileSync(new URL("../screens/FeedScreen.jsx", import.meta.url), "utf8");
const composer = readFileSync(new URL("../screens/LogScreen.jsx", import.meta.url), "utf8");
const feedCard = readFileSync(new URL("../components/TicketStub.jsx", import.meta.url), "utf8");
const afterparty = readFileSync(new URL("../components/AfterpartyPreview.jsx", import.meta.url), "utf8");
const store = readFileSync(new URL("../store.js", import.meta.url), "utf8");

function astNodes(source) {
  const nodes = [];
  const visit = node => {
    if (!node || typeof node !== "object") return;
    if (node.type) nodes.push(node);
    for (const value of Object.values(node)) if (Array.isArray(value)) value.forEach(visit); else visit(value);
  };
  visit(parse(source, { sourceType: "module", plugins: ["jsx"] }));
  return nodes;
}

test("Artist HQ navigation modules remain parseable", () => {
  for (const [name, source] of Object.entries({ app, menu, you, artist, hub, artistEditor, profile, settings, feed, composer, feedCard, afterparty })) {
    assert.doesNotThrow(() => parse(source, { sourceType: "module", plugins: ["jsx"] }), `${name} must parse`);
  }
});

test("named artists get one profile-management doorway across account surfaces", () => {
  assert.match(menu, /onManageProfile/);
  assert.match(menu, /manageProfile: onManageProfile/);
  assert.match(you, /onManageProfile=\{onManageProfile\}/);
  assert.match(app, /onManageProfile=\{replaceProfileManagement\}/);
  assert.match(app, /onManageProfile=\{openProfileManagement\}/);
  assert.match(profile, /accessibilityLabel="Manage profile"/);
  assert.match(settings, /const manageProfile = profileManagementAction\(session\)/);
  assert.doesNotMatch(feed, /onPress=\{onManageProfile\}/, "Feed does not duplicate profile management");
});

test("authoritative artist identities survive uncached people and direct-link navigation", () => {
  assert.match(app, /const publicIdentityFrame = \(id, authoritativeUser = null\)/);
  assert.match(app, /openProfile\(u\.id, u\)/);
  assert.match(app, /openProfile\(hit\.id, hit\)/);
  assert.match(app, /const user = userById\?\.\(entity\.id\) \|\| \(await loadUser\(entity\.id, \{ signal: controller\.signal \}\)\)\?\.user \|\| null/);
  assert.match(app, /publicIdentityFrame\(entity\.id, user\)/);
  assert.doesNotMatch(app, /entity\.kind === "profile"\) setStack\(\[\{\}, \{ profileId: entity\.id \}\]\)/);
});

test("the shell keeps artist management, staff editing, and fan preview as distinct routes", () => {
  assert.match(app, /import\("\.\/src\/screens\/ArtistHubScreen"\)/);
  assert.match(app, /else if \(nav\.artistHub\) overlay = <ArtistHubScreen/);
  for (const prop of ["onClose", "onPreview", "onEditPage", "onEditAccount", "onTourDates", "onCampaignPost", "onPlay"]) {
    assert.match(app, new RegExp(`${prop}=`), `ArtistHubScreen must receive ${prop}`);
  }
  assert.doesNotMatch(app, /<ArtistHubScreen[^;]+onOpenPublicPage=/);
  assert.match(hub, /title="Edit artist page"[\s\S]*?onPress=\{openPageEditor\}/);
  assert.match(hub, /if \(!artistPageEditReady\(scopedArtistPageResource\)\) return;/);
  assert.match(hub, /onEditPage\?\.\(artistName\)/);
  assert.match(hub, /title="Personal account"[\s\S]*?onPress=\{onEditAccount\}/);
  assert.match(app, /onEditPage=\{\(name\) => name && requireVerifiedMutation\("artist", \(\) => go\(\{ editArtist: name \}\)\)\}/);
  assert.match(app, /onEditAccount=\{\(\) => requireVerifiedMutation\("profile", \(\) => go\(\{ editProfile: true \}\)\)\}/);
  assert.match(artist, /onManageArtistProfile/);
  assert.match(artist, /onEditArtistProfile/);
  assert.match(artist, /ownsNamedArtistPage && !previewAsFan && onManageArtistProfile/);
  assert.match(artist, /canModerate && !previewAsFan && onEditArtistProfile/);
  assert.match(artist, /<Text style=\{styles\.editTxt\}>Artist HQ<\/Text>/);
  assert.match(artist, /<Text style=\{styles\.editTxt\}>Edit artist page<\/Text>/);
  assert.match(app, /onManageArtistProfile=\{\(\) => go\(\{ artistHub: true \}\)\}/);
  assert.match(app, /onEditArtistProfile=\{\(name\) => name && requireVerifiedMutation\("artist", \(\) => go\(\{ editArtist: name \}\)\)\}/);
  assert.match(app, /go\(\{ artistPreview: name \}\)/);
  const previewRoute = astNodes(app).find(node => node.type === "IfStatement" && node.test?.type === "MemberExpression" && node.test.object?.name === "nav" && node.test.property?.name === "artistPreview");
  const preview = previewRoute.consequent.expression.right.openingElement;
  assert.equal(preview.name.name, "ArtistScreen");
  const props = new Map(preview.attributes.filter(attr => attr.type === "JSXAttribute").map(attr => [attr.name.name, attr.value]));
  assert.ok(props.has("previewAsFan"));
  assert.equal(props.get("previewAsFan"), null, "preview is explicitly enabled");
  const name = props.get("artistName").expression;
  assert.equal(vm.runInNewContext(`(${app.slice(name.start, name.end)})`, { nav: { artistPreview: "Preview artist", artistName: "Other" } }), "Preview artist");
  for (const action of ["onManageArtistProfile", "onEditArtistProfile"]) assert.equal(props.has(action), false, "preview never receives editing callbacks");
  assert.match(app, /\["artistHub", "artist_hq"\]/);
  assert.match(app, /\["artistPreview", "artist_preview"\]/);
});

test("Artist HQ exposes one primary action for each distinct job", () => {
  assert.equal((hub.match(/onPress=\{\(\) => onPreview\?\.\(artistName\)\}/g) || []).length, 1, "one public artist profile preview");
  assert.equal((hub.match(/title="Edit artist page"/g) || []).length, 1, "one artist-page editor");
  assert.equal((hub.match(/onPress=\{onCampaignPost\}/g) || []).length, 1, "one artist-drop action");
  assert.equal((hub.match(/onPress=\{onTourDates\}/g) || []).length, 1, "one upcoming-shows action");
  assert.equal((hub.match(/onPress=\{onEditAccount\}/g) || []).length, 1, "one personal-account action");
  assert.match(hub, />Preview artist page<\/Text>/);
  assert.match(hub, /title="Live photos & videos"/);
  assert.match(hub, /title="Promote a concert or release"/);
  assert.equal((hub.match(/onPress=\{onMediaPost\}/g) || []).length, 1, "one normal live-media post action, distinct from capped featured promotions");
  assert.match(hub, /title="Upcoming shows"/);
});

test("Artist HQ launches the artist-only campaign composer and the feed renders its trusted presentation", () => {
  assert.match(hub, /onCampaignPost/);
  assert.match(hub, /title="Promote a concert or release"/);
  assert.match(app, /onCampaignPost=\{\(\) => requireVerifiedMutation\("artist", \(\) => go\(\{ logging: true, postMode: "campaign" \}\)\)\}/);
  assert.match(composer, /user\?\.role === "artist"/);
  assert.match(composer, /campaign: isCampaign \? campaign : null/);
  assert.match(composer, /backgroundAssetId: isCampaignBackground \? undefined : backgroundAssetId/);
  assert.match(composer, /media: publishedMedia/);
  assert.match(feedCard, /artistCampaignPresentation\(log\.campaign, postMedia\)/);
  assert.match(feedCard, /autoplay=\{!tabPreview && !reduceMotion\}/);
  // Both presentation owners must permit animation, independently.
  const autoplay = feedCard.match(/autoplay=\{([^}]+)\}/)[1];
  const evaluateAutoplay = new Function("tabPreview", "reduceMotion", `return (${autoplay});`);
  for (const preview of [false, true]) for (const reduced of [false, true]) {
    assert.equal(evaluateAutoplay(preview, reduced), !preview && !reduced);
  }
  assert.match(feedCard, /FEATURED ARTIST POST|campaignTreatment\.eyebrow\.toUpperCase\(\)/);
  assert.match(feedCard, /campaignTouchTarget: \{ minWidth: 44, minHeight: 44 \}/);
  assert.match(afterparty, /palette\.mutedTextColor/);
  assert.match(afterparty, /campaignBubble/);
  assert.doesNotMatch(afterparty, /TextInput|loadComments|addComment|campaignSend/);
  assert.match(hub, /Featured feed posts still appear in the main feed\./);
});

test("fan preview hides ownership affordances and unreleased dates", () => {
  assert.match(artist, /previewAsFan = false/);
  assert.match(artist, /const profileServicesAvailable = memorialKnown && !legacyMode/);
  assert.match(artist, /const canManagePublicPage = profileServicesAvailable && ownsArtistPage && !previewAsFan/);
  assert.match(artist, /const liveAvailable = memorialAvailability === "living"/);
  assert.match(artist, /useArtistOverview\(\{[\s\S]*?enabled: profileServicesAvailable,[\s\S]*?publicPreview: previewAsFan/);
  assert.match(artist, /sectionModel\.showLive && liveAvailable && \([\s\S]*?<ArtistUpcomingShows/);
  assert.match(artistOverview, /\[artistKey, accountId, enabled, pageSize, publicPreview\]/);
  assert.match(artistOverviewRequest, /publicPreview/);
  assert.doesNotMatch(artist, /a\.upcoming|selectArtistUpcomingShows|setShowAllUpcoming/,
    "artist previews must use the release-aware server schedule, not the capped startup list");
  assert.match(artist, /FAN PREVIEW/);
  assert.match(artist, /Owner controls and scheduled dates are hidden\./);
  assert.match(artist, /!ownsArtistPage && profileOwnerId && onReport/);
  assert.match(artist, /!ownsArtistPage && onReport/);
});

test("staff can follow artists; only the artist's own account has no Follow button", () => {
  // Regression: isArtistOwner() is true for every staff account, so hiding
  // Follow on ownsArtistPage hid it from the site owner on every artist page.
  assert.match(artist, /const followHidden = ownsNamedArtistPage;/);
  assert.match(artist, /\{!followHidden \? \(\s*<Pressable\s+style=\{\[styles\.artistFollowBtn/);
  const nodes = astNodes(artist);
  const expression = nodes.find(node => node.type === "JSXAttribute" && node.name?.name === "onFollow").value.expression;
  const wrapper = nodes.find(node => node.type === "VariableDeclarator" && node.id?.name === "announceFollow").init;
  for (const IS_IOS of [false, true]) for (const session of [null, { id: "staff", role: "admin" }, { id: "member", role: "user" }]) for (const followHidden of [false, true]) {
    const calls = [];
    const context = { IS_IOS, session, followHidden, followUi: { toggleFollow: () => calls.push("follow") },
      onRequireAuth: () => calls.push("auth"), announcements: { current: { request: () => calls.push("announce") } } };
    context.announceFollow = vm.runInNewContext(`(${artist.slice(wrapper.start, wrapper.end)})`, context);
    const action = vm.runInNewContext(`(${artist.slice(expression.start, expression.end)})`, context);
    if (followHidden) assert.equal(action, undefined);
    else {
      action();
      assert.deepEqual(calls, !session ? ["auth"] : IS_IOS ? ["announce", "follow"] : ["follow"]);
    }
  }
  assert.doesNotMatch(artist, /!ownsArtistPage \? \(\s*<Pressable\s+style=\{\[styles\.artistFollowBtn/);
});

test("artist publishing reports authoritative outcomes and preserves failed drafts", () => {
  assert.match(store, /const addArtistPost = async/);
  assert.match(store, /captureAccountMutation\(actor\.id, accountMutationEpochRef\.current\)/);
  assert.match(store, /accountMutationIsCurrent\(mutation, currentActor\?\.id, accountMutationEpochRef\.current\)/);
  assert.match(store, /return commandSuccess\(\{ id \}\)/);
  assert.match(store, /return commandError\(error, context\)/);

  assert.match(hub, /const result = await addArtistPost/);
  assert.match(hub, /const submittedDraft = draft/);
  assert.match(hub, /setDraft\(\(current\) => current === submittedDraft \? "" : current\)/);
  assert.match(hub, /draft is still here/i);
  assert.doesNotMatch(artist, /addArtistPost|removeArtistPost|Publish page update|deletePageUpdate/);
  assert.match(artist, /Artist posts are read-only here/);
});

test("Artist HQ retains confirmed page data on refresh failure without crossing account scope", () => {
  const scope = accountTargetScope("artist-account", "artist-page:model/actriz");
  const confirmed = { profile: { feedEnabled: true }, posts: [{ id: "update-1" }] };
  const ready = resolveLoadState({ scope, data: confirmed, updatedAt: 100 });
  const refreshing = beginLoadState(ready, { scope, emptyData: null, retainData: true });
  assert.equal(refreshing.status, "refreshing");
  assert.equal(refreshing.data, confirmed);

  const error = Object.assign(new Error("offline"), {
    name: "AppError",
    code: "PIT-NET-001",
    retryable: true,
  });
  const stale = rejectLoadState(refreshing, { scope, error, emptyData: null, retainData: true });
  assert.equal(stale.status, "error");
  assert.equal(stale.data, confirmed);
  assert.equal(stale.updatedAt, 100);

  const otherAccount = projectLoadState(
    stale,
    accountTargetScope("other-account", "artist-page:model/actriz"),
    null,
  );
  assert.equal(otherAccount.status, "loading");
  assert.equal(otherAccount.data, null);
  assert.equal(otherAccount.updatedAt, null);
});

test("Artist HQ page reads expose a retryable scoped contract and gate unconfirmed zeroes", () => {
  assert.match(store, /const loadArtistPage = async \(name, \{ signal \} = \{\}\) =>/);
  assert.match(store, /accountTargetScope\(accountId, `artist-page:\$\{artistKey\}`\)/);
  assert.match(store, /return commandSuccess\(\{[\s\S]*scope,[\s\S]*profile: normalizedProfile,[\s\S]*posts: normalizedPosts,[\s\S]*legacyProfile,[\s\S]*loadedAt: Date\.now\(\),[\s\S]*\}\)/);
  assert.match(store, /return commandError\(error, context\)/);
  assert.match(store, /silent: true/);

  assert.match(hub, /const artistPageScope = accountTargetScope\(session\?\.id \|\| null, `artist-page:\$\{artistName\.toLowerCase\(\)\}`\)/);
  assert.match(hub, /beginLoadState\(current, \{/);
  assert.match(hub, /resolveLoadState\(\{/);
  assert.match(hub, /rejectLoadState\(current, \{/);
  assert.match(hub, /const hasConfirmedArtistPage = artistPageEditReady\(scopedArtistPageResource\)/);
  assert.match(hub, /disabled=\{!hasConfirmedArtistPage\}/);
  assert.match(hub, /accessibilityLabel="Retry loading artist page data"/);
  assert.match(hub, /\{hasConfirmedArtistPage \? \(\s*<View style=\{styles\.statsRow\}>/);
  assert.match(hub, /hasConfirmedArtistPage && !model\.feedEnabled/);
  assert.match(hub, /\{!hasConfirmedArtistPage \? \([\s\S]*Existing artist posts will appear after the artist page loads\./);
  assert.match(artist, /loadArtistPage\(a\.name, \{ signal: controller\.signal \}\)/);
});

test("page-update deletion lives in Artist HQ with confirmation, account scoping, and retry", () => {
  assert.match(hub, /await removeArtistPost\(artistName, postId, \{ signal: controller\.signal \}\)/);
  assert.match(hub, /artistPostMutation\.scope === artistPostScope/);
  assert.match(hub, /Remove this artist post\?/);
  assert.match(hub, /This artist post was not removed, so it is still visible/);
  assert.match(hub, /error\?\.retryable/);
  assert.match(hub, /posts\.map\(\(item\) =>/);
});

test("page-update visibility is an accessible switch with explicit state", () => {
  assert.match(artistEditor, /title="Edit artist page"/);
  assert.match(artistEditor, /loadArtistPage\(artist\.name, \{ signal: controller\.signal \}\)/);
  assert.match(artistEditor, /if \(!artistPageEditReady\(resource\) \|\| mediaBusy \|\| saving\) return;/);
  assert.match(artistEditor, /confirmedProfile=\{scopedResource\.data\.profile\}/);
  assert.doesNotMatch(artistEditor, /const prof = artistProfile\(/);
  assert.match(artistEditor, /accessibilityRole="switch"/);
  assert.match(artistEditor, /accessibilityState=\{\{ checked: feedEnabled, disabled: mediaBusy \|\| saving \}\}/);
  assert.match(artistEditor, /accessibilityValue=\{\{ text: feedEnabled \? "Shown" : "Hidden" \}\}/);
  assert.match(artistEditor, />Show artist posts<\/Text>/);
});
