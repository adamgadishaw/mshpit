import test from "node:test";
import assert from "node:assert/strict";
import { canCommitMediaAsset, createMediaEditCapabilities, mediaCapabilityBlockers } from "./mediaEditCapabilities.mjs";

test("capabilities never imply destructive video output", () => {
  const capabilities = createMediaEditCapabilities({ platform: "ios", imageGeometry: true, imageRaster: true, videoCover: true });
  assert.equal(capabilities.image.export, true);
  assert.equal(capabilities.video.cover, true);
  assert.equal(capabilities.video.trim, false);
  assert.equal(capabilities.video.mute, false);
  assert.equal(capabilities.video.filters, false);
  assert.equal(capabilities.video.destructiveExport, false);
});

test("commit gating distinguishes a real raster renderer from recipe-only UI", () => {
  const partial = createMediaEditCapabilities({ platform: "native", imageGeometry: true, imageRaster: false });
  assert.equal(canCommitMediaAsset(partial, { kind: "image" }), false);
  assert.deepEqual(mediaCapabilityBlockers(partial, "image"), ["The photo adjustment renderer is unavailable."]);
  assert.equal(canCommitMediaAsset(partial, { kind: "video" }), false);
});
