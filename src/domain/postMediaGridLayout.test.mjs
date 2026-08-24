import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { postMediaGridLayout } from "./postMediaGridLayout.mjs";

const postMediaGrid = readFileSync(new URL("../components/PostMediaGrid.jsx", import.meta.url), "utf8");

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

test("post media semantics describe the action only when the tile is interactive", () => {
  assert.match(postMediaGrid, /height: viewportHeight/);
  assert.match(postMediaGrid, /if \(!interactive\)[\s\S]*accessibilityRole="image"/);
  assert.match(postMediaGrid, /accessibilityHint=\{`\$\{video \? "Opens the video player\." : "Opens the full-size photo\."\}/);
  assert.doesNotMatch(postMediaGrid, /Double tap/);
});
