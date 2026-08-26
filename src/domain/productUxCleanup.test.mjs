import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parse } from "@babel/parser";

const read = (relative) => readFileSync(new URL(relative, import.meta.url), "utf8");
const app = read("../../App.js");
const auth = read("../screens/AuthScreen.jsx");
const errorBoundary = read("../components/ErrorBoundary.jsx");
const feed = read("../screens/FeedScreen.jsx");
const landing = read("../screens/LandingScreen.jsx");
const menu = read("../screens/MenuScreen.jsx");
const pickArtists = read("../screens/PickArtistsScreen.jsx");
const rails = read("../components/Rails.jsx");
const resetPassword = read("../screens/ResetPasswordScreen.jsx");
const search = read("../screens/SearchScreen.jsx");
const settings = read("../screens/SettingsScreen.jsx");

test("the product cleanup screens remain parseable", () => {
  for (const [name, source] of Object.entries({ app, auth, errorBoundary, feed, landing, menu, pickArtists, rails, resetPassword, search, settings })) {
    assert.doesNotThrow(() => parse(source, { sourceType: "module", plugins: ["jsx"] }), `${name} must parse`);
  }
});

test("the feed uses the Mshpit brand and separates For You from Discover", () => {
  assert.match(feed, /<Text style=\{styles\.wordmark\}>MSHPIT<\/Text>/);
  assert.match(feed, /<Seg label="For You"/);
  assert.doesNotMatch(feed, /<Seg label="Discover"/);
  assert.match(feed, /Log your first show[\s\S]*See what fans thought[\s\S]*Find your next show/);
  assert.match(feed, /label="See what fans thought"[\s\S]*onPress=\{onOpenDiscover\}/);
  assert.match(app, /onOpenDiscover=\{\(\) => switchTab\("discover"\)\}/);
});

test("universal search offers typed result filters without member-count marketing", () => {
  for (const label of ["All", "Artists", "Shows", "Venues", "People", "Songs"]) {
    assert.match(search, new RegExp(`label: "${label}"`));
  }
  assert.match(search, /SEARCH_CATEGORIES\.map/);
  assert.match(search, /accessibilityLabel="Filter search results"/);
  assert.match(search, /hidden=\{!showCategory\("artists"\)\}/);
  assert.match(search, /hidden=\{!showCategory\("shows"\)\}/);
  assert.match(search, /searchLiveAnnouncement\(\{ query, state: visibleResultState/);
  assert.doesNotMatch(search, /memberCount|loadMembers/);
});

test("primary branding is Mshpit across entry, navigation, and recovery surfaces", () => {
  assert.match(landing, />MSHPIT<\/Text>/);
  assert.match(landing, /accessibilityLabel="Mshpit, live music remembered"/);
  assert.match(feed, />MSHPIT<\/Text>/);
  for (const [name, source] of Object.entries({ auth, errorBoundary, rails, resetPassword })) {
    assert.match(source, />MSHPIT<\/Text>/, `${name} carries the Mshpit wordmark`);
    assert.doesNotMatch(source, />PIT<\/Text>/, `${name} has no legacy standalone wordmark`);
  }
  assert.match(menu, /MSHPIT · YOUR STORY IN SOUND/);
  assert.match(settings, /sub="Mshpit mobile"/);
});

test("enthusiast themes are progressively disclosed without losing saved choices", () => {
  assert.match(settings, /visibleThemeChoices\(THEMES, \{ expanded: showMoreThemes, selectedKey: themeKey \}\)/);
  assert.match(settings, /themeChoices\.map/);
  assert.match(settings, /Show more themes/);
  assert.match(settings, /accessibilityState=\{\{ expanded: showMoreThemes \}\}/);
  assert.match(settings, /isMod\(session\?\.role\) && <Row icon="discover" label="Diagnostics"/);

  assert.match(pickArtists, /visibleThemeChoices\(THEMES, \{ selectedKey: theme \}\)/);
  assert.match(pickArtists, /onboardingThemes\.map/);
  assert.doesNotMatch(pickArtists, /\{THEMES\.map/);

  assert.match(menu, /visibleThemeChoices\(THEMES, \{ selectedKey: themeKey \}\)/);
  assert.match(menu, /guestThemeChoices\.map/);
  assert.doesNotMatch(menu, /\{THEMES\.map/);
});
