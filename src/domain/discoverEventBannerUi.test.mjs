import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../components/discover/DiscoverEventBanner.jsx", import.meta.url), "utf8");

test("Discover event banner uses one cached Expo image and respects Reduce Motion", () => {
  assert.match(source, /from "expo-image"/);
  assert.match(source, /cachePolicy="memory-disk"/);
  assert.match(source, /enforceEarlyResizing/);
  assert.match(source, /transition=\{reduceMotion \? 0 : 220\}/);
  assert.match(source, /if \(!active \|\| !foreground \|\| paused \|\| holding \|\| reduceMotion/);
  assert.match(source, /const AUTO_ADVANCE_MS = 9_000;/, "slides stay up long enough to read");
  assert.match(source, /AppState\.addEventListener\("change"/);
  assert.doesNotMatch(source, /\bAnimated\b/);
});

test("Discover event banner exposes manual controls, pauses itself, and has a no-image fallback", () => {
  assert.match(source, /Previous event/);
  assert.match(source, /Next event/);
  assert.doesNotMatch(source, /Pause event slideshow|PAUSE/, "no Pause button: the owner asked for it to go");
  assert.match(source, /onMouseEnter=\{\(\) => setHolding\(true\)\}/);
  assert.match(source, /onFocus=\{\(\) => setHolding\(true\)\}/);
  assert.match(source, /onTouchStart=\{\(\) => setHolding\(true\)\}/);
  assert.match(source, /styles\.fallback/);
  assert.match(source, /onError=\{\(\) => setFailed/);
  assert.match(source, /const slideSetKey = useMemo/);
  assert.match(source, /setIndex\(0\);[\s\S]*setPaused\(false\);[\s\S]*setFailed\(new Set\(\)\);/);
  assert.match(source, /\}, \[slideSetKey\]\);/);
});

test("Discover event banner leaves nested controls reachable", () => {
  assert.match(source, /styles\.shell, compact && styles\.shellCompact\]\} accessible=\{false\}/);
  assert.match(source, /styles\.hero, compact && styles\.heroCompact\]\} accessible=\{false\}/);
  assert.doesNotMatch(source, /accessibilityState=\{\{[^}]*checked:/);
});

test("banner credits open the existing photo viewer without printing provider or creator names", () => {
  assert.match(source, /discoverPhotoAttribution\(candidateMedia\)/);
  assert.match(source, /const media = \(licensedSource \|\| providerSource\) && \(!attribution \|\| !onOpenPhoto\) \? null : candidateMedia/);
  assert.match(source, /onOpenPhoto\(media\)/);
  assert.match(source, /accessibilityLabel="Photo credits"/);
  assert.doesNotMatch(source, /Fan photo by|Artist photo|attribution\.creator|attribution\.license/);
  const screen = fs.readFileSync(new URL("../screens/DiscoverScreen.jsx", import.meta.url), "utf8");
  assert.match(screen, /onOpenPhoto=\{\(media\) => openPhotos\?\.\(\[media\], 0, media.postId \|\| null\)\}/);
  const viewer = fs.readFileSync(new URL("../components/PhotoViewer.jsx", import.meta.url), "utf8");
  assert.match(viewer, /venuePhotoAttribution\(p\) \|\| discoverPhotoAttribution\(p\)/);
  assert.match(viewer, /webAttributionLinkProps\(venueAttribution.sourcePage\)/);
  assert.match(viewer, /venueAttribution.licenseUrl \? <Pressable/);
});
