import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parse } from "@babel/parser";
import { unifiedSearchCategories } from "./unifiedSearch.mjs";

const read = (relative) => readFileSync(new URL(relative, import.meta.url), "utf8");
const app = read("../../App.js");
const auth = read("../screens/AuthScreen.jsx");
const artistCarousel = read("../components/ArtistCinematicCarousel.jsx");
const artistMemorialTribute = read("../components/artist/ArtistMemorialTribute.jsx");
const artistMemorialConsole = read("../components/moderation/ArtistMemorialConsole.jsx");
const artistScreen = read("../screens/ArtistScreen.jsx");
const clips = read("../screens/ClipsScreen.jsx");
const concertMemory = read("../components/ConcertMemoryModal.jsx");
const errorBoundary = read("../components/ErrorBoundary.jsx");
const errorCatalog = read("../lib/errorCatalog.mjs");
const feed = read("../screens/FeedScreen.jsx");
const landing = read("../screens/LandingScreen.jsx");
const log = read("../screens/LogScreen.jsx");
const menu = read("../screens/MenuScreen.jsx");
const nearby = read("../screens/NearbyScreen.jsx");
const pickArtists = read("../screens/PickArtistsScreen.jsx");
const rails = read("../components/Rails.jsx");
const resetPassword = read("../screens/ResetPasswordScreen.jsx");
const search = read("../screens/SearchScreen.jsx");
const settings = read("../screens/SettingsScreen.jsx");
const show = read("../screens/ShowScreen.jsx");
const venue = read("../screens/VenueScreen.jsx");
const venues = read("../screens/VenuesScreen.jsx");
const serverApi = read("../../server/api.js");

test("the product cleanup screens remain parseable", () => {
  for (const [name, source] of Object.entries({ app, auth, artistCarousel, artistMemorialConsole, artistMemorialTribute, artistScreen, clips, concertMemory, errorBoundary, errorCatalog, feed, landing, log, menu, nearby, pickArtists, rails, resetPassword, search, settings, show, venue, venues })) {
    assert.doesNotThrow(() => parse(source, { sourceType: "module", plugins: ["jsx"] }), `${name} must parse`);
  }
});

test("high-frequency fallback and provenance copy stays literal", () => {
  const touched = {
    artistCarousel,
    artistMemorialConsole,
    artistMemorialTribute,
    artistScreen,
    clips,
    concertMemory,
    errorBoundary,
    errorCatalog,
    log,
    menu,
    nearby,
    rails,
    serverApi,
    show,
    venue,
    venues,
  };
  const rejected = [
    "The night hit a snag",
    "FROM THE CROWD",
    "FROM THE PIT COMMUNITY",
    "BACK IN THE CROWD",
    "That post left the stage",
    "written from the Pit community",
    "That act left the stage",
    "Backstage hit a snag",
    "The saved copy missed a beat",
    "Your account changed stages",
    "Give the crowd a beat",
    "A guest performer missed the cue",
    "That format missed the guest list",
    "The stage lights went out",
    "Something missed the beat",
    "More clips missed the beat",
    "Friend search missed a beat",
    "A staged media file was removed by the device",
    "That link missed the cue",
    "One staged media file was removed by the device",
    "start your musical journey",
    "Start your journey",
    "title=\"Your journey\"",
    "Closest stages first",
    "Shows worth leaving home for",
    "Reviews missed a beat",
    "The local lineup missed a beat",
    "Coming to this stage",
    "Find the stage before the lights go down",
    "Shared a moment from the archive",
    "A quick look at public fan moments",
    "Public fan shots and clips, alongside artist imagery",
    "Pit could not confirm a valid MusicBrainz identity",
    "WRITTEN BY MSHPIT MEMBERS",
    "written by Mshpit members",
  ];
  for (const [name, source] of Object.entries(touched)) {
    for (const phrase of rejected) {
      assert.doesNotMatch(source, new RegExp(phrase, "i"), `${name} must not use “${phrase}”`);
    }
  }
  assert.match(errorBoundary, />Something went wrong<\/Text>/);
  assert.match(artistCarousel, /current\?\.source === "fan" \? "MSHPIT MEMBER PHOTO" : "FEATURED ARTIST"/);
  assert.match(artistMemorialTribute, /TRIBUTE MESSAGE/);
  assert.match(concertMemory, /CONCERT MEMORY/);
  assert.equal((serverApi.match(/That post is unavailable/g) || []).length, 2);
  assert.match(errorCatalog, /title: "This item is unavailable"/);
  assert.match(errorCatalog, /title: "Something went wrong"/);
  assert.match(errorCatalog, /title: "This change was not saved"/);
  assert.doesNotMatch(errorCatalog, /message: "Pit could not finish that action/);
  assert.doesNotMatch(errorCatalog, /failurePoint: "Pit service"/);
});

test("the feed uses the Mshpit brand and separates For You from Discover", () => {
  assert.match(feed, /<Text style=\{styles\.wordmark\}>MSHPIT<\/Text>/);
  assert.match(feed, /<Seg label="For You"/);
  assert.doesNotMatch(feed, /<Seg label="Discover"/);
  assert.match(feed, /homeGuideStorageKey\(accountId\)/);
  assert.match(feed, /label="Find a show" onPress=\{onOpenDiscover\}/);
  assert.match(feed, /label="Log a show" onPress=\{onLogShow\}/);
  assert.match(app, /onOpenDiscover=\{\(\) => switchTab\("discover"\)\}/);
});

test("universal search offers typed result filters without member-count marketing", () => {
  assert.deepEqual(
    unifiedSearchCategories({ canSearchPeople: true, canSearchSongs: true }).map(({ label }) => label),
    ["All", "Artists", "Shows", "Venues", "People", "Fan clubs", "Songs"],
  );
  assert.match(search, /searchCategories\.map/);
  assert.match(search, /accessibilityLabel="Filter search results"/);
  assert.match(search, /hidden=\{!showCategory\("artists"\)\}/);
  assert.match(search, /hidden=\{!showCategory\("shows"\)\}/);
  assert.match(search, /hidden=\{!showCategory\("clubs"\)\}/);
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
