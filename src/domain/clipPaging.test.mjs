import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { clipKeyboardTarget, clipPageIndex, clipPageNeedsMore, clipRenderWindow } from "./clipPaging.mjs";

test("clip paging clamps native momentum offsets to a valid page", () => {
  assert.equal(clipPageIndex(-80, 600, 4), 0);
  assert.equal(clipPageIndex(610, 600, 4), 1);
  assert.equal(clipPageIndex(1_510, 600, 4), 3);
  assert.equal(clipPageIndex(99_000, 600, 4), 3);
  assert.equal(clipPageNeedsMore(2, 4), true);
  assert.equal(clipPageNeedsMore(1, 4), false);
});

test("web reel render windows remain bounded across a long cursor session", () => {
  assert.deepEqual(clipRenderWindow(0, 100), { start: 0, end: 5 });
  assert.deepEqual(clipRenderWindow(50, 100), { start: 46, end: 55 });
  assert.deepEqual(clipRenderWindow(99, 100), { start: 95, end: 100 });
});

test("desktop clip keyboard paging is bounded and leaves controls alone", () => {
  assert.equal(clipKeyboardTarget({ key: "ArrowDown", activeIndex: 2, pageCount: 4 }), 3);
  assert.equal(clipKeyboardTarget({ key: "PageDown", activeIndex: 3, pageCount: 4 }), 3);
  assert.equal(clipKeyboardTarget({ key: "ArrowUp", activeIndex: 0, pageCount: 4 }), 0);
  assert.equal(clipKeyboardTarget({ key: "Home", activeIndex: 3, pageCount: 4 }), 0);
  assert.equal(clipKeyboardTarget({ key: "End", activeIndex: 0, pageCount: 4 }), 3);
  assert.equal(clipKeyboardTarget({ key: "ArrowDown", activeIndex: 1, pageCount: 4, tagName: "button" }), null);
});

test("ClipsScreen keeps a paged virtualized native reel instead of a non-scrollable View", async () => {
  const source = await readFile(new URL("../screens/ClipsScreen.jsx", import.meta.url), "utf8");
  assert.match(source, /function NativeReel/);
  assert.match(source, /<FlatList/);
  assert.match(source, /pagingEnabled/);
  assert.match(source, /onScroll=\{onScroll\}/);
  assert.match(source, /<VideoView\s+key=\{playbackSession\}/,
    "a retry or reactivation remounts the web listener with the current first-frame session");
  assert.match(source, /ref=\{videoViewRef\}[\s\S]*onFirstFrameRender=\{recordFirstFrame\}/,
    "the clip player exposes Expo's web video element to the decoded-frame fallback");
  assert.match(source, /videoViewerWebFrameReady\(element\)[\s\S]*setInterval\(probe, 125\)/,
    "a missed Expo web first-frame event cannot leave the clip poster mounted forever");
  assert.match(source, /claimClipPlaybackFailure\(reportedPlaybackErrorsRef\.current, failure\)/,
    "broken clip analytics are claimed at screen scope instead of resetting on each revisit");
  assert.doesNotMatch(source, /trackedErrorRef/);
  assert.match(source, /return web \? <WebReel \{\.\.\.props\} \/> : <NativeReel \{\.\.\.props\} \/>/);
});
