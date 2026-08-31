import assert from "node:assert/strict";
import test from "node:test";

import {
  hasLandingCompatibleImage,
  isLandingCompatibleImage,
  landingPhotoAfterFailure,
  normalizeLandingCommunityMedia,
} from "./landingShowcase.mjs";

test("composer showcase eligibility remains independent from automatic landing loading", () => {
  assert.equal(isLandingCompatibleImage("https://media.example/users/u/post/photo.webp"), true);
  assert.equal(hasLandingCompatibleImage([
    "https://media.example/users/u/post/clip.mp4",
    "https://media.example/users/u/post/phone.heic",
  ]), false);
  assert.equal(hasLandingCompatibleImage([
    "https://media.example/users/u/post/clip.mp4",
    "https://media.example/users/u/post/photo.jpeg",
  ]), true);
});

test("landing reel accepts only bounded unique compatible community photos", () => {
  const media = normalizeLandingCommunityMedia([
    { id: "p1:0", path: "/media/landing/p1", credit: " Shared by @fan ", artist: "Artist", venue: "Venue" },
    { id: "duplicate", path: "/media/landing/p1" },
    { id: "external", uri: "https://tracker.example/two.jpg" },
    { id: "unsafe", path: "//tracker.example/two.jpg" },
    { id: "p2:0", path: "/media/landing/p2", credit: "\u0000Shared by Fan" },
  ], 6, { resolvePath: (path) => `https://www.mshpit.com${path}` });

  assert.deepEqual(media, [
    {
      id: "community:p1:0",
      uri: "https://www.mshpit.com/media/landing/p1",
      path: "/media/landing/p1",
      credit: "Shared by @fan",
      artist: "Artist",
      venue: "Venue",
      source: "community",
    },
    {
      id: "community:p2:0",
      uri: "https://www.mshpit.com/media/landing/p2",
      path: "/media/landing/p2",
      credit: "Shared by Fan",
      artist: null,
      venue: null,
      source: "community",
    },
  ]);
  assert.deepEqual(landingPhotoAfterFailure(media, new Set(["community:p1:0"])), [media[1]]);
});
