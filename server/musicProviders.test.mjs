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
  selectArtistChannel,
  selectCatalogueTrack,
  selectDeezerArtist,
  selectDeezerTrack,
  trackOverrideKey,
  youtubeOEmbed,
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

test("a stylized artist name beats exact-spelling impostors, and bad pins self-heal", () => {
  // Deezer lists Korn as "KoЯn" (2.6M fans). Two impostor accounts are spelled
  // exactly "Korn", so exact-match-first picked one with 2 albums and the real
  // band's page came up empty.
  const korn = [
    { id: 267400112, name: "Korn", nb_fan: 4497 },
    { id: 240940521, name: "Korn", nb_fan: 25 },
    { id: 1327, name: "KoЯn", nb_fan: 2_609_988 },
    { id: 394171, name: "Lorn", nb_fan: 27_228 },
    { id: 7101, name: "Jorn", nb_fan: 12_679 },
  ];
  assert.equal(selectDeezerArtist("Korn", korn).artist.id, 1327, "the real band wins on audience size");

  // A genuine same-name collision must still prefer the exact spelling: Lorn is
  // more popular than Jorn but is NOT overwhelmingly bigger, so Jorn stays Jorn.
  assert.equal(selectDeezerArtist("Jorn", korn).artist.id, 7101);
  assert.equal(selectDeezerArtist("Lorn", korn).artist.id, 394171);

  // An auto-saved id is only a hint: a previously mis-pinned impostor heals...
  assert.equal(selectDeezerArtist("Korn", korn, null, { hintId: 267400112 }).artist.id, 1327);
  // ...while a reasonable saved id keeps continuity...
  assert.equal(selectDeezerArtist("Jorn", korn, null, { hintId: 7101 }).artist.id, 7101);
  // ...and a listener's explicit pick always wins.
  assert.equal(selectDeezerArtist("Korn", korn, 267400112).artist.id, 267400112);
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

test("YouTube scoring gates on the creator and the song, not the title alone", () => {
  // A flawless title match by a completely different uploader is the classic
  // wrong-result: rejected outright because the creator is not the artist.
  const wrongArtist = scoreYouTubeCandidate(
    youtubeCandidate("wrongact001", "Espresso (Official Audio)", "Some Other Band"),
    { title: "Espresso", artist: "Sabrina Carpenter" },
  );
  assert.equal(wrongArtist.rejected, true);
  assert.deepEqual(wrongArtist.reasons, ["wrong-creator"]);

  // The real failure the owner hit: a DIFFERENT act's video that merely features
  // the requested artist ("Tory Lanez - X (feat. Nelly Furtado)") must not land
  // on Nelly Furtado's page. Its title leads with Tory Lanez and its channel is
  // Tory Lanez, so the creator gate rejects it.
  const featBySomeoneElse = scoreYouTubeCandidate(
    youtubeCandidate("featwrong01", "Tory Lanez - The Take (feat. Nelly Furtado)", "Tory Lanez"),
    { title: "The Take", artist: "Nelly Furtado" },
  );
  assert.equal(featBySomeoneElse.rejected, true);
  assert.deepEqual(featBySomeoneElse.reasons, ["wrong-creator"]);

  // Official/VEVO and "Artist - Topic" channels carry the name, so they pass.
  const vevo = scoreYouTubeCandidate(
    youtubeCandidate("vevo000001", "Sabrina Carpenter - Espresso (Official Video)", "SabrinaCarpenterVEVO"),
    { title: "Espresso", artist: "Sabrina Carpenter" },
  );
  assert.equal(vevo.rejected, false);
  assert.ok(vevo.reasons.includes("artist-channel"));

  // A label upload that leads with the artist ("Artist - Song") also passes even
  // when the channel is not the artist's.
  const labelLead = scoreYouTubeCandidate(
    youtubeCandidate("label00001", "Nelly Furtado - Say It Right (Official Music Video)", "GeffenVEVO"),
    { title: "Say It Right", artist: "Nelly Furtado" },
  );
  assert.equal(labelLead.rejected, false);

  // Right creator, wrong song is still the wrong result.
  const wrongSong = scoreYouTubeCandidate(
    youtubeCandidate("wrongsong01", "Sabrina Carpenter - Please Please Please (Official Audio)", "Sabrina Carpenter - Topic"),
    { title: "Espresso", artist: "Sabrina Carpenter" },
  );
  assert.equal(wrongSong.rejected, true);
  assert.deepEqual(wrongSong.reasons, ["title-mismatch"]);
});

test("the artist's own channel is picked over lookalike channels", () => {
  const items = [
    { id: { channelId: "UC_fanpage" }, snippet: { title: "Korn Fan Page" } },
    { id: { channelId: "UC_topic" }, snippet: { title: "Korn - Topic" } },
    { id: { channelId: "UC_vevo" }, snippet: { title: "KornVEVO" } },
  ];
  assert.equal(selectArtistChannel("Korn", items).channelId, "UC_topic", "the auto-generated Topic channel wins");
  assert.equal(selectArtistChannel("Korn", [items[0], items[2]]).channelId, "UC_vevo", "VEVO is next best");
  assert.equal(selectArtistChannel("Korn", [{ id: { channelId: "UC_x" }, snippet: { title: "Reaction Central" } }]), null);
});

test("catalogue matching picks the studio track over decorated and live variants", () => {
  const catalogue = [
    { videoId: "liveversion", title: "Say It Right (Live at Wembley)" },
    { videoId: "studiotrack", title: "Say It Right" },
    { videoId: "karaoketrk", title: "Say It Right (Karaoke Version)" },
    { videoId: "otherssong", title: "Maneater" },
  ];
  assert.equal(selectCatalogueTrack("Say It Right", catalogue).videoId, "studiotrack");
  // A decorated official title still matches when there is no bare version.
  assert.equal(
    selectCatalogueTrack("Say It Right", [{ videoId: "officialmv", title: "Say It Right (Official Music Video)" }]).videoId,
    "officialmv",
  );
  // Nothing close enough is a miss, not a wrong guess.
  assert.equal(selectCatalogueTrack("Say It Right", [{ videoId: "x", title: "Completely Different" }]), null);
});

test("the catalogue path resolves songs without burning a keyword search", async () => {
  // Each keyword search costs 100 quota units and only ~99 fit in a day, which is
  // why songs kept falling back to previews. channels/playlistItems cost 1 unit.
  const calls = [];
  const fetchImpl = async (url) => {
    const u = String(url);
    calls.push(u);
    let data = {};
    if (u.includes("type=channel")) data = { items: [{ id: { channelId: "UC_topic" }, snippet: { title: "Nelly Furtado - Topic" } }] };
    else if (u.includes("/channels?")) data = { items: [{ contentDetails: { relatedPlaylists: { uploads: "UU_topic" } } }] };
    else if (u.includes("/playlistItems?")) data = { items: [
      { snippet: { title: "Say It Right", resourceId: { videoId: "studiotrack" } } },
      { snippet: { title: "Maneater", resourceId: { videoId: "maneater001" } } },
    ] };
    else data = { items: [youtubeCandidate("studiotrack", "Say It Right", "Nelly Furtado - Topic")] };
    return { ok: true, status: 200, json: async () => data };
  };
  const result = await resolveYouTubeTrack("Say It Right", "Nelly Furtado", { apiKey: "test-key", fetchImpl });
  assert.equal(result.videoId, "studiotrack");
  assert.equal(result.status, "artist_catalogue");
  // Only the one-off channel lookup may use search; the song itself must not.
  const songSearches = calls.filter((u) => u.includes("/search?") && !u.includes("type=channel"));
  assert.equal(songSearches.length, 0, "the song resolved without a 100-unit search");
});

test("resolver searches the artist's channel first, so reactions can never win", async () => {
  // A reaction upload outranks the real song on a blind keyword search. Scoping
  // the search to the artist's Topic channel means it is never even a candidate.
  // A distinct artist from the catalogue test above: the provider cache is shared
  // across tests, so reusing a name would simply replay the cached catalogue.
  const fetchImpl = async (url) => {
    const u = String(url);
    let data = {};
    if (u.includes("type=channel")) data = { items: [{ id: { channelId: "UC_feist" }, snippet: { title: "Feist - Topic" } }] };
    // No uploads playlist here, so the cheap catalogue path finds nothing and
    // the resolver falls back to searching inside the artist's channel.
    else if (u.includes("/channels?")) data = { items: [] };
    else if (u.includes("/search?") && u.includes("channelId=UC_feist")) data = { items: [{ id: { videoId: "officialAud" } }] };
    else if (u.includes("/search?")) data = { items: [{ id: { videoId: "reactvid001" } }] };
    else data = {
      items: [
        youtubeCandidate("officialAud", "Mushaboom", "Feist - Topic"),
        youtubeCandidate("reactvid001", "Mushaboom REACTION!!", "Reaction Central"),
      ].filter((item) => u.includes(item.id)),
    };
    return { ok: true, status: 200, json: async () => data };
  };
  const result = await resolveYouTubeTrack("Mushaboom", "Feist", { apiKey: "test-key", fetchImpl });
  assert.equal(result.videoId, "officialAud");
  assert.equal(result.status, "artist_channel");
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

test("YouTube post attachments canonicalize links and keep provider metadata", async () => {
  let requested = "";
  const song = await youtubeOEmbed("https://youtu.be/dQw4w9WgXcQ?t=42", {
    fetchImpl: async (url) => {
      requested = String(url);
      return {
        ok: true,
        status: 200,
        json: async () => ({ title: "Never Gonna Give You Up", author_name: "Rick Astley", thumbnail_url: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg" }),
      };
    },
  });
  assert.match(requested, /^https:\/\/www\.youtube\.com\/oembed\?/);
  assert.equal(song.videoId, "dQw4w9WgXcQ");
  assert.equal(song.url, "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  assert.equal(song.title, "Never Gonna Give You Up");
  assert.equal(song.artist, "Rick Astley");
  assert.equal(await youtubeOEmbed("https://example.com/not-youtube", { fetchImpl: async () => { throw new Error("must not fetch"); } }), null);
});
