import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { postMediaGridLayout, postMediaPreviewWidth, videoPosterContain } from "./postMediaGridLayout.mjs";

const postMediaGrid = readFileSync(new URL("../components/PostMediaGrid.jsx", import.meta.url), "utf8");
const smartImage = readFileSync(new URL("../components/SmartImage.jsx", import.meta.url), "utf8");

test("mobile media keeps the existing full-width collage", () => {
  assert.deepEqual(postMediaGridLayout({ viewportWidth: 430, viewportHeight: 900, count: 1, width: 1080, height: 1350 }), {
    desktop: false,
    maxWidth: null,
    aspectRatio: null,
    containSingle: false,
  });
});

test("a desktop 4:5 photo is height-bounded, uncropped, and fits a short browsing viewport", () => {
  assert.deepEqual(postMediaGridLayout({ viewportWidth: 1440, viewportHeight: 768, count: 1, width: 1080, height: 1350 }), {
    desktop: true,
    maxWidth: 356,
    aspectRatio: 0.8,
    containSingle: true,
  });
});

test("desktop single-media ratios and multi-item collages remain bounded", () => {
  assert.deepEqual(postMediaGridLayout({ viewportWidth: 1600, viewportHeight: 900, count: 1, width: 400, height: 2000 }), {
    desktop: true,
    maxWidth: 416,
    aspectRatio: 0.8,
    containSingle: true,
  });
  assert.deepEqual(postMediaGridLayout({ viewportWidth: 1600, viewportHeight: 900, count: 3 }), {
    desktop: true,
    maxWidth: 693,
    aspectRatio: null,
    containSingle: false,
  });
});

test("919 and 920 pixel windows share the same bounded layout instead of a breakpoint cliff", () => {
  const input = { viewportHeight: 700, count: 1, width: 1920, height: 1080 };
  const at919 = postMediaGridLayout({ ...input, viewportWidth: 919 });
  const at920 = postMediaGridLayout({ ...input, viewportWidth: 920 });
  assert.deepEqual(at919, at920);
  assert.deepEqual(at919, {
    desktop: true,
    maxWidth: 721,
    aspectRatio: 16 / 9,
    containSingle: true,
  });
});

test("short desktop viewports also bound multi-item collages", () => {
  assert.deepEqual(postMediaGridLayout({ viewportWidth: 1000, viewportHeight: 560, count: 2 }), {
    desktop: true,
    maxWidth: 576,
    aspectRatio: null,
    containSingle: false,
  });
});

test("feed preview derivatives follow mobile density and each tile's actual share", () => {
  assert.equal(postMediaPreviewWidth({ viewportWidth: 390, scale: 3, tileFraction: 1 }), 768,
    "a 3x phone remains capped at the mobile derivative ceiling");
  assert.equal(postMediaPreviewWidth({ viewportWidth: 390, scale: 3, tileFraction: 1 / 2 }), 448,
    "half-width phone tiles do not decode a full-width derivative");
  assert.equal(postMediaPreviewWidth({ viewportWidth: 390, scale: 3, tileFraction: 1 / 3 }), 320,
    "small collage tiles retain a useful minimum derivative");
  assert.equal(postMediaPreviewWidth({ viewportWidth: 360, scale: 1.5, tileFraction: 1 }), 576,
    "requests round up to the next 64-pixel bucket");
});

test("desktop previews use the bounded grid width rather than the browser viewport", () => {
  assert.equal(postMediaPreviewWidth({ viewportWidth: 1440, scale: 2, desktopMaxWidth: 356 }), 768);
  assert.equal(postMediaPreviewWidth({ viewportWidth: 1600, scale: 1, desktopMaxWidth: 693 }), 704);
  assert.equal(postMediaPreviewWidth({ viewportWidth: 1600, scale: 3, desktopMaxWidth: 760 }), 1200,
    "desktop density is capped at 2x and the desktop derivative ceiling");
});

test("the grid passes per-tile previews and contained media decodes the main source once", () => {
  assert.doesNotMatch(postMediaGrid, /previewWidth=\{1200\}/);
  assert.match(postMediaGrid, /width: viewportWidth, height: viewportHeight, scale/);
  assert.match(postMediaGrid, /desktopMaxWidth: desktopLayout\.desktop \? desktopLayout\.maxWidth : null/);
  assert.match(postMediaGrid, /previewWidth=\{previewWidthFor\(2 \/ 3\)\}/);
  assert.match(postMediaGrid, /previewWidth=\{previewWidthFor\(1 \/ 3\)\}/);

  assert.doesNotMatch(smartImage, /backdropUri|smart-image-background|blurRadius=\{28\}/,
    "contained media must not issue a second request for a blurred copy");
  assert.equal((smartImage.match(/source=\{source\}/g) || []).length, 1,
    "the full feed derivative must not be mounted as both backdrop and foreground");
  assert.match(smartImage, /useMemo\(\(\) => \(\{ uri: src, cacheKey: src \}\), \[src\]\)/,
    "counter updates reuse the exact Expo Image source object and cache identity");
  assert.match(smartImage, /styles\.containBackdrop/);
  assert.match(smartImage, /\{contain && <View style=\{\[StyleSheet\.absoluteFill, styles\.scrim\]\} \/>\}/,
    "non-http contained media keeps the stable background scrim without another image decode");
  assert.match(smartImage, /priority=\{policy\.priority\}/);
  assert.match(smartImage, /loading=\{policy\.loading\}/);
  assert.match(smartImage, /allowDownscaling/);
  assert.match(smartImage, /enforceEarlyResizing/);
  assert.match(postMediaGrid, /priority=\{index === 0 && viewable === true \? "high" : "normal"\}/);
  assert.match(postMediaGrid, /loading=\{viewable === true \? "eager" : "lazy"\}/);
});

test("post media semantics describe the action only when the tile is interactive", () => {
  assert.match(postMediaGrid, /height: viewportHeight/);
  assert.match(postMediaGrid, /if \(!interactive\)[\s\S]*accessibilityRole="image"/);
  assert.match(postMediaGrid, /accessibilityHint=\{`\$\{video \? "Opens the video player\." : "Opens the full-size photo\."\}/);
  assert.doesNotMatch(postMediaGrid, /Double tap/);
});

test("feed cards mount at most three media previews while retaining the full gallery", () => {
  assert.match(postMediaGrid, /if \(items\.length >= 3\)/);
  assert.match(postMediaGrid, /item=\{items\[2\]\}[\s\S]*more=\{Math\.max\(0, items\.length - 3\)\}[\s\S]*total=\{items\.length\}/);
  assert.doesNotMatch(postMediaGrid, /item=\{items\[3\]\}/);
  assert.doesNotMatch(postMediaGrid, /styles\.four/);
  assert.match(postMediaGrid, />SEE ALL<\/Text>/);
  assert.match(postMediaGrid, /onOpen\(index, openerRef\.current\)/,
    "the third preview still opens the original full media array in PhotoViewer");
});

test("a video poster letterboxes on wide tiles and keeps the phone collage crop", () => {
  // The reported bug: a portrait clip covering a wide desktop tile is scaled to
  // roughly 2.4x the tile height, so only a middle sliver is visible.
  assert.equal(videoPosterContain({ viewportWidth: 1440 }), true);
  assert.equal(videoPosterContain({ viewportWidth: 768 }), true, "the desktop breakpoint is inclusive");
  assert.equal(videoPosterContain({ viewportWidth: 390 }), false, "phone tiles stay as they are today");
  assert.equal(videoPosterContain({ viewportWidth: 767 }), false);
});

test("an explicit caller decision always wins over the viewport default", () => {
  // PhotoViewer and ClipsScreen already know they want contain; the single
  // attachment desktop layout already computed containSingle. Neither may be
  // second-guessed by the width.
  assert.equal(videoPosterContain({ viewportWidth: 390, explicit: true }), true);
  assert.equal(videoPosterContain({ viewportWidth: 1440, explicit: false }), false);
  // Only a real boolean counts as a decision; null/undefined mean "auto".
  assert.equal(videoPosterContain({ viewportWidth: 1440, explicit: null }), true);
  assert.equal(videoPosterContain({ viewportWidth: 1440 }), true);
});

test("a missing or malformed viewport width never claims desktop", () => {
  for (const viewportWidth of [undefined, null, 0, -1, Number.NaN, "abc", {}]) {
    assert.equal(videoPosterContain({ viewportWidth }), false);
  }
});

test("the grid forwards video posters as auto rather than a hard cover", () => {
  // A plain contain={contain} here would pin every collage video to cover and
  // silently reintroduce the crop.
  assert.match(postMediaGrid, /contain=\{video && contain !== true \? null : contain\}/);
});

test("ClipPoster resolves its own fit from the shared helper", () => {
  const clipPoster = readFileSync(new URL("../components/ClipPoster.jsx", import.meta.url), "utf8");
  assert.match(clipPoster, /videoPosterContain\(\{ viewportWidth, explicit: contain \}\)/);
  assert.match(clipPoster, /contain = null/, "the default must be auto, not cover");
});
