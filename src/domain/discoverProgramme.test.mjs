import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DISCOVER_PROGRAMME_SECTIONS, discoverProgrammeKey, discoverProgrammeKeyboardTarget } from "./discoverProgramme.mjs";

test("Discover keeps all five destinations without inventing routes or changing area", () => {
  assert.deepEqual(DISCOVER_PROGRAMME_SECTIONS.map(({ key }) => key), ["shows", "artists", "venues", "cities", "photos"]);
  for (const { key } of DISCOVER_PROGRAMME_SECTIONS) assert.equal(discoverProgrammeKey(key), key);
  for (const key of [null, undefined, "", "admin", {}, "__proto__"]) assert.equal(discoverProgrammeKey(key), "shows");
});

test("Discover keyboard navigation wraps and supports Home and End", () => {
  assert.equal(discoverProgrammeKeyboardTarget("shows", "ArrowLeft"), "photos");
  assert.equal(discoverProgrammeKeyboardTarget("photos", "ArrowRight"), "shows");
  assert.equal(discoverProgrammeKeyboardTarget("artists", "ArrowRight"), "venues");
  assert.equal(discoverProgrammeKeyboardTarget("venues", "Home"), "shows");
  assert.equal(discoverProgrammeKeyboardTarget("cities", "End"), "photos");
  for (const key of ["Tab", "Enter", "Escape", "a"]) assert.equal(discoverProgrammeKeyboardTarget("shows", key), null);
});

const read = (name) => readFileSync(new URL(name, import.meta.url), "utf8");
test("Discover renders only the selected destination and keeps filter state independent", () => {
  const source = read("../screens/DiscoverScreen.jsx");
  assert.match(source, /const \[programme, setProgramme\] = useState\(\(\) => discoverProgrammeKey\(initialProgramme\)\)/);
  assert.match(source, /if \(initialProgramme !== undefined\) setProgramme\(discoverProgrammeKey\(initialProgramme\)\)/);
  assert.match(source, /const \[areaExpanded, setAreaExpanded\] = useState\(false\)/);
  assert.match(source, /const \[dateExpanded, setDateExpanded\] = useState\(false\)/);
  for (const { key } of DISCOVER_PROGRAMME_SECTIONS) {
    assert.ok(source.includes(`programme === "${key}" && <View nativeID="discover-panel-${key}"`), `${key} has an owned conditional panel`);
  }
  assert.match(source, /<DiscoverProgrammeNav selected=\{programme\} onSelect=\{\(value\) => setProgramme\(discoverProgrammeKey\(value\)\)\}/);
  assert.match(source, /\{areaExpanded && <View style=\{styles.controlsCard\}/);
  assert.match(source, /\{dateExpanded && <View style=\{styles.rangeOptions\}/);
  assert.ok(source.indexOf("<DiscoverProgrammeNav") < source.indexOf('<View style={styles.controlsCard}'));
});

test("Discover tabs retain accessible relationships, keyboard focus, and touch targets", () => {
  const source = read("../components/discover/DiscoverProgrammeNav.jsx");
  assert.match(source, /accessibilityRole="tablist"/);
  assert.match(source, /accessibilityRole="tab"/);
  assert.match(source, /accessibilityState=\{\{ selected: active \}\}/);
  assert.match(source, /tabIndex: active \? 0 : -1/);
  assert.match(source, /"aria-selected": active/);
  assert.match(source, /"aria-controls": `discover-panel-\$\{section.key\}`/);
  assert.match(source, /tabs.current\[next\]\?\.focus\?\.\(\)/);
  assert.match(source, /minHeight: 52/);
  assert.match(source, /minHeight: 58/);
});

test("city discovery has an awaited pull refresh, visible errors, retry and an empty state", () => {
  const source = read("../features/cities/CityDiscoveryTiles.jsx");
  const screen = read("../screens/DiscoverScreen.jsx");
  assert.match(source, /registerRefresh\?\.\(resource.refresh\)/);
  assert.match(source, /return \(\) => registerRefresh\?\.\(null\)/);
  assert.match(source, /accessibilityRole="alert"/);
  assert.match(source, /onPress=\{resource.reload\}/);
  assert.match(source, /copy.noCities/);
  assert.match(screen, /cityRefreshRef.current\(\{ signal: controller.signal \}\)/);
  assert.match(screen, /\[accountId, programme, rangeScopeKey\]/, "changing destination cancels the owned refresh");
  assert.match(screen, /areaDisclosureRef.current\?\.focus\?\.\(\)/);
  assert.match(screen, /dateDisclosureRef.current\?\.focus\?\.\(\)/);
  for (const { key } of DISCOVER_PROGRAMME_SECTIONS) assert.ok(screen.includes(`aria-labelledby="discover-tab-${key}"`));
});
