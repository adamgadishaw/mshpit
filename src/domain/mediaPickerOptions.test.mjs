import assert from "node:assert/strict";
import test from "node:test";

import { postMediaPickerOptions } from "./mediaPickerOptions.mjs";
import { MEDIA_POST_MAX_ATTACHMENTS } from "./mediaUploadPolicy.mjs";

test("iOS post media requests compatible originals, Live Photos and the H.264 export preset", () => {
  const options = postMediaPickerOptions({
    platform: "ios",
    remaining: 8,
    iosH264Preset: 7,
    iosCompatibleRepresentation: "compatible",
    allowVideos: true,
  });
  assert.equal(options.videoExportPreset, 7);
  assert.equal(options.orderedSelection, true);
  assert.equal(options.shouldDownloadFromNetwork, true);
  assert.equal(options.preferredAssetRepresentationMode, "compatible");
  assert.equal(options.quality, 1);
  assert.equal(options.allowsEditing, false);
  assert.equal(options.selectionLimit, 8);
  assert.deepEqual(options.mediaTypes, ["images", "livePhotos", "videos"]);
});

test("web and Android keep their native files without an iOS-only export option", () => {
  for (const platform of ["web", "android"]) {
    const options = postMediaPickerOptions({ platform, remaining: 3, iosH264Preset: 7, allowVideos: true });
    assert.equal(Object.hasOwn(options, "videoExportPreset"), false);
    assert.equal(Object.hasOwn(options, "orderedSelection"), false);
    assert.equal(Object.hasOwn(options, "shouldDownloadFromNetwork"), false);
    assert.equal(Object.hasOwn(options, "preferredAssetRepresentationMode"), false);
    assert.equal(options.quality, 1);
    assert.equal(options.allowsEditing, false);
    assert.equal(options.selectionLimit, 3);
  }
});

test("post selection fails closed to photos until video publishing is advertised", () => {
  const defaultOptions = postMediaPickerOptions({ platform: "ios", remaining: 3, iosH264Preset: 7 });
  assert.deepEqual(defaultOptions.mediaTypes, ["images", "livePhotos"]);
  assert.equal(Object.hasOwn(defaultOptions, "videoExportPreset"), false);
  assert.deepEqual(postMediaPickerOptions({ platform: "ios", remaining: 3, iosH264Preset: 7, allowVideos: false }).mediaTypes, ["images", "livePhotos"]);
});

test("picker honors an explicit photo outage without hiding available videos", () => {
  assert.deepEqual(postMediaPickerOptions({
    platform: "ios",
    remaining: 3,
    iosH264Preset: 7,
    allowPhotos: false,
    allowVideos: true,
  }).mediaTypes, ["videos"]);
});

test("picker selection limit uses every open post slot without exceeding post capacity", () => {
  assert.equal(postMediaPickerOptions({ platform: "ios", remaining: 0, iosH264Preset: 7 }).selectionLimit, 1);
  assert.equal(postMediaPickerOptions({ platform: "ios", remaining: 7, iosH264Preset: 7 }).selectionLimit, 7);
  assert.equal(postMediaPickerOptions({ platform: "ios", remaining: 99, iosH264Preset: 7 }).selectionLimit, MEDIA_POST_MAX_ATTACHMENTS);
});
