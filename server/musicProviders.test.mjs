import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
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
  normName,
} = await import("./db.js");
const {
  PREVIEW_CACHE_MAX_ENTRIES,
  YOUTUBE_MATCH_CACHE_VERSION,
  invalidateSongIndex,
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
  spotifyCatalogueTrackProof,
  trackOverrideKey,
  youtubeOEmbed,
  youtubeCacheKey,
  youtubeJson,
  youtubeRecordingIdentity,
  youtubeProviderStatus,
} = await import("./musicProviders.js");

after(() => {
  db.close();
  rmSync(dataDir, { recursive: true, force: true });
});

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

test("every bundled Spotify track has exact local recording proof without duration metadata", () => {
  const bundled = JSON.parse(readFileSync(new URL("../src/seed/catalog.core.json", import.meta.url), "utf8"));
  const tracks = Object.values(bundled.artists || {}).flatMap((artist) => (
    (artist.topTracks || []).map((track) => ({
      artist: artist.name,
      title: track.title,
      sourceId: String(track.url || "").match(/open\.spotify\.com\/track\/([A-Za-z0-9]+)/i)?.[1] || "",
      duration: track.duration,
    })).filter((track) => track.sourceId)
  ));
  assert.equal(tracks.length, 2484, "the regression covers the complete current production catalogue");
  assert.equal(tracks.filter((track) => Number(track.duration) > 0).length, 0,
    "the fixture mirrors production: exact Spotify identities currently have no stored duration");
  const unsupported = tracks.filter((track) => !spotifyCatalogueTrackProof(track));
  assert.deepEqual(unsupported, [], "source ID + artist + authoritative title proves every bundled recording");
  assert.equal(youtubeRecordingIdentity("spotify", tracks[0].sourceId), `spotify:${tracks[0].sourceId}`);
  assert.equal(youtubeRecordingIdentity("SPOTIFY", tracks[1].sourceId), `spotify:${tracks[1].sourceId}`);
  assert.equal(youtubeRecordingIdentity("spotify", "open.spotify.com/track/not-an-id"), "",
    "only a bounded bare Spotify ID becomes cache authority");
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

test("discography persistence requires release consensus while preserving staff genres", () => {
  const evidence = {
    genre: "Pop", provider: "deezer", basis: "release-consensus-v1",
    sampleCount: 3, supportingCount: 3, share: 1,
    counts: [{ genre: "Pop", count: 3 }],
  };
  artistStmts.upsert.run(artistRow("Provider Claim Writer", { name: "Provider Claim Writer", genre: "Metal" }, "musicbrainz"));
  persistDeezerIdentity("Provider Claim Writer", 501, evidence);
  const providerRow = artistStmts.byNorm.get("provider claim writer");
  const providerData = JSON.parse(providerRow.data);
  assert.equal(providerRow.genre, "Pop");
  assert.equal(providerData.genreClaims.find((claim) => claim.source === "release_consensus")?.value, "Pop");

  artistStmts.upsert.run(artistRow("Staff Claim Writer", {
    name: "Staff Claim Writer",
    genre: "r&b",
    genreClaims: [{ value: "r&b", source: "staff", at: 1 }],
  }, "staff"));
  persistDeezerIdentity("Staff Claim Writer", 502, evidence);
  const staffRow = artistStmts.byNorm.get("staff claim writer");
  const staffData = JSON.parse(staffRow.data);
  assert.equal(staffRow.genre, "r&b");
  assert.equal(staffData.genreClaims.find((claim) => claim.source === "release_consensus")?.value, "Pop");
  assert.equal(staffData.genreClaims.find((claim) => claim.source === "staff")?.value, "r&b");
});

test("identity corrections clear the former artist's Deezer genre until new releases agree", () => {
  const evidence = {
    genre: "Pop", provider: "deezer", basis: "release-consensus-v1",
    sampleCount: 3, supportingCount: 2, share: 0.6667,
    counts: [{ genre: "Pop", count: 2 }, { genre: "Rock", count: 1 }],
  };
  artistStmts.upsert.run(artistRow("Corrected Identity Writer", { name: "Corrected Identity Writer" }, "deezer"));
  persistDeezerIdentity("Corrected Identity Writer", 601, evidence);
  persistDeezerIdentity("Corrected Identity Writer", 602);
  const data = JSON.parse(artistStmts.byNorm.get("corrected identity writer").data);
  assert.equal(data.deezerId, 602);
  assert.equal(data.genreEvidence, undefined);
  assert.equal(data.genreClaims.some((claim) => claim.source === "release_consensus"), false);
});

test("the Deezer identity writer rejects a bare unsupported genre", () => {
  artistStmts.upsert.run(artistRow("Unsupported Genre Writer", { name: "Unsupported Genre Writer" }, "deezer"));
  persistDeezerIdentity("Unsupported Genre Writer", 603, "Pop");
  const data = JSON.parse(artistStmts.byNorm.get("unsupported genre writer").data);
  assert.equal(Boolean(data.genreClaims?.some((claim) => claim.source === "release_consensus")), false);
  assert.equal(data.genreEvidence, undefined);
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
  const deezerSignedUrl = `https://cdnt-preview.dzcdn.net/api/1/1/0/b/9/0/song.mp3?hdnea=exp=${providerExpiry}~acl=/api/1/1/0/b/9/0/song.mp3*~data=user_id=0,application_id=42~hmac=abc123`;
  assert.equal(playbackUrlExpiry(deezerSignedUrl, now), now + 2 * 60_000);
  const farExpiry = Math.floor((now + 30 * 60_000) / 1000);
  assert.equal(playbackUrlExpiry(`https://preview.example/song.mp3?exp=${farExpiry}`, now), now + 5 * 60_000);
  assert.equal(playbackUrlExpiry("https://preview.example/no-exp.mp3", now), now);
});

test("a Deezer hdnea preview is reused while its bounded signature remains fresh", async () => {
  const requestedAt = Date.now();
  const providerExpiry = Math.floor((requestedAt + 15 * 60_000) / 1000);
  const preview = `https://cdnt-preview.dzcdn.net/api/1/1/0/b/9/0/cache.mp3?hdnea=exp=${providerExpiry}~acl=/api/1/1/0/b/9/0/cache.mp3*~data=user_id=0,application_id=42~hmac=cache123`;
  let requests = 0;
  const fetchImpl = async () => {
    requests += 1;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        data: [{
          id: 9001,
          title: "Signed Cache Song",
          artist: { name: "Signed Cache Artist" },
          preview,
          link: "https://www.deezer.com/track/9001",
        }],
      }),
    };
  };

  const first = await getFreshDeezerPreview("Signed Cache Song", "Signed Cache Artist", { fetchImpl });
  const completedAt = Date.now();
  const second = await getFreshDeezerPreview("Signed Cache Song", "Signed Cache Artist", { fetchImpl });

  assert.equal(first.status, "fresh");
  assert.equal(second.status, "cached");
  assert.equal(second.preview, preview);
  assert.equal(requests, 1, "the second resolution should not call Deezer again");
  assert.ok(first.expiresAt > requestedAt);
  assert.ok(first.expiresAt <= completedAt + 5 * 60_000);
});

test("Deezer preview cancellation reaches the active provider request", async () => {
  const started = deferred();
  const callerAbort = new AbortController();
  let providerSignal;
  const fetchImpl = async (_url, request) => {
    providerSignal = request.signal;
    started.resolve();
    return new Promise((_resolve, reject) => {
      const onAbort = () => reject(request.signal.reason);
      if (request.signal.aborted) onAbort();
      else request.signal.addEventListener("abort", onAbort, { once: true });
    });
  };
  const pending = getFreshDeezerPreview("Preview Cancellation Track", "Preview Cancellation Artist", {
    fetchImpl,
    signal: callerAbort.signal,
  });

  await started.promise;
  callerAbort.abort(new DOMException("listener skipped", "AbortError"));
  await assert.rejects(() => pending, (error) => error?.code === "network" && error?.cause?.name === "AbortError");
  assert.equal(providerSignal.aborted, true);
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

  // A label/fan upload cannot borrow creator identity merely by formatting the
  // title as "Artist - Song". YouTube exposes the uploader in channelTitle, so
  // an unrelated channel remains unproven even if it writes a perfect title.
  const labelLead = scoreYouTubeCandidate(
    youtubeCandidate("label00001", "Nelly Furtado - Say It Right (Official Music Video)", "GeffenVEVO"),
    { title: "Say It Right", artist: "Nelly Furtado" },
  );
  assert.equal(labelLead.rejected, true);
  assert.deepEqual(labelLead.reasons, ["wrong-creator"]);

  const hnmTitleSpoof = scoreYouTubeCandidate(
    youtubeCandidate("Bu5DMJ8LJnk", "J. Cole - MIDDLE CHILD (Official Audio)", "HNM Magazine"),
    { title: "MIDDLE CHILD", artist: "J. Cole" },
  );
  assert.equal(hnmTitleSpoof.rejected, true, "the concrete wrong uploader cannot impersonate J. Cole through its title");
  assert.deepEqual(hnmTitleSpoof.reasons, ["wrong-creator"]);

  const shortNameSpoof = scoreYouTubeCandidate(
    youtubeCandidate("u2spoof0001", "U2 - One (Official Audio)", "Unrelated Uploads"),
    { title: "One", artist: "U2" },
  );
  const shortNameOfficial = scoreYouTubeCandidate(
    youtubeCandidate("u2official1", "U2 - One (Official Audio)", "U2"),
    { title: "One", artist: "U2" },
  );
  assert.deepEqual(shortNameSpoof.reasons, ["wrong-creator"], "short artist names remain creator-gated");
  assert.equal(shortNameOfficial.rejected, false);

  const unicodeSpoof = scoreYouTubeCandidate(
    youtubeCandidate("unicodebad1", "宇多田ヒカル - First Love", "Unrelated Uploads"),
    { title: "First Love", artist: "宇多田ヒカル" },
  );
  const unicodeTopic = scoreYouTubeCandidate(
    youtubeCandidate("unicodegood", "宇多田ヒカル - First Love", "宇多田ヒカル - Topic"),
    { title: "First Love", artist: "宇多田ヒカル" },
  );
  assert.deepEqual(unicodeSpoof.reasons, ["wrong-creator"], "non-Latin names remain creator-gated");
  assert.equal(unicodeTopic.rejected, false);

  const punctuationOfficial = scoreYouTubeCandidate(
    youtubeCandidate("bangofficial", "!!! - Me and Giuliani Down by the School Yard", "!!! - Topic"),
    { title: "Me and Giuliani Down by the School Yard", artist: "!!!" },
  );
  const punctuationSpoof = scoreYouTubeCandidate(
    youtubeCandidate("bangspoof001", "!!! - Me and Giuliani Down by the School Yard", "!!! Fan Uploads"),
    { title: "Me and Giuliani Down by the School Yard", artist: "!!!" },
  );
  assert.equal(punctuationOfficial.rejected, false, "symbol-only artist names retain an exact Topic identity");
  assert.deepEqual(punctuationSpoof.reasons, ["wrong-creator"]);

  // Right creator, wrong song is still the wrong result.
  const wrongSong = scoreYouTubeCandidate(
    youtubeCandidate("wrongsong01", "Sabrina Carpenter - Please Please Please (Official Audio)", "Sabrina Carpenter - Topic"),
    { title: "Espresso", artist: "Sabrina Carpenter" },
  );
  assert.equal(wrongSong.rejected, true);
  assert.deepEqual(wrongSong.reasons, ["title-mismatch"]);
});

test("YouTube scoring rejects unrequested alternate recordings but permits an explicitly requested version", () => {
  for (const [suffix, expectedReason] of [
    ["Mashup", "mashup"],
    ["Medley", "medley"],
    ["Cover", "cover"],
    ["Remix", "remix-variant"],
    ["Bootleg", "remix-variant"],
    ["Sped Up", "alternate-recording"],
  ]) {
    const assessment = scoreYouTubeCandidate(
      youtubeCandidate(`variant${suffix.length}`.padEnd(11, "0").slice(0, 11), `J. Cole - MIDDLE CHILD (${suffix})`, "J. Cole"),
      { title: "MIDDLE CHILD", artist: "J. Cole" },
    );
    assert.equal(assessment.rejected, true, `${suffix} must not replace the requested studio recording`);
    assert.deepEqual(assessment.reasons, [expectedReason]);
  }

  const requestedRemix = scoreYouTubeCandidate(
    youtubeCandidate("remixokay1", "J. Cole - MIDDLE CHILD (Remix)", "J. Cole"),
    { title: "MIDDLE CHILD Remix", artist: "J. Cole" },
  );
  assert.equal(requestedRemix.rejected, false, "an explicit remix request may resolve to that remix");

  for (const prefix of ["Live at Slane Castle", "Acoustic", "Remix", "Cover"]) {
    const prefixed = scoreYouTubeCandidate(
      youtubeCandidate(`prefix${prefix.length}`.padEnd(11, "0").slice(0, 11), `${prefix} - One`, "U2 - Topic"),
      { title: "One", artist: "U2" },
    );
    assert.equal(prefixed.rejected, true, `${prefix} before a separator cannot bypass the variant gate`);
  }
});

test("YouTube recording identity keeps feature credits distinct", () => {
  const solo = scoreYouTubeCandidate(
    youtubeCandidate("levitating01", "Dua Lipa - Levitating (Official Audio)", "Dua Lipa - Topic"),
    { title: "Levitating", artist: "Dua Lipa" },
  );
  const feature = scoreYouTubeCandidate(
    youtubeCandidate("levitating02", "Dua Lipa - Levitating (feat. DaBaby)", "Dua Lipa - Topic"),
    { title: "Levitating", artist: "Dua Lipa" },
  );
  const requestedFeature = scoreYouTubeCandidate(
    youtubeCandidate("levitating02", "Dua Lipa - Levitating (feat. DaBaby)", "Dua Lipa - Topic"),
    { title: "Levitating feat. DaBaby", artist: "Dua Lipa" },
  );
  assert.equal(solo.rejected, false);
  assert.deepEqual(feature.reasons, ["title-mismatch"]);
  assert.equal(requestedFeature.rejected, false);
  assert.equal(selectCatalogueTrack("Levitating", [{ videoId: "levitating02", title: "Levitating (feat. DaBaby)" }]), null);
  assert.equal(selectCatalogueTrack("Levitating feat. DaBaby", [{ videoId: "levitating02", title: "Levitating (feat. DaBaby)" }]).videoId, "levitating02");
  assert.equal(scoreYouTubeCandidate(
    youtubeCandidate("levitating02", "Dua Lipa - Levitating ft. DaBaby", "Dua Lipa - Topic"),
    { title: "Levitating (featuring DaBaby)", artist: "Dua Lipa" },
  ).rejected, false, "feat/ft/featuring markers share one exact credit identity");
  assert.deepEqual(scoreYouTubeCandidate(
    youtubeCandidate("levitating03", "Dua Lipa - Levitating (feat. Missy Elliott)", "Dua Lipa - Topic"),
    { title: "Levitating feat. DaBaby", artist: "Dua Lipa" },
  ).reasons, ["title-mismatch"]);

  const providerProved = scoreYouTubeCandidate(
    youtubeCandidate("beautybeat1", "Beauty And A Beat (feat. Nicki Minaj)", "Justin Bieber - Topic", { duration: "PT3M48S" }),
    {
      title: "Beauty And A Beat",
      artist: "Justin Bieber",
      expectedDurationSec: 228,
      providerFeaturedCredits: ["Nicki Minaj"],
    },
  );
  assert.equal(providerProved.rejected, false);
  assert.ok(providerProved.reasons.includes("provider-omitted-feature-credit"));
});

test("licensed collaborations may resolve from an exact participating artist channel", () => {
  const collaboration = scoreYouTubeCandidate(
    youtubeCandidate("aptvideo001", "ROSÉ & Bruno Mars - APT. (Official Music Video)", "ROSÉ"),
    { title: "APT.", artist: "ROSÉ & Bruno Mars" },
  );
  const unrelated = scoreYouTubeCandidate(
    youtubeCandidate("aptvideo002", "ROSÉ & Bruno Mars - APT. (Official Music Video)", "Fan Uploads"),
    { title: "APT.", artist: "ROSÉ & Bruno Mars" },
  );
  assert.equal(collaboration.rejected, false);
  assert.deepEqual(unrelated.reasons, ["wrong-creator"]);
});

test("YouTube matching preserves non-Latin song identity on a trusted artist channel", () => {
  const rightSong = scoreYouTubeCandidate(
    youtubeCandidate("unicodehit1", "宇多田ヒカル - 初恋 (Official Audio)", "宇多田ヒカル - Topic"),
    { title: "初恋", artist: "宇多田ヒカル", trustedChannel: true },
  );
  const wrongSong = scoreYouTubeCandidate(
    youtubeCandidate("unicodemiss", "宇多田ヒカル - First Love (Official Audio)", "宇多田ヒカル - Topic"),
    { title: "初恋", artist: "宇多田ヒカル", trustedChannel: true },
  );
  assert.equal(rightSong.rejected, false);
  assert.equal(wrongSong.rejected, true, "a trusted channel proves the creator, never a different song");
  assert.deepEqual(wrongSong.reasons, ["title-mismatch"]);

  const picked = selectCatalogueTrack("初恋", [
    { videoId: "wrongunicode", title: "First Love (Official Audio)" },
    { videoId: "rightunicode", title: "初恋 (Official Audio)" },
  ]);
  assert.equal(picked.videoId, "rightunicode");
});

test("YouTube title identity rejects prefix-neighbor songs but keeps recognized decoration", () => {
  const wrongNeighbor = scoreYouTubeCandidate(
    youtubeCandidate("onetreehill", "U2 - One Tree Hill (Official Audio)", "U2 - Topic"),
    { title: "One", artist: "U2" },
  );
  const exactDecorated = scoreYouTubeCandidate(
    youtubeCandidate("oneofficial", "U2 - One (Official Audio)", "U2 - Topic"),
    { title: "One", artist: "U2" },
  );
  assert.deepEqual(wrongNeighbor.reasons, ["title-mismatch"]);
  assert.equal(exactDecorated.rejected, false);
  assert.equal(selectCatalogueTrack("One", [{ videoId: "onetreehill", title: "One Tree Hill" }]), null);
  assert.equal(selectCatalogueTrack("One", [{ videoId: "oneofficial", title: "One (Official Audio)" }]).videoId, "oneofficial");

  const bandNamedLive = scoreYouTubeCandidate(
    youtubeCandidate("liveband001", "Live - Lightning Crashes (Official Video)", "LiveVEVO"),
    { title: "Lightning Crashes", artist: "Live" },
  );
  assert.equal(bandNamedLive.rejected, false, "an artist name is not mistaken for a live-recording qualifier");

  const selfTitled = scoreYouTubeCandidate(
    youtubeCandidate("4YbD40UMwHQ", "Black Sabbath (2014 Remaster)", "Black Sabbath - Topic"),
    { title: "Black Sabbath - 2014 Remaster", artist: "Black Sabbath", trustedChannel: true },
  );
  const artistPrefixTitle = scoreYouTubeCandidate(
    youtubeCandidate("publicenemy1", "Public Enemy No. 1", "Public Enemy - Topic"),
    { title: "Public Enemy No. 1", artist: "Public Enemy", trustedChannel: true },
  );
  assert.equal(selfTitled.rejected, false, "a self-titled song retains the unstripped title identity");
  assert.equal(artistPrefixTitle.rejected, false, "an artist-name prefix inside the real song title is retained");
});

test("YouTube title identity preserves semantic kana marks", () => {
  const wrongKana = scoreYouTubeCandidate(
    youtubeCandidate("kanawrong01", "架空バンド - かみ (Official Audio)", "架空バンド - Topic"),
    { title: "がみ", artist: "架空バンド" },
  );
  const rightKana = scoreYouTubeCandidate(
    youtubeCandidate("kanaright01", "架空バンド - がみ (Official Audio)", "架空バンド - Topic"),
    { title: "がみ", artist: "架空バンド" },
  );
  assert.deepEqual(wrongKana.reasons, ["title-mismatch"], "dakuten is semantic and cannot be discarded");
  assert.equal(rightKana.rejected, false);
  assert.equal(selectCatalogueTrack("がみ", [{ videoId: "kanawrong01", title: "かみ" }]), null);
  assert.equal(selectCatalogueTrack("がみ", [{ videoId: "kanaright01", title: "がみ (Official Audio)" }]).videoId, "kanaright01");

  const wrongIndic = scoreYouTubeCandidate(
    youtubeCandidate("indicwrong1", "कलाकार - क (Official Audio)", "कलाकार - Topic"),
    { title: "कि", artist: "कलाकार" },
  );
  const rightIndic = scoreYouTubeCandidate(
    youtubeCandidate("indicright1", "कलाकार - कि (Official Audio)", "कलाकार - Topic"),
    { title: "कि", artist: "कलाकार" },
  );
  assert.deepEqual(wrongIndic.reasons, ["title-mismatch"], "Indic vowel marks remain part of the song identity");
  assert.equal(rightIndic.rejected, false);
  assert.equal(selectCatalogueTrack("कि", [{ videoId: "indicwrong1", title: "क" }]), null);
  assert.equal(selectCatalogueTrack("कि", [{ videoId: "indicright1", title: "कि (Official Audio)" }]).videoId, "indicright1");
});

test("symbol-only song titles retain an exact identity", () => {
  const exact = scoreYouTubeCandidate(
    youtubeCandidate("symbolsong1", "Symbol Artist - !!! (Official Audio)", "Symbol Artist - Topic"),
    { title: "!!!", artist: "Symbol Artist" },
  );
  assert.equal(exact.rejected, false);
  assert.equal(selectCatalogueTrack("!!!", [{ videoId: "symbolsong1", title: "!!! (Official Audio)" }]).videoId, "symbolsong1");
  assert.equal(selectCatalogueTrack("!!!", [{ videoId: "questions01", title: "??? (Official Audio)" }]), null);
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
  assert.equal(selectArtistChannel("U2", [
    { id: { channelId: "UC_u2_spoof" }, snippet: { title: "U2 Fan Uploads" } },
    { id: { channelId: "UC_u2" }, snippet: { title: "U2" } },
  ]).channelId, "UC_u2", "short names require an exact recognized channel identity");
  assert.equal(selectArtistChannel("宇多田ヒカル", [
    { id: { channelId: "UC_unicode_spoof" }, snippet: { title: "宇多田ヒカル Fans" } },
    { id: { channelId: "UC_unicode_topic" }, snippet: { title: "宇多田ヒカル - Topic" } },
  ]).channelId, "UC_unicode_topic", "Unicode creator names survive identity normalization");
  assert.equal(selectArtistChannel("!!!", [
    { id: { channelId: "UC_bang_spoof" }, snippet: { title: "!!! Fan Uploads" } },
    { id: { channelId: "UC_bang_topic" }, snippet: { title: "!!! - Topic" } },
  ]).channelId, "UC_bang_topic", "symbol-only names use exact display identity rather than collapsing empty");
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
  const artist = "Nelly Furtado";
  const norm = normName(artist);
  if (!artistStmts.byNorm.get(norm)) artistStmts.upsert.run(artistRow(norm, { name: artist }, "test"));
  artistStmts.setChannel.run("UC_topic", Date.now(), "youtube_v4", norm);
  const calls = [];
  const fetchImpl = async (url) => {
    const u = String(url);
    calls.push(u);
    let data = {};
    if (u.includes("/channels?")) data = { items: [{ contentDetails: { relatedPlaylists: { uploads: "UU_topic" } } }] };
    else if (u.includes("/playlistItems?")) data = { items: [
      { snippet: { title: "Say It Right", resourceId: { videoId: "studiotrack" } } },
      { snippet: { title: "Maneater", resourceId: { videoId: "maneater001" } } },
    ] };
    else data = { items: [youtubeCandidate("studiotrack", "Say It Right", "Nelly Furtado - Topic")] };
    return { ok: true, status: 200, json: async () => data };
  };
  const result = await resolveYouTubeTrack("Say It Right", artist, { apiKey: "test-key", fetchImpl });
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
  const artist = "Shared Artist";
  const norm = normName(artist);
  artistStmts.upsert.run(artistRow(norm, { name: artist }, "test"));
  artistStmts.setChannel.run("UC_shared", Date.now(), "youtube_v4", norm);
  let requests = 0;
  const fetchImpl = async (url) => {
    requests += 1;
    await new Promise((resolve) => setTimeout(resolve, 2));
    const value = String(url);
    if (value.includes("/channels?")) return { ok: true, status: 200, json: async () => ({ items: [{ contentDetails: { relatedPlaylists: { uploads: "UU_shared" } } }] }) };
    if (value.includes("/playlistItems?")) return { ok: true, status: 200, json: async () => ({ items: [{ snippet: { title: "Shared Song", resourceId: { videoId: "sharedtrack" } } }] }) };
    return { ok: true, status: 200, json: async () => ({ items: [youtubeCandidate("sharedtrack", "Shared Song", "Shared Artist - Topic")] }) };
  };
  const [first, second] = await Promise.all([
    resolveYouTubeTrack("Shared Song", artist, { apiKey: "test-key", fetchImpl }),
    resolveYouTubeTrack("Shared Song", artist, { apiKey: "test-key", fetchImpl }),
  ]);
  assert.equal(first.videoId, "sharedtrack");
  assert.deepEqual(second, first);
  assert.equal(requests, 3, "one shared data-only channel/catalogue/video request chain");
  assert.equal(youtubeProviderStatus().inFlight, 0);
});

test("one cancelled coalesced listener does not abort YouTube work needed by another", async () => {
  const gate = deferred();
  const started = deferred();
  const leaderAbort = new AbortController();
  const followerAbort = new AbortController();
  let providerSignal;
  let requests = 0;
  const fetchImpl = async (_url, request) => {
    requests += 1;
    providerSignal = request.signal;
    started.resolve();
    await gate.promise;
    if (request.signal.aborted) throw request.signal.reason;
    return { ok: true, status: 200, json: async () => ({ items: [] }) };
  };
  const leader = resolveYouTubeTrack("Coalesced Cancellation Track", "", {
    apiKey: "test-key",
    fetchImpl,
    signal: leaderAbort.signal,
  });
  const follower = resolveYouTubeTrack("Coalesced Cancellation Track", "", {
    apiKey: "test-key",
    fetchImpl,
    signal: followerAbort.signal,
  });

  await started.promise;
  leaderAbort.abort(new DOMException("leader left", "AbortError"));
  await assert.rejects(() => leader, { name: "AbortError" });
  assert.equal(providerSignal.aborted, false, "the live follower retains the shared provider request");
  gate.resolve();
  assert.equal((await follower).status, "low_confidence");
  assert.equal(requests, 1, "both listeners still share one search request");
});

test("the final cancelled listener aborts its in-flight YouTube provider request", async () => {
  const started = deferred();
  const stopped = deferred();
  const callerAbort = new AbortController();
  let providerSignal;
  const fetchImpl = async (_url, request) => {
    providerSignal = request.signal;
    started.resolve();
    return new Promise((_resolve, reject) => {
      const onAbort = () => {
        stopped.resolve();
        reject(request.signal.reason);
      };
      if (request.signal.aborted) onAbort();
      else request.signal.addEventListener("abort", onAbort, { once: true });
    });
  };
  const pending = resolveYouTubeTrack("Solo Cancellation Track", "", {
    apiKey: "test-key",
    fetchImpl,
    signal: callerAbort.signal,
  });

  await started.promise;
  callerAbort.abort(new DOMException("listener skipped", "AbortError"));
  await assert.rejects(() => pending, { name: "AbortError" });
  await stopped.promise;
  assert.equal(providerSignal.aborted, true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(youtubeProviderStatus().inFlightByKind.tracks, 0);
});

test("interactive YouTube resolution enforces a shared deadline below the client timeout", async () => {
  const started = deferred();
  let providerSignal;
  const fetchImpl = async (_url, request) => {
    providerSignal = request.signal;
    started.resolve();
    return new Promise((_resolve, reject) => {
      const onAbort = () => reject(request.signal.reason);
      if (request.signal.aborted) onAbort();
      else request.signal.addEventListener("abort", onAbort, { once: true });
    });
  };
  const beganAt = Date.now();
  const pending = resolveYouTubeTrack("Deadline Cancellation Track", "", {
    apiKey: "test-key",
    fetchImpl,
    deadlineMs: 25,
  });

  await started.promise;
  await assert.rejects(() => pending, (error) => error?.code === "resolution_timeout" && error?.retryable === true);
  assert.equal(providerSignal.aborted, true);
  assert.equal(providerSignal.reason?.name, "TimeoutError");
  assert.ok(Date.now() - beganAt < 1_000, "the server deadline ends provider work promptly");
});

test("resolver searches the artist's channel first, so reactions can never win", async () => {
  // A reaction upload outranks the real song on a blind keyword search. Scoping
  // the search to the artist's Topic channel means it is never even a candidate.
  // A distinct artist from the catalogue test above: the provider cache is shared
  // across tests, so reusing a name would simply replay the cached catalogue.
  const artist = "Feist";
  const norm = normName(artist);
  if (!artistStmts.byNorm.get(norm)) artistStmts.upsert.run(artistRow(norm, { name: artist }, "test"));
  artistStmts.setChannel.run("UC_feist", Date.now(), "youtube_v4", norm);
  const fetchImpl = async (url) => {
    const u = String(url);
    let data = {};
    // No uploads playlist here, so the cheap catalogue path finds nothing and
    // the resolver falls back to searching inside the artist's channel.
    if (u.includes("/channels?")) data = { items: [] };
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
  const result = await resolveYouTubeTrack("Mushaboom", artist, { apiKey: "test-key", fetchImpl });
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
  const nonLatinKeys = [
    trackOverrideKey("初恋", "宇多田ヒカル"),
    trackOverrideKey("群青", "ヨルシカ"),
    trackOverrideKey("봄날", "방탄소년단"),
  ];
  assert.equal(new Set(nonLatinKeys).size, 3, "Unicode pins retain separate song/artist identities");
});

test("provider recording proof keeps omitted feature credits exact and fails closed when proof is unavailable", async () => {
  const artist = "Proofed Pop Artist";
  const title = "Shared Recording";
  const norm = normName(artist);
  const channelId = "UC_proofed_recording";
  const featureSourceId = "1234638792";
  const soloSourceId = "1124841682";
  const outageSourceId = "9990001112";
  const soloId = "solo1234567";
  const featureId = "feat1234567";
  const otherId = "other123456";
  let proofOutage = true;
  artistStmts.upsert.run(artistRow(norm, { name: artist }, "test"));
  artistStmts.setChannel.run(channelId, Date.now(), "youtube_v4", norm);
  const providerCalls = new Map();
  const candidates = [
    youtubeCandidate(soloId, title, `${artist} - Topic`, { duration: "PT3M23S", views: "900000000" }),
    youtubeCandidate(featureId, `${title} (feat. Guest Rapper)`, `${artist} - Topic`, { duration: "PT3M23S", views: "1000" }),
    youtubeCandidate(otherId, "Different Recording (feat. Guest Rapper)", `${artist} - Topic`, { duration: "PT3M23S" }),
  ];
  const fetchImpl = async (url) => {
    const parsed = new URL(String(url));
    if (parsed.hostname === "api.deezer.com") {
      const sourceId = parsed.pathname.split("/").pop();
      providerCalls.set(sourceId, (providerCalls.get(sourceId) || 0) + 1);
      if (sourceId === outageSourceId && proofOutage) return { ok: false, status: 503, json: async () => ({}) };
      return {
        ok: true,
        status: 200,
        json: async () => ({
          id: Number(sourceId),
          title,
          duration: 203,
          artist: { name: artist },
          contributors: sourceId === featureSourceId || sourceId === outageSourceId
            ? [{ name: artist, role: "Main" }, { name: "Guest Rapper", role: "Featured" }]
            : [{ name: artist, role: "Main" }],
        }),
      };
    }
    if (parsed.pathname.endsWith("/channels")) {
      return { ok: true, status: 200, json: async () => ({ items: [{ contentDetails: { relatedPlaylists: { uploads: "UU_proofed_recording" } } }] }) };
    }
    if (parsed.pathname.endsWith("/playlistItems")) {
      return { ok: true, status: 200, json: async () => ({ items: candidates.map((item) => ({
        snippet: { title: item.snippet.title, resourceId: { videoId: item.id } },
      })) }) };
    }
    if (parsed.pathname.endsWith("/search")) {
      return { ok: true, status: 200, json: async () => ({
        items: candidates.map((item) => ({ id: { videoId: item.id } })),
      }) };
    }
    if (parsed.pathname.endsWith("/videos")) {
      const ids = new Set((parsed.searchParams.get("id") || "").split(","));
      return { ok: true, status: 200, json: async () => ({ items: candidates.filter((item) => ids.has(item.id)) }) };
    }
    throw new Error(`unexpected proof fixture endpoint: ${parsed}`);
  };

  const feature = await resolveYouTubeTrack(title, artist, {
    apiKey: "test-key",
    allowSearch: false,
    expectedDurationSec: 203,
    sourceProvider: "deezer",
    sourceId: featureSourceId,
    fetchImpl,
  });
  assert.equal(feature.videoId, featureId,
    "authoritative Featured metadata overrides the higher-view solo candidate for that exact provider recording");

  const solo = await resolveYouTubeTrack(title, artist, {
    apiKey: "test-key",
    allowSearch: false,
    expectedDurationSec: 203,
    sourceProvider: "deezer",
    sourceId: soloSourceId,
    fetchImpl,
  });
  assert.equal(solo.videoId, soloId, "verified no-feature metadata preserves the solo recording");
  assert.notEqual(
    youtubeCacheKey(title, artist, `deezer:${featureSourceId}`),
    youtubeCacheKey(title, artist, `deezer:${soloSourceId}`),
    "provider recordings with the same display title have isolated shared cache keys",
  );

  const unavailable = await resolveYouTubeTrack(title, artist, {
    apiKey: "test-key",
    allowSearch: true,
    expectedDurationSec: 203,
    sourceProvider: "deezer",
    sourceId: outageSourceId,
    fetchImpl,
  });
  assert.equal(unavailable.videoId, null);
  assert.deepEqual(unavailable, { videoId: null, status: "recording_proof_unavailable", retryable: true },
    "a proof outage is temporary, distinctly classified, and never plays a different recording");
  assert.equal(
    db.prepare("SELECT 1 FROM yt_cache WHERE key=?").get(youtubeCacheKey(title, artist, `deezer:${outageSourceId}`)),
    undefined,
    "an indeterminate provider identity must never become a shared three-day YouTube miss",
  );

  proofOutage = false;
  const recovered = await resolveYouTubeTrack(title, artist, {
    apiKey: "test-key",
    allowSearch: false,
    expectedDurationSec: 203,
    sourceProvider: "deezer",
    sourceId: outageSourceId,
    fetchImpl,
  });
  assert.equal(recovered.videoId, featureId, "the next healthy request re-fetches proof and resolves the exact feature recording");
  assert.equal(providerCalls.get(outageSourceId), 2, "proof recovery is not hidden behind a negative YouTube cache row");

  const poisoned = await resolveYouTubeTrack("Different Recording", artist, {
    apiKey: "test-key",
    allowSearch: false,
    expectedDurationSec: 203,
    sourceProvider: "deezer",
    sourceId: featureSourceId,
    fetchImpl,
  });
  assert.equal(poisoned.videoId, null, "a proof cached for one title cannot authorize another title");
  assert.equal(providerCalls.get(featureSourceId), 2, "the mismatched identity cannot reuse the first title's proof cache entry");
});

test("fresh tuple positives promote only to the exact matching Deezer recording", async () => {
  const artist = "Tuple Promotion Artist";
  const featureTitle = "Feature Tuple Recording";
  const soloTitle = "Solo Tuple Recording";
  const featureVideoId = "tuplefeat01";
  const soloVideoId = "tuplesolo01";
  const featureSourceId = "7000000001";
  const soloSourceId = "7000000002";
  const mismatchedSoloSourceId = "7000000003";
  const mismatchedFeatureSourceId = "7000000004";
  const at = Date.now();
  const seedTuplePositive = (title, videoId, videoTitle) => db.prepare(`INSERT OR REPLACE INTO yt_cache
    (key,video_id,updated_at,metadata,score,expires_at,rejected_ids) VALUES (?,?,?,?,?,?,?)`).run(
    youtubeCacheKey(title, artist),
    videoId,
    at,
    JSON.stringify({
      title: videoTitle,
      channel: `${artist} - Topic`,
      reasons: ["artist-channel", "licensed"],
      duration: 203,
      matchVersion: YOUTUBE_MATCH_CACHE_VERSION,
    }),
    100,
    at + 24 * 60 * 60 * 1000,
    "[]",
  );
  seedTuplePositive(featureTitle, featureVideoId, `${featureTitle} (feat. Guest Rapper)`);
  seedTuplePositive(soloTitle, soloVideoId, soloTitle);

  const candidates = new Map([
    [featureVideoId, youtubeCandidate(featureVideoId, `${featureTitle} (feat. Guest Rapper)`, `${artist} - Topic`, { duration: "PT3M23S" })],
    [soloVideoId, youtubeCandidate(soloVideoId, soloTitle, `${artist} - Topic`, { duration: "PT3M23S" })],
  ]);
  let searches = 0;
  const fetchImpl = async (url) => {
    const parsed = new URL(String(url));
    if (parsed.hostname === "api.deezer.com") {
      const sourceId = parsed.pathname.split("/").pop();
      const title = sourceId === featureSourceId || sourceId === mismatchedSoloSourceId ? featureTitle : soloTitle;
      const featured = sourceId === featureSourceId || sourceId === mismatchedFeatureSourceId;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          id: Number(sourceId),
          title,
          duration: 203,
          artist: { name: artist },
          contributors: featured
            ? [{ name: artist, role: "Main" }, { name: "Guest Rapper", role: "Featured" }]
            : [{ name: artist, role: "Main" }],
        }),
      };
    }
    if (parsed.pathname.endsWith("/videos")) {
      const id = parsed.searchParams.get("id");
      return { ok: true, status: 200, json: async () => ({ items: candidates.has(id) ? [candidates.get(id)] : [] }) };
    }
    if (parsed.pathname.endsWith("/search")) searches += 1;
    throw new Error(`tuple promotion must remain data-only: ${parsed}`);
  };

  const matchingFeature = await resolveYouTubeTrack(featureTitle, artist, {
    apiKey: "test-key",
    allowSearch: false,
    expectedDurationSec: 203,
    sourceProvider: "deezer",
    sourceId: featureSourceId,
    fetchImpl,
  });
  assert.equal(matchingFeature.videoId, featureVideoId);
  assert.equal(db.prepare("SELECT video_id FROM yt_cache WHERE key=?").get(
    youtubeCacheKey(featureTitle, artist, `deezer:${featureSourceId}`),
  )?.video_id, featureVideoId, "a revalidated feature tuple positive is promoted to that exact source key");

  const featureMustNotLeakToSolo = await resolveYouTubeTrack(featureTitle, artist, {
    apiKey: "test-key",
    allowSearch: false,
    expectedDurationSec: 203,
    sourceProvider: "deezer",
    sourceId: mismatchedSoloSourceId,
    fetchImpl,
  });
  assert.deepEqual(featureMustNotLeakToSolo, { videoId: null, status: "search_deferred" });
  assert.equal(db.prepare("SELECT 1 FROM yt_cache WHERE key=?").get(
    youtubeCacheKey(featureTitle, artist, `deezer:${mismatchedSoloSourceId}`),
  ), undefined, "a feature tuple positive never becomes authority for a solo provider recording");

  const matchingSolo = await resolveYouTubeTrack(soloTitle, artist, {
    apiKey: "test-key",
    allowSearch: false,
    expectedDurationSec: 203,
    sourceProvider: "deezer",
    sourceId: soloSourceId,
    fetchImpl,
  });
  assert.equal(matchingSolo.videoId, soloVideoId);
  assert.equal(db.prepare("SELECT video_id FROM yt_cache WHERE key=?").get(
    youtubeCacheKey(soloTitle, artist, `deezer:${soloSourceId}`),
  )?.video_id, soloVideoId, "a revalidated solo tuple positive is promoted to that exact source key");

  const soloMustNotLeakToFeature = await resolveYouTubeTrack(soloTitle, artist, {
    apiKey: "test-key",
    allowSearch: false,
    expectedDurationSec: 203,
    sourceProvider: "deezer",
    sourceId: mismatchedFeatureSourceId,
    fetchImpl,
  });
  assert.deepEqual(soloMustNotLeakToFeature, { videoId: null, status: "search_deferred" });
  assert.equal(db.prepare("SELECT 1 FROM yt_cache WHERE key=?").get(
    youtubeCacheKey(soloTitle, artist, `deezer:${mismatchedFeatureSourceId}`),
  ), undefined, "a solo tuple positive never becomes authority for a feature provider recording");
  assert.equal(searches, 0);
});

test("bundled no-duration Spotify solo and feature titles resolve only into exact source keys", async () => {
  const at = Date.now();
  const fixtures = [
    {
      artist: "Turnstile",
      title: "BIRDS",
      sourceId: "0kshHISCRGn9MwpkbqafG4",
      videoId: "spotsolo001",
      videoTitle: "BIRDS",
    },
    {
      artist: "Beyoncé",
      title: "Crazy In Love (feat. JAY-Z)",
      sourceId: "5IVuqXILoxVWvWEPm82Jxr",
      videoId: "spotfeat001",
      videoTitle: "Crazy In Love (feat. JAY-Z)",
    },
  ];
  const candidates = new Map();
  for (const fixture of fixtures) {
    assert.equal(spotifyCatalogueTrackProof(fixture)?.durationSec, 0,
      "the real bundled row proves identity without inventing duration");
    candidates.set(fixture.videoId, youtubeCandidate(
      fixture.videoId,
      fixture.videoTitle,
      `${fixture.artist} - Topic`,
    ));
    db.prepare(`INSERT OR REPLACE INTO yt_cache
      (key,video_id,updated_at,metadata,score,expires_at,rejected_ids) VALUES (?,?,?,?,?,?,?)`).run(
      youtubeCacheKey(fixture.title, fixture.artist),
      fixture.videoId,
      at,
      JSON.stringify({
        title: fixture.videoTitle,
        channel: `${fixture.artist} - Topic`,
        reasons: ["artist-channel", "licensed"],
        matchVersion: YOUTUBE_MATCH_CACHE_VERSION,
      }),
      100,
      at + 24 * 60 * 60 * 1000,
      "[]",
    );
  }

  let videoReads = 0;
  const fetchImpl = async (url) => {
    const parsed = new URL(String(url));
    assert.ok(parsed.pathname.endsWith("/videos"), `Spotify tuple promotion stays data-only: ${parsed}`);
    videoReads += 1;
    const requested = (parsed.searchParams.get("id") || "").split(",");
    return {
      ok: true,
      status: 200,
      json: async () => ({ items: requested.map((id) => candidates.get(id)).filter(Boolean) }),
    };
  };

  for (const fixture of fixtures) {
    const result = await resolveYouTubeTrack(fixture.title, fixture.artist, {
      apiKey: "test-key",
      allowSearch: false,
      sourceProvider: "spotify",
      sourceId: fixture.sourceId,
      fetchImpl,
    });
    assert.equal(result.videoId, fixture.videoId);
    assert.equal(db.prepare("SELECT video_id FROM yt_cache WHERE key=?").get(
      youtubeCacheKey(fixture.title, fixture.artist, `spotify:${fixture.sourceId}`),
    )?.video_id, fixture.videoId, "the validated recording is stored only under its Spotify source identity");
  }
  assert.equal(videoReads, fixtures.length);
});

test("Spotify catalogue proof prevents tuple solo/feature leaks and unknown-ID cache access", async () => {
  const artist = "Spotify Recording Boundary";
  const sharedTitle = "Parallel Signal";
  const durationTitle = "Duration Boundary";
  const soloSourceId = "SpSoloBoundary001";
  const featureSourceId = "SpFeatureBoundary001";
  const durationSourceId = "SpDurationBoundary001";
  const unknownSourceId = "SpUnknownBoundary001";
  const soloVideoId = "spsolo00001";
  const featureVideoId = "spfeat00001";
  const durationVideoId = "spdur000001";
  artistStmts.upsert.run(artistRow(normName(artist), {
    name: artist,
    topTracks: [
      { title: sharedTitle, url: `https://open.spotify.com/track/${soloSourceId}` },
      { title: `${sharedTitle} (feat. Guest Rapper)`, url: `https://open.spotify.com/track/${featureSourceId}` },
      { title: durationTitle, url: `https://open.spotify.com/track/${durationSourceId}` },
    ],
  }, "test"));
  invalidateSongIndex();

  const candidates = new Map([
    [soloVideoId, youtubeCandidate(soloVideoId, sharedTitle, `${artist} - Topic`, { duration: "PT3M23S" })],
    [featureVideoId, youtubeCandidate(featureVideoId, `${sharedTitle} (feat. Guest Rapper)`, `${artist} - Topic`, { duration: "PT3M23S" })],
    [durationVideoId, youtubeCandidate(durationVideoId, durationTitle, `${artist} - Topic`, { duration: "PT4M20S" })],
  ]);
  const seedTuple = (title, videoId, videoTitle) => {
    const at = Date.now();
    db.prepare(`INSERT OR REPLACE INTO yt_cache
      (key,video_id,updated_at,metadata,score,expires_at,rejected_ids) VALUES (?,?,?,?,?,?,?)`).run(
      youtubeCacheKey(title, artist),
      videoId,
      at,
      JSON.stringify({
        title: videoTitle,
        channel: `${artist} - Topic`,
        reasons: ["artist-channel", "licensed"],
        matchVersion: YOUTUBE_MATCH_CACHE_VERSION,
      }),
      100,
      at + 24 * 60 * 60 * 1000,
      "[]",
    );
  };
  let fetches = 0;
  const fetchImpl = async (url) => {
    fetches += 1;
    const parsed = new URL(String(url));
    assert.ok(parsed.pathname.endsWith("/videos"), `source promotion must not search: ${parsed}`);
    const requested = (parsed.searchParams.get("id") || "").split(",");
    return {
      ok: true,
      status: 200,
      json: async () => ({ items: requested.map((id) => candidates.get(id)).filter(Boolean) }),
    };
  };

  seedTuple(sharedTitle, featureVideoId, `${sharedTitle} (feat. Guest Rapper)`);
  const featureIntoSolo = await resolveYouTubeTrack(sharedTitle, artist, {
    apiKey: "test-key",
    allowSearch: false,
    sourceProvider: "spotify",
    sourceId: soloSourceId,
    fetchImpl,
  });
  assert.deepEqual(featureIntoSolo, { videoId: null, status: "search_deferred" });
  assert.equal(db.prepare("SELECT 1 FROM yt_cache WHERE key=?").get(
    youtubeCacheKey(sharedTitle, artist, `spotify:${soloSourceId}`),
  ), undefined, "a feature tuple positive cannot become the Spotify solo source");

  seedTuple(sharedTitle, soloVideoId, sharedTitle);
  const soloIntoFeature = await resolveYouTubeTrack(sharedTitle, artist, {
    apiKey: "test-key",
    allowSearch: false,
    sourceProvider: "spotify",
    sourceId: featureSourceId,
    fetchImpl,
  });
  assert.deepEqual(soloIntoFeature, { videoId: null, status: "search_deferred" });
  assert.equal(db.prepare("SELECT 1 FROM yt_cache WHERE key=?").get(
    youtubeCacheKey(sharedTitle, artist, `spotify:${featureSourceId}`),
  ), undefined, "a solo tuple positive cannot become the Spotify feature source");

  const beforeUnknown = fetches;
  const unknown = await resolveYouTubeTrack(sharedTitle, artist, {
    apiKey: "test-key",
    allowSearch: true,
    sourceProvider: "spotify",
    sourceId: unknownSourceId,
    fetchImpl,
  });
  assert.deepEqual(unknown, { videoId: null, status: "search_deferred" });
  assert.equal(fetches, beforeUnknown, "an unproved Spotify ID returns before reading or validating the tuple positive");
  assert.equal(db.prepare("SELECT 1 FROM yt_cache WHERE key=?").get(
    youtubeCacheKey(sharedTitle, artist, `spotify:${unknownSourceId}`),
  ), undefined);

  seedTuple(durationTitle, durationVideoId, durationTitle);
  const durationMismatch = await resolveYouTubeTrack(durationTitle, artist, {
    apiKey: "test-key",
    allowSearch: false,
    expectedDurationSec: 203,
    sourceProvider: "spotify",
    sourceId: durationSourceId,
    fetchImpl,
  });
  assert.deepEqual(durationMismatch, { videoId: null, status: "search_deferred" });
  assert.equal(db.prepare("SELECT 1 FROM yt_cache WHERE key=?").get(
    youtubeCacheKey(durationTitle, artist, `spotify:${durationSourceId}`),
  ), undefined, "when request duration exists, a materially different recording is rejected");
  assert.equal(fetches, beforeUnknown + 1, "the unknown-ID branch is the only case that skips even tuple validation");
});

test("tuple negatives never suppress a source-scoped recording", async () => {
  const title = "Tuple Negative Isolation";
  const artist = "Tuple Negative Artist";
  const sourceId = "7111111111";
  const at = Date.now();
  db.prepare(`INSERT OR REPLACE INTO yt_cache
    (key,video_id,updated_at,metadata,score,expires_at,rejected_ids) VALUES (?,NULL,?,NULL,NULL,?,?)`).run(
    youtubeCacheKey(title, artist),
    at,
    at + 24 * 60 * 60 * 1000,
    "[]",
  );
  const result = await resolveYouTubeTrack(title, artist, {
    apiKey: "test-key",
    allowSearch: false,
    sourceProvider: "deezer",
    sourceId,
    fetchImpl: async () => { throw new Error("tuple negatives must not be fetched or promoted"); },
  });
  assert.deepEqual(result, { videoId: null, status: "search_deferred" });
  assert.equal(db.prepare("SELECT 1 FROM yt_cache WHERE key=?").get(
    youtubeCacheKey(title, artist, `deezer:${sourceId}`),
  ), undefined);
});

test("an actor-local exclusion can choose a catalogue alternate without rewriting the shared cache", async () => {
  const title = "Guest Alternate Song";
  const artist = "Guest Alternate Artist";
  const failedId = "guestfail01";
  const alternateId = "guestgood01";
  const key = youtubeCacheKey(title, artist);
  const at = Date.now();
  artistStmts.upsert.run(artistRow(artist, { name: artist, popularity: 30 }, "test"));
  artistStmts.setChannel.run("UC_guest_alternate", at, "youtube_v4", artist.toLowerCase());
  db.prepare(`INSERT OR REPLACE INTO yt_cache
    (key,video_id,updated_at,metadata,score,expires_at,rejected_ids) VALUES (?,?,?,?,?,?,?)`).run(
    key,
    failedId,
    at,
    JSON.stringify({ title, channel: `${artist} - Topic`, matchVersion: YOUTUBE_MATCH_CACHE_VERSION }),
    99,
    at + 24 * 60 * 60 * 1000,
    "[]",
  );
  const result = await resolveYouTubeTrack(title, artist, {
    apiKey: "test-key",
    allowSearch: false,
    excludedVideoIds: [failedId],
    fetchImpl: async (url) => {
      const value = String(url);
      const parsed = new URL(value);
      if (value.includes("/channels?") && parsed.searchParams.get("part") === "contentDetails") {
        return { ok: true, status: 200, json: async () => ({ items: [{ contentDetails: { relatedPlaylists: { uploads: "UU_guest_alternate" } } }] }) };
      }
      if (value.includes("/playlistItems?")) {
        return { ok: true, status: 200, json: async () => ({ items: [{ snippet: { title, resourceId: { videoId: alternateId } } }] }) };
      }
      if (value.includes("/videos?")) {
        return { ok: true, status: 200, json: async () => ({ items: [youtubeCandidate(alternateId, `${artist} - ${title} (Official Audio)`, `${artist} - Topic`)] }) };
      }
      throw new Error(`guest catalogue recovery must not search: ${value}`);
    },
  });
  assert.equal(result.videoId, alternateId);
  assert.equal(result.status, "artist_catalogue");
  assert.deepEqual({ ...db.prepare("SELECT video_id,rejected_ids FROM yt_cache WHERE key=?").get(key) }, {
    video_id: failedId,
    rejected_ids: "[]",
  });
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

test("a known Topic channel resolves multiple songs without any channel-discovery search", async () => {
  // Channel identity is learned by catalogue/Wikidata jobs. Track resolution
  // consumes no search.list request merely to rediscover that identity.
  const now = Date.now();
  artistStmts.upsert.run(artistRow("Channel Keeper", { name: "Channel Keeper", popularity: 50 }, "test"));
  artistStmts.setChannel.run("UC_keeper", now, "youtube_v4", "channel keeper");

  let channelSearches = 0;
  const fetchImpl = async (url) => {
    const u = String(url);
    let data = {};
    if (u.includes("type=channel")) { channelSearches += 1; data = { items: [] }; }
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
  assert.equal(channelSearches, 0, "track resolution never searches for a channel identity");

  // The channel id is now on the artist row with YouTube provenance and a
  // refresh timestamp, so it is reused without another discovery search.
  const stored = artistStmts.getChannel.get("channel keeper");
  assert.equal(stored.channelId, "UC_keeper");
  assert.ok(stored.at >= now);
  assert.equal(stored.source, "youtube_v4");

  // A DIFFERENT song by the same artist resolves from the cached catalogue with
  // no further channel discovery search.
  const second = await resolveYouTubeTrack("Second Single", "Channel Keeper", { apiKey: "test-key", fetchImpl });
  assert.equal(second.videoId, "keeper_b");
  assert.equal(channelSearches, 0, "the stored channel is reused without any discovery search");
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

test("one cold miss spends one actor permit and at most one in-channel search", async () => {
  const artist = "Single Search Artist";
  const title = "Wanted Recording";
  const norm = normName(artist);
  artistStmts.upsert.run(artistRow(norm, { name: artist, popularity: 40 }, "test"));
  artistStmts.setChannel.run("UC_single_search", Date.now(), "youtube_v4", norm);
  let searchCalls = 0;
  let actorCharges = 0;
  const result = await resolveYouTubeTrack(title, artist, {
    apiKey: "test-key",
    beforeSearch: () => { actorCharges += 1; },
    fetchImpl: async (url) => {
      const parsed = new URL(String(url));
      if (parsed.pathname.endsWith("/channels")) {
        // No uploads playlist means the catalogue is incomplete and justifies
        // exactly one in-channel search.
        return { ok: true, status: 200, json: async () => ({ items: [] }) };
      }
      if (parsed.pathname.endsWith("/search")) {
        searchCalls += 1;
        assert.equal(parsed.searchParams.get("channelId"), "UC_single_search",
          "the resolver chooses the safer known-channel search, never a second global search");
        return { ok: true, status: 200, json: async () => ({ items: [{ id: { videoId: "wrongsong01" } }] }) };
      }
      if (parsed.pathname.endsWith("/videos")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ items: [youtubeCandidate("wrongsong01", "Completely Different Song", `${artist} - Topic`)] }),
        };
      }
      throw new Error(`unexpected single-search endpoint: ${parsed.pathname}`);
    },
  });
  assert.deepEqual(result, { videoId: null, status: "low_confidence" },
    "a wrong recording remains rejected instead of triggering a broader guess");
  assert.equal(searchCalls, 1);
  assert.equal(actorCharges, 1, "one explicit cold track attempt charges the actor once");
});

test("fresh legacy channel mappings are revalidated under the current Unicode creator policy", async () => {
  artistStmts.upsert.run(artistRow("Si", { name: "Si", popularity: 35 }, "test"));
  artistStmts.setChannel.run("UC_legacy_accent", Date.now(), "youtube", "si");
  let snippetChecks = 0;
  const result = await resolveYouTubeTrack("Home", "Si", {
    apiKey: "test-key",
    allowSearch: false,
    fetchImpl: async (url) => {
      const value = String(url);
      if (value.includes("/channels?") && new URL(value).searchParams.get("part") === "snippet") {
        snippetChecks += 1;
        return {
          ok: true,
          status: 200,
          json: async () => ({ items: [{ id: "UC_legacy_accent", snippet: { title: "Sí - Topic" } }] }),
        };
      }
      throw new Error(`wrong legacy channel must not reach catalogue/video reads: ${value}`);
    },
  });
  assert.equal(result.videoId, null);
  assert.equal(result.status, "search_deferred");
  assert.equal(snippetChecks, 1);
  assert.equal(artistStmts.getChannel.get("si").channelId, null);
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

test("only unambiguous legacy YouTube cache rows migrate and must pass the current scorer", async () => {
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
  let validations = 0;
  const result = await resolveYouTubeTrack(title, artist, {
    apiKey: "test-key",
    fetchImpl: async (url) => {
      validations += 1;
      assert.match(String(url), /\/videos\?/);
      return {
        ok: true,
        status: 200,
        json: async () => ({ items: [youtubeCandidate("legacy00001", title, `${artist} - Topic`)] }),
      };
    },
  });
  assert.equal(result.videoId, "legacy00001");
  assert.equal(result.status, "validated");
  assert.equal(validations, 1, "a pre-version cache ID is never replayed without current metadata validation");
  assert.equal(db.prepare("SELECT 1 FROM yt_cache WHERE key=?").get(legacyKey), undefined);
  const migrated = db.prepare("SELECT * FROM yt_cache WHERE key=?").get(youtubeCacheKey(title, artist));
  assert.ok(migrated.updated_at >= updatedAt);
  assert.ok(migrated.expires_at > expiresAt, "a successful fresh API validation may renew the policy-bounded row");
  assert.equal(JSON.parse(migrated.metadata).matchVersion, YOUTUBE_MATCH_CACHE_VERSION);

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

test("a prior matcher miss is retired instead of suppressing the corrected resolver", async () => {
  const title = "初恋";
  const artist = "宇多田ヒカル";
  const previousKey = `yt:v${YOUTUBE_MATCH_CACHE_VERSION - 1}:${JSON.stringify([
    normalizeYouTubeCacheText(artist),
    normalizeYouTubeCacheText(title),
  ])}`;
  const at = Date.now();
  db.prepare(`INSERT OR REPLACE INTO yt_cache
    (key,video_id,updated_at,metadata,score,expires_at,rejected_ids)
    VALUES (?,NULL,?,NULL,NULL,?,?)`).run(previousKey, at, at + 60_000, "[]");
  const result = await resolveYouTubeTrack(title, artist, { apiKey: "" });
  assert.deepEqual(result, { videoId: null, status: "unconfigured" },
    "the current matcher is allowed to resolve instead of replaying an obsolete not_found");
  assert.equal(db.prepare("SELECT 1 FROM yt_cache WHERE key=?").get(previousKey), undefined);
  assert.equal(db.prepare("SELECT 1 FROM yt_cache WHERE key=?").get(youtubeCacheKey(title, artist)), undefined,
    "a prior-version negative is never copied under the current key");
});

test("the retired v3 J. Cole cache cannot replay the HNM recording and resolves the official upload", async () => {
  const title = "MIDDLE CHILD";
  const artist = "J. Cole";
  const wrongId = "Bu5DMJ8LJnk";
  const officialId = "e8CLsYzE5wk";
  const currentTime = Date.now();
  const oldKey = `yt:v3:${JSON.stringify([
    normalizeYouTubeCacheText(artist),
    normalizeYouTubeCacheText(title),
  ])}`;
  assert.ok(youtubeCacheKey(title, artist).startsWith(`yt:v${YOUTUBE_MATCH_CACHE_VERSION}:`));

  // Reproduce the production failure: a fresh positive v3 row points at an
  // unrelated HNM Magazine uploader whose title begins with the requested act.
  db.prepare(`INSERT OR REPLACE INTO yt_cache
    (key,video_id,updated_at,metadata,score,expires_at,rejected_ids)
    VALUES (?,?,?,?,?,?,?)`).run(
    oldKey,
    wrongId,
    currentTime,
    JSON.stringify({ title: "J. Cole - MIDDLE CHILD", channel: "HNM Magazine", reasons: ["title-match"], duration: 213 }),
    97,
    currentTime + 7 * 24 * 60 * 60 * 1000,
    "[]",
  );

  // Keep this regression on the global candidate path: a fresh structural
  // channel miss skips Wikidata/catalogue discovery and lets the search result
  // set prove that only the official/Topic candidate can win.
  if (!artistStmts.byNorm.get("j. cole")) {
    artistStmts.upsert.run(artistRow("J. Cole", { name: "J. Cole" }, "test"));
  }
  artistStmts.setChannel.run(null, currentTime, "youtube", "j. cole");

  const withoutValidation = await resolveYouTubeTrack(title, artist, { apiKey: "" });
  assert.deepEqual(withoutValidation, { videoId: null, status: "unconfigured" },
    "a retired positive is never used as an offline/stale fallback before current validation");

  const wrong = youtubeCandidate(wrongId, "J. Cole - MIDDLE CHILD", "HNM Magazine", { duration: "PT3M33S", views: "9000000" });
  const official = youtubeCandidate(officialId, "J. Cole - MIDDLE CHILD (Official Audio)", "J. Cole - Topic", { duration: "PT3M34S", views: "200000000" });
  const videoLookups = [];
  let globalSearches = 0;
  const fetchImpl = async (url) => {
    const parsed = new URL(String(url));
    if (parsed.pathname.endsWith("/search")) {
      assert.equal(parsed.searchParams.get("type"), "video");
      globalSearches += 1;
      return {
        ok: true,
        status: 200,
        json: async () => ({ items: [
          { id: { videoId: wrongId } },
          { id: { videoId: officialId } },
        ] }),
      };
    }
    if (parsed.pathname.endsWith("/videos")) {
      const ids = (parsed.searchParams.get("id") || "").split(",").filter(Boolean);
      videoLookups.push(ids);
      return {
        ok: true,
        status: 200,
        json: async () => ({ items: [wrong, official].filter((item) => ids.includes(item.id)) }),
      };
    }
    throw new Error(`unexpected YouTube endpoint: ${parsed.pathname}`);
  };

  const resolved = await resolveYouTubeTrack(title, artist, { apiKey: "test-key", fetchImpl });
  assert.equal(resolved.videoId, officialId);
  assert.equal(resolved.status, "resolved");
  assert.equal(globalSearches, 1);
  assert.deepEqual(videoLookups, [[wrongId], [officialId]],
    "the retired ID is validated once, rejected, and excluded from the candidate details batch");

  assert.equal(db.prepare("SELECT 1 FROM yt_cache WHERE key=?").get(oldKey), undefined, "the v3 positive row is evicted");
  const cached = db.prepare("SELECT * FROM yt_cache WHERE key=?").get(youtubeCacheKey(title, artist));
  const metadata = JSON.parse(cached.metadata);
  assert.equal(cached.video_id, officialId);
  assert.equal(metadata.channel, "J. Cole - Topic");
  assert.equal(metadata.matchVersion, YOUTUBE_MATCH_CACHE_VERSION);
  assert.ok(JSON.parse(cached.rejected_ids).includes(wrongId));

  const replay = await resolveYouTubeTrack(title, artist, {
    apiKey: "test-key",
    fetchImpl: async () => { throw new Error("the current validated match should be a cache hit"); },
  });
  assert.deepEqual(replay, { videoId: officialId, status: "cached", confidence: resolved.confidence });
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

test("Deezer preview misses are briefly cached instead of repeating provider work", async () => {
  let fetches = 0;
  const fetchImpl = async () => {
    fetches += 1;
    return { ok: true, status: 200, json: async () => ({ data: [] }) };
  };

  const first = await getFreshDeezerPreview("Bounded Missing Preview", "Missing Preview Artist", { fetchImpl });
  const second = await getFreshDeezerPreview("Bounded Missing Preview", "Missing Preview Artist", { fetchImpl });
  assert.equal(first.status, "not_found");
  assert.equal(second.status, "not_found");
  assert.equal(fetches, 2, "one exact and one broad lookup are reused during the miss TTL");
});

test("Deezer preview memory is bounded with least-recently-used eviction", async () => {
  let fetches = 0;
  const futureExpiry = Math.floor(Date.now() / 1000) + 60 * 60;
  const fetchImpl = async (url) => {
    fetches += 1;
    const query = new URL(String(url)).searchParams.get("q") || "";
    const title = query.match(/track:"([^"]+)"/)?.[1] || "";
    const artist = query.match(/artist:"([^"]+)"/)?.[1] || "";
    return {
      ok: true,
      status: 200,
      json: async () => ({ data: [{
        id: fetches,
        title,
        preview: `https://preview.example/${fetches}?exp=${futureExpiry}`,
        link: `https://deezer.example/${fetches}`,
        artist: { id: fetches, name: artist },
      }] }),
    };
  };

  for (let index = 0; index <= PREVIEW_CACHE_MAX_ENTRIES; index += 1) {
    await getFreshDeezerPreview(`Bounded Preview ${index}`, `Bounded Artist ${index}`, { fetchImpl });
  }
  const afterFill = fetches;
  await getFreshDeezerPreview(
    `Bounded Preview ${PREVIEW_CACHE_MAX_ENTRIES}`,
    `Bounded Artist ${PREVIEW_CACHE_MAX_ENTRIES}`,
    { fetchImpl },
  );
  assert.equal(fetches, afterFill, "the newest entry remains cached");

  await getFreshDeezerPreview("Bounded Preview 0", "Bounded Artist 0", { fetchImpl });
  assert.equal(fetches, afterFill + 1, "the least-recently-used entry was evicted at the cap");
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
  const artist = "Unknown Cache Act";
  const cachedAt = Date.now();
  db.prepare(`INSERT OR REPLACE INTO provider_cache (key,data,updated_at,expires_at)
    VALUES (?,?,?,?)`).run(
    `yt:channel:v3:${normalizeYouTubeCacheText(artist)}`,
    JSON.stringify({
      channelId: "UC_unknown_cache",
      title: `${artist} - Topic`,
      rank: 100,
      refreshAt: cachedAt + 7 * 24 * 60 * 60 * 1000,
    }),
    cachedAt,
    cachedAt + 30 * 24 * 60 * 60 * 1000,
  );
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

  const first = await resolveYouTubeTrack("Cache Track One", artist, { apiKey: "test-key", fetchImpl });
  const second = await resolveYouTubeTrack("Cache Track Two", "  UNKNOWN   CACHE ACT ", { apiKey: "test-key", fetchImpl });
  assert.equal(first.videoId, "cachetrack1");
  assert.equal(second.videoId, "cachetrack2");
  assert.equal(channelSearches, 0, "the persisted provider channel avoids channel-discovery search entirely");
  assert.equal(catalogueReads, 1, "one channel id maps to one normalized catalogue cache");
});

test("different songs cold-starting together coalesce artist channel and catalogue requests", async () => {
  const artist = "Coalesce Artist";
  const norm = normName(artist);
  artistStmts.upsert.run(artistRow(norm, { name: artist }, "test"));
  artistStmts.setChannel.run("UC_coalesce", Date.now(), "youtube_v4", norm);
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
    resolveYouTubeTrack("Parallel One", artist, { apiKey: "test-key", fetchImpl }),
    resolveYouTubeTrack("Parallel Two", artist, { apiKey: "test-key", fetchImpl }),
  ]);
  assert.equal(one.videoId, "parallel001");
  assert.equal(two.videoId, "parallel002");
  assert.equal(channelSearches, 0);
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
  assert.equal(channelSearches, 0, "track resolution never spends search quota discovering a channel");
  assert.equal(globalSearches, 2, "each distinct song still receives one legitimate global attempt");
});

test("an uncatalogued artist refreshes a known channel with channels.list instead of search.list", async () => {
  const artist = "Cheap Refresh Artist";
  const title = "Cheap Refresh Song";
  const now = Date.now();
  db.prepare(`INSERT OR REPLACE INTO provider_cache (key,data,updated_at,expires_at)
    VALUES (?,?,?,?)`).run(
    `yt:channel:v3:${normalizeYouTubeCacheText(artist)}`,
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
    JSON.stringify({ title, channel: `${artist} - Topic`, reasons: ["official"], duration: 200, matchVersion: YOUTUBE_MATCH_CACHE_VERSION }),
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
    JSON.stringify({ title: expiredTitle, channel: `${artist} - Topic`, reasons: ["official"], duration: 200, matchVersion: YOUTUBE_MATCH_CACHE_VERSION }),
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

test("an open data-validation circuit blocks search before global or actor reservation", async () => {
  await assert.rejects(
    youtubeJson("videos", { part: "snippet", id: "datacircuit1" }, "test-key", async () => ({
      ok: false,
      status: 403,
      json: async () => ({}),
    })),
    (error) => error?.code === "quota_or_forbidden",
  );
  const before = youtubeProviderStatus();
  assert.equal(before.dataCircuitOpen, true);
  let actorPermits = 0;
  let providerRequests = 0;
  await assert.rejects(
    resolveYouTubeTrack("Data Circuit Search Guard", "", {
      apiKey: "test-key",
      beforeSearch: () => { actorPermits += 1; },
      fetchImpl: async () => {
        providerRequests += 1;
        return { ok: true, status: 200, json: async () => ({ items: [] }) };
      },
    }),
    (error) => error?.code === "provider_paused",
  );
  const after = youtubeProviderStatus();
  assert.equal(providerRequests, 0, "the known data outage prevents a doomed search.list fetch");
  assert.equal(actorPermits, 0, "the actor is not charged for a search whose candidates cannot be validated");
  assert.equal(after.search.used, before.search.used, "the shared search counter is unchanged");
  assert.equal(after.efficiency.searchCallsReserved, before.efficiency.searchCallsReserved,
    "no global search reservation is recorded");
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
