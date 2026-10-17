import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { memberTabRequiresAccount, memberFrameRequiresAccount, navigationFrameForAccount, visibleMainTab } from "./memberAccess.mjs";

test("guests see discovery instead of restored Feed or You, while members retain their tab", () => {
  for (const tab of ["feed", "you"]) {
    assert.equal(memberTabRequiresAccount(tab), true);
    assert.equal(visibleMainTab(tab, null), "discover");
    assert.equal(visibleMainTab(tab, "member"), tab);
  }
  for (const tab of ["search", "discover"]) assert.equal(visibleMainTab(tab, null), tab);
});

test("guest community and account frames become sign-in without replay payloads", () => {
  for (const key of ["logging", "artistGallery", "fanClub", "lounge", "settings", "calendar", "inbox", "editProfile", "reporting", "clips", "catalogEditor"]) {
    const frame = { [key]: { id: "private-target" } };
    assert.equal(memberFrameRequiresAccount(frame), true);
    assert.deepEqual(navigationFrameForAccount(frame, null), { auth: true });
    assert.equal(navigationFrameForAccount(frame, "member"), frame);
  }
});

test("public entity snapshots, search, legal and sign-in routes stay accessible", () => {
  assert.deepEqual(navigationFrameForAccount({ followList: { userId: "public", mode: "followers" } }, null), { followList: { userId: "public", mode: "followers" } });
  for (const frame of [{}, { artistName: "Example" }, { venueName: "Example Hall" }, { profileId: "member" }, { openLog: { id: "show" } }, { post: { id: "public-post" } }, { cityGuide: {} }, { directory: "events" }, { venues: true }, { privacy: true }, { terms: true }, { auth: true, authMode: "signup" }]) {
    assert.equal(memberFrameRequiresAccount(frame), false);
    assert.equal(navigationFrameForAccount(frame, null), frame);
  }
  assert.equal(navigationFrameForAccount(null, null), null);
});

test("App never mounts member tabs for guests and applies the restored-overlay boundary", () => {
  const source = readFileSync(new URL("../../App.js", import.meta.url), "utf8");
  assert.match(source, /activeTab === "feed" && !!session/);
  assert.match(source, /activeTab === "you" && !!session/);
  assert.match(source, /if \(!session && memberTabRequiresAccount\(key\)\) \{ openSignIn\(\); return; \}/);
  assert.match(source, /if \(!session && memberFrameRequiresAccount\(nav, Platform\.OS\)\)/);
  assert.match(source, /<VenueScreen[^\n]+onRequireAuth=\{openSignIn\}/);
});

test("native news entry and restored news posts require a free account; web stays public",()=>{
 for(const frame of [{news:true},{news:true,liveSlug:"example"},{newsroom:true},{post:{id:"news_example"}},{post:{id:"post_example",news:{}}}]){
  const expected = frame.news ? { auth: true, authReturn: { news: true, ...(frame.liveSlug ? { liveSlug: frame.liveSlug } : {}) } } : { auth: true };
  assert.deepEqual(navigationFrameForAccount(frame,null,"android"),expected);
  assert.deepEqual(navigationFrameForAccount(frame,null,"ios"),expected);
  assert.equal(navigationFrameForAccount(frame,"member","android"),frame);
  assert.equal(navigationFrameForAccount(frame,null,"web"),frame);
 }
});

test("native News return retains only a bounded read-only route", () => {
  assert.deepEqual(navigationFrameForAccount({ news: true, liveSlug: "tour-update", logging: true, reporting: { id: "private" } }, null, "android"), { auth: true, authReturn: { news: true, liveSlug: "tour-update" } });
  for (const liveSlug of ["../settings", "", "x".repeat(81), { id: "unsafe" }]) {
    assert.deepEqual(navigationFrameForAccount({ news: true, liveSlug }, null, "ios"), { auth: true, authReturn: { news: true } });
  }
  assert.deepEqual(navigationFrameForAccount({ newsroom: true }, null, "android"), { auth: true });
});
