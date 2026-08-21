import assert from "node:assert/strict";
import test from "node:test";
import { postMediaGridLayout } from "./postMediaGridLayout.mjs";

test("mobile media keeps the existing full-width collage", () => {
  assert.deepEqual(postMediaGridLayout({ viewportWidth: 430, count: 1, width: 1080, height: 1350 }), {
    desktop: false,
    maxWidth: null,
    aspectRatio: null,
    containSingle: false,
  });
});

test("a desktop 4:5 photo is bounded, uncropped, and fits a browsing viewport", () => {
  assert.deepEqual(postMediaGridLayout({ viewportWidth: 1440, count: 1, width: 1080, height: 1350 }), {
    desktop: true,
    maxWidth: 500,
    aspectRatio: 0.8,
    containSingle: true,
  });
});

test("desktop single-media ratios and multi-item collages remain bounded", () => {
  assert.deepEqual(postMediaGridLayout({ viewportWidth: 1600, count: 1, width: 400, height: 2000 }), {
    desktop: true,
    maxWidth: 500,
    aspectRatio: 0.8,
    containSingle: true,
  });
  assert.deepEqual(postMediaGridLayout({ viewportWidth: 1600, count: 3 }), {
    desktop: true,
    maxWidth: 760,
    aspectRatio: null,
    containSingle: false,
  });
});
