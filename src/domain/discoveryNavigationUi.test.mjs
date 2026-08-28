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

test("Discover leads with upcoming events, then Near you, then Venues, while retaining deeper discovery", async () => {
  const source = await read("../screens/DiscoverScreen.jsx");
  const upcoming = source.indexOf('title="Upcoming live events"');
  const nearby = source.indexOf('title="Near you"');
  const venue = source.indexOf('title="Venues"');
  const chart = source.indexOf("<DiscoverChart");
  const genres = source.indexOf("<DiscoverGenres");
  assert.ok(upcoming >= 0 && nearby > upcoming && venue > nearby, "Discover should read Upcoming, Near you, then Venues");
  assert.ok(venue >= 0 && chart > venue, "the Venue destination should precede charts");
  assert.ok(genres > chart, "genre exploration should remain available later in the page");
  assert.match(source, /EventScopeToggle/);
  assert.match(source, /PopularLoungeCard/);
  assert.match(source, /onOpenLounge/);
  assert.match(source, /saved home area/);
  assert.match(source, /DiscoverEventBanner/);
  assert.match(source, /eventImage[\s\S]*source: "provider"[\s\S]*provider: "ticketmaster"/);
  assert.match(source, /const liveEvents = useMemo\(\(\) => upcomingEventsForScope/);
  assert.match(source, /accessibilityLabel="Browse all events"/);
  assert.equal((source.match(/title="Near you"/g) || []).length, 1, "Near you should not be duplicated in the shortcut grid");
  assert.equal((source.match(/title="Find venues"/g) || []).length, 0, "Venues already owns a full section");
  assert.match(source, /const sceneProjection = useMemo\(\(\) => projectDiscoverScene\(tourDates, \{[\s\S]*region,[\s\S]*eventLimit: 12,[\s\S]*venueLimit: 8,[\s\S]*countryForCity,[\s\S]*\}\), \[region, tourDates\]\)/);
  assert.match(source, /worldwideEvents: sceneProjection\.events/);
  assert.match(source, /const \[areaChoice, setAreaChoice\] = useState\(\(\) => defaultDiscoverAreaChoice\(areaContext\)\)/);
  assert.match(source, /selectDiscoverCountryArea/);
  assert.match(source, /selectDiscoverScopeArea/);
  assert.doesNotMatch(source, /regionChoice|liveScopeChoice/);
  assert.match(source, /discoverEventCountryFacets\(tourDates/);
  assert.match(source, /discoverNationOptions\(eventCountryFacets/);
  assert.match(source, />\{compactDiscoverNumber\(country\.count\)\} upcoming</);
  assert.match(source, /worldLabel=\{region\}/);
  assert.match(source, /key=\{`events:\$\{liveScope\}:\$\{discoverCountryIdentity\(region\)\}`\}/);
});

test("Discover keeps scene controls inside their card and makes genre exploration useful without a tap", async () => {
  const screen = await read("../screens/DiscoverScreen.jsx");
  const genres = await read("../components/discover/DiscoverGenres.jsx");
  const donut = await read("../components/SoundDonut.jsx");
  assert.match(screen, /visibleDiscoverCountries/);
  assert.match(screen, /style=\{styles\.regionGrid\}/);
  assert.doesNotMatch(screen, /contentContainerStyle=\{styles\.regionRail\}/);
  assert.match(screen, /controlsCard: \{ width: "100%", minWidth: 0, overflow: "hidden"/);
  assert.match(screen, /selectDefaultDiscoverGenre/);
  assert.match(screen, /genreResult\.genre === selectedGenre && genreResult\.region === region/);
  assert.match(screen, /fallbackRows=\{overview\.chart\.rows\}/);
  assert.match(screen, /attendanceRows=\{sceneAttendance\}/);
  assert.match(screen, /filterDiscoverSceneRows\(photos/);
  assert.match(screen, /filterDiscoverSceneRows\([\s\S]*projectPopularLounges/);
  assert.match(screen, /sceneProjection\.venues/);
  assert.match(genres, /<SoundDonut/);
  assert.match(genres, /Recently attended/);
  assert.match(genres, /The map is tuning up/);
  assert.match(genres, /Popular right now/);
  assert.doesNotMatch(donut, /colors\.blue/);
  assert.doesNotMatch(donut, /Animated/);
  assert.match(donut, /importantForAccessibility="no-hide-descendants"/);
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
  assert.match(source, /onOpenEvents=\{\(discoverRegion\) => openPublicDirectory\("events", \{ region: discoverRegion \}\)\}/);
  assert.match(source, /onOpenVenues=\{\(discoverRegion\) => go\(\{ venues: true, discoverRegion \}\)\}/);
  assert.match(source, /nav\.artistGallery/);
  assert.match(source, /accountId=\{session\?\.id \|\| null\}/);
  assert.match(source, /showMobilePublicTrail \? <PublicWebTrail/);
  assert.match(source, /onOpenTopRated=\{\(discoverRegion\) => go\(\{ topRated: true, discoverRegion \}\)\}/);
  assert.match(source, /<TopRatedScreen initialRegion=\{nav\.discoverRegion\}/);
});
