import assert from "node:assert/strict";
import test from "node:test";

import {
  hasLandingCompatibleImage,
  isLandingCompatibleImage,
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
