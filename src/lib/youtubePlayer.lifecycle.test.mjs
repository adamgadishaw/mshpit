import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  createYouTubePlayerLoadLease,
  createYouTubePlayerDisposer,
  youtubePlayerCanReceiveCommands,
  youtubePlayerEventBelongsToLoad,
  youtubeVideoIdFromPlayer,
} from "../domain/youtubePlayerLifecycle.mjs";

test("player commands require a ready generation with an attached host and iframe", () => {
  const iframe = { isConnected: true };
  const player = { getIframe: () => iframe };
  const host = { isConnected: true, contains: (node) => node === iframe };
  assert.equal(youtubePlayerCanReceiveCommands({ ready: true, host, player }), true);
  assert.equal(youtubePlayerCanReceiveCommands({ ready: false, host, player }), false);
  assert.equal(youtubePlayerCanReceiveCommands({ ready: true, host: { isConnected: false }, player }), false);
  assert.equal(youtubePlayerCanReceiveCommands({ ready: true, host, player: { getIframe: () => ({ isConnected: false }) } }), false);
  assert.equal(youtubePlayerCanReceiveCommands({ ready: true, host, player: {} }), false);
  assert.equal(youtubePlayerCanReceiveCommands({
    ready: true,
    host: { isConnected: true, contains: () => false },
    player,
  }), false, "a connected iframe stranded outside the current host is stale");
});

test("the iframe lifecycle teardown is idempotent and destroys detached players once", async () => {
  let pauses = 0;
  let destroys = 0;
  let removes = 0;
  const dispose = createYouTubePlayerDisposer();
  const owned = {
    player: {
      pauseVideo: () => { pauses += 1; },
      destroy: () => { destroys += 1; },
    },
    mount: { isConnected: false, remove: () => { removes += 1; } },
  };
  assert.equal(dispose(owned), true);
  assert.equal(dispose(owned), false);
  assert.deepEqual({ pauses, destroys, removes }, { pauses: 1, destroys: 1, removes: 1 });

  const source = await readFile(new URL("./youtubePlayer.js", import.meta.url), "utf8");
  assert.match(source, /useLayoutEffect\(\(\) => \{/);
  assert.match(source, /readyRef\.current = false;[\s\S]*disposePlayer\(\{ player: ownedPlayer, mount: ownedMount \}\)/);
});

test("rapid A to B loads reject late errors and state from A", () => {
  const player = {
    getVideoUrl: () => "https://www.youtube.com/watch?v=BBBBBBBBBBB",
  };
  const loadB = { token: 2, videoId: "BBBBBBBBBBB", mediaKey: "track:b" };
  assert.equal(youtubeVideoIdFromPlayer(player), "BBBBBBBBBBB");
  assert.equal(youtubePlayerEventBelongsToLoad({ event: { target: player, data: 1 }, player, load: loadB }), true);

  player.getVideoUrl = () => "https://youtu.be/AAAAAAAAAAA";
  assert.equal(
    youtubePlayerEventBelongsToLoad({ event: { target: player, data: 100 }, player, load: loadB }),
    false,
    "track A must not invalidate or advance track B",
  );
  assert.equal(
    youtubePlayerEventBelongsToLoad({ event: { target: { getVideoUrl: () => "https://youtu.be/BBBBBBBBBBB" } }, player, load: loadB }),
    false,
    "a callback from a destroyed iframe generation is stale even when the ID matches",
  );
  assert.equal(
    youtubePlayerEventBelongsToLoad({ event: { target: { getVideoUrl: () => "" } }, player, load: loadB }),
    false,
    "a destroyed A generation stays stale when its URL is empty",
  );
  player.getVideoUrl = () => "";
  assert.equal(youtubePlayerEventBelongsToLoad({ event: { target: player, data: 1 }, player, load: loadB }), true);
});

test("an error without a loaded URL remains attributable to its active load lease", () => {
  const player = { getVideoUrl: () => "" };
  const load = { token: 7, videoId: "CCCCCCCCCCC", mediaKey: "track:c" };
  assert.equal(youtubePlayerEventBelongsToLoad({ event: { target: player, data: 101 }, player, load }), true);
});

test("fresh iframe loads accept browser event variance while in-place reloads require a boundary", () => {
  const first = createYouTubePlayerLoadLease({ token: 1, videoId: "AAAAAAAAAAA", mediaKey: "a", loadNumber: 1 });
  const reload = createYouTubePlayerLoadLease({ token: 2, videoId: "AAAAAAAAAAA", mediaKey: "a", loadNumber: 2 });
  assert.equal(first.armed, true, "current-generation PLAYING/errors may arrive before -1/5");
  assert.equal(reload.armed, false, "same-generation reload callbacks wait for their own boundary");
});

test("iframe failures carry the active media identity", async () => {
  const source = await readFile(new URL("./youtubePlayer.js", import.meta.url), "utf8");
  assert.match(source, /mediaKeyRef\.current = mediaKey/);
  assert.match(source, /youtubePlayerEventBelongsToLoad\(\{ event, player, load: activeLoad \}\)/);
  assert.match(source, /event\.data === 0 && activeLoad\.started && !activeLoad\.ended/);
  assert.match(source, /\[enabled, hostId, mediaKey, engineGeneration\]/, "account or track media identity must rebuild the iframe generation");
  const bar = await readFile(new URL("../components/PlayerBar.jsx", import.meta.url), "utf8");
  assert.match(bar, /ytStateForThis = yt\.state\.mediaKey === resolutionKey && yt\.state\.videoId === resolved\.videoId/);
  assert.match(bar, /ytActive && ytStateForThis && yt\.state\.playing/);
  const errorWrites = source.match(/setError\(\{ kind: [^\n]+/g) || [];
  assert.ok(errorWrites.length >= 5);
  assert.ok(errorWrites.every((line) => line.includes("mediaKey:")), "every iframe error must be scoped to its track/account generation");
});

test("minimize keeps one keyed iframe host mounted and only gates visibility", async () => {
  const source = await readFile(new URL("../components/PlayerBar.jsx", import.meta.url), "utf8");
  assert.match(source, /useYouTubePlayer\(web && !!cur && !!resolved\.videoId, \{ hostId: youtubeHostId, mediaKey: resolutionKey \}\)/);
  assert.doesNotMatch(source, /useYouTubePlayer\([^\n]*!minimized/);
  assert.match(source, /compactStageCollapsed = minimized \|\|/);
  assert.ok((source.match(/\{web && mediaSurface\}/g) || []).length >= 3, "expanded and minimized shells must all retain the keyed surface");
  assert.match(source, /yt\.setVisible\(ytActive && showVideo && !minimized && !obscured\)/);
  assert.doesNotMatch(source, /if \(minimized\) sigRef\.current = ""/, "restore must not force an in-place reload");
  assert.match(source, /wasMinimized[\s\S]*yt\.seek\(restoreMs\)[\s\S]*yt\.play\(\)/);
});

test("adjacent duplicate occurrences restart and stale ENDED cannot advance the new index", async () => {
  const hook = await readFile(new URL("./youtubePlayer.js", import.meta.url), "utf8");
  const webPreview = await readFile(new URL("./audioPreview.js", import.meta.url), "utf8");
  const nativePreview = await readFile(new URL("./audioPreview.native.js", import.meta.url), "utf8");
  const bar = await readFile(new URL("../components/PlayerBar.jsx", import.meta.url), "utf8");
  assert.match(bar, /playerResolutionKey\(\{ track: cur, user: session \}\)/,
    "the stable queue-entry occurrence must participate in the iframe media generation");
  assert.match(bar, /recordedKeyRef\.current === resolutionKey/,
    "history start dedupe is occurrence-scoped instead of recording-scoped");
  assert.match(hook, /endedCbRef\.current\?\.\(\{ mediaKey: activeLoad\.mediaKey, videoId: activeLoad\.videoId \}\)/,
    "ENDED must identify the load lease that emitted it");
  assert.match(bar, /youtubeEndedCursorRef\.current = \{ resolutionKey, videoId: resolved\.videoId, hasNext, index, onIndex \}/,
    "queue reorders must update the committed occurrence cursor used by auto-advance");
  assert.match(bar, /ended\?\.mediaKey !== current\?\.resolutionKey \|\| ended\?\.videoId !== current\?\.videoId/,
    "a stale occurrence callback cannot advance the current queue index");
  assert.match(bar, /useAudioPreview\(previewSrc, \{[\s\S]*mediaKey: resolutionKey,[\s\S]*started\?\.mediaKey === resolutionKey/,
    "preview starts and history writes must use the same occurrence boundary");
  assert.match(webPreview, /\[src, enabled, mediaKey\]/,
    "web audio must reload an identical URI for occurrence two");
  assert.match(webPreview, /const lease = \{[\s\S]*mediaKey,[\s\S]*source: src \|\| null,[\s\S]*generation: \+\+loadGenerationRef\.current/,
    "web audio callbacks must capture an immutable source and occurrence lease");
  assert.match(webPreview, /\[enabled, mediaKey, src\]/,
    "web audio must detach the prior source occurrence's delayed event listeners");
  assert.match(webPreview, /audioPreviewLeaseMatches\(activeLoadRef\.current, lease\)/,
    "a delayed play rejection cannot write into the next load generation's state");
  assert.match(nativePreview, /playbackKey = sourceKey \? JSON\.stringify\(\[sourceKey, String\(mediaKey \|\| ""\)\]\)/,
    "native audio load/start/completion keys must include the queue occurrence");
  assert.match(nativePreview, /await player\.seekTo\(0\)/,
    "native occurrence two must rewind an unchanged expo-audio source");
  assert.match(nativePreview, /preparedKeyRef\.current !== playbackKey/,
    "native occurrence two cannot arm from occurrence one's stale PLAYING status");
  assert.match(nativePreview, /status\?\.didJustFinish \|\| !status\?\.playing/,
    "the native PLAYING boundary must first observe that the prior finish cleared");
  assert.match(nativePreview, /nativeAudioCompletion\(status, playbackKey, endedKeyRef\.current, startedKeyRef\.current\)/,
    "native completion stays disarmed until the current occurrence actually starts");
  assert.match(nativePreview, /await configureNativeAudioMode\(\);\s*if \(!leaseIsCurrent\(\)\) return;/,
    "deferred native setup must recheck the latest visibility/occurrence lease");
  assert.match(bar, /enabled: !ytActive && !minimized && !obscured/,
    "hidden preview engines must not autoplay while minimized or obscured");
});

test("late API resolution and ready callbacks are fenced by lifecycle generation", async () => {
  const source = await readFile(new URL("./youtubePlayer.js", import.meta.url), "utf8");
  assert.match(source, /const lifecycle = \+\+lifecycleRef\.current/);
  assert.match(source, /const isCurrent = \(\) => !cancelled && lifecycleRef\.current === lifecycle/);
  assert.match(source, /loadYouTubeIframeApi\(\)\.then\(\(YT\) => \{\s*if \(!isCurrent\(\)\) return/);
  assert.match(source, /onReady: \(\) => \{[\s\S]*if \(!isCurrent\(\) \|\| initializationFailed\) return/);
});

test("autoplay blocking stays recoverable through the visible Play control", async () => {
  const hook = await readFile(new URL("./youtubePlayer.js", import.meta.url), "utf8");
  const bar = await readFile(new URL("../components/PlayerBar.jsx", import.meta.url), "utf8");
  assert.match(hook, /onAutoplayBlocked:/);
  assert.match(hook, /kind: "autoplay"/);
  assert.match(bar, /const autoplayBlocked = ytErrorForThis\?\.kind === "autoplay"/);
  assert.match(bar, /const ytFailed = !autoplayBlocked &&/,
    "retry exhaustion must never turn a recoverable autoplay block into a failed video");
  assert.match(bar, /!terminalYt && !autoplayBlocked/);
  assert.match(bar, /autoplayBlocked \? ytErrorForThis\.message/);
  assert.match(bar, /accessibilityLiveRegion="polite">\{statusLine\}/);
});

test("persistent media engines publish progress at a bounded frequency", async () => {
  const youtube = await readFile(new URL("./youtubePlayer.js", import.meta.url), "utf8");
  const webPreview = await readFile(new URL("./audioPreview.js", import.meta.url), "utf8");
  const nativePreview = await readFile(new URL("./audioPreview.native.js", import.meta.url), "utf8");

  assert.match(youtube, /PROGRESS_UPDATE_INTERVAL_MS = 1_000/);
  assert.match(youtube, /if \(!shownRef\.current\) return;/,
    "a retained minimized iframe must not keep publishing an unchanged clock");
  assert.match(youtube, /current\.position === next\.position[\s\S]*\? current\s*: next/,
    "paused progress snapshots must preserve state identity and skip React renders");
  assert.match(webPreview, />= 0\.95/);
  assert.match(nativePreview, /updateInterval: 1_000/);
});

test("invalid YouTube ids are evicted while client-identity errors stay local", async () => {
  const bar = await readFile(new URL("../components/PlayerBar.jsx", import.meta.url), "utf8");
  assert.match(bar, /\[2, 100, 101, 150\]\.includes/);
  assert.doesNotMatch(bar, /\[2, 100, 101, 150, 153\]\.includes/,
    "error 153 can be caused by one listener's privacy settings and must not poison the shared cache");
});

test("intentional YouTube lookup cancellation never becomes a cached miss", async () => {
  const store = await readFile(new URL("../store.js", import.meta.url), "utf8");
  const resolver = store.slice(store.indexOf("const resolveYouTube = async"), store.indexOf("const youtubeLookupStatus"));
  const cancellationFence = resolver.indexOf("if (isLoadCancellation(error, signal)) throw error;");
  const failureClassification = resolver.indexOf("outcome = classifyResolve({ error });");
  const cacheWrite = resolver.indexOf("ytCache.current[k] = {");
  assert.ok(cancellationFence >= 0, "player teardown and track changes must bypass failure caching");
  assert.ok(failureClassification > cancellationFence);
  assert.ok(cacheWrite > failureClassification);
});
