import assert from "node:assert/strict";
import test from "node:test";

import {
  PLAYLIST_VISIBILITY_OPTIONS,
  normalizePlaylistVisibility,
  playlistVisibilityOption,
} from "./playlistVisibility.mjs";

test("playlist creation exposes exactly the server-supported visibility choices", () => {
  assert.deepEqual(PLAYLIST_VISIBILITY_OPTIONS.map((option) => option.value), ["public", "unlisted", "private"]);
  assert.equal(new Set(PLAYLIST_VISIBILITY_OPTIONS.map((option) => option.description)).size, 3);
  assert.match(playlistVisibilityOption("public").description, /profile/i);
  assert.match(playlistVisibilityOption("unlisted").description, /link/i);
  assert.match(playlistVisibilityOption("private").description, /only you/i);
});

test("playlist visibility normalization is defensive and defaults to public", () => {
  assert.equal(normalizePlaylistVisibility("unlisted"), "unlisted");
  assert.equal(normalizePlaylistVisibility("private"), "private");
  assert.equal(normalizePlaylistVisibility("followers"), "public");
  assert.equal(normalizePlaylistVisibility(null, "private"), "private");
});
