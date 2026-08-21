import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  nextVisibleMediaPostIds,
  posterBoundsAreViewable,
  posterGenerationEnabled,
} from "./posterVisibility.mjs";

test("an eight-video feed invokes poster generation only for viewable cards", () => {
  const feed = Array.from({ length: 8 }, (_, index) => ({ id: `video-${index}`, uri: `https://media.test/${index}.mp4` }));
  let visible = nextVisibleMediaPostIds(new Set(), [
    { item: feed[2], isViewable: true },
    { item: feed[3], isViewable: true },
  ]);
  const invoked = [];
  for (const item of feed) {
    const itemViewable = visible.has(item.id);
    if (posterGenerationEnabled({
      enabled: true,
      explicitViewable: itemViewable ? true : null,
      autoViewable: itemViewable,
    })) invoked.push(item.id);
  }
  assert.deepEqual(invoked, ["video-2", "video-3"]);

  visible = nextVisibleMediaPostIds(visible, [
    { item: feed[2], isViewable: false },
    { item: feed[4], isViewable: true },
  ]);
  assert.deepEqual([...visible], ["video-3", "video-4"]);
  assert.equal(posterGenerationEnabled({ enabled: true, explicitViewable: false, autoViewable: true }), false);
});

test("a coarse visible multi-video card still requires each tile to intersect", () => {
  const invoked = Array.from({ length: 4 }, (_, index) => index).filter((index) => posterGenerationEnabled({
    enabled: true,
    explicitViewable: true,
    autoViewable: index === 2,
  }));
  assert.deepEqual(invoked, [2]);
});

test("a fully visible media tile in a two-viewport-tall card can use media-level visibility", () => {
  const flatListSaysWholeItemIsViewable = false;
  const mediaViewable = flatListSaysWholeItemIsViewable ? true : null;
  const invoked = Array.from({ length: 8 }, (_, index) => index).filter((index) => posterGenerationEnabled({
    enabled: true,
    explicitViewable: mediaViewable,
    // The fifth tile is fully on screen inside a 2x-viewport post while the
    // other mounted feed-window tiles remain offscreen.
    autoViewable: index === 4,
  }));
  assert.deepEqual(invoked, [4]);
});

test("native fallback requires a real viewport intersection", () => {
  const viewport = { viewportWidth: 390, viewportHeight: 844, width: 200, height: 120 };
  assert.equal(posterBoundsAreViewable({ ...viewport, x: 20, y: 200 }), true);
  assert.equal(posterBoundsAreViewable({ ...viewport, x: 20, y: 900 }), false);
  assert.equal(posterBoundsAreViewable({ ...viewport, x: -250, y: 200 }), false);
  assert.equal(posterBoundsAreViewable({ ...viewport, x: 20, y: 200, width: 0 }), false);
});

test("feed viewability is threaded to the actual ClipPoster generation boundary", () => {
  const feed = readFileSync(new URL("../screens/FeedScreen.jsx", import.meta.url), "utf8");
  const ticket = readFileSync(new URL("../components/TicketStub.jsx", import.meta.url), "utf8");
  const grid = readFileSync(new URL("../components/PostMediaGrid.jsx", import.meta.url), "utf8");
  const smartImage = readFileSync(new URL("../components/SmartImage.jsx", import.meta.url), "utf8");
  const poster = readFileSync(new URL("../components/ClipPoster.jsx", import.meta.url), "utf8");

  assert.match(feed, /setVisibleMediaPostIds\(\(current\) => nextVisibleMediaPostIds\(current, changed\)\)/);
  assert.match(feed, /extraData=\{visibleMediaPostIds\}/);
  assert.match(feed, /mediaViewable=\{visibleMediaPostIds\.has\(String\(item\.id\)\) \? true : null\}/);
  assert.match(ticket, /<PostMediaGrid media=\{postMedia\} viewable=\{mediaViewable\}/);
  assert.match(grid, /<SmartImage[\s\S]*viewable=\{viewable\}/);
  assert.match(smartImage, /<ClipPoster uri=\{uri\} posterUri=\{posterUri\} viewable=\{viewable\}/);
  assert.match(poster, /!generationEnabled \|\| !uri/);
  assert.match(poster, /controller\?\.abort\?\.\(\)/);
});

test("delayed native measurements are fenced after unmount and explicit visibility changes", () => {
  const hook = readFileSync(new URL("../lib/usePosterViewability.js", import.meta.url), "utf8");
  assert.match(hook, /mountedRef\.current = false;[\s\S]*measurementEpochRef\.current \+= 1/);
  assert.match(hook, /if \(!mountedRef\.current \|\| explicitRef\.current \|\| measurementEpoch !== measurementEpochRef\.current\) return/);
  assert.match(hook, /if \(blocked\) \{[\s\S]*measurementEpochRef\.current \+= 1/);
});
