import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../components/discover/DiscoverEventBanner.jsx", import.meta.url), "utf8");

test("Discover event banner uses one cached Expo image and respects Reduce Motion", () => {
  assert.match(source, /from "expo-image"/);
  assert.match(source, /cachePolicy="memory-disk"/);
  assert.match(source, /enforceEarlyResizing/);
  assert.match(source, /transition=\{reduceMotion \? 0 : 220\}/);
  assert.match(source, /if \(!active \|\| !foreground \|\| paused \|\| reduceMotion/);
  assert.match(source, /AppState\.addEventListener\("change"/);
  assert.doesNotMatch(source, /\bAnimated\b/);
});

test("Discover event banner exposes manual controls and a no-image fallback", () => {
  assert.match(source, /Previous featured event/);
  assert.match(source, /Next featured event/);
  assert.match(source, /Auto-play disabled by Reduce Motion/);
  assert.match(source, /styles\.fallback/);
  assert.match(source, /onError=\{\(\) => setFailed/);
  assert.match(source, /const slideSetKey = useMemo/);
  assert.match(source, /setIndex\(0\);[\s\S]*setPaused\(false\);[\s\S]*setFailed\(new Set\(\)\);/);
  assert.match(source, /\}, \[slideSetKey\]\);/);
});

test("Discover event banner leaves nested controls reachable and gives Pause button semantics", () => {
  assert.match(source, /styles\.shell, compact && styles\.shellCompact\]\} accessible=\{false\}/);
  assert.match(source, /styles\.hero, compact && styles\.heroCompact\]\} accessible=\{false\}/);
  assert.match(source, /accessibilityState=\{\{ disabled: reduceMotion \}\}/);
  assert.doesNotMatch(source, /accessibilityState=\{\{[^}]*checked:/);
});

test("licensed banner photos fail closed without actionable HTTPS attribution", () => {
  assert.match(source, /const LICENSED_SOURCES = new Set\(\["licensed", "commons", "openverse"\]\)/);
  assert.match(source, /url\.protocol !== "https:" \|\| url\.username \|\| url\.password \|\| url\.port/);
  assert.match(source, /const media = \(licensedSource \|\| providerSource\) && !attribution \? null : candidateMedia/);
  assert.match(source, /href=\{Platform\.OS === "web" \? attribution\.sourcePage : undefined\}/);
  assert.match(source, /href=\{Platform\.OS === "web" \? attribution\.licenseUrl : undefined\}/);
  assert.match(source, /Linking\.openURL\(url\)/);
  assert.match(source, /accessibilityRole="link"/);
  assert.match(source, /attribution\.creator\} · Source/);
  assert.match(source, /Open \$\{attribution\.license\} license terms/);
});

test("provider event artwork gets a visible source link without inventing a license", () => {
  assert.match(source, /const PROVIDER_SOURCES = new Set\(\["ticketmaster"\]\)/);
  assert.match(source, /providerMediaAttribution\(candidateMedia\)/);
  assert.match(source, /\(licensedSource \|\| providerSource\) && !attribution \? null : candidateMedia/);
  assert.match(source, /attribution\.licenseUrl \? \(/);
});
