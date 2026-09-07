import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { artistScheduleCandidateIndex, ensureArtistScheduleRevisionSchema } from "./artistScheduleCandidateIndex.js";

test("native billing revision observes another SQLite writer and transaction rollback", () => {
  const directory = mkdtempSync(join(tmpdir(), "pit-artist-candidates-"));
  const database = new DatabaseSync(join(directory, "test.sqlite"));
  let writer;
  try {
    database.exec(`CREATE TABLE artists(norm TEXT PRIMARY KEY,name TEXT);
      CREATE TABLE tour_dates(id TEXT PRIMARY KEY,artist TEXT,artist_key TEXT,owner_id TEXT,source TEXT,music_evidence TEXT,billed_artists TEXT);
      INSERT INTO artists VALUES('alpha','Alpha');`);
    ensureArtistScheduleRevisionSchema(database);
    ensureArtistScheduleRevisionSchema(database);
    writer = new DatabaseSync(join(directory, "test.sqlite"));
    const index = artistScheduleCandidateIndex(database);
    assert.equal(index.candidates("Alpha").ids, "[]");
    writer.exec(`INSERT INTO tour_dates VALUES('a','Beta','beta',NULL,'ticketmaster','music','["Alpha"]')`);
    assert.equal(index.candidates("Alpha").ids, '["a"]');
    writer.exec(`BEGIN; UPDATE tour_dates SET billed_artists='["Beta"]'; ROLLBACK;`);
    assert.equal(index.candidates("Alpha").ids, '["a"]');
    assert.equal(index.diagnostics().buildCount, 2);
    writer.exec("UPDATE artists SET name='Different' WHERE norm='alpha'");
    assert.equal(index.candidates("Alpha").unambiguous, false);
    writer.exec("DELETE FROM tour_dates");
    assert.equal(index.candidates("Alpha").ids, "[]");
    assert.equal(index.diagnostics().buildCount, 4);
    // Building inside an outer transaction then rolling it back must not allow
    // a different write to reuse a cached revision with different candidates.
    database.exec(`UPDATE artists SET name='Alpha'; BEGIN;
      INSERT INTO tour_dates VALUES('rolled-back','Beta','beta',NULL,'ticketmaster','music','["Alpha"]');`);
    assert.equal(index.candidates("Alpha").ids, '["rolled-back"]');
    database.exec(`ROLLBACK; INSERT INTO tour_dates VALUES('committed','Beta','beta',NULL,'ticketmaster','music','["Alpha"]');`);
    assert.equal(index.candidates("Alpha").ids, '["committed"]');
  } finally {
    writer?.close(); database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
