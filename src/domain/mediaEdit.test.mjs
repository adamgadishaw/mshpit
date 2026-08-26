import test from "node:test";
import assert from "node:assert/strict";
import {
  VIDEO_MAX_DURATION_MS,
  buildPhotoTransformPlan,
  defaultMediaEdit,
  effectiveAdjustments,
  mediaCropRect,
  mediaDraftAssetFromPicker,
  mediaEditHasChanges,
  mediaImageRequiresRender,
  mediaImageNeedsNativeDecode,
  mediaImageAnimationUnsupported,
  mediaPreviewTransformPlan,
  mediaSourceMaxBytes,
  mediaSourceSizeAllowed,
  mediaVideoSourceCompatible,
  normalizeMediaEdit,
  normalizeRotation,
  videoEditRequiresExport,
} from "./mediaEdit.mjs";

test("media recipes normalize hostile and stale values into a bounded versioned shape", () => {
  const edit = normalizeMediaEdit({
    version: 999,
    kind: "video",
    aspect: "freeform",
    zoom: 99,
    focalX: -4,
    focalY: 5,
    rotation: -91,
    filter: "missing",
    filterIntensity: -5,
    adjustments: { brightness: 8, saturation: -8, vignette: -2 },
    trimStartMs: 90_000,
    trimEndMs: -1,
    coverMs: 999_999,
  }, { kind: "video", durationMs: 120_000 });
  assert.equal(edit.version, 1);
  assert.equal(edit.aspect, "original");
  assert.equal(edit.zoom, 3);
  assert.equal(edit.focalX, 0);
  assert.equal(edit.focalY, 1);
  assert.equal(edit.rotation, 270);
  assert.equal(edit.filter, "original");
  assert.equal(edit.filterIntensity, 1);
  assert.equal(edit.adjustments.brightness, 0.5);
  assert.equal(edit.adjustments.saturation, -1);
  assert.equal(edit.adjustments.vignette, 0);
  assert.ok(edit.trimEndMs - edit.trimStartMs >= 1_000);
  assert.ok(edit.trimEndMs - edit.trimStartMs <= VIDEO_MAX_DURATION_MS);
  assert.ok(edit.coverMs >= edit.trimStartMs && edit.coverMs < edit.trimEndMs);
});

test("crop math honors rotation, focal point, zoom, and social aspect presets", () => {
  const edit = { ...defaultMediaEdit("image"), aspect: "portrait", rotation: 90, zoom: 2, focalX: 1, focalY: 0 };
  const crop = mediaCropRect({ width: 4000, height: 3000, edit });
  assert.deepEqual(crop, { originX: 1500, originY: 0, width: 1500, height: 1875 });
});

test("preview matrix maps the exact exported rotated crop into the viewport", () => {
  const edit = { ...defaultMediaEdit("image"), aspect: "story", rotation: 90, zoom: 2, focalX: 1, focalY: 0.25 };
  const plan = mediaPreviewTransformPlan({ width: 4000, height: 3000, edit, viewportWidth: 288, viewportHeight: 512 });
  const [a, b, , , c, d, , , , , , , e, f] = plan.matrix;
  const rotatedPoint = (x, y) => ({ x: 3000 - y, y: x });
  const inverseRotatedPoint = (u, v) => ({ x: v, y: 3000 - u });
  const topLeft = inverseRotatedPoint(plan.crop.originX, plan.crop.originY);
  const bottomRight = inverseRotatedPoint(plan.crop.originX + plan.crop.width, plan.crop.originY + plan.crop.height);
  const map = (point) => ({ x: a * point.x + c * point.y + e, y: b * point.x + d * point.y + f });
  const mappedTop = map(topLeft);
  const mappedBottom = map(bottomRight);
  assert.ok(Math.abs(mappedTop.x) < 0.01 && Math.abs(mappedTop.y) < 0.01);
  assert.ok(Math.abs(mappedBottom.x - 288) < 0.01 && Math.abs(mappedBottom.y - 512) < 0.01);
  assert.deepEqual(rotatedPoint(topLeft.x, topLeft.y), { x: plan.crop.originX, y: plan.crop.originY });
});

test("photo plans are deterministic, bounded, and put rotation before crop", () => {
  const plan = buildPhotoTransformPlan({
    width: 4032,
    height: 3024,
    edit: { ...defaultMediaEdit("image"), rotation: 90, flipX: true, aspect: "square", filter: "pit" },
  });
  assert.equal(plan.output.width, 2048);
  assert.equal(plan.output.height, 2048);
  assert.deepEqual(plan.actions.map((action) => Object.keys(action)[0]), ["rotate", "flip", "crop", "resize"]);
  assert.equal(plan.adjustments.contrast, 0.12);
});

test("preset and manual adjustments compose within safe rendering limits", () => {
  const values = effectiveAdjustments({ ...defaultMediaEdit("image"), filter: "encore", filterIntensity: 0.5, adjustments: { warmth: 0.45, saturation: 0.95, highlights: -0.2, sharpen: 0.3 } });
  assert.equal(values.warmth, 0.5);
  assert.equal(values.saturation, 1);
  assert.equal(values.brightness, 0.02);
  assert.equal(values.highlights, -0.2);
  assert.equal(values.sharpen, 0.3);
});

test("video export decisions never describe cover-only selection as destructive editing", () => {
  const base = defaultMediaEdit("video", { durationMs: 30_000 });
  assert.equal(base.coverMode, "auto");
  assert.equal(videoEditRequiresExport(base), false);
  assert.equal(videoEditRequiresExport({ ...base, coverMode: "manual", coverMs: 12_000 }), false);
  assert.equal(videoEditRequiresExport({ ...base, muted: true }), true);
  assert.equal(videoEditRequiresExport({ ...base, trimEndMs: 20_000 }), true);
  assert.equal(videoEditRequiresExport(defaultMediaEdit("video", { durationMs: 300_000 })), false);
  assert.equal(videoEditRequiresExport(defaultMediaEdit("video", { durationMs: VIDEO_MAX_DURATION_MS + 1 })), true);
});

test("picker assets become stable local draft entries without persisting opaque file objects", () => {
  const input = { type: "video", uri: "file:///clip.mov", fileName: "clip.mov", mimeType: "video/quicktime", duration: 82_000, width: 1920, height: 1080, altText: "  Crowd   singing together  ", file: { secret: true } };
  const asset = mediaDraftAssetFromPicker(input, 2);
  assert.equal(asset.kind, "video");
  assert.equal(asset.durationMs, 82_000);
  assert.equal(asset.edit.trimEndMs, 82_000);
  assert.equal(asset.altText, "Crowd singing together");
  assert.equal("file" in asset, false);
});

test("default image recipes remain unchanged and rotations snap predictably", () => {
  assert.equal(mediaEditHasChanges(defaultMediaEdit("image")), false);
  assert.equal(normalizeRotation(44), 0);
  assert.equal(normalizeRotation(46), 90);
  assert.equal(normalizeRotation(450), 90);
});

test("every source image requires a verified metadata-stripped delivery render", () => {
  const edit = defaultMediaEdit("image");
  assert.equal(mediaImageRequiresRender({ kind: "image", mimeType: "image/heic", uri: "file:///photo.heic", edit }), true);
  assert.equal(mediaImageRequiresRender({ kind: "image", mimeType: "image/jpeg", uri: "file:///photo.jpg", edit }), true);
  assert.equal(mediaImageRequiresRender({ kind: "image", mimeType: "image/jpeg", uri: "file:///photo.jpg", edit: { ...edit, filter: "pit" } }), true);
});

test("HEIC and HEIF sources require a native decoder before web-safe export", () => {
  assert.equal(mediaImageNeedsNativeDecode({ mimeType: "image/heic", fileName: "photo.heic" }), true);
  assert.equal(mediaImageNeedsNativeDecode({ fileName: "photo.HEIF" }), true);
  assert.equal(mediaImageNeedsNativeDecode({ mimeType: "image/jpeg", fileName: "photo.jpg" }), false);
});

test("animated GIF is never silently flattened into a still photo", () => {
  assert.equal(mediaImageAnimationUnsupported({ mimeType: "image/gif", fileName: "crowd.gif" }), true);
  assert.equal(mediaImageAnimationUnsupported({ fileName: "crowd.GIF" }), true);
  assert.equal(mediaImageAnimationUnsupported({ mimeType: "image/jpeg", fileName: "crowd.jpg" }), false);
});

test("new stable clip sources admit MP4 and QuickTime while delivery remains server-sanitized", () => {
  assert.equal(mediaVideoSourceCompatible({ mimeType: "video/mp4", fileName: "clip.mp4" }), true);
  assert.equal(mediaVideoSourceCompatible({ mimeType: "video/quicktime", fileName: "clip.mov" }), true);
  assert.equal(mediaVideoSourceCompatible({ mimeType: "", fileName: "clip.MOV" }), true);
  assert.equal(mediaVideoSourceCompatible({ mimeType: "video/webm", fileName: "clip.webm" }), false);
});

test("Studio rejects sources above the same post limits before durable staging", () => {
  const photoLimit = 30 * 1024 * 1024;
  const videoLimit = 500 * 1024 * 1024;
  assert.equal(mediaSourceMaxBytes({ kind: "image" }), photoLimit);
  assert.equal(mediaSourceMaxBytes({ kind: "video" }), videoLimit);
  assert.equal(mediaSourceSizeAllowed({ kind: "image", fileSize: photoLimit }), true);
  assert.equal(mediaSourceSizeAllowed({ kind: "image", fileSize: photoLimit + 1 }), false);
  assert.equal(mediaSourceSizeAllowed({ kind: "video", fileSize: videoLimit }), true);
  assert.equal(mediaSourceSizeAllowed({ kind: "video", fileSize: videoLimit + 1 }), false);
  assert.equal(mediaSourceSizeAllowed({ kind: "video", fileSize: 0 }), true, "native staging remeasures unknown picker sizes");
  assert.equal(mediaSourceSizeAllowed({ kind: "video", fileSize: Number.POSITIVE_INFINITY }), false);
});
