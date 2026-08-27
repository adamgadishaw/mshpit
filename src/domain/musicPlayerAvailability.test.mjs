import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  MUSIC_PLAYER_ENABLED,
  isDisabledMusicPlayerApiRequest,
  isMusicPlayerNavigationFrame,
  sanitizeDisabledMusicPlayerNavigationFrame,
} from "./musicPlayerAvailability.mjs";

const source = (relative) => readFile(new URL(relative, import.meta.url), "utf8");

function guardedFunctionHead(text, declaration, size = 700) {
  const start = text.indexOf(declaration);
  assert.notEqual(start, -1, `missing ${declaration}`);
  return text.slice(start, start + size);
}

test("the built-in music player is paused at the shared product boundary", () => {
  assert.equal(MUSIC_PLAYER_ENABLED, false);

  assert.equal(isMusicPlayerNavigationFrame({ listeningHistory: true }), true);
  assert.equal(isMusicPlayerNavigationFrame({ addToPlaylist: { title: "Song" } }), true);
  assert.equal(isMusicPlayerNavigationFrame({ profileId: "u_1" }), false);

  assert.deepEqual(sanitizeDisabledMusicPlayerNavigationFrame({ listeningHistory: true }), {});
  assert.deepEqual(sanitizeDisabledMusicPlayerNavigationFrame({
    artistName: "Beyonce",
    addToPlaylist: { title: "Song" },
  }), { artistName: "Beyonce" });
});

test("the paused request boundary blocks player APIs but never blocks uploaded media", () => {
  assert.equal(isDisabledMusicPlayerApiRequest("GET", "/api/me/plays?limit=50"), true);
  assert.equal(isDisabledMusicPlayerApiRequest("POST", "/api/plays"), true);
  assert.equal(isDisabledMusicPlayerApiRequest("GET", "/api/plays/friends"), true);
  assert.equal(isDisabledMusicPlayerApiRequest("GET", "/api/deezer/track?title=Song"), true);
  assert.equal(isDisabledMusicPlayerApiRequest("POST", "/api/youtube/track/resolve"), true);
  assert.equal(isDisabledMusicPlayerApiRequest("GET", "/api/users/u_1/playlists"), true);
  assert.equal(isDisabledMusicPlayerApiRequest("PATCH", "/api/playlists/pl_1"), true);

  assert.equal(isDisabledMusicPlayerApiRequest("POST", "/api/media/assets"), false);
  assert.equal(isDisabledMusicPlayerApiRequest("POST", "/api/media/assets/ma_1/finalize"), false);
  assert.equal(isDisabledMusicPlayerApiRequest("POST", "/api/posts"), false);
  assert.equal(isDisabledMusicPlayerApiRequest("GET", "/api/posts/p_1"), false);
});

test("the initial App shell cannot eagerly load, mount, or preload PlayerBar", async () => {
  const app = await source("../../App.js");

  assert.doesNotMatch(app, /import\s+PlayerBar\s+from/);
  assert.match(app, /const PlayerBar = lazyWithRetry\(\(\) => import\("\.\/src\/components\/PlayerBar"\), "PlayerBar"\);/);
  assert.doesNotMatch(app, /PlayerBar\.preload/);
  assert.match(
    app,
    /\{MUSIC_PLAYER_ENABLED && \(wide \|\| \(player[\s\S]*?<Suspense fallback=\{null\}>[\s\S]*?<PlayerBar/,
  );
  assert.doesNotMatch(app, /\{\(wide \|\| \(player[\s\S]*?<PlayerBar/);
});

test("stale player routes are sanitized on restore, push, and replace", async () => {
  const app = await source("../../App.js");

  assert.match(app, /const sanitized = sanitizeDisabledMusicPlayerNavigationFrame\(prepared\);/);
  assert.match(app, /isMusicPlayerNavigationFrame\(prepared\)[\s\S]*?return null;/);
  assert.match(app, /const top = prepareAvailableNavigationFrame\(saved\[saved\.length - 1\]\);/);
  assert.match(app, /const commitGo = \(candidate\) => \{\s*const frame = prepareAvailableNavigationFrame\(candidate\);\s*if \(!frame\) return;/);
  assert.match(app, /const commitReplace = \(candidate\) => \{\s*const frame = prepareAvailableNavigationFrame\(candidate\);\s*if \(!frame\) return;/);
  assert.match(app, /else if \(MUSIC_PLAYER_ENABLED && nav\.addToPlaylist\)/);
  assert.match(app, /else if \(MUSIC_PLAYER_ENABLED && nav\.listeningHistory\)/);
});

test("regular screens receive no playback, playlist, or listening-history actions while paused", async () => {
  const app = await source("../../App.js");

  assert.match(app, /const musicPlayerAction = MUSIC_PLAYER_ENABLED \? openPlayer : undefined;/);
  assert.match(app, /const musicPreviewAction = MUSIC_PLAYER_ENABLED \? showPreview : undefined;/);
  assert.match(app, /const musicPlaylistAction = MUSIC_PLAYER_ENABLED \? openAddToPlaylist : undefined;/);
  assert.match(app, /const musicListeningHistoryAction = MUSIC_PLAYER_ENABLED \? \(\) => go\(\{ listeningHistory: true \}\) : undefined;/);
  assert.doesNotMatch(app, /onPlay=\{openPlayer\}|onPlayTrack=\{openPlayer\}/);
  assert.doesNotMatch(app, /onAddToPlaylist=\{openAddToPlaylist\}/);
  assert.doesNotMatch(app, /onListeningHistory=\{\(\) =>/);
});

test("pausing preserves saved player state while background player work stays dormant", async () => {
  const [app, store] = await Promise.all([
    source("../../App.js"),
    source("../store.js"),
  ]);

  assert.match(app, /player: MUSIC_PLAYER_ENABLED && web && session\?\.id/);
  assert.match(
    app,
    /useEffect\(\(\) => \{\s*if \(!MUSIC_PLAYER_ENABLED\) return;\s*if \(!web \|\| !authReady \|\| !playerStateIsScoped\) return;[\s\S]*?PLAYER_STATE_STORAGE_KEY/,
  );

  assert.match(store, /useEffect\(\(\) => \{\s*if \(!MUSIC_PLAYER_ENABLED\) return;\s*loadMyPlaylists\(\);/);
  assert.match(store, /if \(MUSIC_PLAYER_ENABLED && accountId\) loadPlayHistory/);
  assert.match(store, /useState\(MUSIC_PLAYER_ENABLED && session \? "loading" : "ready"\)/);

  for (const [declaration, result] of [
    ["const resolveYouTube = async", "return null"],
    ["const invalidateYouTube = async", "paused: true"],
    ["const resolveDeezerPreview = async", "return null"],
    ["const recordPlay =", "return"],
    ["const loadPlayHistory = async", "playHistoryStorageKey"],
    ["const loadFriendsListeningStrict = async", "return []"],
    ["const userPlaylists = async", "return []"],
    ["const loadMyPlaylists = async", "scopedMyPlaylists"],
    ["const loadPlaylist = async", "return null"],
    ["const createPlaylist = async", "return null"],
    ["const addToPlaylist = async", "return false"],
    ["const updatePlaylist = async", "return null"],
    ["const deletePlaylist = async", "return false"],
    ["const saveQueueAsPlaylist = async", "return null"],
  ]) {
    const head = guardedFunctionHead(store, declaration);
    assert.match(head, /if \(!MUSIC_PLAYER_ENABLED\)/, `${declaration} must stop at the shared gate`);
    assert.ok(head.includes(result), `${declaration} must return its dormant result before provider work`);
  }
});
