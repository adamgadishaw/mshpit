import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { ENABLE_MUSIC_PLAYER } from "../config/runtime.mjs";

test("the unstable built-in music player is paused at one product gate", async () => {
  assert.equal(ENABLE_MUSIC_PLAYER, false);

  const app = await readFile(new URL("../../App.js", import.meta.url), "utf8");
  assert.match(app, /player:\s*ENABLE_MUSIC_PLAYER\s*&&\s*web\s*&&\s*session\?\.id/);
  assert.match(app, /const openPlayer = \(media, queue\) => \{\s*if \(!ENABLE_MUSIC_PLAYER\) return;/);
  assert.match(app, /const musicPlayerAction = ENABLE_MUSIC_PLAYER \? openPlayer : undefined;/);
  assert.match(app, /\{ENABLE_MUSIC_PLAYER && \(wide \|\| \(player/);
  assert.doesNotMatch(app, /onPlay=\{openPlayer\}|onPlayTrack=\{openPlayer\}/);
});

test("pausing the player leaves the saved queue envelope untouched", async () => {
  const app = await readFile(new URL("../../App.js", import.meta.url), "utf8");
  assert.match(
    app,
    /useEffect\(\(\) => \{\s*if \(!ENABLE_MUSIC_PLAYER\) return;\s*if \(!web \|\| !authReady \|\| !playerStateIsScoped\) return;[\s\S]*?PLAYER_STATE_STORAGE_KEY/,
  );
});
test("visible playback affordances become static while media and music data stay visible", async () => {
  const [app, hub, search, discover, profile, history, you, show, song, playlist, ticket] = await Promise.all([
    "../../App.js",
    "../screens/ArtistHubScreen.jsx",
    "../screens/SearchScreen.jsx",
    "../screens/DiscoverScreen.jsx",
    "../screens/ProfileScreen.jsx",
    "../screens/ListeningHistoryScreen.jsx",
    "../screens/YouScreen.jsx",
    "../screens/ShowScreen.jsx",
    "../components/SongAttachment.jsx",
    "../components/PlaylistAttachment.jsx",
    "../components/TicketStub.jsx",
  ].map((relative) => readFile(new URL(relative, import.meta.url), "utf8")));

  assert.match(app, /const musicPreviewAction = ENABLE_MUSIC_PLAYER \? showPreview : undefined;/);
  assert.doesNotMatch(app, /onPreview=\{showPreview\}/);
  assert.match(hub, /const SpotlightSurface = onPlay \? Pressable : View;/);
  assert.match(search, /onPress=\{onPlay \? \(\) => \{/);
  assert.match(discover, /onPlay=\{onPlay \? playArtistRow : undefined\}/);
  assert.match(profile, /const StaticOrPlayable = onPlay \? Pressable : View;/);
  assert.match(history, /const StaticOrPlayable = track && onPlay \? Pressable : View;/);
  assert.match(you, /const StaticOrPlayable = onPlay \? Pressable : View;/);
  assert.match(show, /\{onPreview && <Pressable style=\{styles\.previewBtn\}/);
  assert.match(song, /onPlay \? "WATCH ON PIT" : "SHARED TRACK"/);
  assert.match(playlist, /const StaticOrPlayable = onPlay \? Pressable : View;/);

  assert.match(ticket, /<PostMediaGrid media=\{statusMedia\}/, "uploaded post media remains available");
  assert.match(profile, /Linking\.openURL\(listenUrl\(user\.nowPlaying\)\)/, "external listen links remain available");
});