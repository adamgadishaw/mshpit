import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyStoredGenre, displayGenre, genreClaim, isCrawlLabel,
  isUnverifiedGenre, mergeGenre, providerGenreFields, resolveGenre,
  projectArtistGenre, storedClaims, upsertClaim, withoutSource,
} from "./genre.mjs";

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
