import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

import {
  PULL_REFRESH_COVERAGE,
  REQUIRED_PULL_REFRESH_SCREENS,
} from "./pullRefreshCoverage.mjs";

const screensUrl = new URL("../screens/", import.meta.url);
const readScreen = (screen) => readFileSync(new URL(screen, screensUrl), "utf8");
const store = readFileSync(new URL("../store.js", import.meta.url), "utf8");
const ownsVerticalScroll = (source) => ["<ScrollView", "<FlatList", "<SectionList"]
  .some((token) => source.includes(token));

test("every vertical screen is explicitly classified for pull refresh", () => {
  const scrollScreens = readdirSync(screensUrl)
    .filter((name) => name.endsWith(".jsx"))
    .filter((name) => ownsVerticalScroll(readScreen(name)))
    .sort();
  const classified = PULL_REFRESH_COVERAGE.map((entry) => entry.screen).sort();
  assert.deepEqual(classified, scrollScreens);
  assert.equal(new Set(classified).size, classified.length, "refresh coverage cannot classify one screen twice");
  for (const entry of PULL_REFRESH_COVERAGE) {
    assert.ok(entry.reason.trim().length >= 12, `${entry.screen} needs a meaningful refresh decision`);
  }
});

test("every required remote surface uses the shared scoped refresh control", () => {
  for (const screen of REQUIRED_PULL_REFRESH_SCREENS) {
    const source = readScreen(screen);
    assert.match(source, /VinylRefreshBoundary/, `${screen} must use the shared vinyl boundary`);
    assert.match(source, /useScopedRefresh/, `${screen} must await and control refresh state`);
    assert.match(source, /refreshScope/, `${screen} must include account and target identity`);
    assert.match(source, /accessibilityLabel=/, `${screen} refresh needs an accessible label`);
    assert.doesNotMatch(source, /RefreshControl|refreshControl=/, `${screen} cannot install a second native refresh owner`);
  }
});

test("remote directory pulls await their real loaders and retain current views on failure", () => {
  const fanClubs = readScreen("FanClubsScreen.jsx");
  const followList = readScreen("FollowListScreen.jsx");
  const nearby = readScreen("NearbyScreen.jsx");
  const topRated = readScreen("TopRatedScreen.jsx");
  const venues = readScreen("VenuesScreen.jsx");

  assert.match(fanClubs, /await loadFanClubsDirectory\(\{ signal \}\)/);
  assert.match(store, /fanClubDirectoryStatus === "ready"[\s\S]{0,160}?fanClubDirectoryStatus === "refreshing"[\s\S]{0,160}?fanClubDirectorySnapshot\.length > 0/);

  assert.match(followList, /readDirectory\(\{ signal, preserveRows: true \}\)/);
  assert.match(store, /expectedAccountId: accountId,[\s\S]{0,240}?signal\?\.aborted/);

  for (const source of [nearby, venues]) {
    assert.match(source, /return refreshTourDates\(\{ signal \}\)/);
    assert.match(source, /results are unchanged|results are unchanged\./);
  }
  assert.match(store, /fetchStartupTourDates\(\{[\s\S]{0,160}?expectedAccountId: accountId/);

  assert.match(topRated, /readTopRated\(\{ signal, force: true \}\)/);
  assert.match(topRated, /status: current\.rows\.length \? "refreshing" : "loading", rows: current\.rows/);
  assert.match(topRated, /setResource\(\(current\) => \(\{ \.\.\.current, status: "error" \}\)\)/);
});

test("remote archives, media gallery, and clips await scoped head refresh without removing pagination", () => {
  const artistArchive = readScreen("ArtistArchiveScreen.jsx");
  const artistGallery = readScreen("ArtistGalleryScreen.jsx");
  const tourArchive = readScreen("TourArchiveScreen.jsx");
  const clips = readScreen("ClipsScreen.jsx");
  const artistEventHook = readFileSync(
    new URL("../features/artistEvents/useArtistEventArchive.js", import.meta.url),
    "utf8",
  );

  assert.match(artistArchive, /return refreshArchive\(\{ signal \}\)/);
  assert.match(artistGallery, /await loadArtistPhotos\(resolvedName, resolvedKey, \{ signal \}\)/);
  assert.match(tourArchive, /Promise\.allSettled\(\[[\s\S]{0,180}?refreshArchive\(\{ signal \}\),[\s\S]{0,100}?refreshReviews\(\{ signal \}\)/);
  assert.match(tourArchive, /onEndReached=/);
  assert.match(clips, /const result = await loadClips\(\{ signal \}\)/);
  assert.match(clips, /loadMoreControllerRef\.current\?\.abort\(\)/);
  assert.match(clips, /preservedIndex/);
  assert.match(clips, /function NativeReel[\s\S]{0,500}?<VinylRefreshBoundary[\s\S]{0,300}?<FlatList/);
  assert.match(clips, /function WebReel[\s\S]{0,1800}?<VinylRefreshBoundary[\s\S]{0,300}?<ScrollView/);

  assert.match(artistEventHook, /externalSignal\?\.addEventListener\?\.\("abort", relayAbort/);
  assert.match(artistEventHook, /const refresh = useCallback\(async \(\{ signal \}/);
  assert.match(artistEventHook, /resource: projectArtistEventReviews\([\s\S]{0,240}?refresh,[\s\S]{0,80}?loadMore,/);
});

test("ordinary post comments do not poll while true live rooms keep live updates", () => {
  const post = readScreen("PostScreen.jsx");
  assert.doesNotMatch(post, /setInterval/);
  assert.ok(post.includes("loadComments(log.id, { limit: 50, force: true, signal"));

  for (const screen of ["LoungeScreen.jsx", "FanClubScreen.jsx", "ThreadScreen.jsx", "InboxScreen.jsx"]) {
    assert.ok(readScreen(screen).includes("useLiveChat("), `${screen} must retain active-room updates`);
  }
});
