import assert from "node:assert/strict";
import test from "node:test";
import { clipPosterPhase, clipPosterTime, shouldWarmClipPoster } from "./clipPoster.mjs";

test("clipPosterTime skips common black opening frames and stays inside short clips", () => {
  assert.equal(clipPosterTime(10), 0.8);
  assert.equal(clipPosterTime(120), 2);
  assert.equal(clipPosterTime(0.2), 0.1);
  assert.equal(clipPosterTime(Number.NaN), 0.35);
});

test("shouldWarmClipPoster limits reel work to the current page and neighbours", () => {
  assert.equal(shouldWarmClipPoster({ index: 3, activeIndex: 3 }), true);
  assert.equal(shouldWarmClipPoster({ index: 2, activeIndex: 3 }), true);
  assert.equal(shouldWarmClipPoster({ index: 4, activeIndex: 3 }), true);
  assert.equal(shouldWarmClipPoster({ index: 5, activeIndex: 3 }), false);
  assert.equal(shouldWarmClipPoster({ index: 5, activeIndex: 3, radius: 2 }), true);
});

test("clipPosterPhase never calls metadata readiness a rendered thumbnail", () => {
  assert.equal(clipPosterPhase({ enabled: false }), "idle");
  assert.equal(clipPosterPhase({ status: "readyToPlay" }), "loading");
  assert.equal(clipPosterPhase({ status: "readyToPlay", hasVisual: true }), "ready");
  assert.equal(clipPosterPhase({ status: "error" }), "error");
  assert.equal(clipPosterPhase({ error: new Error("decode") }), "error");
});
