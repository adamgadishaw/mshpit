import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { postMediaGridLayout, postMediaPreviewWidth } from "./postMediaGridLayout.mjs";

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

  assert.match(smartImage, /backdropUri = contain && isHttp\(uri\) \? proxied\(uri, 96\) : null/);
  assert.equal((smartImage.match(/source=\{\{ uri: src \}\}/g) || []).length, 1,
    "the full feed derivative must not be mounted as both backdrop and foreground");
  assert.match(smartImage, /\{contain && <View style=\{\[StyleSheet\.absoluteFill, styles\.scrim\]\} \/>\}/,
    "non-http contained media keeps the stable background scrim without another image decode");
});

test("post media semantics describe the action only when the tile is interactive", () => {
  assert.match(postMediaGrid, /height: viewportHeight/);
  assert.match(postMediaGrid, /if \(!interactive\)[\s\S]*accessibilityRole="image"/);
  assert.match(postMediaGrid, /accessibilityHint=\{`\$\{video \? "Opens the video player\." : "Opens the full-size photo\."\}/);
  assert.doesNotMatch(postMediaGrid, /Double tap/);
});
