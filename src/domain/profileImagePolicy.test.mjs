import assert from "node:assert/strict";
import test from "node:test";

import {
  changedProfileImageFields,
  profileImageContract,
  profileImagePickerOptions,
  profileImageSelectionHint,
} from "./profileImagePolicy.mjs";

test("profile image contracts keep avatar and banner renditions bounded at their display aspect", () => {
  assert.deepEqual(profileImageContract("avatar"), {
    purpose: "avatar", aspect: [1, 1], outputWidth: 1024, outputHeight: 1024,
  });
  assert.deepEqual(profileImageContract("banner"), {
    purpose: "banner", aspect: [3, 1], outputWidth: 1800, outputHeight: 600,
  });
  assert.equal(profileImageContract("review"), null);
});

test("SDK 57 picker options never open the square iOS editor for a banner", () => {
  const avatar = profileImagePickerOptions("avatar", { platform: "ios" });
  const banner = profileImagePickerOptions("banner", { platform: "ios" });
  assert.equal(avatar.allowsEditing, true);
  assert.equal(banner.allowsEditing, false);
  assert.equal(Object.hasOwn(avatar, "aspect"), false, "aspect is Android-only in Expo SDK 57");
  assert.equal(Object.hasOwn(banner, "aspect"), false, "aspect is Android-only in Expo SDK 57");
  assert.equal(avatar.quality, 0.85);
  assert.equal(banner.quality, 0.85);
  assert.equal(avatar.shouldDownloadFromNetwork, true);
  assert.equal(banner.shouldDownloadFromNetwork, true);
  assert.deepEqual(avatar.mediaTypes, ["images"]);
});

test("Android exposes the correct native crop while web defers cropping to the server", () => {
  assert.deepEqual(profileImagePickerOptions("avatar", { platform: "android" }).aspect, [1, 1]);
  assert.deepEqual(profileImagePickerOptions("banner", { platform: "android" }).aspect, [3, 1]);
  const webBanner = profileImagePickerOptions("banner", { platform: "web" });
  assert.equal(webBanner.allowsEditing, false);
  assert.equal(Object.hasOwn(webBanner, "aspect"), false);
  assert.equal(Object.hasOwn(webBanner, "shouldDownloadFromNetwork"), false);
  assert.throws(() => profileImagePickerOptions("review", { platform: "ios" }), /avatar or banner/);
});

test("profile image hints state the crop and server rendition users will receive", () => {
  assert.equal(profileImageSelectionHint("avatar"), "Square photo · centered crop · 1024 × 1024");
  assert.equal(profileImageSelectionHint("banner"), "Wide 3:1 image · centered crop · 1800 × 600");
  assert.throws(() => profileImageSelectionHint("review"), /avatar or banner/);
});

test("artist catalog fallbacks are omitted until the owner explicitly replaces that field", () => {
  assert.deepEqual(changedProfileImageFields({
    avatarUri: "https://catalog.example/avatar.jpg",
    banner: "https://catalog.example/banner.jpg",
  }), {});
  assert.deepEqual(changedProfileImageFields({
    avatarUri: "https://media.example/avatar.jpg",
    banner: "https://catalog.example/banner.jpg",
    avatarChanged: true,
  }), { avatarUri: "https://media.example/avatar.jpg" });
});
