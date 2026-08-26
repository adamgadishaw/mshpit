import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
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
const hub = readFileSync(new URL("../screens/ArtistHubScreen.jsx", import.meta.url), "utf8");
const artistEditor = readFileSync(new URL("../screens/EditArtistProfileScreen.jsx", import.meta.url), "utf8");
const profile = readFileSync(new URL("../screens/ProfileScreen.jsx", import.meta.url), "utf8");
const settings = readFileSync(new URL("../screens/SettingsScreen.jsx", import.meta.url), "utf8");
const feed = readFileSync(new URL("../screens/FeedScreen.jsx", import.meta.url), "utf8");
const composer = readFileSync(new URL("../screens/LogScreen.jsx", import.meta.url), "utf8");
const feedCard = readFileSync(new URL("../components/TicketStub.jsx", import.meta.url), "utf8");
const afterparty = readFileSync(new URL("../components/AfterpartyPreview.jsx", import.meta.url), "utf8");
const store = readFileSync(new URL("../store.js", import.meta.url), "utf8");

test("Artist HQ navigation modules remain parseable", () => {
  for (const [name, source] of Object.entries({ app, menu, you, artist, hub, artistEditor, profile, settings, feed, composer, feedCard, afterparty })) {
    assert.doesNotThrow(() => parse(source, { sourceType: "module", plugins: ["jsx"] }), `${name} must parse`);
  }
});

test("named artists get one profile-management doorway across account surfaces", () => {
  assert.match(menu, /onManageProfile/);
  assert.match(menu, /manageProfile: onManageProfile/);
  assert.match(you, /const profileAction = profileManagementAction\(session\)/);
  assert.match(you, /label: profileAction\.title, onPress: onManageProfile/);
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
  assert.match(app, /const resolvedUser = knownUser \|\| \(await loadUser\(entity\.id\)\)\?\.user \|\| null/);
  assert.match(app, /publicIdentityFrame\(entity\.id, resolvedUser\)/);
  assert.doesNotMatch(app, /entity\.kind === "profile"\) setStack\(\[\{\}, \{ profileId: entity\.id \}\]\)/);
});

test("the shell keeps artist management, staff editing, and fan preview as distinct routes", () => {
  assert.match(app, /import\("\.\/src\/screens\/ArtistHubScreen"\)/);
  assert.match(app, /else if \(nav\.artistHub\) overlay = <ArtistHubScreen/);
  for (const prop of ["onClose", "onPreview", "onEditPage", "onEditAccount", "onTourDates", "onCampaignPost", "onPlay"]) {
    assert.match(app, new RegExp(`${prop}=`), `ArtistHubScreen must receive ${prop}`);
  }
  assert.doesNotMatch(app, /<ArtistHubScreen[^;]+onOpenPublicPage=/);
  assert.match(hub, /title="Edit public page"[\s\S]*?onPress=\{openPageEditor\}/);
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
  assert.match(artist, /<Text style=\{styles\.editTxt\}>Edit public page<\/Text>/);
  assert.match(app, /onManageArtistProfile=\{\(\) => go\(\{ artistHub: true \}\)\}/);
  assert.match(app, /onEditArtistProfile=\{\(name\) => name && requireVerifiedMutation\("artist", \(\) => go\(\{ editArtist: name \}\)\)\}/);
  assert.match(app, /go\(\{ artistPreview: name \}\)/);
  assert.match(app, /else if \(nav\.artistPreview\) overlay = <ArtistScreen artistName=\{nav\.artistPreview\} previewAsFan/);
  assert.match(app, /\["artistHub", "artist_hq"\]/);
  assert.match(app, /\["artistPreview", "artist_preview"\]/);
});

test("Artist HQ exposes one primary action for each distinct job", () => {
  assert.equal((hub.match(/onPress=\{\(\) => onPreview\?\.\(artistName\)\}/g) || []).length, 1, "one public artist profile preview");
  assert.equal((hub.match(/title="Edit public page"/g) || []).length, 1, "one public-page editor");
  assert.equal((hub.match(/onPress=\{onCampaignPost\}/g) || []).length, 1, "one artist-drop action");
  assert.equal((hub.match(/onPress=\{onTourDates\}/g) || []).length, 1, "one live-dates action");
  assert.equal((hub.match(/onPress=\{onEditAccount\}/g) || []).length, 1, "one personal-account action");
  assert.match(hub, />Public artist profile<\/Text>/);
  assert.match(hub, /title="Artist drop"/);
  assert.match(hub, /title="Live dates"/);
});

test("Artist HQ launches the artist-only campaign composer and the feed renders its trusted presentation", () => {
  assert.match(hub, /onCampaignPost/);
  assert.match(hub, /title="Artist drop"/);
  assert.match(app, /onCampaignPost=\{\(\) => requireVerifiedMutation\("artist", \(\) => go\(\{ logging: true, postMode: "campaign" \}\)\)\}/);
  assert.match(composer, /user\?\.role === "artist"/);
  assert.match(composer, /campaign: isCampaign \? campaign : null/);
  assert.match(composer, /backgroundAssetId: isCampaignBackground \? undefined : backgroundAssetId/);
  assert.match(composer, /media: publishedMedia/);
  assert.match(feedCard, /artistCampaignPresentation\(log\.campaign, postMedia\)/);
  assert.match(feedCard, /autoplay=\{!reduceMotion\}/);
  assert.match(feedCard, /OFFICIAL ARTIST DROP|campaignTreatment\.eyebrow\.toUpperCase\(\)/);
  assert.match(feedCard, /campaignTouchTarget: \{ minWidth: 44, minHeight: 44 \}/);
  assert.match(afterparty, /palette\?\.mutedTextColor/);
  assert.match(afterparty, /campaignSend: \{ width: 44, height: 44/);
  assert.match(hub, /Artist drops still reach the main feed\./);
});

test("fan preview hides ownership affordances and unreleased dates", () => {
  assert.match(artist, /previewAsFan = false/);
  assert.match(artist, /const canManagePublicPage = ownsArtistPage && !previewAsFan/);
  assert.match(artist, /const upcoming = previewAsFan \? a\.upcoming\.filter\(\(date\) => !date\.scheduled\) : a\.upcoming/);
  assert.match(artist, /FAN PREVIEW/);
  assert.match(artist, /Owner controls and scheduled dates are hidden\./);
  assert.match(artist, /!ownsArtistPage && a\.ownerId && onReport/);
  assert.match(artist, /!ownsArtistPage && onReport/);
  assert.match(artist, /\^https:\\\/\\\/\/i\.test\(t\.ticketUrl \|\| ""\)/);
  assert.match(artist, /Tickets soon/);
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
  assert.match(artist, /Page updates are read-only here/);
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
  assert.match(store, /return commandSuccess\(\{ scope, profile: normalizedProfile, posts: normalizedPosts, loadedAt: Date\.now\(\) \}\)/);
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
  assert.match(hub, /\{!hasConfirmedArtistPage \? \([\s\S]*Existing page updates will appear after the artist page is confirmed\./);
  assert.match(artist, /loadArtistPage\(a\.name, \{ signal: controller\.signal \}\)/);
});

test("page-update deletion lives in Artist HQ with confirmation, account scoping, and retry", () => {
  assert.match(hub, /await removeArtistPost\(artistName, postId, \{ signal: controller\.signal \}\)/);
  assert.match(hub, /artistPostMutation\.scope === artistPostScope/);
  assert.match(hub, /Remove this page update\?/);
  assert.match(hub, /This page update was not removed, so it is still visible/);
  assert.match(hub, /error\?\.retryable/);
  assert.match(hub, /posts\.map\(\(item\) =>/);
});

test("page-update visibility is an accessible switch with explicit state", () => {
  assert.match(artistEditor, /title="Edit public page"/);
  assert.match(artistEditor, /loadArtistPage\(artist\.name, \{ signal: controller\.signal \}\)/);
  assert.match(artistEditor, /if \(!artistPageEditReady\(resource\) \|\| mediaBusy \|\| saving\) return;/);
  assert.match(artistEditor, /confirmedProfile=\{scopedResource\.data\.profile\}/);
  assert.doesNotMatch(artistEditor, /const prof = artistProfile\(/);
  assert.match(artistEditor, /accessibilityRole="switch"/);
  assert.match(artistEditor, /accessibilityState=\{\{ checked: feedEnabled, disabled: mediaBusy \|\| saving \}\}/);
  assert.match(artistEditor, /accessibilityValue=\{\{ text: feedEnabled \? "Shown" : "Hidden" \}\}/);
  assert.match(artistEditor, />Show page updates<\/Text>/);
});
