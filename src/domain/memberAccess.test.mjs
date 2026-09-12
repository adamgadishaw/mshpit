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
  for (const key of ["logging", "followList", "artistGallery", "fanClub", "lounge", "settings", "calendar", "inbox", "editProfile", "reporting", "clips"]) {
    const frame = { [key]: { id: "private-target" } };
    assert.equal(memberFrameRequiresAccount(frame), true);
    assert.deepEqual(navigationFrameForAccount(frame, null), { auth: true });
    assert.equal(navigationFrameForAccount(frame, "member"), frame);
  }
});

test("public entity snapshots, search, legal and sign-in routes stay accessible", () => {
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
  assert.match(source, /if \(!session && memberFrameRequiresAccount\(nav\)\)/);
  assert.match(source, /<VenueScreen[^\n]+onRequireAuth=\{openSignIn\}/);
});
