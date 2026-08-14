import assert from "node:assert/strict";
import test from "node:test";
import { galleryKeyAction, videoViewerPhase } from "./mediaViewer.mjs";

test("videoViewerPhase keeps idle and buffering players in a visible loading state", () => {
  assert.equal(videoViewerPhase({ status: "idle" }), "loading");
  assert.equal(videoViewerPhase({ status: "loading" }), "loading");
});

test("videoViewerPhase becomes ready from either supported readiness signal", () => {
  assert.equal(videoViewerPhase({ status: "readyToPlay" }), "ready");
  assert.equal(videoViewerPhase({ status: "loading", hasFirstFrame: true }), "ready");
});

test("videoViewerPhase gives playback errors precedence over stale ready state", () => {
  assert.equal(videoViewerPhase({ status: "error", hasFirstFrame: true }), "error");
  assert.equal(videoViewerPhase({ status: "readyToPlay", error: new Error("decode failed") }), "error");
});

test("gallery arrows do not steal seeking keys from focused video controls", () => {
  assert.equal(galleryKeyAction({ key: "ArrowLeft", tagName: "VIDEO" }), null);
  assert.equal(galleryKeyAction({ key: "ArrowRight", tagName: "input" }), null);
  assert.equal(galleryKeyAction({ key: "ArrowRight", tagName: "DIV" }), "next");
  assert.equal(galleryKeyAction({ key: "ArrowLeft", tagName: "DIV" }), "previous");
  assert.equal(galleryKeyAction({ key: "Escape", tagName: "VIDEO" }), "close");
});
