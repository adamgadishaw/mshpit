import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { galleryItemPostId, galleryKeyAction, normalizedGalleryIndex, trappedGalleryFocusIndex, videoViewerPhase } from "./mediaViewer.mjs";

test("videoViewerPhase keeps idle and buffering players in a visible loading state", () => {
  assert.equal(videoViewerPhase({ status: "idle" }), "loading");
  assert.equal(videoViewerPhase({ status: "loading" }), "loading");
});

test("videoViewerPhase waits for a painted frame after metadata is ready", () => {
  assert.equal(videoViewerPhase({ status: "readyToPlay" }), "loading");
  assert.equal(videoViewerPhase({ status: "loading", hasFirstFrame: true }), "ready");
});

test("videoViewerPhase gives playback errors precedence over stale ready state", () => {
  assert.equal(videoViewerPhase({ status: "error", hasFirstFrame: true }), "error");
  assert.equal(videoViewerPhase({ status: "readyToPlay", error: new Error("decode failed") }), "error");
});

test("gallery arrows do not steal seeking keys from focused video controls", () => {
  assert.equal(galleryKeyAction({ key: "ArrowLeft", tagName: "VIDEO" }), null);
  assert.equal(galleryKeyAction({ key: "ArrowRight", tagName: "input" }), null);
  assert.equal(galleryKeyAction({ key: "ArrowRight", tagName: "button" }), null);
  assert.equal(galleryKeyAction({ key: "ArrowRight", tagName: "DIV" }), "next");
  assert.equal(galleryKeyAction({ key: "ArrowLeft", tagName: "DIV" }), "previous");
  assert.equal(galleryKeyAction({ key: "Escape", tagName: "VIDEO" }), "close");
});

test("gallery indexes clamp when a live media set changes", () => {
  assert.equal(normalizedGalleryIndex(4, 2), 1);
  assert.equal(normalizedGalleryIndex(-8, 2), 0);
  assert.equal(normalizedGalleryIndex(1, 0), 0);
});

test("cross-post galleries attribute the current item instead of the opener", () => {
  assert.equal(galleryItemPostId({ uri: "https://cdn.test/second.mp4", postId: "p_second" }, "p_first"), "p_second");
  assert.equal(galleryItemPostId("https://cdn.test/legacy.jpg", "p_first"), "p_first");
  assert.equal(galleryItemPostId({ postId: "  " }, " p_fallback "), "p_fallback");
  assert.equal(galleryItemPostId({ postId: null }, null), null);
});

test("modal focus wraps in both directions and recovers from an outside target", () => {
  assert.equal(trappedGalleryFocusIndex({ currentIndex: 2, count: 3 }), 0);
  assert.equal(trappedGalleryFocusIndex({ currentIndex: 0, count: 3, shiftKey: true }), 2);
  assert.equal(trappedGalleryFocusIndex({ currentIndex: -1, count: 3 }), 0);
  assert.equal(trappedGalleryFocusIndex({ currentIndex: -1, count: 3, shiftKey: true }), 2);
  assert.equal(trappedGalleryFocusIndex({ count: 0 }), null);
});

test("the viewer captures its opener before RN Web mounts the modal portal", async () => {
  const app = await readFile(new URL("../../App.js", import.meta.url), "utf8");
  const viewer = await readFile(new URL("../components/PhotoViewer.jsx", import.meta.url), "utf8");
  const grid = await readFile(new URL("../components/PostMediaGrid.jsx", import.meta.url), "utf8");
  const post = await readFile(new URL("../components/TicketStub.jsx", import.meta.url), "utf8");
  assert.match(grid, /ref=\{openerRef\}[\s\S]*onOpen\(index, openerRef\.current\)/);
  assert.match(grid, /nativeID=\{openerId\}/);
  assert.match(post, /openerScope=\{log\.id\}/);
  assert.match(post, /onOpenPhotos\(postMedia, i, log\.id, opener\)/);
  assert.match(app, /capturedOpener\s*=\s*opener\?\.focus \? opener : document\.activeElement[\s\S]*mediaViewerOpenerRef\.current = capturedOpener[\s\S]*go\(\{ photos:/);
  assert.match(app, /requestAnimationFrame\(\(\) => \{[\s\S]*requestAnimationFrame\(\(\) => \{[\s\S]*generation !== mediaViewerFocusGenerationRef\.current/);
  assert.match(app, /document\.getElementById\(identity\.id\)[\s\S]*getAttribute\("aria-label"\) === identity\.label[\s\S]*focusTarget\.focus\(\)/);
  assert.match(app, /returnFocusRef=\{mediaViewerOpenerRef\}/);
  assert.match(viewer, /returnFocusRef\?\.current \|\| document\.activeElement/);
  assert.match(viewer, /if \(!returnFocusRef && previous\?\.isConnected\)/);
  assert.match(viewer, /tabIndex:\s*-1,\s*"aria-hidden":\s*true/);
  assert.match(viewer, /element\.getAttribute\?\.\("aria-hidden"\) !== "true"/);
  assert.match(viewer, /const currentPostId = galleryItemPostId\(p, postId\)/);
  assert.match(viewer, /<ClipStage[^>]*postId=\{currentPostId\}/);
  assert.match(viewer, /toggleMediaReaction\(uri, currentPostId\)/);
});
