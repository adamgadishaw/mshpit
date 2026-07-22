import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyStoredGenre, displayGenre, genreClaim, isCrawlLabel,
  isUnverifiedGenre, mergeGenre, resolveGenre,
  storedClaims, upsertClaim, withoutSource,
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

test("provider enrichment is evidence and does display", () => {
  // These arrive lowercased from Deezer/MusicBrainz, unlike the crawl labels.
  for (const value of ["hip hop", "thrash metal", "reggaeton", "pop"]) {
    const record = resolveGenre([classifyStoredGenre(value)]);
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

test("crawl labels are matched exactly, so a real genre string is not demoted", () => {
  assert.equal(isCrawlLabel("Metal"), true);
  // Lowercase and compound provider values are not the seeder's labels.
  assert.equal(isCrawlLabel("metal"), false);
  assert.equal(isCrawlLabel("thrash metal"), false);
  assert.equal(isCrawlLabel("metalcore"), false);
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
