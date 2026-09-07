import test from "node:test";
import assert from "node:assert/strict";
import { artistBiographyRows, musicBrainzBiographyFacts, preserveArtistBiography, projectArtistBiography, validateStaffArtistBiography } from "./artistBiography.mjs";
const id = "875203e1-8e58-4b86-8dcb-7190faf411c5";
const person = musicBrainzBiographyFacts({ id, type: "Person", "life-span": { begin: "1985-01-28" } });

test("MusicBrainz lifespan is birth for a person and formation only for a verified group", () => {
  assert.equal(person.birthDate, "1985-01-28");
  assert.equal(person.formedDate, null); assert.equal(person.careerStartYear, null);
  assert.deepEqual(artistBiographyRows(person).map(row => row.label), ["Born"]);
  const group = musicBrainzBiographyFacts({ id, type: "Group", "life-span": { begin: "1960" } });
  assert.equal(group.birthDate, null); assert.equal(group.formedDate, "1960");
  assert.deepEqual(artistBiographyRows(group).map(row => row.label), ["Formed"]);
  assert.equal(musicBrainzBiographyFacts({ id, "life-span": { begin: "1985" } }), null);
});

test("ambiguous legacy years and unverified or malformed facts stay hidden", () => {
  assert.equal(projectArtistBiography({ formed: "1985", beginYear: "1985", type: "Person" }), null);
  assert.equal(projectArtistBiography({ biographyProvider: { ...person, verified: false } }), null);
  for (const birthDate of ["2026-02-31", "9999", "1985-15", "1985-01-28 extra"]) {
    assert.equal(projectArtistBiography({ biographyProvider: { ...person, birthDate } }), null);
  }
  assert.equal(projectArtistBiography({ biographyProvider: { ...person, careerStartYear: "2007" } }), null);
});

test("explicit staff career evidence survives provider refresh, omission, and a clear correction", () => {
  const facts = validateStaffArtistBiography({ artistType: "person", birthDate: "1985", careerStartYear: "2007", sourceUrl: "https://artist.example.org/about" });
  const stored = { biographyProvider: person, biographyStaff: { revision: 2, artistMbid: null, facts } };
  const refreshed = preserveArtistBiography(stored, { biographyProvider: { ...person, birthDate: "1984" }, photo: "kept" });
  assert.equal(projectArtistBiography(refreshed).careerStartYear, "2007");
  assert.equal(projectArtistBiography(refreshed).birthDate, "1985");
  assert.equal(projectArtistBiography(preserveArtistBiography(stored, {})).source, "staff");
  const cleared = { ...stored, biographyStaff: { revision: 3, artistMbid: null, facts: validateStaffArtistBiography({ artistType: "unknown" }) } };
  assert.deepEqual(artistBiographyRows(projectArtistBiography(preserveArtistBiography(cleared, { biographyProvider: person }))), []);
});

test("moderator facts require source, compatible type, and honest dates", () => {
  for (const value of [
    { artistType: "person", birthDate: "1985" },
    { artistType: "group", birthDate: "1985", sourceUrl: "https://example.org" },
    { artistType: "person", formedDate: "2000", sourceUrl: "https://example.org" },
    { artistType: "person", birthDate: "1985", careerStartYear: "1980", sourceUrl: "https://example.org" },
    { artistType: "group", formedDate: "2020", careerStartYear: "1990", sourceUrl: "https://example.org" },
    { artistType: "unknown", careerStartYear: "2007" },
    { artistType: "unknown", birthDate: 0 },
    { artistType: "unknown", sourceUrl: "javascript:alert(1)" },
    { artistType: "person", sourceUrl: "javascript:alert(1)" },
    { artistType: "person", sourceUrl: "https://127.0.0.1/source" },
    { artistType: "person", birthDate: false, sourceUrl: "https://example.org" },
    { artistType: "person", sourceUrl: "https://example.org", privateNote: "never public" },
  ]) assert.throws(() => validateStaffArtistBiography(value));
  assert.equal(validateStaffArtistBiography({ artistType: "group", formedDate: "2020-12-01", careerStartYear: "2020", sourceUrl: "https://example.org" }).careerStartYear, "2020");
});

test("staff corrections remain stored but hidden after an identity change or without a reviewed binding", () => {
  const nextId = "b10bbbfc-cf9e-42e0-be17-e2c3e1d2600d";
  const facts = validateStaffArtistBiography({ artistType: "person", birthDate: "1985", sourceUrl: `https://musicbrainz.org/artist/${id}` });
  const stored = { mbid: id, biographyStaff: { revision: 1, artistMbid: id, facts } };
  assert.equal(projectArtistBiography(stored, { artistMbid: id }).birthDate, "1985");
  const refreshed = preserveArtistBiography(stored, { mbid: nextId, biographyProvider: musicBrainzBiographyFacts({ id: nextId, type: "Group", "life-span": { begin: "1960" } }) });
  assert.deepEqual(refreshed.biographyStaff, stored.biographyStaff, "the original correction is retained for staff review");
  assert.equal(projectArtistBiography(refreshed), null);
  assert.equal(projectArtistBiography(refreshed, { artistMbid: nextId }), null);
  assert.equal(projectArtistBiography({ biographyStaff: { revision: 1, facts } }, { artistMbid: id }), null);
  assert.equal(projectArtistBiography({ biographyStaff: { revision: 1, artistMbid: null, facts } }, { artistMbid: id }), null);
  assert.equal(projectArtistBiography({ biographyStaff: { revision: 1, artistMbid: "invalid-id", facts } }, { artistMbid: null }), null);
});
