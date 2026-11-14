import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parse } from "@babel/parser";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("Discover shows four event cards, a week-by-week list, and fetches the selected scope before offering wider ranges", async () => {
  const screen = await read("../screens/DiscoverScreen.jsx");
  const store = await read("../store.js");
  const rangeApi = await read("../features/discovery/tourDateRangeApi.mjs");
  assert.match(screen, /limit: 4,/);
  assert.match(screen, /DISCOVER_RANGE_DAYS/);
  assert.match(screen, /HOW FAR AHEAD\?/);
  assert.match(screen, /accessibilityLabel="Choose how far ahead to look for events"/);
  assert.match(screen, /onPress=\{\(\) => \{ selectEventRange\(days\); setDateExpanded\(false\); dateDisclosureRef.current\?\.focus\?\.\(\); \}\}/);
  assert.match(screen, /const \[selectedRangeDays, setSelectedRangeDays\] = useState/);
  assert.match(screen, /const initialRangeEvents = useMemo\(\(\) => selectDiscoverRangeEvents\([\s\S]*days: DISCOVER_RANGE_DAYS\[0\]/);
  assert.match(screen, /const liveEvents = useMemo\(\(\) => upcomingEventsForScope\([\s\S]*worldwideEvents: initialRangeEvents[\s\S]*limit: 4,/);
  assert.match(screen, /const openEventList = useCallback[\s\S]*if \(!rangeMatchesScene\) requestEventRange\(selectedRangeDays\)/);
  assert.doesNotMatch(screen, /more events`/, "no endless load more");
  assert.match(screen, /See all \$\{rangeEvents\.length\} shows as a list/);
  assert.match(screen, /<DiscoverEventList events=\{listEvents\}/);
  assert.match(screen, /requestedCursorRef\.current\.has\(eventRange\.nextCursor\)/, "the list never asks for the same page twice");
  assert.match(screen, /filter\(\(event\) => !isFestivalListing\(event\)\)/, "festivals stay in their own tab");
  assert.match(screen, /selectDiscoverRangeEvents/);
  assert.match(screen, /mergeDiscoverRangePages/);
  assert.match(screen, /rangeRequestRef\.current\.controller\?\.abort\(\)/);
  const body = parse(screen, { sourceType: "module", plugins: ["jsx"] }).program.body
    .find((n) => n.type === "ExportDefaultDeclaration").declaration.body.body;
  const effect = body.find((n) => n.expression?.callee?.name === "useEffect"
    && n.expression.arguments[1]?.elements?.some((arg) => arg.name === "rangeScopeKey")
    && screen.slice(n.start, n.end).includes("rangeRequestRef.current.sequence += 1")).expression.arguments[0];
  assert.ok(effect, "scope changes own a request effect with cancellation");
  const run = new Function("restoredRangeScope", "rangeScopeKey", "selectedRangeDays", "setEventWeek", "requestEventRange", "rangeRequestRef",
    `return (${screen.slice(effect.start, effect.end)})();`);
  for (const [savedScope, days, clearWeek] of [["scene", 30, false], ["scene", 90, false], ["old-scene", 90, true]]) {
    const requests = [], weeks = [], scope = { current: savedScope }, owner = { current: { sequence: 0, controller: { abort: () => requests.push("abort") } } };
    const cleanup = run(scope, "scene", days, (v) => weeks.push(v), (v) => requests.push(v), owner);
    assert.deepEqual(requests, [days]); assert.deepEqual(weeks, clearWeek ? [null] : []);
    assert.equal(scope.current, "scene"); cleanup();
    assert.deepEqual(requests, [days, "abort"]); assert.equal(owner.current.sequence, 1);
  }
  assert.match(screen, /const local = liveScope === LIVE_EVENT_SCOPE\.LOCAL/);
  assert.match(screen, /rangeLoaderRef\.current\(\{[\s\S]*country: requestCountry,[\s\S]*local,[\s\S]*signal: controller\.signal/);
  assert.doesNotMatch(screen, /rangeLoaderRef\.current\(\{[^}]*\bcity\b/);
  assert.match(screen, /then\(\(\{ tourDates: rows, nextCursor, through \}\)/);
  assert.match(screen, /const currentMatches = current\.scopeKey === rangeScopeKey && current\.days === days/);
  assert.match(screen, /const readyState = \{[\s\S]*through,[\s\S]*rows: normalized,[\s\S]*nextCursor,[\s\S]*status: "ready"/);
  assert.match(screen, /eventRangeRef\.current = readyState;\s*setEventRange\(readyState\)/);
  assert.match(store, /const loadDiscoverTourDateRange = async/);
  assert.match(store, /fetchDiscoverTourDateRange\(\{ days, limit, after, country, local, signal \}\)/);
  assert.doesNotMatch(store, /loadDiscoverTourDateRange[\s\S]{0,220}\bcity\b/);
  assert.match(store, /through: parsed\.through/);
  assert.match(rangeApi, /local[\s\S]*discoverySidebarRangeRequestPath\(\{ days, limit: DISCOVER_RANGE_MAX_EVENTS \}\)/);
  assert.match(rangeApi, /tourDateRangeRequestPath\(\{ days, limit, after, country \}\)/);
  assert.doesNotMatch(rangeApi, /tourDateRangeRequestPath\(\{[^}]*city/);
  assert.match(rangeApi, /parseTourDateRangeResponse\(payload\)/);
});
