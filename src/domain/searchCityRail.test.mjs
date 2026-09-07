import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("Search explicitly uses one city rail while Discover retains the default grid", () => {
  const search = read("../screens/SearchScreen.jsx");
  const discover = read("../screens/DiscoverScreen.jsx");
  const feature = read("../features/cities/CityDiscoveryTiles.jsx");
  assert.match(search, /<CityDiscoveryTiles[^>]*query=\{settledQuery\}[^>]*layout="rail"/);
  assert.match(feature, /layout = "grid"/);
  assert.match(feature, /layout === "rail" \? CityDirectoryRail : CityDirectoryTiles/);
  assert.doesNotMatch(discover, /<CityDiscoveryTiles[^>]*layout="rail"/);
});

test("city rail keeps bounded cards, native scrolling, keyboard taps and city links", () => {
  const rail = read("../components/cities/CityDirectoryRail.jsx");
  assert.match(rail, /<ScrollView horizontal/);
  assert.match(rail, /showsHorizontalScrollIndicator keyboardShouldPersistTaps="handled"/);
  assert.match(rail, /rail: \{ flexGrow: 0, minWidth: 0, width: "100%" \}/);
  assert.match(rail, /card: \{ flexShrink: 0 \}/);
  assert.match(rail, /onOpenCity=\{onOpenCity\} compact/);
  assert.match(rail, /if \(!cities.length\) return null/);
  assert.doesNotMatch(rail, /flexWrap: "wrap"/);
});
