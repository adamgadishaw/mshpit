import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  directPlayerVideoId,
  embeddedPlayerPreview,
  initialPlayerSources,
  patchPlayerSources,
  playerPlaybackFailure,
  playerProvidersSettled,
  playerSourcesUnavailable,
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
    youtubeStatus: null,
    youtubePending: false,
    youtubeSettled: true,
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

test("resolver state cannot cross accounts or verification scopes for the same track", () => {
  const accountB = initialPlayerSources({ key: '["account-b","verified","track:same"]', track: { title: "Same" } });
  assert.equal(
    patchPlayerSources(accountB, '["account-a","unverified","track:same"]', {
      youtubeStatus: "search_login_required",
      youtubeSettled: true,
    }),
    accountB,
  );
});

test("a cold track is unavailable only after both providers settle empty", () => {
  const cold = initialPlayerSources({ key: "track:new", track: { title: "New" } });
  const unavailable = (sources, extra = {}) => playerSourcesUnavailable({
    forCurrentTrack: true,
    youtubeActive: false,
    youtubeConnecting: false,
    preview: sources.preview,
    youtubePending: sources.youtubePending,
    youtubeRequired: true,
    youtubeSettled: sources.youtubeSettled,
    previewPending: sources.previewPending,
    ...extra,
  });

  assert.equal(unavailable(cold), false, "the initial preview lookup is still pending");
  assert.equal(unavailable({ ...cold, youtubePending: true }), false, "both providers are still pending");
  assert.equal(unavailable({ ...cold, previewPending: false, youtubePending: true }), false, "YouTube is still pending");
  assert.equal(unavailable({ ...cold, previewPending: false, youtubePending: false }), false, "a deferred YouTube lookup has not settled");
  assert.equal(unavailable({ ...cold, previewPending: false, youtubePending: false, youtubeSettled: true }), true, "both providers settled without a source");
  assert.equal(unavailable({ ...cold, previewPending: false, youtubePending: false, youtubeSettled: true, preview: "https://cdn.example.test/new.mp3" }), false);
  assert.equal(unavailable({ ...cold, previewPending: false, youtubePending: false, youtubeSettled: true }, { youtubeConnecting: true }), false);
  assert.equal(unavailable({ ...cold, previewPending: false, youtubePending: false, youtubeSettled: true }, { youtubeActive: true }), false);
  assert.equal(unavailable({ ...cold, previewPending: false, youtubePending: false, youtubeSettled: true }, { forCurrentTrack: false }), false);
  assert.equal(unavailable({ ...cold, previewPending: false }, { youtubeRequired: false }), true, "native preview-only playback settles without YouTube");
});

test("a minimized restored cold track waits for its deferred YouTube attempt", () => {
  const restored = {
    ...initialPlayerSources({ key: "track:restored", track: { title: "Restored" } }),
    previewPending: false,
  };
  const state = (sources) => playerSourcesUnavailable({
    forCurrentTrack: true,
    youtubeActive: false,
    youtubeConnecting: false,
    preview: sources.preview,
    youtubePending: sources.youtubePending,
    youtubeRequired: true,
    youtubeSettled: sources.youtubeSettled,
    previewPending: sources.previewPending,
  });

  assert.equal(state(restored), false, "minimized restore deferred YouTube and is not terminal");
  assert.equal(state({ ...restored, youtubePending: true }), false, "restoring started the lookup");
  assert.equal(state({ ...restored, youtubeSettled: true }), true, "the restored lookup settled empty");
});

test("a failed preview waits for the still-viable YouTube engine", () => {
  const pending = playerProvidersSettled({
    web: true,
    youtubeSettled: false,
    youtubePending: true,
    youtubeConnecting: false,
    previewPending: false,
  });
  assert.equal(pending, false);
  assert.equal(playerPlaybackFailure({ providersSettled: pending, audioErrorKind: "playback" }), null);

  const youtubeSucceeded = playerProvidersSettled({
    web: true,
    youtubeSettled: true,
    youtubePending: false,
    youtubeConnecting: false,
    previewPending: false,
  });
  assert.equal(youtubeSucceeded, true);
  assert.equal(playerPlaybackFailure({ providersSettled: youtubeSucceeded }), null, "a later YouTube success suppresses the obsolete preview error");
});

test("terminal and native engine failures preserve PIT media reporting semantics", () => {
  assert.deepEqual(playerPlaybackFailure({ providersSettled: true, audioErrorKind: "playback" }), {
    kind: "playback",
    source: "audio-preview",
    toast: true,
  });
  assert.deepEqual(playerPlaybackFailure({ providersSettled: true, youtubeErrorKind: "embed" }), {
    kind: "embed",
    source: "youtube-player",
    toast: false,
  });
  assert.deepEqual(playerPlaybackFailure({ providersSettled: true, unavailable: true }), {
    kind: "unavailable",
    source: "youtube-player",
    toast: true,
  });
  assert.equal(playerPlaybackFailure({ providersSettled: true, unavailable: true, resolverNotice: { kind: "sign_in" } }), null);
  assert.equal(playerProvidersSettled({ web: false, previewPending: false }), true, "native has no deferred YouTube provider");
});

test("PlayerBar publishes provider results independently instead of awaiting Promise.all", async () => {
  const source = await readFile(new URL("../components/PlayerBar.jsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /\[videoId, preview\]\s*=\s*await Promise\.all/);
  assert.match(source, /shouldResolvePlayerYouTube/);
  assert.match(source, /playerSourcesUnavailable\(\{[\s\S]*youtubePending:\s*resolved\.youtubePending,[\s\S]*previewPending:\s*resolved\.previewPending/);
});

test("the full-screen media viewer owns audio instead of overlapping PlayerBar", async () => {
  const source = await readFile(new URL("../../App.js", import.meta.url), "utf8");
  assert.match(source, /playerObscured\s*=\s*[^;]*!!nav\.photos/);
});
