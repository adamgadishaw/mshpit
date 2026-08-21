import test from "node:test";
import assert from "node:assert/strict";
import {
  IDENTITY_COLOR_MATRIX,
  applyMediaColorMatrix,
  applyTonalRanges,
  buildMediaColorMatrix,
  deterministicGrain,
  mediaAdjustmentsAreIdentity,
  multiplyColorMatrices,
  vignetteFactor,
} from "./mediaEditColor.mjs";

test("identity color transforms preserve RGBA bytes", () => {
  assert.deepEqual(applyMediaColorMatrix([12, 140, 250, 99], IDENTITY_COLOR_MATRIX), [12, 140, 250, 99]);
  assert.deepEqual(multiplyColorMatrices(IDENTITY_COLOR_MATRIX, IDENTITY_COLOR_MATRIX), [...IDENTITY_COLOR_MATRIX]);
  assert.equal(mediaAdjustmentsAreIdentity({}), true);
});

test("photo adjustment matrices are deterministic and bounded", () => {
  const matrix = buildMediaColorMatrix({ brightness: 0.2, contrast: 0.1, saturation: -1, warmth: 0.2, tint: 0.1, fade: 0.1 });
  assert.deepEqual(matrix, buildMediaColorMatrix({ brightness: 0.2, contrast: 0.1, saturation: -1, warmth: 0.2, tint: 0.1, fade: 0.1 }));
  const pixel = applyMediaColorMatrix([255, 8, 40, 255], matrix);
  assert.equal(pixel.length, 4);
  assert.ok(pixel.every((value) => value >= 0 && value <= 255));
});

test("highlights and shadows target opposite luminance ranges", () => {
  const bright = applyTonalRanges([230, 230, 230], { highlights: 0.5 });
  const darkWithHighlights = applyTonalRanges([20, 20, 20], { highlights: 0.5 });
  const darkWithShadows = applyTonalRanges([20, 20, 20], { shadows: 0.5 });
  assert.ok(bright[0] - 230 > darkWithHighlights[0] - 20);
  assert.ok(darkWithShadows[0] - 20 > darkWithHighlights[0] - 20);
});

test("spatial effects use repeatable grain and darken only toward edges", () => {
  assert.equal(deterministicGrain(11, 19), deterministicGrain(11, 19));
  assert.notEqual(deterministicGrain(11, 19), deterministicGrain(12, 19));
  const center = vignetteFactor(50, 50, 100, 100, 0.6);
  const corner = vignetteFactor(0, 0, 100, 100, 0.6);
  assert.ok(center > corner);
  assert.ok(corner >= 0.4 && center <= 1);
});
