import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  MUSIC_PLAYER_ENABLED,
  isDisabledMusicPlayerApiRequest,
  isMusicPlayerNavigationFrame,
  sanitizeDisabledMusicPlayerNavigationFrame,
} from "../src/domain/musicPlayerAvailability.mjs";
import { publicProfileCacheEntry } from "../src/domain/dataPolicy.mjs";
import { renderPublicPage } from "./publicPages.js";
import { publicUser } from "./db.js";

test("the shared pause policy rejects only built-in music-player navigation", () => {
  assert.equal(MUSIC_PLAYER_ENABLED, false);
  assert.equal(isMusicPlayerNavigationFrame({ listeningHistory: true }), true);
  assert.equal(isMusicPlayerNavigationFrame({ addToPlaylist: { title: "Song" } }), true);
  assert.equal(isMusicPlayerNavigationFrame({ logging: true, postMode: "status" }), false);
  assert.equal(isMusicPlayerNavigationFrame({ photos: { images: [] } }), false);

  assert.deepEqual(
    sanitizeDisabledMusicPlayerNavigationFrame({ artistName: "Test", listeningHistory: true }),
    { artistName: "Test" },
  );
  const uploadFrame = { logging: true, postMode: "status" };
  assert.equal(sanitizeDisabledMusicPlayerNavigationFrame(uploadFrame), uploadFrame);
});

test("the server policy conceals player routes without touching shared YouTube links or uploaded video", () => {
  const concealed = [
    ["GET", "/api/deezer/track"],
    ["GET", "/api/youtube/track"],
    ["POST", "/api/youtube/track/resolve"],
    ["POST", "/api/youtube/invalidate"],
    ["POST", "/api/plays"],
    ["GET", "/api/me/plays"],
    ["GET", "/api/plays/friends"],
    ["POST", "/api/playlists"],
    ["GET", "/api/users/u_1/playlists"],
    ["GET", "/api/playlists/pl_1"],
    ["PATCH", "/api/playlists/pl_1"],
    ["DELETE", "/api/playlists/pl_1"],
    ["GET", "/api/posts/post_1/playlist"],
    ["POST", "/api/tracks/report"],
  ];
  for (const [method, path] of concealed) {
    assert.equal(isDisabledMusicPlayerApiRequest(method, path), true, `${method} ${path}`);
  }
  assert.equal(isDisabledMusicPlayerApiRequest("GET", "/api/discover/chart", { by: "plays" }), true);
  assert.equal(isDisabledMusicPlayerApiRequest("GET", "/api/discover/overview", { by: "plays" }), true);

  const available = [
    ["GET", "/api/youtube/oembed?url=https%3A%2F%2Fyoutu.be%2Fexample"],
    ["POST", "/api/media/assets"],
    ["POST", "/api/media/assets/media_1/finalize"],
    ["PATCH", "/api/media/assets/media_1"],
    ["POST", "/api/media/assets/media_1/variants"],
    ["GET", "/api/songs/search"],
    ["GET", "/api/discover/chart"],
    ["POST", "/api/admin/tracks/override"],
    ["GET", "/api/admin/health"],
  ];
  for (const [method, path] of available) {
    assert.equal(isDisabledMusicPlayerApiRequest(method, path), false, `${method} ${path}`);
  }
});

test("the HTTP boundary returns a concealed 404 before disabled routes reach API dispatch", async () => {
  const source = await readFile(new URL("./index.js", import.meta.url), "utf8");
  const gate = source.indexOf("if (isDisabledMusicPlayerApiRequest(req.method, pathname, query))");
  const originCheck = source.indexOf("assertUnsafeRequestOrigin", gate);
  const routeMatch = source.indexOf("const match = matchRoute", gate);
  assert.ok(gate > 0);
  assert.ok(originCheck > gate, "the concealed response precedes mutation-origin details");
  assert.ok(routeMatch > gate, "disabled routes never reach the API table");
  assert.match(source.slice(gate, originCheck), /new ApiError\(404, "Not found\.", "NOT_FOUND"\)/);
  assert.match(source, /MUSIC_PLAYER_ENABLED \? " https:\/\/www\.youtube\.com https:\/\/s\.ytimg\.com" : ""/);
  assert.match(source, /MUSIC_PLAYER_ENABLED \? " https:\/\/www\.youtube\.com https:\/\/\*\.googlevideo\.com" : ""/);
  assert.match(source, /MUSIC_PLAYER_ENABLED \? " https:\/\/www\.youtube\.com https:\/\/www\.youtube-nocookie\.com" : ""/);
});

test("paused profile projections preserve stored extras without publishing them", () => {
  const musicExtras = {
    theme: "stage",
    analyticsOptOut: false,
    nowPlaying: { title: "Now", artist: "Artist" },
    treble: { title: "Top", artist: "Artist" },
    bass: { title: "Deep", artist: "Artist" },
    playlists: [{ id: "pl_1", name: "Saved", tracks: [{ title: "Song", artist: "Artist" }] }],
  };
  const projected = publicProfileCacheEntry({ id: "u_1", name: "Member", nowPlaying: musicExtras.nowPlaying });
  assert.equal(Object.hasOwn(projected, "nowPlaying"), false);

  const self = publicUser({
    id: "u_1", email: "member@example.test", name: "Member", handle: "member",
    role: "fan", verified: 0, sponsor: 0, artist_name: null, home_city: null,
    home_lat: null, home_lng: null, bio: "", avatar_uri: null, avatar_color: null,
    banner: null, initials: "M", genres: "[]", favorite_artists: "[]",
    extras: JSON.stringify(musicExtras), email_verified_at: null, marketing_opt_out: 0,
    marketing_consent_at: null, is_banned: 0, suspended_until: null,
  }, { self: true });
  assert.equal(self.theme, "stage");
  assert.equal(self.analyticsOptOut, false);
  for (const field of ["nowPlaying", "treble", "bass", "playlists"]) {
    assert.equal(Object.hasOwn(self, field), false, `${field} stays stored but leaves the profile response`);
  }
});

test("public policy copy describes link metadata without advertising dormant playback", async () => {
  const [publicIndex, listing] = await Promise.all([
    readFile(new URL("../public/index.html", import.meta.url), "utf8"),
    readFile(new URL("../APP_STORE_LISTING_DRAFT.md", import.meta.url), "utf8"),
  ]);
  const privacy = renderPublicPage("/privacy");
  const terms = renderPublicPage("/terms");

  assert.match(privacy, /YouTube links shared in posts/);
  assert.match(privacy, /YouTube(?:'|&#39;)s oEmbed service/);
  assert.match(privacy, /Music catalogue metadata/);
  assert.match(privacy, /does not receive a Deezer password or download or provide Deezer recordings/);
  assert.match(terms, /YouTube links in posts/);
  assert.match(terms, /does not download, host, or provide the underlying YouTube video/);
  assert.match(terms, /Music catalogue metadata/);

  const forbidden = /embedded YouTube player|YouTube playback|in-app music player|full[- ]track|preview audio|preview recording|playback milestone|listening history|music player is paused|community is listening/i;
  for (const [label, text] of [["privacy", privacy], ["terms", terms], ["public index", publicIndex], ["App Store draft", listing]]) {
    assert.doesNotMatch(text, forbidden, `${label} must not advertise paused player behavior`);
  }
});
