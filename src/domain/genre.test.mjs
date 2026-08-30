import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyStoredGenre, displayGenre, genreClaim, isCrawlLabel,
  hasMusicBrainzGenreEvidence, isUnverifiedGenre, mergeGenre,
  musicBrainzGenreFields, providerGenreFields, resolveGenre,
  projectArtistGenre, storedClaims, upsertClaim, withoutSource,
} from "./genre.mjs";

const ARTIST_MBID = "11111111-1111-4111-8111-111111111111";
const HIP_HOP_MBID = "22222222-2222-4222-8222-222222222222";
const POP_MBID = "33333333-3333-4333-8333-333333333333";

function musicBrainzEvidence({
  artistMbid = ARTIST_MBID,
  counts = [
    { genre: "Hip Hop", id: HIP_HOP_MBID, count: 5 },
    { genre: "Pop", id: POP_MBID, count: 2 },
  ],
  genre = "Hip Hop",
  genreId = HIP_HOP_MBID,
  supportingCount = 5,
} = {}) {
  return {
    genre,
    genreId,
    provider: "musicbrainz",
    basis: "artist-genres-v1",
    artistMbid,
    supportingCount,
    counts,
    checkedAt: 1_000,
  };
}

// The artists the owner actually complained about. Each was discovered under a
// MusicBrainz crawl bucket that has nothing to do with their music.
const MISLABELLED = [
  ["Justin Bieber", "Metal"],
  ["Eminem", "Hardcore"],
  ["Rihanna", "House"],
  ["Adele", "Indie"],
  ["Michael Jackson", "Hip-Hop"],
];

test("a crawl bucket is never stated as an artist's genre", () => {
  for (const [artist, bucket] of MISLABELLED) {
    const stored = classifyStoredGenre(bucket);
    assert.equal(stored.source, "tag_hint", `${artist}: ${bucket} should read as a hint`);
    assert.equal(displayGenre(resolveGenre([stored])), null, `${artist} must not display "${bucket}"`);
    assert.equal(isUnverifiedGenre(resolveGenre([stored])), true, `${artist} keeps the hint for staff review`);
  }
});

test("a Spotify identity beside a crawler label does not authenticate that label", () => {
  for (const [artist, bucket] of [["Eminem", "Hardcore"], ["Michael Jackson", "Hip-Hop"]]) {
    const projected = projectArtistGenre({ spotifyId: `spotify-${artist}` }, bucket);
    assert.equal(projected.genre, null, `${artist}: the adjacent identity cannot promote ${bucket}`);
    assert.equal(projected.genreHint, bucket);
  }
});

test("exact-MBID MusicBrainz genre votes create a reversible display claim", () => {
  const data = { mbid: ARTIST_MBID };
  const evidence = musicBrainzEvidence();
  assert.equal(hasMusicBrainzGenreEvidence({ ...data, musicBrainzGenreEvidence: evidence }, "Hip Hop"), true);

  const fields = musicBrainzGenreFields(data, "Hardcore", evidence, 1_000);
  assert.equal(fields.genre, "Hip Hop");
  assert.equal(fields.genreClaims.find((claim) => claim.source === "musicbrainz_genre")?.value, "Hip Hop");
  assert.equal(projectArtistGenre({ ...data, ...fields }, fields.genre).genre, "Hip Hop");
});

test("MusicBrainz evidence fails closed for identity mismatch, ties, and weak votes", () => {
  const rejects = [
    musicBrainzEvidence({ artistMbid: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }),
    musicBrainzEvidence({
      counts: [
        { genre: "Hip Hop", id: HIP_HOP_MBID, count: 4 },
        { genre: "Pop", id: POP_MBID, count: 4 },
      ],
      supportingCount: 4,
    }),
    musicBrainzEvidence({
      counts: [{ genre: "Hip Hop", id: HIP_HOP_MBID, count: 1 }],
      supportingCount: 1,
    }),
  ];
  for (const evidence of rejects) {
    const data = {
      mbid: ARTIST_MBID,
      musicBrainzGenreEvidence: evidence,
      genreClaims: [{ value: "Hip Hop", source: "musicbrainz_genre", at: 1_000 }],
    };
    assert.equal(hasMusicBrainzGenreEvidence(data, "Hip Hop"), false);
    assert.equal(projectArtistGenre(data, "Hip Hop").genre, null);
  }
});

test("an explicitly sourced provider claim is evidence and does display", () => {
  for (const value of ["hip hop", "thrash metal", "reggaeton", "pop"]) {
    const record = resolveGenre([genreClaim(value, "provider")]);
    assert.equal(record.source, "provider");
    assert.equal(displayGenre(record), value);
  }
});

test("the hierarchy is staff over provider over consensus over hint", () => {
  const hint = genreClaim("Metal", "tag_hint", 500);
  const consensus = genreClaim("dance pop", "consensus", 400);
  const provider = genreClaim("pop", "provider", 300);
  const staff = genreClaim("contemporary r&b", "staff", 100);

  assert.equal(resolveGenre([hint]).value, "Metal");
  assert.equal(resolveGenre([hint, consensus]).value, "dance pop");
  assert.equal(resolveGenre([hint, consensus, provider]).value, "pop");
  // Staff wins even though it is the oldest claim on the record.
  assert.equal(resolveGenre([hint, consensus, provider, staff]).value, "contemporary r&b");
});

test("an empty or deprecated provider field never erases a good classification", () => {
  const good = resolveGenre([genreClaim("pop", "provider", 100)]);
  for (const empty of [null, undefined, "", "   ", genreClaim("", "provider"), genreClaim(null, "provider")]) {
    assert.equal(mergeGenre(good, empty)?.value, "pop", "a blank incoming claim must not clear the record");
  }
});

test("an automated run cannot overwrite a staff decision", () => {
  const staff = resolveGenre([genreClaim("afrobeats", "staff", 100)]);
  const later = genreClaim("Metal", "tag_hint", 999);
  const providerLater = genreClaim("rock", "provider", 999);

  assert.equal(mergeGenre(staff, later).value, "afrobeats");
  assert.equal(mergeGenre(staff, providerLater).value, "afrobeats");
  // Staff can still correct staff.
  assert.equal(mergeGenre(staff, genreClaim("amapiano", "staff", 1000)).value, "amapiano");
});

test("a staff correction rescues a mislabelled artist", () => {
  let record = resolveGenre([classifyStoredGenre("Metal")]); // Justin Bieber
  assert.equal(displayGenre(record), null);
  record = mergeGenre(record, genreClaim("pop", "staff"));
  assert.equal(displayGenre(record), "pop");
  assert.equal(record.confidence, 1);
});

test("a fresher claim from the same source refreshes rather than freezes", () => {
  const old = resolveGenre([genreClaim("pop", "provider", 100)]);
  assert.equal(mergeGenre(old, genreClaim("dance pop", "provider", 200)).value, "dance pop");
  assert.equal(mergeGenre(old, genreClaim("stale", "provider", 50)).value, "pop");
});

test("junk never enters the record", () => {
  for (const bad of [null, undefined, "", "   ", "x".repeat(41), 42, {}]) {
    assert.equal(genreClaim(bad, "provider"), null);
  }
  assert.equal(genreClaim("pop", "not-a-source"), null);
  assert.equal(classifyStoredGenre(""), null);
  assert.equal(resolveGenre([]), null);
  assert.equal(resolveGenre(null), null);
  assert.equal(displayGenre(null), null);
});

test("the crawl vocabulary remains diagnostic but never authenticates a bare value", () => {
  assert.equal(isCrawlLabel("Metal"), true);
  assert.equal(isCrawlLabel("metal"), false);
  assert.equal(isCrawlLabel("thrash metal"), false);
  for (const value of ["Metal", "metal", "Alternative", "Asian Music", "pop"]) {
    assert.equal(classifyStoredGenre(value)?.source, "tag_hint");
    assert.equal(displayGenre(resolveGenre([classifyStoredGenre(value)])), null);
  }
});

test("the shared public projection fails closed for legacy values and shows structured evidence", () => {
  assert.equal(projectArtistGenre({}, "Alternative").genre, null);
  assert.equal(projectArtistGenre({}, "Alternative").genreHint, "Alternative");
  assert.equal(projectArtistGenre({ genreClaims: [genreClaim("Classical", "provider", 1)] }, "Alternative").genre, "Classical");
});

test("legacy Deezer provider claims require matching release-consensus evidence", () => {
  const oldData = {
    deezerId: 99,
    genreClaims: [genreClaim("Pop", "provider", 1)],
  };
  assert.equal(projectArtistGenre(oldData, "Pop").genre, null);
  assert.equal(projectArtistGenre(oldData, "Pop").genreSource, "release_hint");

  const verified = {
    ...oldData,
    genreEvidence: {
      genre: "Pop", provider: "deezer", basis: "release-consensus-v1",
      sampleCount: 3, supportingCount: 2, share: 0.6667,
      counts: [{ genre: "Pop", count: 2 }, { genre: "Rock", count: 1 }],
    },
  };
  assert.equal(projectArtistGenre(verified, "Pop").genre, "Pop");
  assert.equal(projectArtistGenre(verified, "Pop").genreSource, "release_consensus");

  const forged = { ...verified, genreEvidence: { ...verified.genreEvidence, genre: "Rock" } };
  assert.equal(projectArtistGenre(forged, "Pop").genre, null);
});

test("provider evidence overtakes a crawl bucket, which is what enrichment was failing to do", () => {
  // Enrichment used to do `row.genre || e.genre`, so "Metal" from the crawl
  // outlived Deezer knowing Justin Bieber was pop.
  let claims = storedClaims({}, "Metal");
  assert.equal(displayGenre(resolveGenre(claims)), null);

  claims = upsertClaim(claims, genreClaim("pop", "provider"));
  assert.equal(displayGenre(resolveGenre(claims)), "pop");

  // A later run where the provider returns nothing must not undo that.
  claims = upsertClaim(claims, genreClaim(null, "provider"));
  assert.equal(displayGenre(resolveGenre(claims)), "pop");
});

test("an explicitly empty claim list is authoritative over a stale typed column", () => {
  assert.deepEqual(storedClaims({ genreClaims: [] }, "r&b"), []);
  assert.equal(displayGenre(resolveGenre(storedClaims({ genreClaims: [] }, "r&b"))), null);
});

test("legacy crawler genreHint is retained only as a non-displayable hint", () => {
  const claims = storedClaims({ genreHint: "Hardcore" }, null);
  assert.equal(claims.length, 1);
  assert.equal(claims[0].source, "tag_hint");
  assert.equal(claims[0].value, "Hardcore");
  assert.equal(displayGenre(resolveGenre(claims)), null);
  assert.equal(storedClaims({ genreHint: "Hardcore" }, "Metal")[0]?.value, "Hardcore",
    "the structured crawler hint is newer than a stale legacy hint column");
});

test("the centralized provider writer records exact labels without displacing staff", () => {
  const fromHint = providerGenreFields({ genreHint: "Metal" }, null, "Pop", 200);
  assert.equal(fromHint.genre, "Pop");
  assert.equal(fromHint.genreClaims.find((claim) => claim.source === "provider")?.value, "Pop");
  assert.equal(displayGenre(resolveGenre(fromHint.genreClaims)), "Pop");

  const data = { genreClaims: [genreClaim("r&b", "staff", 100)] };
  const underStaff = providerGenreFields(data, "r&b", "Pop", 300);
  assert.equal(underStaff.genre, "r&b");
  assert.equal(underStaff.genreClaims.find((claim) => claim.source === "provider")?.value, "Pop");
  assert.equal(resolveGenre(underStaff.genreClaims)?.source, "staff");
});

test("withdrawing a staff correction falls back to evidence, not to nothing", () => {
  let claims = storedClaims({}, "House"); // Rihanna, from the crawl
  claims = upsertClaim(claims, genreClaim("r&b", "provider"));
  claims = upsertClaim(claims, genreClaim("dancehall", "staff"));
  assert.equal(resolveGenre(claims).value, "dancehall");

  claims = withoutSource(claims, "staff");
  assert.equal(resolveGenre(claims).value, "r&b", "the provider claim survived the correction");
  assert.equal(displayGenre(resolveGenre(claims)), "r&b");
});

test("one claim per source, so a record cannot grow without bound", () => {
  let claims = [];
  for (let i = 0; i < 50; i++) claims = upsertClaim(claims, genreClaim(`genre ${i}`, "provider", i));
  assert.equal(claims.length, 1);
  assert.equal(claims[0].value, "genre 49");
});
