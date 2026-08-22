import assert from "node:assert/strict";
import test from "node:test";

import {
  buildLandingSlideDeck,
  hasLandingCompatibleImage,
  isLandingCompatibleImage,
  landingCommunityAdvanceDelay,
  landingCommunityFrameReady,
  landingSlideFrame,
  landingStockStartIndex,
  normalizeLandingCommunityMedia,
  rotateLandingFallbacks,
} from "./landingShowcase.mjs";

const stock = [
  { id: "one", uri: "https://images.unsplash.com/photo-1501386761578-eac5c94b800a?auto=format&fit=crop&w=2000&q=85", credit: "One" },
  { id: "two", uri: "https://images.unsplash.com/photo-1429962714451-bb934ecdc4ec?auto=format&fit=crop&w=2000&q=85", credit: "Two" },
  { id: "three", uri: "https://images.unsplash.com/photo-1470229722913-7c0e2dbbafd3?auto=format&fit=crop&w=2000&q=85", credit: "Three" },
];

test("landing community media rejects incompatible, unsafe, and duplicate images", () => {
  const media = normalizeLandingCommunityMedia([
    { id: "good", uri: "https://media.example/users/u/post/good.jpg", credit: " Shared by @fan ", artist: " J. Cole ", venue: " Scotiabank Arena " },
    { id: "duplicate", uri: "https://media.example/users/u/post/good.jpg" },
    { id: "video", uri: "https://media.example/users/u/post/clip.mp4" },
    { id: "heic", uri: "https://media.example/users/u/post/phone.heic" },
    { id: "http", uri: "http://media.example/users/u/post/photo.png" },
    { id: "tracker", uri: "https://user:secret@media.example/users/u/post/photo.png" },
  ], 7);
  assert.deepEqual(media, [{
    id: "community:good",
    uri: "https://media.example/users/u/post/good.jpg",
    credit: "Shared by @fan",
    artist: "J. Cole",
    venue: "Scotiabank Arena",
    source: "community",
  }]);
});

test("composer showcase eligibility requires a browser-compatible still", () => {
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

test("landing deck is fixed-size, stock-first, bounded, and deterministic", () => {
  const community = [
    { id: "a", uri: "https://media.example/users/a/post/a.jpg", credit: "A" },
    { id: "b", uri: "https://media.example/users/b/post/b.webp", credit: "B" },
  ];
  const first = buildLandingSlideDeck(community, stock, 4);
  const second = buildLandingSlideDeck(community, stock, 4);
  assert.deepEqual(first, second);
  assert.equal(first.length, 4);
  assert.equal(first[0].source, "stock");
  assert.equal(first[0].uri, stock[0].uri);
  assert.deepEqual(first.slice(1, 3).map((slide) => slide.source), ["community", "community"]);
});

test("real extensionless Unsplash hero URLs are accepted without widening community trust", () => {
  const deck = buildLandingSlideDeck([], stock, 3);
  assert.equal(deck.length, 3);
  assert.deepEqual(deck.map((slide) => slide.uri), stock.map((slide) => slide.uri));
  assert.equal(isLandingCompatibleImage(stock[0].uri), false);
  assert.equal(buildLandingSlideDeck([], [{ id: "evil", uri: "https://tracker.example/photo-1501386761578-eac5c94b800a" }], 1).length, 0);
});

test("a failed community frame resolves to its deterministic stock fallback", () => {
  const [_, community] = buildLandingSlideDeck([
    { id: "a", uri: "https://media.example/users/a/post/a.jpg", credit: "A" },
  ], stock, 3);
  assert.equal(landingSlideFrame(community, new Set()).source, "community");
  const fallback = landingSlideFrame(community, new Set([community.id]));
  assert.equal(fallback.source, "stock");
  assert.equal(fallback.uri, stock[1].uri);
});

test("stock opening rotation is deterministic per day/session and can shift the first frame", () => {
  const at = Date.UTC(2026, 7, 14, 12);
  const index = landingStockStartIndex({ at, sessionSeed: "session-a", total: stock.length });
  assert.equal(landingStockStartIndex({ at, sessionSeed: "session-a", total: stock.length }), index);
  const rotated = rotateLandingFallbacks(stock, 2);
  assert.deepEqual(rotated.map((item) => item.id), ["three", "one", "two"]);
});

test("community imagery advances early only after the minimum first-paint window", () => {
  assert.equal(landingCommunityAdvanceDelay({ mountedAt: 1000, now: 1200, hasCommunity: true }), 1200);
  assert.equal(landingCommunityAdvanceDelay({ mountedAt: 1000, now: 3000, hasCommunity: true }), 0);
  assert.equal(landingCommunityAdvanceDelay({ mountedAt: 1000, now: 1200, hasCommunity: false }), null);
  assert.equal(landingCommunityAdvanceDelay({ mountedAt: 1000, now: 1200, hasCommunity: true, hasAdvanced: true }), null);
});

test("early community advancement requires that exact frame to prefetch successfully", () => {
  const frame = { id: "community:night", source: "community", uri: "https://media.example/users/u/post/night.jpg" };
  assert.equal(landingCommunityFrameReady({ frame, prefetchSucceeded: true }), true);
  assert.equal(landingCommunityFrameReady({ frame, prefetchSucceeded: false }), false);
  assert.equal(landingCommunityFrameReady({ frame: stock[0], prefetchSucceeded: true }), false);
  assert.equal(landingCommunityFrameReady({ frame, prefetchSucceeded: true, aborted: true }), false);
  assert.equal(landingCommunityFrameReady({ frame, prefetchSucceeded: true, hasAdvanced: true }), false);
  assert.equal(landingCommunityFrameReady({ frame, prefetchSucceeded: true, reduceMotion: true }), false);
});
