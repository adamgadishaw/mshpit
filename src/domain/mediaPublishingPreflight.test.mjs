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

test("video preflight defers container and metadata inspection to the server verifier", () => {
  assert.equal(mediaPublishingPreflightIssue(video()), null);
  assert.equal(mediaPublishingPreflightIssue(video({ mimeType: "video/quicktime", fileName: "crowd.mov" })), null);
  assert.equal(mediaPublishingPreflightIssue(video({ durationMs: 0 })), null);
  assert.equal(mediaPublishingPreflightIssue(video({ durationMs: 600_000 })), null);
  assert.equal(mediaPublishingPreflightIssue(video({ durationMs: 3_600_000 })), null);
  assert.equal(mediaPublishingPreflightIssue(video({ mimeType: "video/webm", fileName: "crowd.webm" })), null);
  assert.equal(mediaPublishingPreflightIssue(video({ mimeType: "application/octet-stream", fileName: "crowd.bin" })), null);
  assert.equal(mediaPublishingPreflightIssue(video({ fileSize: 500 * 1024 * 1024 })), null);
  assert.equal(mediaPublishingPreflightIssue(video({ fileSize: 500 * 1024 * 1024 + 1 })).code, MEDIA_PREFLIGHT_CODES.videoTooLarge);
  assert.equal(mediaPublishingPreflightIssue(video({ width: 0, height: 0 })), null);
});

test("photo preflight admits GIF and HEIC sources and defers format normalization to the server", () => {
  const heic = { id: "photo", kind: "image", fileName: "lights.heic", mimeType: "image/heic", fileSize: 0 };
  assert.equal(mediaPublishingPreflightIssue(heic, { platform: "native" }), null);
  assert.equal(mediaPublishingPreflightIssue({ ...heic, fileSize: 30 * 1024 * 1024 }, { platform: "native" }), null);
  assert.equal(
    mediaPublishingPreflightIssue({ ...heic, fileSize: 30 * 1024 * 1024 + 1 }, { platform: "native" }).code,
    MEDIA_PREFLIGHT_CODES.imageTooLarge,
  );
  assert.equal(mediaPublishingPreflightIssue(heic, { platform: "web" }), null);
  assert.equal(mediaPublishingPreflightIssue({ ...heic, fileName: "lights.gif", mimeType: "image/gif" }), null);
});

test("mixed selections skip only sources beyond the shared byte-safety ceiling", () => {
  const photo = { id: "photo", kind: "image", fileName: "lights.jpg", mimeType: "image/jpeg", fileSize: 20_000 };
  const metadataPoor = video({ durationMs: 0, width: 0, height: 0 });
  const webm = video({ id: "webm", mimeType: "video/webm", fileName: "crowd.webm" });
  const result = mediaPublishingPreflightSelection([
    photo,
    metadataPoor,
    webm,
    video({ id: "oversize", fileSize: 500 * 1024 * 1024 + 1 }),
  ]);
  assert.deepEqual(result.accepted, [photo, metadataPoor, webm]);
  assert.deepEqual(result.rejected.map((item) => item.code), [MEDIA_PREFLIGHT_CODES.videoTooLarge]);
  assert.doesNotMatch(mediaPublishingPreflightMessage(result.rejected), /selected items were skipped/);
});
