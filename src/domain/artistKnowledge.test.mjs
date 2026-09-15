import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { artistKnowledgeDisplayBio, projectArtistKnowledgeSource, publicArtistKnowledgeSource, validateArtistKnowledgeSource } from "./artistKnowledge.mjs";

const mbid = "12345678-1234-4234-8234-123456789abc";
const otherMbid = "22345678-1234-4234-8234-123456789abc";
const bio = "Alpha is a Canadian band formed in Toronto.";
const source = () => ({ provider: "wikipedia", url: "https://en.wikipedia.org/wiki/Alpha_(band)",
  revisionUrl: "https://en.wikipedia.org/w/index.php?oldid=123456789", license: "CC BY-SA 4.0",
  licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/", modified: true, mbid,
  wikidataId: "Q123", retrievedAt: 1787659200000 });
const data = () => ({ artistKnowledge: { version: 1, mbid, wikidataId: "Q123",
  wikidataUrl: "https://www.wikidata.org/wiki/Q123", bio, country: "Canada", bioSource: source() } });

test("knowledge citation is allowlisted and bound to the exact artist and displayed imported biography", () => {
  const input = data();
  input.artistKnowledge.bioSource.privateDebug = "not public";
  const projected = projectArtistKnowledgeSource(input, { mbid, bio });
  assert.deepEqual(projected, source());
  assert.equal(Object.isFrozen(projected), true);
  assert.equal(projectArtistKnowledgeSource(input, { mbid: otherMbid, bio }), null);
  for (const replaced of [null, "", " ", `${bio} `, `${bio}\n`, "A staff replacement."]) {
    assert.equal(projectArtistKnowledgeSource(input, { mbid, bio: replaced }), null);
  }
  assert.equal(projectArtistKnowledgeSource(input, { mbid, bio: { text: bio } }), null);
});

test("stored provenance rejects a mismatched version, MBID, Wikidata ID or canonical URL", () => {
  for (const patch of [
    { version: 2 }, { mbid: otherMbid }, { mbid: mbid.toUpperCase() },
    { wikidataId: "q123" }, { wikidataId: "Q0123" }, { wikidataId: "Q999" },
    { wikidataUrl: "https://wikidata.org/wiki/Q123" },
    { wikidataUrl: "https://www.wikidata.org/wiki/Q999" },
    { wikidataUrl: "https://www.wikidata.org.evil.test/wiki/Q123" },
    { bioSource: { ...source(), mbid: otherMbid } },
    { bioSource: { ...source(), wikidataId: "Q999" } },
  ]) {
    const input = data(); Object.assign(input.artistKnowledge, patch);
    assert.equal(projectArtistKnowledgeSource(input, { mbid, bio }), null, JSON.stringify(patch));
  }
  for (const input of [null, [], {}, { artistKnowledge: [] }]) {
    assert.equal(projectArtistKnowledgeSource(input, { mbid, bio }), null);
  }
});

test("citation rejects unsafe, unlicensed, malformed or redirect-style URLs", () => {
  for (const patch of [
    { provider: "other" }, { license: "Public domain" }, { modified: false },
    { licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/?tracking=yes" },
    { url: "javascript:alert(1)" }, { url: "http://en.wikipedia.org/wiki/Alpha" },
    { url: "https://en.wikipedia.org.evil.test/wiki/Alpha" },
    { url: "https://en.wikipedia.org@evil.test/wiki/Alpha" },
    { url: "https://en.wikipedia.org:443/wiki/Alpha" },
    { url: "https://en.wikipedia.org/wiki/Alpha?redirect=no" },
    { url: "https://en.wikipedia.org/wiki/Alpha#History" },
    { url: "https://en.wikipedia.org/wiki/%3Cscript%3E" },
    { url: "https://en.wikipedia.org/wiki/Special:Redirect/file/Alpha.jpg" },
    { url: "https://en.wikipedia.org/wiki/Bad%zz" },
    { revisionUrl: "https://en.wikipedia.org/wiki/Alpha" },
    { revisionUrl: "https://en.wikipedia.org/w/index.php?oldid=0" },
    { revisionUrl: "https://en.wikipedia.org/w/index.php?oldid=1&oldid=2" },
    { revisionUrl: "https://en.wikipedia.org/w/index.php?oldid=1&action=edit" },
    { revisionUrl: "https://en.wikipedia.org/w/index.php?oldid=1&title=Another_artist" },
    { revisionUrl: "https://en.wikipedia.org/w/index.php?oldid=1#forged" },
    { revisionUrl: "https://evil.test/w/index.php?oldid=1" },
    { retrievedAt: -1 }, { retrievedAt: Infinity }, { retrievedAt: 1.5 }, { retrievedAt: "2026-09-15" },
  ]) assert.equal(validateArtistKnowledgeSource({ ...source(), ...patch }, { mbid }), null, JSON.stringify(patch));
});

test("valid immutable revision variants and encoded article titles retain exact attribution", () => {
  for (const revisionUrl of [
    "https://en.wikipedia.org/w/index.php?title=Alpha_(band)&oldid=123",
    "https://en.wikipedia.org/wiki/Special:PermanentLink/123",
  ]) assert.equal(validateArtistKnowledgeSource({ ...source(), revisionUrl }, { mbid }).revisionUrl, revisionUrl);
  const unicode = { ...source(), url: "https://en.wikipedia.org/wiki/Bj%C3%B6rk",
    revisionUrl: "https://en.wikipedia.org/w/index.php?title=Bj%C3%B6rk&oldid=123" };
  assert.equal(validateArtistKnowledgeSource(unicode, { mbid }).url, unicode.url);
});

test("hydrated metadata cannot attribute owner replacements or a changed catalog identity", () => {
  const meta = { mbid, bio, bioSource: source() };
  assert.deepEqual(publicArtistKnowledgeSource(meta, { bio }), source());
  assert.equal(publicArtistKnowledgeSource(meta, { bio: "Owner's own biography" }), null);
  assert.equal(publicArtistKnowledgeSource({ ...meta, mbid: otherMbid }, { bio }), null);
  assert.equal(publicArtistKnowledgeSource({ ...meta, bio: "Updated biography" }, { bio }), null);
  assert.equal(publicArtistKnowledgeSource({ ...meta, bioSource: null }, { bio }), null);
});

test("an invalidated imported biography is hidden, while independent staff replacements survive", () => {
  assert.equal(artistKnowledgeDisplayBio(data(), { mbid, bio }), bio);
  assert.equal(artistKnowledgeDisplayBio(data(), { mbid: otherMbid, bio }), null);
  const invalid = data(); invalid.artistKnowledge.bioSource.url = "https://evil.test/wiki/Alpha";
  assert.equal(artistKnowledgeDisplayBio(invalid, { mbid, bio }), null);
  assert.equal(artistKnowledgeDisplayBio(invalid, { mbid, bio: "Staff replacement" }), "Staff replacement");
  assert.equal(artistKnowledgeDisplayBio({}, { mbid, bio }), bio);
  assert.equal(artistKnowledgeDisplayBio(data(), { mbid, bio: null }), null);
});

test("each hydrated biography display includes source, revision, license and edited-excerpt notice", () => {
  const screen = readFileSync(new URL("../screens/ArtistScreen.jsx", import.meta.url), "utf8");
  assert.equal(screen.match(/<ArtistBiographyAttribution source=\{bioSource\} \/>/g)?.length, 3);
  assert.match(screen, /publicArtistKnowledgeSource\(meta, \{ bio \}\)/);
  assert.match(screen, /Edited excerpt from Wikipedia\./);
  assert.match(screen, /href=\{source\.url\}/);
  assert.match(screen, /href=\{source\.revisionUrl\}/);
  assert.match(screen, /href=\{source\.licenseUrl\}/);
  assert.match(screen, /Wikipedia contributors/);
});
