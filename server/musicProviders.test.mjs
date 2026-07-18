import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

const dataDir = mkdtempSync(join(tmpdir(), "pit-music-providers-"));
process.env.PIT_DATA_DIR = dataDir;

const {
  mergeBundledArtist,
  stripEphemeralPreviews,
  db,
} = await import("./db.js");
const {
  invalidateYouTubeTrack,
  parseYouTubeVideoId,
  playbackUrlExpiry,
  resolveYouTubeTrack,
  scoreYouTubeCandidate,
  selectDeezerArtist,
  selectDeezerTrack,
  trackOverrideKey,
} = await import("./musicProviders.js");

after(() => {
  db.close();
  rmSync(dataDir, { recursive: true, force: true });
});

test("same-name Deezer artists prefer the established exact match or stored ID", () => {
  const small = { id: 67926762, name: "Drake", nb_fan: 22 };
  const canonical = { id: 246791, name: "Drake", nb_fan: 24_000_000 };
  assert.equal(selectDeezerArtist("Drake", [small, canonical]).artist.id, canonical.id);
  assert.equal(selectDeezerArtist("Drake", [canonical, small], small.id).artist.id, small.id);
  assert.equal(selectDeezerArtist("Drake", [{ id: 1, name: "Drake Tribute", nb_fan: 5000 }]), null);
});

test("artist migration removes URL previews without deleting durable song metadata", () => {
  const source = {
    name: "Artist",
    topTracks: [{ id: 1, title: "Song", preview: "https://cdn.example/preview.mp3?exp=1", album: "Record" }],
    albums: [{ title: "Record", tracks: [{ title: "Song", preview: null }] }],
  };
  assert.deepEqual(stripEphemeralPreviews(source), {
    name: "Artist",
    topTracks: [{ id: 1, title: "Song", album: "Record" }],
    albums: [{ title: "Record", tracks: [{ title: "Song", preview: null }] }],
  });
});

test("bundle merge fills gaps but keeps richer production identity and tracks", () => {
  const existing = {
    name: "Canonical Artist",
    genre: "R&B",
    photo: "https://media.example/current.jpg",
    bio: "Current bio",
    mbid: "mb-current",
    spotify_id: null,
    country: "Canada",
    formed: "2001",
    popularity: 91,
    rank_score: 91000,
    data: JSON.stringify({ name: "Canonical Artist", deezerId: 42, topTracks: [{ title: "Current song" }] }),
  };
  const merged = mergeBundledArtist(existing, { name: "Old Artist", genre: "Pop", photo: "old.jpg", topTracks: [{ title: "Old song" }], albums: [{ title: "Useful gap" }] });
  assert.equal(merged.name, "Canonical Artist");
  assert.equal(merged.genre, "R&B");
  assert.equal(merged.photo, "https://media.example/current.jpg");
  assert.equal(merged.deezerId, 42);
  assert.deepEqual(merged.topTracks, [{ title: "Current song" }]);
  assert.deepEqual(merged.albums, [{ title: "Useful gap" }]);
});

test("Deezer track matching rejects karaoke and mismatched artists", () => {
  const match = selectDeezerTrack("Road Trips", "Drake", [
    { title: "Road Trips Karaoke", artist: { name: "Backing Tracks" }, preview: "bad" },
    { title: "Road Trips", artist: { name: "Drake" }, preview: "good" },
  ]);
  assert.equal(match.track.preview, "good");
  assert.equal(selectDeezerTrack("Road Trips", "Drake", [{ title: "Road Trips", artist: { name: "Other Artist" } }]), null);
});

test("preview cache expiry never outlives the provider signature or five minutes", () => {
  const now = Date.parse("2026-07-15T12:00:00Z");
  const providerExpiry = Math.floor((now + 3 * 60_000) / 1000);
  assert.equal(playbackUrlExpiry(`https://preview.example/song.mp3?exp=${providerExpiry}`, now), now + 2 * 60_000);
  const farExpiry = Math.floor((now + 30 * 60_000) / 1000);
  assert.equal(playbackUrlExpiry(`https://preview.example/song.mp3?exp=${farExpiry}`, now), now + 5 * 60_000);
  assert.equal(playbackUrlExpiry("https://preview.example/no-exp.mp3", now), now);
});

function youtubeCandidate(id, title, channel, { embeddable = true, madeForKids = false, licensed = true, duration = "PT3M30S", views = "1000000" } = {}) {
  return {
    id,
    snippet: { title, channelTitle: channel },
    contentDetails: { duration, licensedContent: licensed },
    status: { embeddable, madeForKids, privacyStatus: "public" },
    statistics: { viewCount: views },
  };
}

test("YouTube scoring strongly prefers official music over lyrics/karaoke and rejects blocked embeds", () => {
  const official = scoreYouTubeCandidate(youtubeCandidate("official01", "Drake - Road Trips (Official Audio)", "Drake - Topic"), { title: "Road Trips", artist: "Drake", expectedDurationSec: 210 });
  const lyrics = scoreYouTubeCandidate(youtubeCandidate("lyrics0001", "Drake - Road Trips (Lyrics)", "Sound & Lyrics", { licensed: false }), { title: "Road Trips", artist: "Drake", expectedDurationSec: 210 });
  const karaoke = scoreYouTubeCandidate(youtubeCandidate("karaoke001", "Drake Road Trips Karaoke", "Karaoke Planet"), { title: "Road Trips", artist: "Drake" });
  const blocked = scoreYouTubeCandidate(youtubeCandidate("blocked001", "Drake - Road Trips", "Drake", { embeddable: false }), { title: "Road Trips", artist: "Drake" });
  const childDirected = scoreYouTubeCandidate(youtubeCandidate("forkids0001", "Drake - Road Trips", "Drake", { madeForKids: true }), { title: "Road Trips", artist: "Drake" });
  assert.ok(official.score > lyrics.score);
  assert.equal(official.rejected, false);
  assert.equal(karaoke.rejected, true);
  assert.equal(blocked.rejected, true);
  assert.equal(childDirected.rejected, true);
});

test("YouTube scoring gates on the artist and the song, not the title alone", () => {
  // A flawless title match by a completely different act is the classic
  // wrong-result: it must be rejected outright, never merely out-scored.
  const wrongArtist = scoreYouTubeCandidate(
    youtubeCandidate("wrongact001", "Espresso (Official Audio)", "Some Other Band"),
    { title: "Espresso", artist: "Sabrina Carpenter" },
  );
  assert.equal(wrongArtist.rejected, true);
  assert.deepEqual(wrongArtist.reasons, ["artist-mismatch"]);

  // Official/VEVO channels concatenate the name into one token, so plain token
  // coverage is 0 — the spaceless-substring rescue must still accept them.
  const vevo = scoreYouTubeCandidate(
    youtubeCandidate("vevo000001", "Sabrina Carpenter - Espresso (Official Video)", "SabrinaCarpenterVEVO"),
    { title: "Espresso", artist: "Sabrina Carpenter" },
  );
  assert.equal(vevo.rejected, false);

  // Right artist, wrong song is still the wrong result.
  const wrongSong = scoreYouTubeCandidate(
    youtubeCandidate("wrongsong01", "Sabrina Carpenter - Please Please Please (Official Audio)", "Sabrina Carpenter - Topic"),
    { title: "Espresso", artist: "Sabrina Carpenter" },
  );
  assert.equal(wrongSong.rejected, true);
  assert.deepEqual(wrongSong.reasons, ["title-mismatch"]);
});

test("YouTube resolver scores multiple candidates, caches finitely, and excludes iframe failures", async () => {
  let requests = 0;
  const searchItems = [
    { id: { videoId: "lyrics00001" } },
    { id: { videoId: "official001" } },
  ];
  const videos = [
    youtubeCandidate("lyrics00001", "Drake - Road Trips (Lyrics)", "Sound & Lyrics", { licensed: false }),
    youtubeCandidate("official001", "Drake - Road Trips (Official Audio)", "Drake - Topic"),
  ];
  const fetchImpl = async (url) => {
    requests++;
    const data = String(url).includes("/search?") ? { items: searchItems } : { items: videos.filter((item) => String(url).includes(item.id)) };
    return { ok: true, status: 200, json: async () => data };
  };

  const first = await resolveYouTubeTrack("Road Trips", "Drake", { apiKey: "test-key", expectedDurationSec: 210, fetchImpl });
  assert.equal(first.videoId, "official001");
  const afterFirst = requests;
  const cached = await resolveYouTubeTrack("Road Trips", "Drake", { apiKey: "test-key", expectedDurationSec: 210, fetchImpl });
  assert.equal(cached.videoId, "official001");
  assert.equal(requests, afterFirst);

  assert.equal(invalidateYouTubeTrack("Road Trips", "Drake", "official001").ok, true);
  const replacement = await resolveYouTubeTrack("Road Trips", "Drake", { apiKey: "test-key", expectedDurationSec: 210, fetchImpl });
  assert.notEqual(replacement.videoId, "official001");
});


test("track pins parse real YouTube link shapes and share one identity per song", () => {
  assert.equal(parseYouTubeVideoId("https://www.youtube.com/watch?v=dQw4w9WgXcQ"), "dQw4w9WgXcQ");
  assert.equal(parseYouTubeVideoId("youtu.be/dQw4w9WgXcQ?t=42"), "dQw4w9WgXcQ");
  assert.equal(parseYouTubeVideoId("https://m.youtube.com/shorts/dQw4w9WgXcQ"), "dQw4w9WgXcQ");
  assert.equal(parseYouTubeVideoId("dQw4w9WgXcQ"), "dQw4w9WgXcQ");
  assert.equal(parseYouTubeVideoId("https://example.com/watch?v=dQw4w9WgXcQ"), null, "non-YouTube hosts are rejected");
  assert.equal(parseYouTubeVideoId("https://www.youtube.com/watch?v=short"), null, "malformed ids are rejected");
  assert.equal(trackOverrideKey("BIRDS", "Turnstile"), trackOverrideKey("Birds ", " TURNSTILE"), "spelling variants share a key");
  assert.notEqual(trackOverrideKey("Birds", "Turnstile"), trackOverrideKey("Birds", "Koyo"), "different artists never collide");
});
