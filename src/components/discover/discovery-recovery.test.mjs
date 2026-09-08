import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { availableSearchCategories, discoverEventRecovery } from "./discovery-recovery.mjs";

const categories = [{ key: "all", label: "All" }, { key: "artists", label: "Artists" }, { key: "shows", label: "Shows" }];
test("available search counts use loaded rows and the shows/events mapping", () => {
  const counts = availableSearchCategories(categories, { artists: Array(12).fill({}), events: [{ id: 1 }] });
  assert.deepEqual(counts.map(({ key, count }) => [key, count]), [["all", 13], ["artists", 12], ["shows", 1]]);
});
test("search alternatives never expose categories unavailable to this viewer", () => {
  assert.equal(availableSearchCategories(categories, { people: [{ id: "private" }], songs: [{}], artists: [{}] })[0].count, 1);
  assert.deepEqual(availableSearchCategories(categories, { artists: null, events: {} }).map(({ count }) => count), [0, 0, 0]);
});
test("Discover never declares no events while the selected date range is loading", () => {
  for (const status of ["idle", "loading", "refreshing"]) {
    const state = discoverEventRecovery({ status, days: 90, ranges: [30, 90, 180] });
    assert.equal(state.kind, "loading");
    assert.doesNotMatch(state.message, /No events/);
    assert.equal(state.nextDays, null);
    assert.equal(state.worldwide, false);
  }
});
test("failed dates offer retry without making a false empty claim", () => {
  assert.equal(discoverEventRecovery({ status: "error" }).kind, "error");
  assert.equal(discoverEventRecovery({ status: "error", count: 2 }), null, "Keep already available cards visible on refresh failure.");
});
test("an empty local or country range offers the next supported duration and worldwide", () => {
  const local = discoverEventRecovery({ status: "ready", days: 30, ranges: [180, 90, 30, 90], local: true, region: "Canada" });
  assert.equal(local.nextDays, 90);
  assert.equal(local.worldwide, true);
  assert.match(local.message, /near your home area over the next 30 days/);
  assert.equal(discoverEventRecovery({ status: "ready", region: "Canada" }).worldwide, true);
});
test("worldwide at the largest range never offers a no-op recovery", () => {
  const state = discoverEventRecovery({ status: "ready", days: 180, ranges: [30, 90, 180], region: "Worldwide" });
  assert.equal(state.nextDays, null);
  assert.equal(state.worldwide, false);
});
test("search reveals existing previews and offers alternatives without rewriting the query", () => {
  const source = readFileSync(new URL("../../screens/SearchScreen.jsx", import.meta.url), "utf8");
  assert.match(source, /onShowAll=\{expandCategory\("artists", artists\)\}/);
  assert.match(source, /availableSearchCategories\(searchCategories, resultGroups\)/);
  assert.match(source, /alternativeCategories\.map/);
  assert.match(source, /onPress=\{\(\) => selectCategory\(item\.key\)\}/);
  assert.match(source, /Show all \{count\}/);
  assert.match(source, /available \$\{title\.toLowerCase\(\)\}/);
  assert.match(source, /categoryChip: \{ minHeight: 44/);
  assert.match(source, /searchInputRef\.current\?\.focus\?\.\(\)/);
  assert.match(source, /keyboardShouldPersistTaps="handled"[\s\S]*accessibilityLabel="Filter search results"/);
  assert.match(source, /<CityDiscoveryTiles[^>]*layout="rail"/);
});
test("Discover recovery changes only explicit area/date choices and preserves the city grid", () => {
  const source = readFileSync(new URL("../../screens/DiscoverScreen.jsx", import.meta.url), "utf8");
  assert.match(source, /discoverEventRecovery\(/);
  assert.match(source, /onPress=\{\(\) => selectEventRange\(eventRecovery\.nextDays\)\}/);
  assert.match(source, /onPress=\{\(\) => pickRegion\("Worldwide"\)\}/);
  assert.doesNotMatch(source, /<CityDiscoveryTiles[^>]*layout="rail"/);
});
