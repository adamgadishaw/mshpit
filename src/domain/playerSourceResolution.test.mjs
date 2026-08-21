import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  directPlayerVideoId,
  embeddedPlayerPreview,
  initialPlayerSources,
  patchPlayerSources,
  shouldResolvePlayerYouTube,
} from "./playerSourceResolution.mjs";

test("stored player sources hydrate locally without a provider lookup", () => {
  const track = { videoId: "dQw4w9WgXcQ", preview: "https://cdn.example.test/preview.mp3" };
  assert.equal(directPlayerVideoId(track), "dQw4w9WgXcQ");
  assert.equal(embeddedPlayerPreview(track), track.preview);
  assert.deepEqual(initialPlayerSources({ key: "track:1", track }), {
    key: "track:1",
    videoId: "dQw4w9WgXcQ",
    preview: track.preview,
    youtubePending: false,
    previewPending: true,
  });
});

test("paused restored queues defer cold YouTube resolution until restore", () => {
  assert.equal(shouldResolvePlayerYouTube({ web: true, minimized: true }), false);
  assert.equal(shouldResolvePlayerYouTube({ web: true, minimized: false }), true);
  assert.equal(shouldResolvePlayerYouTube({ web: true, minimized: false, directVideoId: "dQw4w9WgXcQ" }), false);
  assert.equal(shouldResolvePlayerYouTube({ web: true, minimized: false, resolvedVideoId: "dQw4w9WgXcQ" }), false);
  assert.equal(shouldResolvePlayerYouTube({ web: false, minimized: false }), false);
});

test("late provider results cannot overwrite a newer track", () => {
  const current = initialPlayerSources({ key: "track:new", track: { title: "New" } });
  assert.equal(patchPlayerSources(current, "track:old", { videoId: "dQw4w9WgXcQ" }), current);
  assert.deepEqual(patchPlayerSources(current, "track:new", { preview: "https://cdn.example.test/new.mp3", previewPending: false }), {
    ...current,
    preview: "https://cdn.example.test/new.mp3",
    previewPending: false,
  });
});

test("PlayerBar publishes provider results independently instead of awaiting Promise.all", async () => {
  const source = await readFile(new URL("../components/PlayerBar.jsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /\[videoId, preview\]\s*=\s*await Promise\.all/);
  assert.match(source, /shouldResolvePlayerYouTube/);
});

test("the full-screen media viewer owns audio instead of overlapping PlayerBar", async () => {
  const source = await readFile(new URL("../../App.js", import.meta.url), "utf8");
  assert.match(source, /playerObscured\s*=\s*[^;]*!!nav\.photos/);
});
