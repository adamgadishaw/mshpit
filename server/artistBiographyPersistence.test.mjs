import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { musicBrainzBiographyFacts, validateStaffArtistBiography } from "../src/domain/artistBiography.mjs";
const directory = mkdtempSync(join(tmpdir(), "pit-biography-test-"));
process.env.PIT_DATA_DIR = directory;
process.env.NODE_ENV = "test";
const { db, artistRow, artistStmts, publicArtist, mergeBundledArtist } = await import("./db.js");
after(() => {
  db.close();
  const target = resolve(directory);
  if (dirname(target) !== resolve(tmpdir()) || !target.includes("pit-biography-test-")) throw new Error("Unexpected fixture directory");
  for (const file of ["pit.db", "pit.db-wal", "pit.db-shm"]) rmSync(join(target, file), { force: true });
  try { rmdirSync(target); } catch { /* Leave unrelated platform files untouched. */ }
});

test("public artist output hides legacy lifespan and private correction records while retaining typed evidence", () => {
  artistStmts.upsert.run(artistRow("biography fixture", { name: "Biography Fixture", beginYear: "1985" }));
  const row = artistStmts.byNorm.get("biography fixture");
  assert.equal(row.formed, "1985");
  assert.equal(publicArtist(row).formed, null); assert.equal(publicArtist(row).biographyFacts, null);
  assert.equal(publicArtist(row).beginYear, undefined);
  const facts = validateStaffArtistBiography({ artistType: "person", birthDate: "1985", careerStartYear: "2007", sourceUrl: "https://artist.example.org/about" });
  db.prepare("UPDATE artists SET data=? WHERE norm=?").run(JSON.stringify({ biographyStaff: { revision: 1, artistMbid: null, facts } }), row.norm);
  artistStmts.upsert.run(artistRow(row.norm, { name: row.name, photo: "https://cdn.example.org/new-photo.jpg", beginYear: "1984" }));
  const updated = publicArtist(artistStmts.byNorm.get(row.norm));
  assert.equal(updated.biographyFacts.careerStartYear, "2007");
  assert.equal(updated.biographyFacts.birthDate, "1985");
  assert.equal(updated.biographyStaff, undefined); assert.equal(updated.biographyProvider, undefined);
  const merged = mergeBundledArtist(artistStmts.byNorm.get(row.norm), { name: row.name, beginYear: "1983" });
  artistStmts.upsert.run(artistRow(row.norm, merged));
  assert.equal(publicArtist(artistStmts.byNorm.get(row.norm)).biographyFacts.birthDate, "1985");
});

test("provider formation remains typed and provider facts cannot cross MusicBrainz identities", () => {
  const id = "b10bbbfc-cf9e-42e0-be17-e2c3e1d2600d";
  const biographyProvider = musicBrainzBiographyFacts({ id, type: "Group", "life-span": { begin: "1960" } });
  artistStmts.upsert.run(artistRow("biography group", { name: "Biography Group", mbid: id, biographyProvider }));
  const row = artistStmts.byNorm.get("biography group");
  assert.equal(publicArtist(row).formed, "1960");
  assert.equal(publicArtist(row).biographyFacts.birthDate, null);
  assert.equal(publicArtist({ ...row, mbid: "875203e1-8e58-4b86-8dcb-7190faf411c5" }).biographyFacts, null);
});

test("a catalog identity replacement retains the correction record without publishing its old person's facts", () => {
  const oldId = "875203e1-8e58-4b86-8dcb-7190faf411c5", nextId = "b10bbbfc-cf9e-42e0-be17-e2c3e1d2600d";
  const facts = validateStaffArtistBiography({ artistType: "person", birthDate: "1985", sourceUrl: `https://musicbrainz.org/artist/${oldId}` });
  const biographyStaff = { revision: 4, artistMbid: oldId, facts };
  artistStmts.upsert.run(artistRow("identity replacement", { name: "Identity Replacement", mbid: oldId, biographyStaff }));
  assert.equal(publicArtist(artistStmts.byNorm.get("identity replacement")).biographyFacts.birthDate, "1985");
  artistStmts.upsert.run(artistRow("identity replacement", { name: "Identity Replacement", mbid: nextId,
    biographyProvider: musicBrainzBiographyFacts({ id: nextId, type: "Group", "life-span": { begin: "1960" } }) }));
  const replaced = artistStmts.byNorm.get("identity replacement");
  assert.deepEqual(JSON.parse(replaced.data).biographyStaff, biographyStaff);
  assert.equal(publicArtist(replaced).biographyFacts, null);
  assert.equal(publicArtist(replaced).formed, null);
});
