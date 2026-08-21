import assert from "node:assert/strict";
import test from "node:test";

import { postMediaPickerOptions } from "./mediaPickerOptions.mjs";

test("iOS post videos request the SDK 56 H.264 MP4 export preset", () => {
  const options = postMediaPickerOptions({ platform: "ios", remaining: 8, iosH264Preset: 7, allowVideos: true });
  assert.equal(options.videoExportPreset, 7);
  assert.equal(options.orderedSelection, true);
  assert.equal(options.selectionLimit, 6);
  assert.deepEqual(options.mediaTypes, ["images", "videos"]);
});

test("web and Android keep their native files without an iOS-only export option", () => {
  for (const platform of ["web", "android"]) {
    const options = postMediaPickerOptions({ platform, remaining: 3, iosH264Preset: 7, allowVideos: true });
    assert.equal(Object.hasOwn(options, "videoExportPreset"), false);
    assert.equal(Object.hasOwn(options, "orderedSelection"), false);
    assert.equal(options.selectionLimit, 3);
  }
});

test("post selection fails closed to photos until video publishing is advertised", () => {
  const defaultOptions = postMediaPickerOptions({ platform: "ios", remaining: 3, iosH264Preset: 7 });
  assert.deepEqual(defaultOptions.mediaTypes, ["images"]);
  assert.equal(Object.hasOwn(defaultOptions, "videoExportPreset"), false);
  assert.deepEqual(postMediaPickerOptions({ platform: "ios", remaining: 3, iosH264Preset: 7, allowVideos: false }).mediaTypes, ["images"]);
});

test("picker selection limits stay inside the supported one-to-six range", () => {
  assert.equal(postMediaPickerOptions({ platform: "ios", remaining: 0, iosH264Preset: 7 }).selectionLimit, 1);
  assert.equal(postMediaPickerOptions({ platform: "ios", remaining: 99, iosH264Preset: 7 }).selectionLimit, 6);
});
