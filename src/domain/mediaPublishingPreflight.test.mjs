import assert from "node:assert/strict";
import test from "node:test";

import {
  MEDIA_PREFLIGHT_CODES,
  mediaPublishingPreflightIssue,
  mediaPublishingPreflightMessage,
  mediaPublishingPreflightSelection,
} from "./mediaPublishingPreflight.mjs";

const video = (patch = {}) => ({
  id: "clip",
  kind: "video",
  fileName: "crowd.mp4",
  mimeType: "video/mp4",
  fileSize: 4_000_000,
  durationMs: 25_000,
  width: 1080,
  height: 1920,
  ...patch,
});

test("video preflight admits only a bounded MP4 with usable picker metadata", () => {
  assert.equal(mediaPublishingPreflightIssue(video()), null);
  assert.equal(mediaPublishingPreflightIssue(video({ durationMs: 0 })).code, MEDIA_PREFLIGHT_CODES.videoDurationMissing);
  assert.equal(mediaPublishingPreflightIssue(video({ durationMs: 60_001 })).code, MEDIA_PREFLIGHT_CODES.videoTooLong);
  assert.equal(mediaPublishingPreflightIssue(video({ mimeType: "video/quicktime", fileName: "crowd.mov" })).code, MEDIA_PREFLIGHT_CODES.videoContainerUnsupported);
  assert.equal(mediaPublishingPreflightIssue(video({ fileSize: 101 * 1024 * 1024 })).code, MEDIA_PREFLIGHT_CODES.videoTooLarge);
  assert.equal(mediaPublishingPreflightIssue(video({ width: 1 })).code, MEDIA_PREFLIGHT_CODES.videoDimensionsMissing);
});

test("photo preflight is platform-aware and does not reject an unknown size before native measurement", () => {
  const heic = { id: "photo", kind: "image", fileName: "lights.heic", mimeType: "image/heic", fileSize: 0 };
  assert.equal(mediaPublishingPreflightIssue(heic, { platform: "native" }), null);
  assert.equal(mediaPublishingPreflightIssue(heic, { platform: "web" }).code, MEDIA_PREFLIGHT_CODES.webImageDecodeUnsupported);
  assert.equal(mediaPublishingPreflightIssue({ ...heic, fileName: "lights.gif", mimeType: "image/gif" }).code, MEDIA_PREFLIGHT_CODES.animatedImageUnsupported);
});

test("mixed selections keep valid media and report every rejected item deterministically", () => {
  const photo = { id: "photo", kind: "image", fileName: "lights.jpg", mimeType: "image/jpeg", fileSize: 20_000 };
  const result = mediaPublishingPreflightSelection([
    photo,
    video({ durationMs: 0 }),
    video({ id: "mov", mimeType: "video/quicktime", fileName: "crowd.mov" }),
  ]);
  assert.deepEqual(result.accepted, [photo]);
  assert.deepEqual(result.rejected.map((item) => item.code), [
    MEDIA_PREFLIGHT_CODES.videoDurationMissing,
    MEDIA_PREFLIGHT_CODES.videoContainerUnsupported,
  ]);
  assert.match(mediaPublishingPreflightMessage(result.rejected), /2 selected items were skipped/);
});
