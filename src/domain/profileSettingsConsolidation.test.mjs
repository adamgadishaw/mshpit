import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parse } from "@babel/parser";

const read = (relative) => readFileSync(new URL(relative, import.meta.url), "utf8");
const settings = read("../screens/SettingsScreen.jsx");
const editProfile = read("../screens/EditProfileScreen.jsx");
const pickArtists = read("../screens/PickArtistsScreen.jsx");
const you = read("../screens/YouScreen.jsx");
const rails = read("../components/Rails.jsx");
const store = read("../store.js");
const accountPrivacyApi = read("../lib/accountPrivacyApi.js");

test("the consolidated appearance and profile modules remain parseable", () => {
  for (const [name, source] of Object.entries({ settings, editProfile, pickArtists, you, rails })) {
    assert.doesNotThrow(() => parse(source, { sourceType: "module", plugins: ["jsx"] }), `${name} must parse`);
  }
});

test("Settings is the single signed-in appearance home and uses the shared theme control", () => {
  assert.match(settings, /import ThemeSwatch, \{ themeGridStyle \}/);
  assert.match(settings, /<Text style=\{styles\.section\}>APPEARANCE<\/Text>/);
  assert.match(settings, /<ThemeSwatch/);
  assert.match(settings, /swatchGrid: themeGridStyle/);
  assert.doesNotMatch(settings, /function Swatch/);
  assert.doesNotMatch(settings, /styles\.swatchDots/);
});

test("Settings owns a server-confirmed member search-indexing opt-out", () => {
  assert.match(settings, /Show my profile in search engines/);
  assert.match(settings, /Public posts and artist pages can still appear/);
  assert.match(settings, /accessibilityState=\{\{ checked: profileSearchIndexingEnabled, busy: savingSearchIndexing \}\}/);
  assert.match(store, /const setProfileSearchIndexingEnabled = async \(enabled\) =>/);
  assert.match(store, /updateProfileSearchIndexingPreference\(enabled\)/);
  assert.match(accountPrivacyApi, /body: \{ searchIndexingOptOut: !enabled \}/);
  assert.match(store, /sessionRef\.current = merged;\s+setSession\(merged\)/);
  assert.match(store, /setProfileSearchIndexingEnabled, setAnnouncementEmailsEnabled/);
});

test("Edit Profile clearly owns the personal Pit identity without duplicating appearance", () => {
  assert.match(editProfile, /title="Personal Pit profile"/);
  assert.match(editProfile, /This is your personal identity across Pit/);
  assert.doesNotMatch(editProfile, /ThemeSwatch/);
  assert.doesNotMatch(editProfile, /THEMES|themeKey|chooseTheme/);
});

test("favorite artist tuning is an internal subflow that preserves the profile draft", () => {
  assert.match(editProfile, /const \[pickingArtists, setPickingArtists\] = useState\(false\)/);
  assert.match(editProfile, /<PickArtistsScreen[\s\S]*?showTheme=\{false\}/);
  assert.match(editProfile, /onPress=\{\(\) => setPickingArtists\(true\)\}/);
  assert.doesNotMatch(editProfile, /onPickArtists/);
});

test("artist onboarding keeps theme choice by default while profile revisits cannot reload it", () => {
  assert.match(pickArtists, /showTheme = true/);
  assert.match(pickArtists, /\{showTheme && \(/);
  assert.match(pickArtists, /if \(showTheme && theme && theme !== themeKey\) await chooseTheme/);
  assert.match(pickArtists, /else onDone\?\.\(\)/);
});

test("You is a private dashboard instead of a second public profile", () => {
  assert.match(you, /The You tab is the private dashboard/);
  assert.match(you, /View public (?:artist page|profile)/);
  assert.match(you, /CONCERT MEMORIES/);
  assert.doesNotMatch(you, /YOUR SOUND|Listening history|PLAYS/);
  assert.doesNotMatch(you, /YOUR PHOTO WALL|YOUR POSTS|PLAYLISTS ·|GOING TO ·/);
  assert.doesNotMatch(you, /selectProfileTimeline|mediaDisplayItems|myPlaylists|goingFor|loadPlayHistory/);
});

test("the retired desktop rail cannot drift from the active top navigation", () => {
  assert.match(rails, /export function DesktopTopNav/);
  assert.doesNotMatch(rails, /export function LeftRail|Legacy desktop rail/);
});
