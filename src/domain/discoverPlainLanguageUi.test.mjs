import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const files = {
  screen: await read("../screens/DiscoverScreen.jsx"),
  chart: await read("../components/discover/DiscoverChart.jsx"),
  community: await read("../components/discover/DiscoverCommunity.jsx"),
  genres: await read("../components/discover/DiscoverGenres.jsx"),
  primitives: await read("../components/discover/DiscoverPrimitives.jsx"),
  banner: await read("../components/discover/DiscoverEventBanner.jsx"),
  venues: await read("../components/discover/DiscoverVenues.jsx"),
  photos: await read("../features/discoverPhotos/DiscoverPhotoPanel.jsx"),
};
const combined = Object.values(files).join("\n");

test("Discover explains its purpose and area controls in everyday language", () => {
  assert.match(files.screen, /FIND MUSIC AND SHOWS/);
  assert.match(files.screen, /See upcoming events, popular artists, venues, and fan picks in one place\./);
  assert.match(files.screen, /CHOOSE AN AREA/);
  assert.match(files.screen, /COUNTRY OR REGION/);
  assert.match(files.screen, /accessibilityLabel="Choose an area to explore"/);
  assert.match(files.screen, /More areas/);
  assert.match(files.screen, /title="Upcoming events"/);
  assert.match(files.venues, /accessibilityLabel="Change city"/);
  assert.match(files.venues, /Search venues in/);
});

test("Discover sections say plainly what people will find or do", () => {
  assert.match(files.venues, /Open venue/);
  assert.match(files.venues, /Opens the full venue page/);
  assert.match(files.venues, /Show map/);
  assert.match(files.venues, /const \[mapOpen, setMapOpen\] = useState\(false\)/);
  assert.match(files.venues, /cityPickerOpen &&/);
  assert.doesNotMatch(files.venues, /1 · CHOOSE A CITY|2 · SELECT A VENUE|Coming up elsewhere in|Selected venue:/);
  assert.match(files.venues, /Show fewer shows/);
  assert.doesNotMatch(files.venues, /Open the venue to see all/);
  assert.match(files.photos, /Public concert photos and clips/);
  assert.match(files.screen, /Top-rated shows and artist communities/);
  assert.match(files.screen, /The most active concert conversations\. Private member data is not used\./);
  assert.match(files.community, /Popular photos and videos/);
  assert.match(files.community, /The most-liked concert photos and clips shared by fans/);
});

test("artist and genre sections avoid chart and catalogue jargon", () => {
  assert.match(files.chart, /POPULAR ARTISTS/);
  assert.match(files.chart, /title=\{source === "plays" \? "What members are playing" : "Popular artists"\}/);
  assert.match(files.chart, /Search artists, genres, or songs/);
  assert.match(files.chart, /Clear search/);
  assert.match(files.genres, /BROWSE BY GENRE/);
  assert.match(files.genres, /title="Genres"/);
  assert.match(files.genres, /From shows you attended/);
  assert.match(files.genres, /Genre information is not ready/);
});

test("loading, empty, and slideshow copy describes the current state directly", () => {
  assert.match(files.primitives, />Loading Discover</);
  assert.match(files.primitives, /Loading artists, genres, venues, and events\./);
  assert.match(files.primitives, /Nothing to show for \{region\} yet/);
  assert.match(files.banner, /MULTI-DAY EVENT/);
  assert.match(files.banner, /UPCOMING EVENT/);
  assert.match(files.banner, /Event slideshow controls/);
  assert.match(files.banner, /Previous event/);
  assert.match(files.banner, /Next event/);
});

test("retired insider phrases do not return to Discover UI copy", () => {
  const retired = [
    "FIND YOUR NEXT OBSESSION",
    "Live charts, local rooms",
    "DISCOVER AREA",
    ">NATION<",
    "More scenes",
    "Keep it focused",
    "PLAN THE NEXT NIGHT",
    "Upcoming live events",
    "LIVE ROOMS",
    "Find your next favourite room",
    "GO DEEPER",
    "Active concert rooms ranked by aggregate conversation",
    "Artists moving now",
    "Catalog popularity",
    "LIVE CHART",
    "Your sound map",
    "genre map is still tuning",
    "The map is tuning up",
    "Tuning the scene",
    "regional signals",
    "FEATURED MULTI-DAY EVENT",
    "UPCOMING LIVE",
  ];
  for (const phrase of retired) {
    assert.equal(combined.includes(phrase), false, "Retired Discover copy returned: " + phrase);
  }
});
