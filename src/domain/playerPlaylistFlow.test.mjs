import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { isDisabledMusicPlayerApiRequest, MUSIC_PLAYER_ENABLED } from "./musicPlayerAvailability.mjs";

const player = readFileSync(new URL("../components/PlayerBar.jsx", import.meta.url), "utf8");
const store = readFileSync(new URL("../store.js", import.meta.url), "utf8");

test("the dormant player chunk keeps future single-track and whole-queue labels distinct", () => {
  assert.equal(MUSIC_PLAYER_ENABLED, false);
  assert.match(player, />Add song<\/Text>/);
  assert.match(player, />\{saved \? "Saved" : saving \? "Saving" : "Save queue"\}<\/Text>/);
  assert.doesNotMatch(player, />Save mix<\/Text>|>Save session<\/Text>|>Playlist<\/Text>/);
});

test("queue saving remains private and account-scoped, but cannot run or send playlist traffic while paused", () => {
  assert.match(player, /Save current queue as a private playlist/);
  assert.match(player, /const canSaveQueue = !!session && typeof onSaveQueueAsPlaylist === "function"/);
  assert.ok((player.match(/\{canSaveQueue &&/g) || []).length >= 3, "every queue-save surface must be signed-in only");
  assert.match(store, /const saveQueueAsPlaylist = async \(tracks, name\) => \{\s+if \(!MUSIC_PLAYER_ENABLED\) return null;\s+if \(!session\) return null/);
  assert.match(store, /const createPlaylist = async \(name, tracks, visibility = "public"\) => \{\s+if \(!MUSIC_PLAYER_ENABLED\) return null;\s+const actor = sessionRef\.current;\s+if \(!actor\) return null/);
  assert.match(store, /const loadMyPlaylists = async \(\) => \{\s+if \(!MUSIC_PLAYER_ENABLED\) \{[\s\S]*?return scopedMyPlaylists;/);
  assert.match(store, /createPlaylist\(playlistName, list, "private"\)/);
  assert.doesNotMatch(store, /const \[snapshots|setSnapshots|removeSnapshot|saveSnapshot/);

  for (const [method, path] of [
    ["POST", "/api/playlists"],
    ["GET", "/api/users/u_1/playlists"],
    ["GET", "/api/playlists/pl_1"],
    ["PATCH", "/api/playlists/pl_1"],
    ["DELETE", "/api/playlists/pl_1"],
  ]) {
    assert.equal(isDisabledMusicPlayerApiRequest(method, path), true, method + " " + path);
  }
});
