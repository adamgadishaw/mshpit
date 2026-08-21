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
  artistRow,
  artistStmts,
  db,
} = await import("./db.js");
const {
  invalidateYouTubeTrack,
  normalizeYouTubeCacheText,
  parseYouTubeVideoId,
  playbackUrlExpiry,
  persistDeezerIdentity,
  pruneExpiredProviderData,
  getFreshDeezerPreview,
  resolveYouTubeTrack,
  scoreYouTubeCandidate,
  selectArtistChannel,
  selectCatalogueTrack,
  selectDeezerArtist,
  selectDeezerTrack,
  trackOverrideKey,
  youtubeOEmbed,
  youtubeCacheKey,
  youtubeJson,
  youtubeProviderStatus,
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

test("discography persistence writes provider claims while preserving staff genres", () => {
  artistStmts.upsert.run(artistRow("Provider Claim Writer", { name: "Provider Claim Writer", genre: "Metal" }, "musicbrainz"));
  persistDeezerIdentity("Provider Claim Writer", 501, "Pop");
  const providerRow = artistStmts.byNorm.get("provider claim writer");
  const providerData = JSON.parse(providerRow.data);
  assert.equal(providerRow.genre, "Pop");
  assert.equal(providerData.genreClaims.find((claim) => claim.source === "provider")?.value, "Pop");

  artistStmts.upsert.run(artistRow("Staff Claim Writer", {
    name: "Staff Claim Writer",
    genre: "r&b",
    genreClaims: [{ value: "r&b", source: "staff", at: 1 }],
  }, "staff"));
  persistDeezerIdentity("Staff Claim Writer", 502, "Pop");
  const staffRow = artistStmts.byNorm.get("staff claim writer");
  const staffData = JSON.parse(staffRow.data);
  assert.equal(staffRow.genre, "r&b");
  assert.equal(staffData.genreClaims.find((claim) => claim.source === "provider")?.value, "Pop");
  assert.equal(staffData.genreClaims.find((claim) => claim.source === "staff")?.value, "r&b");
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
  // YouTube now gives search.list its own small daily call bucket. Catalogue
  // reads use the ordinary low-cost API pool and are shared across every listener.
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
  assert.equal(songSearches.length, 0, "the song resolved without a keyword search call");
  const cached = db.prepare("SELECT updated_at,expires_at FROM yt_cache WHERE key=?")
    .get(youtubeCacheKey("Say It Right", "Nelly Furtado"));
  assert.ok(cached.expires_at > cached.updated_at);
  assert.ok(cached.expires_at - cached.updated_at <= 30 * 24 * 60 * 60 * 1000,
    "non-authorized YouTube data is never cached beyond 30 days");
});

test("catalogue-only resolution defers a miss without touching search or any provider", async () => {
  const before = youtubeProviderStatus().search.used;
  let requests = 0;
  const result = await resolveYouTubeTrack("Deferred Deep Cut", "Catalogue Only Artist", {
    apiKey: "test-key",
    allowSearch: false,
    fetchImpl: async () => {
      requests += 1;
      throw new Error("allowSearch:false must return before provider discovery for an unmapped artist");
    },
  });
  assert.deepEqual(result, { videoId: null, status: "search_deferred" });
  assert.equal(requests, 0);
  assert.equal(youtubeProviderStatus().search.used, before);
});

test("concurrent listeners share one cold YouTube resolution", async () => {
  let requests = 0;
  const fetchImpl = async (url) => {
    requests += 1;
    await new Promise((resolve) => setTimeout(resolve, 2));
    const value = String(url);
    if (value.includes("type=channel")) return { ok: true, status: 200, json: async () => ({ items: [{ id: { channelId: "UC_shared" }, snippet: { title: "Shared Artist - Topic" } }] }) };
    if (value.includes("/channels?")) return { ok: true, status: 200, json: async () => ({ items: [{ contentDetails: { relatedPlaylists: { uploads: "UU_shared" } } }] }) };
    if (value.includes("/playlistItems?")) return { ok: true, status: 200, json: async () => ({ items: [{ snippet: { title: "Shared Song", resourceId: { videoId: "sharedtrack" } } }] }) };
    return { ok: true, status: 200, json: async () => ({ items: [youtubeCandidate("sharedtrack", "Shared Song", "Shared Artist - Topic")] }) };
  };
  const [first, second] = await Promise.all([
    resolveYouTubeTrack("Shared Song", "Shared Artist", { apiKey: "test-key", fetchImpl }),
    resolveYouTubeTrack("Shared Song", "Shared Artist", { apiKey: "test-key", fetchImpl }),
  ]);
  assert.equal(first.videoId, "sharedtrack");
  assert.deepEqual(second, first);
  assert.equal(requests, 4, "one shared channel/catalogue/video request chain");
  assert.equal(youtubeProviderStatus().inFlight, 0);
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

test("a discovered Topic channel is stored on the artist and never re-searched", async () => {
  // Put the artist in the catalogue so discovery can persist to their row.
  const now = Date.now();
  artistStmts.upsert.run(artistRow("Channel Keeper", { name: "Channel Keeper", popularity: 50 }, "test"));

  let channelSearches = 0;
  const fetchImpl = async (url) => {
    const u = String(url);
    let data = {};
    if (u.includes("type=channel")) { channelSearches += 1; data = { items: [{ id: { channelId: "UC_keeper" }, snippet: { title: "Channel Keeper - Topic" } }] }; }
    else if (u.includes("/channels?")) data = { items: [{ contentDetails: { relatedPlaylists: { uploads: "UU_keeper" } } }] };
    else if (u.includes("/playlistItems?")) data = { items: [
      { snippet: { title: "First Single", resourceId: { videoId: "keeper_a" } } },
      { snippet: { title: "Second Single", resourceId: { videoId: "keeper_b" } } },
    ] };
    else data = { items: [
      youtubeCandidate("keeper_a", "First Single", "Channel Keeper - Topic"),
      youtubeCandidate("keeper_b", "Second Single", "Channel Keeper - Topic"),
    ].filter((item) => u.includes(item.id)) };
    return { ok: true, status: 200, json: async () => data };
  };

  const first = await resolveYouTubeTrack("First Single", "Channel Keeper", { apiKey: "test-key", fetchImpl });
  assert.equal(first.status, "artist_catalogue");
  assert.equal(channelSearches, 1, "discovery searches once");

  // The channel id is now on the artist row with YouTube provenance and a
  // refresh timestamp, so it is reused without another discovery search.
  const stored = artistStmts.getChannel.get("channel keeper");
  assert.equal(stored.channelId, "UC_keeper");
  assert.ok(stored.at >= now);
  assert.equal(stored.source, "youtube");

  // A DIFFERENT song by the same artist resolves from the cached catalogue with
  // no further channel discovery search.
  const second = await resolveYouTubeTrack("Second Single", "Channel Keeper", { apiKey: "test-key", fetchImpl });
  assert.equal(second.videoId, "keeper_b");
  assert.equal(channelSearches, 1, "the stored channel is reused, so no second discovery search");
});

test("a stale channel whose current title no longer matches is cleared instead of trusted forever", async () => {
  artistStmts.upsert.run(artistRow("Correct Artist", { name: "Correct Artist", popularity: 35 }, "test"));
  const wrongChannel = "UCxxxxxxxxxxxxxxxxxxxxxx";
  artistStmts.setChannel.run(wrongChannel, Date.now() - 31 * 24 * 60 * 60 * 1000, "youtube", "correct artist");

  let requests = 0;
  const result = await resolveYouTubeTrack("Only Song", "Correct Artist", {
    apiKey: "test-key",
    allowSearch: false,
    fetchImpl: async (url) => {
      requests += 1;
      assert.match(String(url), /\/channels\?/);
      return {
        ok: true,
        status: 200,
        json: async () => ({ items: [{ id: wrongChannel, snippet: { title: "Completely Different Band" } }] }),
      };
    },
  });

  assert.deepEqual(result, { videoId: null, status: "search_deferred" });
  assert.equal(requests, 1, "only the bounded channel revalidation ran");
  assert.equal(artistStmts.getChannel.get("correct artist").channelId, null);
});

test("a complete catalogue that lacks the song skips the in-channel search", async () => {
  artistStmts.upsert.run(artistRow("Complete Cat", { name: "Complete Cat", popularity: 40 }, "test"));
  let songSearches = 0;
  const fetchImpl = async (url) => {
    const u = String(url);
    let data = {};
    if (u.includes("type=channel")) data = { items: [{ id: { channelId: "UC_complete" }, snippet: { title: "Complete Cat - Topic" } }] };
    else if (u.includes("/channels?")) data = { items: [{ contentDetails: { relatedPlaylists: { uploads: "UU_complete" } } }] };
    // A single page with no nextPageToken: the catalogue is complete.
    else if (u.includes("/playlistItems?")) data = { items: [{ snippet: { title: "Only Song They Have", resourceId: { videoId: "onlyone" } } }] };
    else { if (u.includes("/search?")) songSearches += 1; data = { items: [youtubeCandidate("globalfallback", "Missing Song", "Someone Else")] }; }
    return { ok: true, status: 200, json: async () => data };
  };
  // Ask for a song the complete catalogue does not contain.
  await resolveYouTubeTrack("Missing Song", "Complete Cat", { apiKey: "test-key", fetchImpl });
  // Exactly one search may fire — the global fallback — never an in-channel one
  // on top of it, because the complete catalogue already proved the Topic
  // channel does not hold the song.
  assert.equal(songSearches, 1, "one global search, no redundant in-channel search");
});

test("YouTube cache identity normalizes harmless Unicode and spacing without collapsing distinct words", () => {
  assert.equal(normalizeYouTubeCacheText("  ARTIST\tName  "), "artist name");
  assert.equal(
    youtubeCacheKey("Song\u2014Name", "The  Artist"),
    youtubeCacheKey("song-name", "  the artist "),
    "dash, case, and whitespace variants share one resolver row",
  );
  assert.equal(
    youtubeCacheKey("Cafe\u0301", "Composer"),
    youtubeCacheKey("Café", "Composer"),
    "canonically equivalent Unicode shares one row",
  );
  assert.notEqual(youtubeCacheKey("Si", "Singer"), youtubeCacheKey("Sí", "Singer"),
    "meaningful diacritics remain distinct");
  assert.notEqual(youtubeCacheKey("東京", "歌手"), youtubeCacheKey("京都", "歌手"),
    "non-Latin titles never collapse to an empty ASCII key");
  assert.notEqual(
    youtubeCacheKey("c", "a|b"),
    youtubeCacheKey("b|c", "a"),
    "artist/title boundaries remain distinct even when either value contains the old delimiter",
  );
});

test("only unambiguous legacy YouTube cache rows migrate without extending retention", async () => {
  const now = Date.now();
  const title = "Legacy Cache Song";
  const artist = "Legacy Cache Artist";
  const legacyKey = "yt:v2:legacy cache artist|legacy cache song";
  const updatedAt = now - 2_000;
  const expiresAt = now + 60_000;
  db.prepare(`INSERT OR REPLACE INTO yt_cache
    (key,video_id,updated_at,metadata,score,expires_at,rejected_ids)
    VALUES (?,?,?,?,?,?,?)`).run(
    legacyKey,
    "legacy00001",
    updatedAt,
    JSON.stringify({ title, channel: `${artist} - Topic`, reasons: ["official"], duration: 180 }),
    99,
    expiresAt,
    "[]",
  );
  const result = await resolveYouTubeTrack(title, artist, {
    apiKey: "test-key",
    fetchImpl: async () => { throw new Error("a fresh legacy row must not fetch"); },
  });
  assert.equal(result.videoId, "legacy00001");
  assert.equal(result.status, "cached");
  assert.equal(db.prepare("SELECT 1 FROM yt_cache WHERE key=?").get(legacyKey), undefined);
  const migrated = db.prepare("SELECT * FROM yt_cache WHERE key=?").get(youtubeCacheKey(title, artist));
  assert.equal(migrated.updated_at, updatedAt);
  assert.equal(migrated.expires_at, expiresAt);

  const ambiguousLegacyKey = "yt:v2:a|b|c";
  db.prepare(`INSERT OR REPLACE INTO yt_cache
    (key,video_id,updated_at,metadata,score,expires_at,rejected_ids)
    VALUES (?,?,?,?,?,?,?)`).run(
    ambiguousLegacyKey,
    "ambiguous01",
    updatedAt,
    JSON.stringify({ title: "c", channel: "a|b", reasons: ["official"], duration: 180 }),
    99,
    expiresAt,
    "[]",
  );
  const ignored = await resolveYouTubeTrack("c", "a|b", { apiKey: "" });
  assert.deepEqual(ignored, { videoId: null, status: "unconfigured" });
  assert.ok(db.prepare("SELECT 1 FROM yt_cache WHERE key=?").get(ambiguousLegacyKey),
    "an ambiguous v2 row is never guessed into either colliding v3 identity");
  assert.equal(db.prepare("SELECT 1 FROM yt_cache WHERE key=?").get(youtubeCacheKey("c", "a|b")), undefined);
});

test("Deezer preview cache keys keep pipe-bearing artist/title tuples separate", async () => {
  let fetches = 0;
  const fetchImpl = async (url) => {
    fetches += 1;
    const query = new URL(String(url)).searchParams.get("q") || "";
    const second = query.includes('track:"b|c"');
    return {
      ok: true,
      status: 200,
      json: async () => ({
        data: [{
          id: second ? 2 : 1,
          title: second ? "b|c" : "c",
          preview: second ? "https://preview.example/second" : "https://preview.example/first",
          link: second ? "https://deezer.example/second" : "https://deezer.example/first",
          artist: { id: second ? 20 : 10, name: second ? "a" : "a|b" },
        }],
      }),
    };
  };
  const first = await getFreshDeezerPreview("c", "a|b", { fetchImpl });
  const second = await getFreshDeezerPreview("b|c", "a", { fetchImpl });
  assert.equal(first.preview, "https://preview.example/first");
  assert.equal(second.preview, "https://preview.example/second");
  assert.equal(fetches, 2);
});

test("provider pruning removes dormant YouTube mappings and downgrades CC0 pointers without retaining API trust", () => {
  const at = Date.now();
  const oldAt = at - 31 * 24 * 60 * 60 * 1000;
  const freshAt = at - 24 * 60 * 60 * 1000;
  const rows = [
    ["Prune YouTube Positive", "UC_prune_positive", "youtube", oldAt],
    ["Prune YouTube Miss", null, "youtube", oldAt],
    ["Prune Legacy Positive", "UC_prune_legacy", null, oldAt],
    ["Prune Wikidata Trusted", "UC_prune_wd_trusted", "wikidata", oldAt],
    ["Prune Wikidata Unverified", "UC_prune_wd_unverified", "wikidata_unverified", oldAt],
    ["Prune Fresh YouTube", "UC_prune_fresh", "youtube", freshAt],
  ];
  for (const [name, channelId, source, channelAt] of rows) {
    const norm = name.toLowerCase();
    artistStmts.upsert.run(artistRow(norm, { name }, "test"));
    artistStmts.setChannel.run(channelId, channelAt, source, norm);
  }
  db.prepare(`INSERT OR REPLACE INTO wikidata_channel_checks
    (mbid,channel_id,validated,checked_at) VALUES (?,?,?,?)`)
    .run("prune-old-validated", "UC_prune_wd_trusted", 1, oldAt);
  db.prepare(`INSERT OR REPLACE INTO wikidata_channel_checks
    (mbid,channel_id,validated,checked_at) VALUES (?,?,?,?)`)
    .run("prune-fresh-validated", "UC_prune_wd_fresh", 1, freshAt);

  const pruned = pruneExpiredProviderData(at, { force: true });
  assert.ok(pruned.artistChannels >= 3);
  assert.ok(pruned.artistValidations >= 2);
  assert.ok(pruned.wikidataValidations >= 1);
  for (const name of ["Prune YouTube Positive", "Prune YouTube Miss", "Prune Legacy Positive"]) {
    assert.deepEqual({ ...artistStmts.getChannel.get(name.toLowerCase()) }, {
      channelId: null,
      at: 0,
      source: null,
    });
  }
  for (const [name, channelId] of [
    ["Prune Wikidata Trusted", "UC_prune_wd_trusted"],
    ["Prune Wikidata Unverified", "UC_prune_wd_unverified"],
  ]) {
    assert.deepEqual({ ...artistStmts.getChannel.get(name.toLowerCase()) }, {
      channelId,
      at: 0,
      source: "wikidata_unverified",
    });
  }
  assert.deepEqual({ ...artistStmts.getChannel.get("prune fresh youtube") }, {
    channelId: "UC_prune_fresh",
    at: freshAt,
    source: "youtube",
  });
  assert.deepEqual(
    { ...db.prepare("SELECT channel_id,validated,checked_at FROM wikidata_channel_checks WHERE mbid=?")
      .get("prune-old-validated") },
    { channel_id: "UC_prune_wd_trusted", validated: 0, checked_at: 0 },
  );
  assert.deepEqual(
    { ...db.prepare("SELECT channel_id,validated,checked_at FROM wikidata_channel_checks WHERE mbid=?")
      .get("prune-fresh-validated") },
    { channel_id: "UC_prune_wd_fresh", validated: 1, checked_at: freshAt },
  );
});

test("uncatalogued artists reuse their durable channel and catalogue across spelling variants", async () => {
  let channelSearches = 0;
  let catalogueReads = 0;
  const fetchImpl = async (url) => {
    const value = String(url);
    let data;
    if (value.includes("type=channel")) {
      channelSearches += 1;
      data = { items: [{ id: { channelId: "UC_unknown_cache" }, snippet: { title: "Unknown Cache Act - Topic" } }] };
    } else if (value.includes("/channels?")) {
      data = { items: [{ contentDetails: { relatedPlaylists: { uploads: "UU_unknown_cache" } } }] };
    } else if (value.includes("/playlistItems?")) {
      catalogueReads += 1;
      data = { items: [
        { snippet: { title: "Cache Track One", resourceId: { videoId: "cachetrack1" } } },
        { snippet: { title: "Cache Track Two", resourceId: { videoId: "cachetrack2" } } },
      ] };
    } else {
      data = { items: [
        youtubeCandidate("cachetrack1", "Cache Track One", "Unknown Cache Act - Topic"),
        youtubeCandidate("cachetrack2", "Cache Track Two", "Unknown Cache Act - Topic"),
      ].filter((item) => value.includes(item.id)) };
    }
    return { ok: true, status: 200, json: async () => data };
  };

  const first = await resolveYouTubeTrack("Cache Track One", "Unknown Cache Act", { apiKey: "test-key", fetchImpl });
  const second = await resolveYouTubeTrack("Cache Track Two", "  UNKNOWN   CACHE ACT ", { apiKey: "test-key", fetchImpl });
  assert.equal(first.videoId, "cachetrack1");
  assert.equal(second.videoId, "cachetrack2");
  assert.equal(channelSearches, 1, "the persisted provider channel avoids a second search.list call");
  assert.equal(catalogueReads, 1, "one channel id maps to one normalized catalogue cache");
});

test("different songs cold-starting together coalesce artist channel and catalogue requests", async () => {
  let channelSearches = 0;
  let channelReads = 0;
  let catalogueReads = 0;
  const before = youtubeProviderStatus().efficiency;
  const fetchImpl = async (url) => {
    await new Promise((resolve) => setTimeout(resolve, 3));
    const value = String(url);
    let data;
    if (value.includes("type=channel")) {
      channelSearches += 1;
      data = { items: [{ id: { channelId: "UC_coalesce" }, snippet: { title: "Coalesce Artist - Topic" } }] };
    } else if (value.includes("/channels?")) {
      channelReads += 1;
      data = { items: [{ contentDetails: { relatedPlaylists: { uploads: "UU_coalesce" } } }] };
    } else if (value.includes("/playlistItems?")) {
      catalogueReads += 1;
      data = { items: [
        { snippet: { title: "Parallel One", resourceId: { videoId: "parallel001" } } },
        { snippet: { title: "Parallel Two", resourceId: { videoId: "parallel002" } } },
      ] };
    } else {
      data = { items: [
        youtubeCandidate("parallel001", "Parallel One", "Coalesce Artist - Topic"),
        youtubeCandidate("parallel002", "Parallel Two", "Coalesce Artist - Topic"),
      ].filter((item) => value.includes(item.id)) };
    }
    return { ok: true, status: 200, json: async () => data };
  };

  const [one, two] = await Promise.all([
    resolveYouTubeTrack("Parallel One", "Coalesce Artist", { apiKey: "test-key", fetchImpl }),
    resolveYouTubeTrack("Parallel Two", "Coalesce Artist", { apiKey: "test-key", fetchImpl }),
  ]);
  assert.equal(one.videoId, "parallel001");
  assert.equal(two.videoId, "parallel002");
  assert.equal(channelSearches, 1);
  assert.equal(channelReads, 1);
  assert.equal(catalogueReads, 1);
  const afterStatus = youtubeProviderStatus();
  assert.ok(afterStatus.efficiency.channelCoalesced > before.channelCoalesced);
  assert.ok(afterStatus.efficiency.catalogueCoalesced > before.catalogueCoalesced);
  assert.deepEqual(afterStatus.inFlightByKind, { tracks: 0, channels: 0, catalogues: 0 });
});

test("an uncatalogued artist channel miss is negative-cached across different songs", async () => {
  let channelSearches = 0;
  let globalSearches = 0;
  const fetchImpl = async (url) => {
    const value = String(url);
    if (value.includes("type=channel")) channelSearches += 1;
    else if (value.includes("/search?")) {
      globalSearches += 1;
      assert.equal(new URL(value).searchParams.get("maxResults"), "25",
        "one search call evaluates a wider first page without pagination");
    }
    return { ok: true, status: 200, json: async () => ({ items: [] }) };
  };

  await resolveYouTubeTrack("Negative One", "No Topic Cache Artist", { apiKey: "test-key", fetchImpl });
  await resolveYouTubeTrack("Negative Two", "No Topic Cache Artist", { apiKey: "test-key", fetchImpl });
  assert.equal(channelSearches, 1, "the structural channel miss is not searched twice");
  assert.equal(globalSearches, 2, "each distinct song still receives one legitimate global attempt");
});

test("an uncatalogued artist refreshes a known channel with channels.list instead of search.list", async () => {
  const artist = "Cheap Refresh Artist";
  const title = "Cheap Refresh Song";
  const now = Date.now();
  db.prepare(`INSERT OR REPLACE INTO provider_cache (key,data,updated_at,expires_at)
    VALUES (?,?,?,?)`).run(
    `yt:channel:v2:${normalizeYouTubeCacheText(artist)}`,
    JSON.stringify({
      channelId: "UC_cheap_refresh",
      title: `${artist} - Topic`,
      rank: 100,
      refreshAt: now - 1,
    }),
    now - 15 * 24 * 60 * 60 * 1000,
    now + 15 * 24 * 60 * 60 * 1000,
  );
  let searches = 0;
  let snippetRefreshes = 0;
  const fetchImpl = async (url) => {
    const value = String(url);
    const parsed = new URL(value);
    let data;
    if (value.includes("/search?")) {
      searches += 1;
      data = { items: [] };
    } else if (value.includes("/channels?") && parsed.searchParams.get("part") === "snippet") {
      snippetRefreshes += 1;
      data = { items: [{ id: "UC_cheap_refresh", snippet: { title: `${artist} - Topic` } }] };
    } else if (value.includes("/channels?")) {
      data = { items: [{ contentDetails: { relatedPlaylists: { uploads: "UU_cheap_refresh" } } }] };
    } else if (value.includes("/playlistItems?")) {
      data = { items: [{ snippet: { title, resourceId: { videoId: "cheaprefresh" } } }] };
    } else {
      data = { items: [youtubeCandidate("cheaprefresh", title, `${artist} - Topic`)] };
    }
    return { ok: true, status: 200, json: async () => data };
  };

  const result = await resolveYouTubeTrack(title, artist, { apiKey: "test-key", fetchImpl });
  assert.equal(result.videoId, "cheaprefresh");
  assert.equal(snippetRefreshes, 1);
  assert.equal(searches, 0, "known channel identity refresh never spends search.list");
});

test("a positive match uses only policy-bounded stale fallback during transient refresh failure", async () => {
  const now = Date.now();
  const title = "Bounded Stale Song";
  const artist = "Bounded Stale Artist";
  const key = youtubeCacheKey(title, artist);
  db.prepare(`INSERT OR REPLACE INTO yt_cache
    (key,video_id,updated_at,metadata,score,expires_at,rejected_ids)
    VALUES (?,?,?,?,?,?,?)`).run(
    key,
    "staletrack01",
    now - 15 * 24 * 60 * 60 * 1000,
    JSON.stringify({ title, channel: `${artist} - Topic`, reasons: ["official"], duration: 200 }),
    100,
    now + 15 * 24 * 60 * 60 * 1000,
    "[]",
  );
  const before = youtubeProviderStatus().efficiency.staleFallbacks;
  const stale = await resolveYouTubeTrack(title, artist, {
    apiKey: "test-key",
    fetchImpl: async () => { throw new Error("temporary network outage"); },
  });
  assert.deepEqual(stale, { videoId: "staletrack01", status: "stale", stale: true, confidence: 100 });
  assert.equal(youtubeProviderStatus().efficiency.staleFallbacks, before + 1);

  const expiredTitle = "Expired Stale Song";
  db.prepare(`INSERT OR REPLACE INTO yt_cache
    (key,video_id,updated_at,metadata,score,expires_at,rejected_ids)
    VALUES (?,?,?,?,?,?,?)`).run(
    youtubeCacheKey(expiredTitle, artist),
    "expiredtrk1",
    now - 31 * 24 * 60 * 60 * 1000,
    JSON.stringify({ title: expiredTitle, channel: `${artist} - Topic`, reasons: ["official"], duration: 200 }),
    100,
    now + 24 * 60 * 60 * 1000,
    "[]",
  );
  await assert.rejects(
    resolveYouTubeTrack(expiredTitle, artist, {
      apiKey: "test-key",
      fetchImpl: async () => { throw new Error("temporary network outage"); },
    }),
    (error) => error?.code === "network",
    "API data older than 30 days is never served as stale",
  );
});

test("a successful normalized resolution and invalidation retain finite policy expiry", async () => {
  const id = "success0001";
  const title = "Success\u2014Track";
  const fetchImpl = async (url) => {
    const value = String(url);
    const data = value.includes("/search?")
      ? { items: [{ id: { videoId: id } }] }
      : { items: [youtubeCandidate(id, "Success-Track (Official Audio)", "Success Label")] };
    return { ok: true, status: 200, json: async () => data };
  };
  const resolved = await resolveYouTubeTrack(title, "", { apiKey: "test-key", fetchImpl });
  assert.equal(resolved.videoId, id);
  const normalizedKey = youtubeCacheKey(" success-track ", "");
  const beforeInvalidation = db.prepare("SELECT * FROM yt_cache WHERE key=?").get(normalizedKey);
  assert.equal(beforeInvalidation.video_id, id);
  assert.ok(beforeInvalidation.expires_at - beforeInvalidation.updated_at <= 30 * 24 * 60 * 60 * 1000);

  const invalidated = invalidateYouTubeTrack(" success-track ", "", id);
  assert.equal(invalidated.invalidated, true);
  const afterInvalidation = db.prepare("SELECT * FROM yt_cache WHERE key=?").get(normalizedKey);
  assert.equal(afterInvalidation.video_id, null);
  assert.deepEqual(JSON.parse(afterInvalidation.metadata), { invalidated: true });
  assert.ok(JSON.parse(afterInvalidation.rejected_ids).includes(id));
  assert.ok(afterInvalidation.expires_at - afterInvalidation.updated_at <= 30 * 24 * 60 * 60 * 1000);
});

test("the local daily reservation cannot overrun its configured search limit", async () => {
  const status = youtubeProviderStatus();
  db.prepare(`INSERT INTO app_meta (key,value) VALUES (?,?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run(status.search.key, String(status.search.limit));
  let requested = false;
  let actorPermits = 0;
  await assert.rejects(
    youtubeJson("search", { part: "snippet", q: "must not run" }, "test-key", async () => {
      requested = true;
      return { ok: true, status: 200, json: async () => ({ items: [] }) };
    }, 8_000, { beforeRequest: () => { actorPermits += 1; } }),
    (error) => error?.code === "search_budget_exhausted",
  );
  assert.equal(requested, false);
  assert.equal(actorPermits, 0, "global exhaustion is rejected before an actor allowance is charged");
  assert.equal(Number(db.prepare("SELECT value FROM app_meta WHERE key=?").get(status.search.key).value), status.search.limit);
});

test("an open provider circuit rejects before charging another actor allowance", async () => {
  const status = youtubeProviderStatus();
  db.prepare(`INSERT INTO app_meta (key,value) VALUES (?,?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run(status.search.key, "0");
  let actorPermits = 0;
  await assert.rejects(
    youtubeJson("search", { part: "snippet", q: "opens circuit" }, "test-key", async () => ({
      ok: false,
      status: 403,
      json: async () => ({}),
    }), 8_000, { beforeRequest: () => { actorPermits += 1; } }),
    (error) => error?.code === "quota_or_forbidden",
  );
  assert.equal(actorPermits, 1, "the provider request that opened the circuit consumed one legitimate actor permit");
  let requested = false;
  await assert.rejects(
    youtubeJson("search", { part: "snippet", q: "must pause" }, "test-key", async () => {
      requested = true;
      return { ok: true, status: 200, json: async () => ({ items: [] }) };
    }, 8_000, { beforeRequest: () => { actorPermits += 1; } }),
    (error) => error?.code === "provider_paused",
  );
  assert.equal(requested, false);
  assert.equal(actorPermits, 1, "the open circuit does not burn a permit for a request that cannot run");
});
