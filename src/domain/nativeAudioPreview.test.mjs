import assert from "node:assert/strict";
import test from "node:test";

import {
  clampNativeAudioVolume,
  nativeAudioCompletion,
  nativeAudioLeaseIsCurrent,
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

test("a same-source duplicate cannot inherit the previous occurrence completion", () => {
  const status = { id: "player-1", didJustFinish: true };
  const occurrenceA = '["preview-a","occurrence-a"]';
  const occurrenceB = '["preview-a","occurrence-b"]';
  const startedA = `player-1:${occurrenceA}`;
  const startedB = `player-1:${occurrenceB}`;
  assert.equal(
    nativeAudioCompletion(status, occurrenceB, null, startedA).notify,
    false,
    "A's didJustFinish status cannot immediately skip unstarted occurrence B",
  );
  assert.equal(nativeAudioCompletion(status, occurrenceB, null, null).notify, false, "B stays disarmed during rewind");
  assert.equal(nativeAudioCompletion(status, occurrenceB, null, startedB).notify, true, "B may end after its own PLAYING boundary");
});

test("deferred native setup cannot play after its occurrence is hidden", async () => {
  let release;
  const configured = new Promise((resolve) => { release = resolve; });
  const current = { enabled: true, key: "occurrence-a" };
  let plays = 0;
  const setup = async () => {
    await configured;
    if (nativeAudioLeaseIsCurrent({
      enabled: current.enabled,
      currentKey: current.key,
      leaseKey: "occurrence-a",
    })) plays += 1;
  };
  const pending = setup();
  current.enabled = false;
  current.key = null;
  release();
  await pending;
  assert.equal(plays, 0);
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
