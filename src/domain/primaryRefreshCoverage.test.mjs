import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const sources = Object.freeze({
  App: read("../../App.js"),
  Feed: read("../screens/FeedScreen.jsx"),
  Search: read("../screens/SearchScreen.jsx"),
  Discover: read("../screens/DiscoverScreen.jsx"),
  Calendar: read("../screens/CalendarScreen.jsx"),
  You: read("../screens/YouScreen.jsx"),
  RightRail: read("../components/Rails.jsx"),
});
const matrix = Object.freeze([
  { name: "Feed", testID: "feed-refresh", handler: "refresh", scope: /accountId|filterScope/ },
  { name: "Search", testID: "search-refresh", handler: "refreshSearch", scope: /searchAccountScope/ },
  { name: "Discover", testID: "discover-refresh", handler: "refreshDiscover", scope: /accountId/ },
  { name: "Calendar", testID: "calendar-refresh", handler: "refreshCalendar", scope: /session\?\.id/ },
  { name: "You", testID: "you-refresh", handler: "refreshDashboard", scope: /session\?\.id/ },
]);

function functionSlice(source, name, nextMarker = "\n  const ") {
  const match = source.match(new RegExp(`const ${name} = (?:useCallback\\()?async`));
  const start = match?.index ?? -1;
  assert.ok(start >= 0, `${name} must exist`);
  const end = source.indexOf(nextMarker, start + 10);
  return source.slice(start, end >= 0 ? end : undefined);
}

test("every meaningful primary data surface owns one accessible vinyl refresh boundary", () => {
  for (const entry of matrix) {
    const source = sources[entry.name];
    assert.ok(source, `${entry.name} source is registered`);
    assert.match(source, /import VinylRefreshBoundary/);
    assert.equal((source.match(/<VinylRefreshBoundary\b/g) || []).length, 1, `${entry.name} has one refresh owner`);
    assert.match(source, new RegExp(`testID="${entry.testID}"`));
    assert.match(source, new RegExp(`onRefresh=\\{${entry.handler}\\}`));
    assert.match(source, /accessibilityLabel="Refresh/i);
    assert.match(source, /accessibilityRole="alert"|accessibilityRole=\{[^}]*"alert"/);
    assert.match(source, entry.scope);
    assert.doesNotMatch(source, /<RefreshControl\b|refreshControl=/, `${entry.name} must delegate native pull ownership to the shared boundary`);
  }
});

test("each pull awaits its bounded current-surface loaders and keeps existing content on failure", () => {
  const feed = functionSlice(sources.Feed, "refresh");
  assert.match(feed, /await onRefresh\(\{ signal: controller\.signal \}\)/);
  assert.match(feed, /setRefreshError/);

  const home = functionSlice(sources.App, "refreshHomeFeedData", "\n  // iOS Safari");
  assert.match(home, /Promise\.allSettled/);
  assert.match(home, /refreshFeed/);
  assert.match(home, /refreshDiscoverySidebar/);
  assert.match(home, /refreshTourDates/);
  assert.match(home, /refreshMyAttendance/);
  assert.match(sources.App, /onRefresh=\{refreshHomeFeedData\}/);

  const search = functionSlice(sources.Search, "refreshSearch", "\n\n  const mine");
  assert.match(search, /Promise\.allSettled/);
  assert.match(search, /searchResult/);
  assert.match(search, /refreshTourDates/);
  assert.match(search, /loadFanClubsDirectory/);
  assert.doesNotMatch(search, /setQ|setQueryState|setActiveCategory|scrollTo/);

  const discover = functionSlice(sources.Discover, "refreshDiscover", "\n\n  const overviewState");
  assert.match(discover, /Promise\.allSettled/);
  assert.match(discover, /requestOverview/);
  assert.match(discover, /requestGenre/);
  assert.match(discover, /refreshTourDates/);
  assert.match(discover, /refreshDiscoverySidebar/);
  assert.match(discover, /refreshLoadedRange/);
  assert.doesNotMatch(discover, /setQuery|setAreaChoice|setVisibleEventCount|scrollTo/);

  const calendar = functionSlice(sources.Calendar, "refreshCalendar", "\n\n  return");
  assert.match(calendar, /Promise\.allSettled/);
  assert.match(calendar, /refreshTourDates/);
  assert.match(calendar, /refreshMyAttendance/);
  assert.match(calendar, /history\.retry/);
  assert.match(calendar, /serverTime/);

  const dashboard = functionSlice(sources.You, "refreshDashboard", "\n\n  \/\/");
  assert.match(dashboard, /Promise\.allSettled/);
  assert.match(dashboard, /history\.retry/);
  assert.match(dashboard, /loadRewards/);
  assert.match(dashboard, /loadInboxThreads/);
  assert.match(dashboard, /refreshNotifications/);

});

test("Discover keeps last-good results inside their exact region and genre scopes", () => {
  const discover = sources.Discover;
  assert.match(discover, /const overviewScopeKey = discoverCountryIdentity\(region\) \|\| "worldwide"/);
  assert.match(discover, /const \[overviewResults, setOverviewResults\] = useState/);
  assert.match(discover, /const previous = overviewResultsRef\.current\[requestScopeKey\]/);
  assert.match(discover, /hasDiscoverOverviewContent\(previous\) \? "refreshing" : "loading"/);
  assert.match(discover, /setOverviewResults\(\(current\) => \(\{ \.\.\.current, \[requestScopeKey\]: normalized \}\)\)/);
  assert.match(discover, /const genreScopeKey = JSON\.stringify\(\[overviewScopeKey,/);
  assert.match(discover, /const previous = genreResultsRef\.current\[requestScopeKey\] \|\| \[\]/);
  assert.match(discover, /previous\.length \? "refreshing" : "loading"/);
  assert.match(discover, /setGenreResults\(\(current\) => \(\{ \.\.\.current, \[requestScopeKey\]: normalized \}\)\)/);
  assert.match(discover, /const sameScope = previous\.scopeKey === rangeScopeKey && previous\.days === days/);
  assert.match(discover, /rows: sameScope \? previous\.rows : \[\]/);
  assert.match(discover, /!append && currentMatches && current\.rows\.length && !normalized\.length/);
  assert.match(discover, /Updating dates\. Your current events are still here\./);
  assert.doesNotMatch(discover, /setOverview\([^\n]*normalizeDiscoverOverview\(\{ countries:/,
    "starting a request must not erase a healthy chart");
  assert.doesNotMatch(discover, /setGenreResult\(\{ genre: selectedGenre, region, rows: \[\] \}\)/,
    "starting a request must not erase healthy genre rows");
  assert.doesNotMatch(discover, /rows: append && current\.scopeKey === rangeScopeKey && current\.days === days \? current\.rows : \[\]/,
    "refreshing an exact event range must not erase healthy event and venue rows");
});

test("desktop right rail has no in-app refresh owner", () => {
  assert.doesNotMatch(sources.RightRail, /VinylRefreshBoundary|right-rail-refresh|onRefreshData|refreshRail/);
  assert.doesNotMatch(sources.App, /refreshRightRailData|onRefreshData=\{refreshRightRailData\}/);
  assert.match(sources.RightRail, /<ScrollView[\s\S]*styles\.right/);
});

test("refresh is deliberate rather than focus polling, and the shared UI never fetches data", () => {
  for (const entry of matrix) {
    const source = sources[entry.name];
    const handler = functionSlice(source, entry.handler);
    assert.doesNotMatch(handler, /AppState|visibilitychange|setInterval|requestAnimationFrame/);
  }
  const vinyl = read("../components/VinylRefreshBoundary.jsx");
  assert.doesNotMatch(vinyl, /\bfetch\s*\(|\bapi\s*\(|setInterval|visibilitychange|AppState/);
});

test("static composers and account forms do not advertise fake pull refresh", () => {
  for (const path of [
    "../screens/LogScreen.jsx",
    "../screens/EditProfileScreen.jsx",
    "../screens/RequestArtistScreen.jsx",
  ]) {
    const source = read(path);
    assert.doesNotMatch(source, /VinylRefreshBoundary|<RefreshControl\b|refreshControl=/);
  }
});
