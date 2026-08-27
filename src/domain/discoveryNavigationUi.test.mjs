import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("desktop discovery rail promotes signed-in lounges without retaining the venue widget", async () => {
  const source = await read("../components/Rails.jsx");
  assert.match(source, /POPULAR LOUNGES/);
  assert.match(source, /PopularLoungeCard/);
  assert.doesNotMatch(source, /TRENDING VENUES/);
  assert.match(source, /onOpenDiscover/);
});

test("Discover makes venues first-class, offers local and worldwide events, and demotes rather than deletes genres", async () => {
  const source = await read("../screens/DiscoverScreen.jsx");
  const venue = source.indexOf('title="Venues"');
  const chart = source.indexOf("<DiscoverChart");
  const genres = source.indexOf("<DiscoverGenres");
  assert.ok(venue >= 0 && chart > venue, "the Venue destination should precede charts");
  assert.ok(genres > chart, "genre exploration should remain available later in the page");
  assert.match(source, /EventScopeToggle/);
  assert.match(source, /PopularLoungeCard/);
  assert.match(source, /onOpenLounge/);
  assert.match(source, /saved home area/);
  assert.match(source, /const worldwideEvents = useMemo\([\s\S]*projectWorldwideUpcomingEvents\(tourDates, \{ limit: 12 \}\)[\s\S]*\[tourDates\]/);
  assert.doesNotMatch(source, /const worldwideEvents = typeof upcomingEvents === "function"/);
});

test("logged-out landing labels events worldwide and explains lounges without activity-derived rows", async () => {
  const source = await read("../screens/LandingScreen.jsx");
  assert.match(source, />WORLDWIDE</);
  assert.match(source, />CONCERT LOUNGES</);
  assert.match(source, /Specific active rooms are shown after sign in/);
  assert.doesNotMatch(source, /live\?\.popularLounges/);
  assert.doesNotMatch(source, /messageCount/);
  assert.doesNotMatch(source, /attendeeCount/);
});

test("landing keeps one stable scroll and credit shell while live discovery reveals inside it", async () => {
  const source = await read("../screens/LandingScreen.jsx");
  assert.equal((source.match(/<ScrollView\b/g) || []).length, 1);
  assert.doesNotMatch(source, /const Pitch =|<Pitch|landingScrollPitch|landingOverlayCredit/);
  assert.match(source, /const \{ discoverStats, discoverySidebar \} = useStore\(\)/);
  assert.match(source, /discoverySidebar\?\.upcomingEvents/);
  assert.doesNotMatch(source, /setLandingLive|live\?\.upcomingEvents|\{ media, totals, live \}/);
  assert.match(source, /<View style=\{styles\.inlineFoot\}>/);
  assert.match(source, /styles\.topbar, scrollPitch && styles\.topbarScrolled/);
});

test("App routes venue and lounge discovery through existing navigation without a new route system", async () => {
  const source = await read("../../App.js");
  assert.match(source, /onOpenVenue=\{openVenue\}/);
  assert.match(source, /onOpenLounge=\{\(lounge\) => go\(\{ lounge \}\)\}/);
  assert.match(source, /onExploreLounges=.*setTab\("discover"\).*authMode: "login"/s);
  assert.match(source, /nav\.artistGallery/);
  assert.match(source, /accountId=\{session\?\.id \|\| null\}/);
});
