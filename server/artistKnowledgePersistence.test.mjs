import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.PIT_DATA_DIR = mkdtempSync(join(tmpdir(), "pit-knowledge-persistence-"));
const { db, artistRow, artistStmts, publicArtist } = await import("./db.js");
const { createArtistKnowledgeRefresher } = await import("./artistKnowledgeRefresh.js");
const MBID = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const bio = "A source-backed band biography.";
const source = { provider: "wikipedia", url: "https://en.wikipedia.org/wiki/Example_(band)",
  revisionUrl: "https://en.wikipedia.org/w/index.php?oldid=123", license: "CC BY-SA 4.0",
  licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/", modified: true,
  mbid: MBID, wikidataId: "Q123", retrievedAt: 1_800_000_000_000 };
const knowledge = { version: 1, mbid: MBID, wikidataId: "Q123", wikidataUrl: "https://www.wikidata.org/wiki/Q123", bio, country: "Canada", bioSource: source };

test("real catalogue upserts retain import licensing and hide stale identity facts", () => {
  const key = "knowledge persistence fixture";
  artistStmts.upsert.run(artistRow(key, { name: key, mbid: MBID, bio, country: "Canada", artistKnowledge: knowledge }, "test"));
  artistStmts.upsert.run(artistRow(key, { name: key, mbid: MBID, photo: "https://example.com/photo.jpg" }, "test"));
  let projection = publicArtist(artistStmts.byNorm.get(key));
  assert.equal(projection.bio, bio); assert.equal(projection.bioSource.revisionUrl, source.revisionUrl);
  assert.equal(projection.artistKnowledge, undefined);
  artistStmts.upsert.run(artistRow(key, { name: key, mbid: OTHER }, "test"));
  projection = publicArtist(artistStmts.byNorm.get(key));
  assert.equal(projection.bio, null); assert.equal(projection.bioSource, null); assert.equal(projection.country, null);
  artistStmts.upsert.run(artistRow(key, { name: key, mbid: OTHER, bio: "A replacement editorial biography.", country: "France" }, "test"));
  projection = publicArtist(artistStmts.byNorm.get(key));
  assert.equal(projection.bio, "A replacement editorial biography."); assert.equal(projection.bioSource, null); assert.equal(projection.country, "France");
});

test("worker works against actual schema and does not alter artist keys, slugs or permissions", async () => {
  const key = "knowledge schema fixture";
  artistStmts.upsert.run(artistRow(key, { name: key, mbid: MBID, rank_score: 1_000_000_000 }, "test"));
  const before = artistStmts.byNorm.get(key);
  const service = createArtistKnowledgeRefresher({ database: db, fetchKnowledge: async () => knowledge });
  await service.runBatch();
  const saved = artistStmts.byNorm.get(key);
  assert.equal(saved.norm, before.norm); assert.equal(saved.public_slug, before.public_slug);
  assert.equal(saved.source, before.source); assert.equal(saved.bio, bio);
  assert.equal(publicArtist(saved).bioSource.url, source.url);
  assert.equal(db.prepare("SELECT * FROM artist_profiles WHERE artist_key=?").get(key), undefined);
});
