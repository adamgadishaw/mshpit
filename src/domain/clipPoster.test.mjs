import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { clipPosterPhase, clipPosterTime, durablePosterEventOwnsInstance, durablePosterFailurePlan, shouldWarmClipPoster } from "./clipPoster.mjs";

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

test("one durable-poster error retries the small image before video generation", () => {
  const generated = [];
  const first = durablePosterFailurePlan(0);
  if (first.terminal) generated.push("video-source");
  assert.deepEqual(first, { failures: 1, terminal: false, retryAfterMs: 700 });
  assert.deepEqual(generated, []);
  assert.deepEqual(durablePosterFailurePlan(first.failures), { failures: 2, terminal: true, retryAfterMs: 0 });
});

test("a stale display from failed durable poster version zero cannot mark the retry ready", () => {
  const waiting = { uri: "poster-a", ready: false, failed: false, failures: 1, retrying: true, retryVersion: 0 };
  assert.equal(durablePosterEventOwnsInstance(waiting, { uri: "poster-a", retryVersion: 0 }), false);
  const remounted = { ...waiting, retrying: false, retryVersion: 1 };
  assert.equal(durablePosterEventOwnsInstance(remounted, { uri: "poster-a", retryVersion: 0 }), false);
  assert.equal(durablePosterEventOwnsInstance(remounted, { uri: "poster-a", retryVersion: 1 }), true);
});

test("ClipPoster keeps its cover until generated artwork paints and handles image decode failure", () => {
  const source = readFileSync(new URL("../components/ClipPoster.jsx", import.meta.url), "utf8");
  assert.match(source, /const generatedPosterReady = generatedPosterState\.uri === uri && generatedPosterState\.ready/);
  assert.match(source, /: generatedPosterReady/);
  assert.match(source, /onDisplay=\{\(\) => handleDurablePosterDisplay\(durablePosterState\.retryVersion\)\}/);
  assert.match(source, /onError=\{\(\) => handleDurablePosterError\(durablePosterState\.retryVersion\)\}/);
  assert.match(source, /if \(useDurablePoster \|\| !generationEnabled/);
  assert.match(source, /onDisplay=\{\(\) => setGeneratedPosterState/);
  assert.match(source, /onError=\{\(\) => \{/);
  assert.match(source, /if \(!releaseThumbnail\(\{ uri, asset: generatedPoster \}\)\) return/);
  assert.doesNotMatch(source, /: !!generatedPoster/);
});

test("ClipPoster uses one solid play badge without a decorative oval or nested ring", () => {
  const source = readFileSync(new URL("../components/ClipPoster.jsx", import.meta.url), "utf8");
  assert.match(source, /styles\.playBadge/);
  assert.match(source, /backgroundColor: colors\.amberStrong/);
  assert.match(source, /phase !== "ready"[\s\S]*showPlayBadge \? <View style=\{\[styles\.playBadge/);
  assert.match(source, /phase === "ready" && showPlayBadge[\s\S]*styles\.playBadge, styles\.readyBadge/);
  assert.doesNotMatch(source, /styles\.glow|glowCompact|playRing|borderColor: "rgba\(255,255,255/);
});
