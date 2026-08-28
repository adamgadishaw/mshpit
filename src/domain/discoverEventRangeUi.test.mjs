import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("Discover keeps four events immediate and requests wider ranges only after an action", async () => {
  const screen = await read("../screens/DiscoverScreen.jsx");
  const store = await read("../store.js");
  const rangeApi = await read("../features/discovery/tourDateRangeApi.mjs");
  assert.match(screen, /limit: 4,/);
  assert.match(screen, /DISCOVER_RANGE_DAYS/);
  assert.match(screen, /HOW FAR AHEAD\?/);
  assert.match(screen, /accessibilityLabel="Choose how far ahead to look for events"/);
  assert.match(screen, /onPress=\{\(\) => selectEventRange\(days\)\}/);
  assert.match(screen, /const selectedRangeDays[\s\S]*DISCOVER_RANGE_DAYS\[0\]/);
  assert.match(screen, /const initialRangeEvents = useMemo\(\(\) => selectDiscoverRangeEvents\([\s\S]*days: DISCOVER_RANGE_DAYS\[0\]/);
  assert.match(screen, /const liveEvents = useMemo\(\(\) => upcomingEventsForScope\([\s\S]*worldwideEvents: initialRangeEvents[\s\S]*limit: 4,/);
  assert.match(screen, /if \(!rangeMatchesScene\)[\s\S]*requestEventRange\(selectedRangeDays\)/);
  assert.match(screen, /Load \$\{DISCOVER_RANGE_BATCH\} more events/);
  assert.match(screen, /selectDiscoverRangeEvents/);
  assert.match(screen, /mergeDiscoverRangePages/);
  assert.match(screen, /rangeRequestRef\.current\.controller\?\.abort\(\)/);
  assert.doesNotMatch(screen, /useEffect\(\(\) => \{\s*requestEventRange\(/);
  assert.match(screen, /const local = liveScope === LIVE_EVENT_SCOPE\.LOCAL/);
  assert.match(screen, /rangeLoaderRef\.current\(\{[\s\S]*country: requestCountry,[\s\S]*local,[\s\S]*signal: controller\.signal/);
  assert.doesNotMatch(screen, /rangeLoaderRef\.current\(\{[^}]*\bcity\b/);
  assert.match(screen, /then\(\(\{ tourDates: rows, nextCursor, through \}\)/);
  assert.match(screen, /setEventRange\(\(current\) => \(\{[\s\S]*\n\s*through,/);
  assert.match(store, /const loadDiscoverTourDateRange = async/);
  assert.match(store, /fetchDiscoverTourDateRange\(\{ days, limit, after, country, local, signal \}\)/);
  assert.doesNotMatch(store, /loadDiscoverTourDateRange[\s\S]{0,220}\bcity\b/);
  assert.match(store, /through: parsed\.through/);
  assert.match(rangeApi, /local[\s\S]*discoverySidebarRangeRequestPath\(\{ days, limit: DISCOVER_RANGE_MAX_EVENTS \}\)/);
  assert.match(rangeApi, /tourDateRangeRequestPath\(\{ days, limit, after, country \}\)/);
  assert.doesNotMatch(rangeApi, /tourDateRangeRequestPath\(\{[^}]*city/);
  assert.match(rangeApi, /parseTourDateRangeResponse\(payload\)/);
});
