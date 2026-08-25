import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  audioPreviewLeaseMatches,
  classifyAudioPlayRejection,
} from "./audioPreviewFailure.mjs";

test("browser audio play rejections ignore intentional load cancellation", () => {
  assert.equal(
    classifyAudioPlayRejection({ name: "AbortError", message: "play() was interrupted by load()" }),
    null,
  );
});

test("browser audio play rejections keep autoplay permission recoverable", () => {
  assert.deepEqual(
    classifyAudioPlayRejection({ name: "NotAllowedError", message: "User interaction is required" }),
    { kind: "permission" },
  );
});

test("browser audio play rejections classify unexpected failures as playback errors", () => {
  assert.deepEqual(
    classifyAudioPlayRejection({ name: "NotSupportedError", message: "Unsupported media" }),
    { kind: "playback" },
  );
  assert.deepEqual(classifyAudioPlayRejection(new Error("decoder failed")), { kind: "playback" });
});

test("browser audio callbacks require the exact active occurrence lease", () => {
  const element = {};
  const active = {
    element,
    mediaKey: "queue-entry:7",
    source: "https://cdn.example.test/preview.mp3",
    generation: 12,
  };

  assert.equal(audioPreviewLeaseMatches(active, { ...active }), true);
  assert.equal(
    audioPreviewLeaseMatches(active, { ...active, generation: 11 }),
    false,
    "a delayed rejection from the same URL and element must not cross a reload generation",
  );
  assert.equal(
    audioPreviewLeaseMatches(active, { ...active, mediaKey: "queue-entry:8" }),
    false,
    "adjacent occurrences of the same recording are distinct",
  );
  assert.equal(
    audioPreviewLeaseMatches(active, { ...active, source: "https://cdn.example.test/other.mp3" }),
    false,
  );
  assert.equal(audioPreviewLeaseMatches(active, { ...active, element: {} }), false);
  assert.equal(audioPreviewLeaseMatches(active, null), false);
  assert.equal(audioPreviewLeaseMatches(null, active), false);
});

test("PlayerBar scopes preview errors to both the occurrence and source", async () => {
  const source = await readFile(new URL("../components/PlayerBar.jsx", import.meta.url), "utf8");
  const start = source.indexOf("const currentAudioError");
  const end = source.indexOf("const currentYoutubeError", start);
  assert.ok(start >= 0 && end > start, "PlayerBar must keep a named current-audio error boundary");
  const boundary = source.slice(start, end);

  assert.match(boundary, /audio\.error\.mediaKey\s*===\s*resolutionKey/,
    "a stale error from another queue occurrence must be ignored");
  assert.match(boundary, /audio\.error\.source\s*===\s*previewSrc/,
    "a stale error from another preview URL must be ignored");
});
