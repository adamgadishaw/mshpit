import {
  MEDIA_PHOTO_SOURCE_MAX_BYTES,
  MEDIA_VIDEO_MAX_DURATION_MS,
  MEDIA_VIDEO_MIN_DURATION_MS,
  MEDIA_VIDEO_SOURCE_MAX_BYTES,
} from "./mediaUploadPolicy.mjs";
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, min, max, fallback = min) => Math.min(max, Math.max(min, finite(value, fallback)));

export const MEDIA_EDIT_VERSION = 1;
export const PHOTO_MAX_EDGE = 2048;
export const VIDEO_MAX_DURATION_MS = MEDIA_VIDEO_MAX_DURATION_MS;
export const VIDEO_MIN_DURATION_MS = MEDIA_VIDEO_MIN_DURATION_MS;
export const MEDIA_PHOTO_MAX_BYTES = MEDIA_PHOTO_SOURCE_MAX_BYTES;
export const MEDIA_VIDEO_MAX_BYTES = MEDIA_VIDEO_SOURCE_MAX_BYTES;
export const MEDIA_DELIVERY_IMAGE_MIME_TYPES = Object.freeze(["image/jpeg", "image/png", "image/webp"]);

export const MEDIA_ASPECTS = Object.freeze({
  original: null,
  square: 1,
  portrait: 4 / 5,
  story: 9 / 16,
  landscape: 16 / 9,
});

export const MEDIA_FILTERS = Object.freeze({
  original: Object.freeze({ label: "Original", adjustments: {} }),
  pit: Object.freeze({ label: "Pit", adjustments: { contrast: 0.12, saturation: 0.12, warmth: 0.08, vignette: 0.12 } }),
  encore: Object.freeze({ label: "Encore", adjustments: { brightness: 0.04, contrast: 0.08, saturation: 0.2, warmth: 0.16 } }),
  neon: Object.freeze({ label: "Neon", adjustments: { contrast: 0.18, saturation: 0.34, warmth: -0.08, fade: 0.04 } }),
  midnight: Object.freeze({ label: "Midnight", adjustments: { brightness: -0.08, contrast: 0.22, saturation: -0.06, warmth: -0.16, vignette: 0.2 } }),
  analog: Object.freeze({ label: "Analog", adjustments: { contrast: -0.04, saturation: -0.08, warmth: 0.22, fade: 0.16, grain: 0.08 } }),
  mono: Object.freeze({ label: "Mono", adjustments: { contrast: 0.16, saturation: -1, fade: 0.04, vignette: 0.1 } }),
});

const ADJUSTMENT_LIMITS = Object.freeze({
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

export function normalizeAspect(value) {
  return Object.hasOwn(MEDIA_ASPECTS, value) ? value : "original";
}

export function normalizeRotation(value) {
  const rounded = Math.round(finite(value) / 90) * 90;
  return ((rounded % 360) + 360) % 360;
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

function normalizeTrim(source, durationMs) {
  const knownDuration = Math.max(0, Math.round(finite(durationMs)));
  const hardEnd = knownDuration || VIDEO_MAX_DURATION_MS;
  let start = clamp(Math.round(finite(source.trimStartMs)), 0, Math.max(0, hardEnd - VIDEO_MIN_DURATION_MS));
  let end = clamp(Math.round(finite(source.trimEndMs, hardEnd)), VIDEO_MIN_DURATION_MS, hardEnd);
  if (end - start < VIDEO_MIN_DURATION_MS) {
    if (start + VIDEO_MIN_DURATION_MS <= hardEnd) end = start + VIDEO_MIN_DURATION_MS;
    else start = Math.max(0, end - VIDEO_MIN_DURATION_MS);
  }
  if (end - start > VIDEO_MAX_DURATION_MS) end = start + VIDEO_MAX_DURATION_MS;
  return { start, end };
}

export function normalizeMediaEdit(value = {}, { kind, durationMs } = {}) {
  const source = value && typeof value === "object" ? value : {};
  const mediaKind = normalizeMediaKind(kind || source.kind);
  const filter = Object.hasOwn(MEDIA_FILTERS, source.filter) ? source.filter : "original";
  const base = {
    version: MEDIA_EDIT_VERSION,
    kind: mediaKind,
    aspect: normalizeAspect(source.aspect),
    zoom: clamp(source.zoom, 1, 3, 1),
    focalX: clamp(source.focalX, 0, 1, 0.5),
    focalY: clamp(source.focalY, 0, 1, 0.5),
    rotation: normalizeRotation(source.rotation),
    flipX: source.flipX === true,
    filter,
    // Intensity applies only to a named preset. The original preset has no
    // contribution, so normalizing it to one prevents a visually meaningless
    // slider value from making the recipe look edited.
    filterIntensity: filter === "original" ? 1 : clamp(source.filterIntensity, 0, 1, 1),
    adjustments: normalizeAdjustments(source.adjustments),
  };
  if (mediaKind !== "video") return base;
  const actualDuration = Math.max(0, Math.round(finite(durationMs, source.durationMs)));
  const trim = normalizeTrim(source, actualDuration);
  return {
    ...base,
    durationMs: actualDuration,
    trimStartMs: trim.start,
    trimEndMs: trim.end,
    coverMode: source.coverMode === "manual" ? "manual" : "auto",
    coverMs: clamp(Math.round(finite(source.coverMs, trim.start)), trim.start, Math.max(trim.start, trim.end - 1)),
    muted: source.muted === true,
  };
}

export function mediaEditFingerprint(value, context) {
  return JSON.stringify(normalizeMediaEdit(value, context));
}

export function mediaEditHasChanges(value, context) {
  const normalized = normalizeMediaEdit(value, context);
  return mediaEditFingerprint(normalized, context) !== mediaEditFingerprint(defaultMediaEdit(normalized.kind, { durationMs: normalized.durationMs }), context);
}

export function mediaImageDeliveryCompatible(asset = {}) {
  const mime = String(asset.mimeType || "").toLowerCase().split(";")[0].trim();
  if (MEDIA_DELIVERY_IMAGE_MIME_TYPES.includes(mime)) return true;
  if (mime) return false;
  return /\.(?:jpe?g|png|webp)(?:[?#]|$)/i.test(String(asset.fileName || asset.uri || ""));
}

export function mediaImageRequiresRender(asset = {}, edit = asset.edit) {
  // The server creates the metadata-stripped public derivative for an Original
  // photo. Only a visual recipe needs device-authored pixels; ordinary camera
  // photos and screenshots must not be blocked by ImageManipulator/Skia.
  return normalizeMediaKind(asset.kind || asset.type) === "image"
    && mediaEditHasChanges(edit, { kind: "image" });
}

export function effectiveAdjustments(value = {}) {
  const edit = normalizeMediaEdit(value, { kind: value?.kind, durationMs: value?.durationMs });
  const preset = MEDIA_FILTERS[edit.filter]?.adjustments || {};
  const manual = edit.adjustments;
  const out = {};
  for (const [key, [min, max]] of Object.entries(ADJUSTMENT_LIMITS)) {
    out[key] = clamp(finite(preset[key]) * edit.filterIntensity + finite(manual[key]), min, max, 0);
  }
  return out;
}

export function rotatedDimensions(width, height, rotation = 0) {
  const w = Math.max(1, finite(width, 1));
  const h = Math.max(1, finite(height, 1));
  const turn = normalizeRotation(rotation);
  return turn === 90 || turn === 270 ? { width: h, height: w } : { width: w, height: h };
}

export function mediaCropRect({ width, height, edit } = {}) {
  const normalized = normalizeMediaEdit(edit, { kind: edit?.kind, durationMs: edit?.durationMs });
  const rotated = rotatedDimensions(width, height, normalized.rotation);
  const targetRatio = MEDIA_ASPECTS[normalized.aspect] || (rotated.width / rotated.height);
  const sourceRatio = rotated.width / rotated.height;
  let cropWidth = rotated.width;
  let cropHeight = rotated.height;
  if (sourceRatio > targetRatio) cropWidth = rotated.height * targetRatio;
  else if (sourceRatio < targetRatio) cropHeight = rotated.width / targetRatio;
  cropWidth /= normalized.zoom;
  cropHeight /= normalized.zoom;
  const centerX = normalized.focalX * rotated.width;
  const centerY = normalized.focalY * rotated.height;
  const originX = clamp(centerX - cropWidth / 2, 0, Math.max(0, rotated.width - cropWidth));
  const originY = clamp(centerY - cropHeight / 2, 0, Math.max(0, rotated.height - cropHeight));
  return {
    originX: Math.round(originX),
    originY: Math.round(originY),
    width: Math.max(1, Math.round(cropWidth)),
    height: Math.max(1, Math.round(cropHeight)),
  };
}

export function mediaPreviewTransformPlan({ width, height, edit, viewportWidth, viewportHeight } = {}) {
  const sourceWidth = Math.max(1, finite(width, 1));
  const sourceHeight = Math.max(1, finite(height, 1));
  const normalized = normalizeMediaEdit(edit, { kind: "image" });
  const rotated = rotatedDimensions(sourceWidth, sourceHeight, normalized.rotation);
  const crop = mediaCropRect({ width: sourceWidth, height: sourceHeight, edit: normalized });
  const scaleX = Math.max(0.0001, finite(viewportWidth, 1) / crop.width);
  const scaleY = Math.max(0.0001, finite(viewportHeight, 1) / crop.height);
  let a = 1; let b = 0; let c = 0; let d = 1; let e = 0; let f = 0;
  if (normalized.rotation === 90) { a = 0; b = 1; c = -1; d = 0; e = sourceHeight; f = 0; }
  else if (normalized.rotation === 180) { a = -1; b = 0; c = 0; d = -1; e = sourceWidth; f = sourceHeight; }
  else if (normalized.rotation === 270) { a = 0; b = -1; c = 1; d = 0; e = 0; f = sourceWidth; }
  if (normalized.flipX) { a = -a; c = -c; e = rotated.width - e; }
  const matrix = [
    scaleX * a, scaleY * b, 0, 0,
    scaleX * c, scaleY * d, 0, 0,
    0, 0, 1, 0,
    scaleX * (e - crop.originX), scaleY * (f - crop.originY), 0, 1,
  ];
  return { edit: normalized, crop, rotated, scaleX, scaleY, matrix };
}

export function boundedOutputSize(width, height, maxEdge = PHOTO_MAX_EDGE) {
  const w = Math.max(1, Math.round(finite(width, 1)));
  const h = Math.max(1, Math.round(finite(height, 1)));
  const edge = Math.max(1, Math.round(finite(maxEdge, PHOTO_MAX_EDGE)));
  const scale = Math.min(1, edge / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
}

export function buildPhotoTransformPlan({ width, height, edit, maxEdge = PHOTO_MAX_EDGE } = {}) {
  const normalized = normalizeMediaEdit(edit, { kind: "image" });
  const crop = mediaCropRect({ width, height, edit: normalized });
  const output = boundedOutputSize(crop.width, crop.height, maxEdge);
  const actions = [];
  if (normalized.rotation) actions.push({ rotate: normalized.rotation });
  if (normalized.flipX) actions.push({ flip: "horizontal" });
  if (crop.originX || crop.originY || crop.width !== rotatedDimensions(width, height, normalized.rotation).width || crop.height !== rotatedDimensions(width, height, normalized.rotation).height) actions.push({ crop });
  if (output.width !== crop.width || output.height !== crop.height) actions.push({ resize: output });
  return { edit: normalized, crop, output, actions, adjustments: effectiveAdjustments(normalized) };
}

export function videoEditRequiresExport(value) {
  const edit = normalizeMediaEdit(value, { kind: "video", durationMs: value?.durationMs });
  const baseline = defaultMediaEdit("video", { durationMs: edit.durationMs });
  return edit.trimStartMs !== baseline.trimStartMs
    || edit.trimEndMs !== baseline.trimEndMs
    || edit.muted
    || edit.rotation !== 0
    || edit.flipX
    || edit.aspect !== "original"
    || edit.zoom !== 1
    || edit.focalX !== 0.5
    || edit.focalY !== 0.5
    || edit.filter !== "original"
    || Object.values(edit.adjustments).some((item) => item !== 0);
}

export function normalizeMediaDraftAsset(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  const kind = normalizeMediaKind(source.kind || source.type);
  const width = Math.max(1, Math.round(finite(source.width, 1)));
  const height = Math.max(1, Math.round(finite(source.height, 1)));
  const durationMs = kind === "video" ? Math.max(0, Math.round(finite(source.durationMs ?? source.duration))) : 0;
  return {
    id: String(source.id || source.assetId || source.uri || "").slice(0, 240),
    kind,
    uri: typeof source.uri === "string" ? source.uri : "",
    fileName: typeof source.fileName === "string" ? source.fileName.slice(0, 180) : null,
    mimeType: typeof source.mimeType === "string" ? source.mimeType.toLowerCase().slice(0, 80) : null,
    fileSize: Math.max(0, Math.round(finite(source.fileSize))),
    width,
    height,
    durationMs,
    edit: normalizeMediaEdit(source.edit, { kind, durationMs }),
    posterUri: typeof source.posterUri === "string" ? source.posterUri : null,
    posterTimeMs: kind === "video" ? Math.max(0, Math.round(finite(source.posterTimeMs, source.edit?.coverMs))) : 0,
    // Accessibility copy belongs to the asset, not the pixel recipe. Keeping it
    // separate means a person can improve alt text later without forcing a new
    // image/video render or changing the edit fingerprint.
    altText: typeof source.altText === "string" ? source.altText.replace(/\s+/g, " ").trim().slice(0, 1_000) : "",
  };
}

export function mediaDraftAssetFromPicker(asset = {}, index = 0) {
  const declaredMime = String(asset.mimeType || asset.file?.type || "").split(";", 1)[0].trim().toLowerCase();
  const sourceName = String(asset.fileName || asset.uri || "").split(/[?#]/u, 1)[0];
  const declaredDuration = Number(asset.duration);
  // Expo allows both `type` and `mimeType` to be absent for some Android
  // ContentProviders. Preserve a normal camera-roll clip as video whenever any
  // available picker signal identifies it, then let byte sniffing and the
  // server verifier make the authoritative format decision during upload.
  const kind = asset.type === "video" || asset.type === "pairedVideo"
    || declaredMime.startsWith("video/") || /\.(?:mp4|mov|m4v|webm)$/i.test(sourceName)
    || (Number.isFinite(declaredDuration) && declaredDuration > 0)
    ? "video"
    : "image";
  const durationMs = kind === "video" ? Math.max(0, Math.round(finite(asset.duration))) : 0;
  return normalizeMediaDraftAsset({
    ...asset,
    id: `${asset.assetId || asset.fileName || "media"}:${index}:${asset.uri || ""}`,
    kind,
    durationMs,
    edit: defaultMediaEdit(kind, { durationMs }),
  });
}
