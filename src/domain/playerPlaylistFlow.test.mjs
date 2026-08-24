import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const player = readFileSync(new URL("../components/PlayerBar.jsx", import.meta.url), "utf8");
const store = readFileSync(new URL("../store.js", import.meta.url), "utf8");

test("player playlist actions name the single-track and whole-queue jobs clearly", () => {
  assert.match(player, />Add song<\/Text>/);
  assert.match(player, />\{saved \? "Saved" : saving \? "Saving" : "Save queue"\}<\/Text>/);
  assert.doesNotMatch(player, />Save mix<\/Text>|>Save session<\/Text>|>Playlist<\/Text>/);
});

test("one-tap queue saving creates one private playlist without duplicate snapshot state", () => {
  assert.match(player, /Save current queue as a private playlist/);
  assert.match(player, /const canSaveQueue = !!session && typeof onSaveQueueAsPlaylist === "function"/);
  assert.ok((player.match(/\{canSaveQueue &&/g) || []).length >= 3, "every queue-save surface must be signed-in only");
  assert.match(store, /const saveQueueAsPlaylist = async \(tracks, name\) => \{\s+if \(!session\) return null/);
  assert.match(store, /createPlaylist\(playlistName, list, "private"\)/);
  assert.doesNotMatch(store, /const \[snapshots|setSnapshots|removeSnapshot|saveSnapshot/);
});
