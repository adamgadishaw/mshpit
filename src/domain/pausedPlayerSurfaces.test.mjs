import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = (relativePath) => readFileSync(new URL(relativePath, import.meta.url), "utf8");

test("ordinary and staff surfaces expose no paused-player workspace copy", () => {
  const ordinarySources = [
    source("../screens/YouScreen.jsx"),
    source("../screens/SettingsScreen.jsx"),
    source("../screens/ProfileScreen.jsx"),
    source("../screens/EditProfileScreen.jsx"),
    source("../screens/ArtistHubScreen.jsx"),
    source("../components/discover/DiscoverCommunity.jsx"),
  ].join("\n");
  assert.doesNotMatch(ordinarySources, /listening history|private listening|your sound|now playing|music spotlight|friends listening/i);

  const staffSources = [
    source("../screens/AdminScreen.jsx"),
    source("../components/moderation/ModerationConsole.jsx"),
  ].join("\n");
  assert.doesNotMatch(staffSources, /playback lookup|playback workflow|open song reports|onOpenSongs|activeTab === "songs"/i);
});

test("the composer hides playlist controls but preserves dormant draft data", () => {
  const composer = source("../screens/LogScreen.jsx");
  assert.match(composer, /playlist: preservedPlaylist/);
  assert.match(composer, /setPreservedPlaylist\(restored\.playlist\)/);
  assert.doesNotMatch(composer, /playlistId|PlaylistAttachment|setShowPlaylist|Attach playlist/i);
  assert.doesNotMatch(composer, /Pit plays/i);
});

test("status edits omit hidden playlist fields while preserving explicit changes", () => {
  const store = source("../store.js");
  const statusEdit = store.match(/if \(\(previous\.kind \|\| changes\.kind\) === "status"\)[\s\S]*?feedMutationRevisionRef\.current \+= 1;/)?.[0] || "";
  assert.match(statusEdit, /hasOwnProperty\.call\(changes, "playlistId"\)/);
  assert.match(statusEdit, /hasOwnProperty\.call\(changes, "playlist"\)/);
  assert.match(statusEdit, /\.\.\.\(hasPlaylistChange \? \{ playlistId \} : \{\}\)/);
  assert.match(statusEdit, /effectivePlaylistId = hasPlaylistChange \? playlistId : previous\.playlist\?\.id \?\? previous\.playlistId \?\? null/);
  assert.doesNotMatch(statusEdit, /^\s*playlistId,\s*$/m);
});

test("stale player-only screens render nothing", () => {
  for (const path of ["../screens/ListeningHistoryScreen.jsx", "../screens/PlaylistPickerScreen.jsx"]) {
    const screen = source(path);
    assert.match(screen, /return null;/);
    assert.doesNotMatch(screen, /listening history|add to playlist|build playlists|playback/i);
  }
});

test("favorite-artist verification uses the neutral artist-picks intent", () => {
  const app = source("../../App.js");
  assert.match(app, /setVerificationPrompt\("artistPicks"\)/);
  assert.doesNotMatch(app, /setVerificationPrompt\("playlist"\)/);
});
