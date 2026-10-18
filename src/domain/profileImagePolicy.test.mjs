import assert from "node:assert/strict";
import test from "node:test";

import {
  profileImageCropRectangle,
  changedProfileImageFields,
  profileImageContract,
  profileImagePickerOptions,
  profileImageSelectionHint,
} from "./profileImagePolicy.mjs";

test("selected profile crops retain the exact source rectangle and reject empty edges or wrong shapes", () => {
  assert.deepEqual(profileImageCropRectangle({x:0.5,y:0.25,width:0.25,height:0.5},1600,800,"avatar"),{x:800,y:200,width:400,height:400});
  assert.deepEqual(profileImageCropRectangle({x:0,y:0.25,width:1,height:0.5},1800,1200,"banner"),{x:0,y:300,width:1800,height:600});
  for (const crop of [{x:-0.1,y:0,width:1,height:1},{x:0.5,y:0,width:1,height:1},{x:0,y:0,width:0,height:1},{x:0,y:0,width:NaN,height:1}]) {
    assert.throws(()=>profileImageCropRectangle(crop,800,800,"avatar"),/invalid/);
  }
  assert.throws(()=>profileImageCropRectangle({x:0,y:0,width:1,height:1},1600,800,"avatar"),/shape/);
});
test("web hints describe the interactive crop while native hints stay unchanged",()=>{
  assert.match(profileImageSelectionHint("avatar",{platform:"web"}),/drag and zoom/);
  assert.match(profileImageSelectionHint("banner",{platform:"web"}),/3:1/);
  assert.match(profileImageSelectionHint("avatar",{platform:"ios"}),/centered crop/);
});

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
