import assert from "node:assert/strict";
import test from "node:test";

import {
  clampNativeAudioVolume,
  nativeAudioCompletion,
  nativeAudioOperationError,
  nativeAudioSnapshot,
  nativeAudioSource,
} from "./nativeAudioPreview.mjs";

test("native preview sources exist only for enabled non-empty URIs", () => {
  assert.deepEqual(nativeAudioSource(" https://cdn.example/preview.mp3 ", true), {
    uri: "https://cdn.example/preview.mp3",
  });
  assert.equal(nativeAudioSource("https://cdn.example/preview.mp3", false), null);
  assert.equal(nativeAudioSource("  ", true), null);
  assert.equal(nativeAudioSource(null, true), null);
});

test("native preview status is bounded and exposes native load failures", () => {
  assert.deepEqual(nativeAudioSnapshot({
    currentTime: 12.5,
    duration: 30,
    playing: true,
    error: null,
  }), {
    pos: 12.5,
    dur: 30,
    playing: true,
    error: null,
  });
  assert.deepEqual(nativeAudioSnapshot({
    currentTime: -3,
    duration: Number.NaN,
    playing: false,
    error: "  Decoder rejected this source.  ",
  }), {
    pos: 0,
    dur: 0,
    playing: false,
    error: { kind: "playback", message: "Decoder rejected this source." },
  });
});

test("native preview completion advances a source only once", () => {
  const first = nativeAudioCompletion({ id: "player-1", didJustFinish: true }, "preview-a");
  assert.deepEqual(first, { key: "player-1:preview-a", notify: true });
  assert.equal(nativeAudioCompletion({ id: "player-1", didJustFinish: true }, "preview-a", first.key).notify, false);
  assert.equal(nativeAudioCompletion({ id: "player-1", didJustFinish: false }, "preview-a").notify, false);
  assert.equal(nativeAudioCompletion({ id: "player-2", didJustFinish: true }, "preview-b", first.key).notify, true);
});

test("native preview operation failures cannot leak across source changes", () => {
  const failedA = {
    sourceKey: "preview-a",
    error: { kind: "playback", message: "Preview A failed." },
  };
  assert.deepEqual(nativeAudioOperationError(failedA, "preview-a"), failedA.error);
  assert.equal(nativeAudioOperationError(failedA, "preview-b"), null);
  assert.equal(nativeAudioOperationError(failedA, null), null);
});

test("native preview volume stays inside the player contract", () => {
  assert.equal(clampNativeAudioVolume(-1), 0);
  assert.equal(clampNativeAudioVolume(0.45), 0.45);
  assert.equal(clampNativeAudioVolume(8), 1);
  assert.equal(clampNativeAudioVolume("not-a-number"), 1);
});
