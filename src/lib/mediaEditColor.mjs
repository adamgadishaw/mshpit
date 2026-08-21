const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, Number(value) || 0));

export const IDENTITY_COLOR_MATRIX = Object.freeze([
  1, 0, 0, 0, 0,
  0, 1, 0, 0, 0,
  0, 0, 1, 0, 0,
  0, 0, 0, 1, 0,
]);

// Multiplies two affine 4x5 RGBA matrices. The result applies `inner` first,
// then `outer`, matching Skia's color-filter composition semantics.
export function multiplyColorMatrices(outer, inner) {
  const result = new Array(20).fill(0);
  for (let row = 0; row < 4; row += 1) {
    for (let col = 0; col < 4; col += 1) {
      for (let k = 0; k < 4; k += 1) result[row * 5 + col] += outer[row * 5 + k] * inner[k * 5 + col];
    }
    result[row * 5 + 4] = outer[row * 5 + 4];
    for (let k = 0; k < 4; k += 1) result[row * 5 + 4] += outer[row * 5 + k] * inner[k * 5 + 4];
  }
  return result;
}

function saturationMatrix(amount) {
  const factor = clamp(1 + Number(amount), 0, 2);
  const inverse = 1 - factor;
  const red = 0.2126 * inverse;
  const green = 0.7152 * inverse;
  const blue = 0.0722 * inverse;
  return [
    red + factor, green, blue, 0, 0,
    red, green + factor, blue, 0, 0,
    red, green, blue + factor, 0, 0,
    0, 0, 0, 1, 0,
  ];
}

export function buildMediaColorMatrix(adjustments = {}) {
  const brightness = clamp(adjustments.brightness, -0.5, 0.5);
  const contrast = clamp(adjustments.contrast, -0.5, 0.5);
  const warmth = clamp(adjustments.warmth, -0.5, 0.5);
  const tint = clamp(adjustments.tint, -0.5, 0.5);
  const fade = clamp(adjustments.fade, 0, 0.5);

  const contrastFactor = 1 + contrast;
  const fadeFactor = 1 - fade * 0.36;
  const lift = (1 - contrastFactor) * 0.5 + brightness + fade * 0.12;
  const tone = [
    contrastFactor * fadeFactor, 0, 0, 0, lift + warmth * 0.12 + tint * 0.045,
    0, contrastFactor * fadeFactor, 0, 0, lift + warmth * 0.015 - tint * 0.08,
    0, 0, contrastFactor * fadeFactor, 0, lift - warmth * 0.12 + tint * 0.045,
    0, 0, 0, 1, 0,
  ];
  return multiplyColorMatrices(tone, saturationMatrix(adjustments.saturation));
}

export function applyMediaColorMatrix(rgba, matrix) {
  const source = [rgba[0] / 255, rgba[1] / 255, rgba[2] / 255, rgba[3] / 255];
  return [0, 1, 2, 3].map((row) => Math.round(clamp(
    matrix[row * 5] * source[0]
      + matrix[row * 5 + 1] * source[1]
      + matrix[row * 5 + 2] * source[2]
      + matrix[row * 5 + 3] * source[3]
      + matrix[row * 5 + 4],
  ) * 255));
}

export function mediaAdjustmentsAreIdentity(adjustments = {}) {
  return ["brightness", "contrast", "saturation", "warmth", "tint", "highlights", "shadows", "fade", "vignette", "grain", "sharpen"]
    .every((key) => Math.abs(Number(adjustments[key]) || 0) < 0.0001);
}

export function applyTonalRanges(rgb, adjustments = {}) {
  const red = clamp(Number(rgb[0]) / 255);
  const green = clamp(Number(rgb[1]) / 255);
  const blue = clamp(Number(rgb[2]) / 255);
  const luminance = red * 0.2126 + green * 0.7152 + blue * 0.0722;
  const shadows = clamp(adjustments.shadows, -0.5, 0.5);
  const highlights = clamp(adjustments.highlights, -0.5, 0.5);
  const shadowMask = (1 - luminance) * (1 - luminance);
  const highlightMask = luminance * luminance;
  const delta = shadows * shadowMask * 0.45 + highlights * highlightMask * 0.35;
  return [red, green, blue].map((channel) => Math.round(clamp(channel + delta) * 255));
}

export function deterministicGrain(x, y, seed = 41) {
  let value = ((Math.trunc(x) + 1) * 374761393) ^ ((Math.trunc(y) + 1) * 668265263) ^ Math.trunc(seed);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 0xffffffff - 0.5;
}

export function vignetteFactor(x, y, width, height, strength) {
  const safeWidth = Math.max(1, Number(width) || 1);
  const safeHeight = Math.max(1, Number(height) || 1);
  const dx = ((Number(x) + 0.5) / safeWidth - 0.5) * 2;
  const dy = ((Number(y) + 0.5) / safeHeight - 0.5) * 2;
  const distance = Math.min(1, Math.sqrt(dx * dx + dy * dy) / Math.SQRT2);
  const edge = clamp((distance - 0.38) / 0.62);
  const eased = edge * edge * (3 - 2 * edge);
  return 1 - eased * clamp(strength, 0, 0.7);
}
