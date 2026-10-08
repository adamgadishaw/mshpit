// Original uploads use the same default recipe and size policy without loading
// the editor crop, filter and transform implementation.
import { MEDIA_PHOTO_SOURCE_MAX_BYTES as MEDIA_PHOTO_MAX_BYTES, MEDIA_VIDEO_SOURCE_MAX_BYTES as MEDIA_VIDEO_MAX_BYTES, MEDIA_VIDEO_MAX_DURATION_MS as VIDEO_MAX_DURATION_MS } from "./mediaUploadPolicy.mjs";
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

const clamp = (value, min, max, fallback = min) => Math.min(max, Math.max(min, finite(value, fallback)));

export const MEDIA_EDIT_VERSION = 1;

export const ADJUSTMENT_LIMITS = Object.freeze({
  brightness: [-0.5, 0.5],
  contrast: [-0.5, 0.5],
  saturation: [-1, 1],
  warmth: [-0.5, 0.5],
  tint: [-0.5, 0.5],
  highlights: [-0.5, 0.5],
  shadows: [-0.5, 0.5],
  fade: [0, 0.5],
  vignette: [0, 0.7],
  grain: [0, 0.35],
  sharpen: [0, 0.5],
});

export function normalizeMediaKind(value) {
  return value === "video" ? "video" : "image";
}

export function mediaSourceMaxBytes(asset = {}) {
  return normalizeMediaKind(asset.kind || asset.type) === "video"
    ? MEDIA_VIDEO_MAX_BYTES
    : MEDIA_PHOTO_MAX_BYTES;
}

export function mediaSourceSizeAllowed(asset = {}, measuredSize = asset.fileSize) {
  const size = Number(measuredSize);
  if (Number.isNaN(size)) return true;
  if (!Number.isFinite(size)) return false;
  return size <= 0 || size <= mediaSourceMaxBytes(asset);
}

export function normalizeAdjustments(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  return Object.fromEntries(Object.entries(ADJUSTMENT_LIMITS).map(([key, [min, max]]) => [key, clamp(source[key], min, max, 0)]));
}

export function defaultMediaEdit(kind = "image", dimensions = {}) {
  const mediaKind = normalizeMediaKind(kind);
  const durationMs = Math.max(0, Math.round(finite(dimensions.durationMs)));
  const base = {
    version: MEDIA_EDIT_VERSION,
    kind: mediaKind,
    aspect: "original",
    zoom: 1,
    focalX: 0.5,
    focalY: 0.5,
    rotation: 0,
    flipX: false,
    filter: "original",
    filterIntensity: 1,
    adjustments: normalizeAdjustments(),
  };
  if (mediaKind === "video") {
    const endMs = Math.min(durationMs || VIDEO_MAX_DURATION_MS, VIDEO_MAX_DURATION_MS);
    return { ...base, trimStartMs: 0, trimEndMs: endMs, durationMs, coverMode: "auto", coverMs: Math.min(1_000, Math.max(0, endMs - 1)), muted: false };
  }
  return base;
}
