import assert from "node:assert/strict";
import test from "node:test";

import { postMediaPickerOptions } from "./mediaPickerOptions.mjs";

test("iOS post videos request the SDK 56 H.264 MP4 export preset", () => {
  const options = postMediaPickerOptions({ platform: "ios", remaining: 8, iosH264Preset: 7 });
  assert.equal(options.videoExportPreset, 7);
  assert.equal(options.selectionLimit, 6);
  assert.deepEqual(options.mediaTypes, ["images", "videos"]);
});

test("web and Android keep their native files without an iOS-only export option", () => {
  for (const platform of ["web", "android"]) {
    const options = postMediaPickerOptions({ platform, remaining: 3, iosH264Preset: 7 });
    assert.equal(Object.hasOwn(options, "videoExportPreset"), false);
    assert.equal(options.selectionLimit, 3);
  }
});

test("picker selection limits stay inside the supported one-to-six range", () => {
  assert.equal(postMediaPickerOptions({ platform: "ios", remaining: 0, iosH264Preset: 7 }).selectionLimit, 1);
  assert.equal(postMediaPickerOptions({ platform: "ios", remaining: 99, iosH264Preset: 7 }).selectionLimit, 6);
});
