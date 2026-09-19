import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parse } from "@babel/parser";
import { artistSetupFailure, artistVerificationNotice } from "./artistAccountSetup.mjs";
import { artistWorkspaceModel } from "./artistWorkspace.mjs";

const setup = readFileSync(new URL("../screens/RequestArtistScreen.jsx", import.meta.url), "utf8");
const hub = readFileSync(new URL("../screens/ArtistHubScreen.jsx", import.meta.url), "utf8");
const page = readFileSync(new URL("../screens/ArtistScreen.jsx", import.meta.url), "utf8");
const identityStatus = readFileSync(new URL("../components/ArtistIdentityStatus.jsx", import.meta.url), "utf8");

test("artist setup offers a reviewed claim only for an authoritative duplicate", () => {
  assert.deepEqual(artistSetupFailure({ code: "ARTIST_PAGE_EXISTS", error: "Already listed" }), { message: "Already listed", existingPage: true });
  assert.deepEqual(artistSetupFailure({ error: { code: "ARTIST_PAGE_EXISTS", userMessage: "Choose a claim" } }), { message: "Choose a claim", existingPage: true });
  assert.equal(artistSetupFailure({ code: "ARTIST_PAGE_LIMIT", error: "Already own a page" }).existingPage, false);
  assert.equal(artistSetupFailure({ status: 409, error: "Account changed" }).existingPage, false);
  assert.equal(artistSetupFailure(new Error("Network unavailable")).message, "Network unavailable");
  assert.match(artistSetupFailure(null).message, /details are still here/);
});

test("verification status never grants a check just because an artist page exists", () => {
  for (const status of [undefined, "not_requested", "rejected", "approved"]) {
    assert.equal(artistVerificationNotice(status, true).locked, false);
  }
  assert.match(artistVerificationNotice("pending", true).message, /keep updating your page/);
  assert.match(artistVerificationNotice("pending", false).message, /another copy will not grant access/);
  assert.equal(artistVerificationNotice("pending").locked, true);
  assert.equal(artistVerificationNotice("verified").locked, true);
  assert.match(artistVerificationNotice("verified").message, /verified by Mshpit/);
});

test("artist setup is one account-scoped form with visible choices and safe confirmations", () => {
  assert.doesNotThrow(() => parse(setup, { sourceType: "module", plugins: ["jsx"] }));
  assert.match(setup, /key=\{session\?\.id \|\| "guest"\}/);
  assert.match(setup, /Create a new artist page/);
  assert.match(setup, /Claim an existing page/);
  assert.match(setup, /no separate login or subscription/);
  assert.match(setup, /session\?\.emailVerified === true && account\.status === "ready"/);
  assert.match(setup, /await resendEmailVerification\(\{ signal: controller\.signal \}\)/);
  assert.match(setup, /await createArtistPage\(artistName\.trim\(\), bio\.trim\(\), \{ signal: controller\.signal \}\)/);
  assert.match(setup, /await requestArtist\(artistName\.trim\(\), reviewNote, \{ signal: controller\.signal,/);
  assert.match(setup, /if \(!mounted\.current \|\| controller\.signal\.aborted \|\| operation\.current !== controller\) return;/);
  assert.match(setup, /operation\.current\?\.abort\(\)/);
  assert.match(setup, /if \(!ownsPage \|\| done\) return;[\s\S]*?setMode\("claim"\);[\s\S]*?setArtistName\(session\.artistName\)/);
  assert.match(setup, /if \(result\?\.ok\) setDone\(\{ mode, result \}\)/);
  assert.match(setup, /Claim this existing page instead/);
  assert.match(setup, /Your artist page can be public\. Your account privacy settings still apply/);
  assert.match(setup, /editable=\{!busy && !ownsPage\}/);
  assert.doesNotMatch(setup, /setBio\(""\)|setNote\(""\)/, "failures cannot erase the supplied evidence or biography");
});

test("free artist workspace exposes media tools and a separate owner-reviewed check", () => {
  assert.doesNotThrow(() => parse(hub, { sourceType: "module", plugins: ["jsx"] }));
  assert.match(hub, /session\?\.verified === true \? <Badge type="verified"/);
  assert.match(hub, /title="Live photos & videos"[\s\S]*?onPress=\{onMediaPost\}/);
  assert.match(hub, /title="Promote a concert or release"[\s\S]*?onPress=\{onCampaignPost\}/);
  assert.match(hub, /two featured promotions per day/);
  assert.match(hub, /ArtistIdentityStatus accountId=\{session\?\.id\}/);
  assert.match(identityStatus, /Request or check verification/);
  assert.match(identityStatus, /onPress=\{onRequestVerification\}/);
  const model = artistWorkspaceModel({ session: { id: "artist-new", role: "artist", artistName: "New Band", verified: false } });
  assert.equal(model.authorized, true);
  assert.equal(model.completion.some((item) => item.key === "catalog"), false, "do not offer an Add music task with no editor");
});

test("public artist promotion previews do not open member-only reviews or chat", () => {
  assert.doesNotThrow(() => parse(page, { sourceType: "module", plugins: ["jsx"] }));
  assert.match(page, /const publicArtistPreview = profileServicesAvailable && sectionModel\.active === "overview"/);
  assert.match(page, /\(sectionModel\.showCommunity \|\| publicArtistPreview\) && \(gallery\.length > 0/);
  assert.match(page, /\(sectionModel\.showCommunity \|\| publicArtistPreview\) && artistPostsVisible/);
  assert.match(page, /name: session \? a\.name : null/);
  assert.match(page, /artistKey: session \? a\.profileKey : null/);
  assert.match(page, /Private and moderated media is not shown/);
});
