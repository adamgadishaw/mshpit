import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

import { createArtistDeathWatchRepository } from "./artistDeathWatchRepository.js";

const MBID = "11111111-1111-4111-8111-111111111111";
const DUPLICATE_MBID = "22222222-2222-4222-8222-222222222222";

function database() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE artists (norm TEXT PRIMARY KEY,name TEXT NOT NULL,mbid TEXT,popularity INTEGER,rank_score REAL,data TEXT);
    CREATE TABLE artist_memorials (artist_key TEXT PRIMARY KEY,artist_mbid TEXT,status TEXT);
    CREATE TABLE artist_death_watch_settings (singleton INTEGER PRIMARY KEY,enabled INTEGER,cursor_artist_key TEXT,last_scan_at INTEGER,last_success_at INTEGER,next_scan_at INTEGER,last_error_code TEXT,updated_at INTEGER);
    INSERT INTO artist_death_watch_settings VALUES (1,1,NULL,NULL,NULL,NULL,NULL,0);
    CREATE TABLE artist_death_candidates (
      artist_key TEXT PRIMARY KEY,artist_mbid TEXT NOT NULL UNIQUE,wikidata_id TEXT NOT NULL UNIQUE,
      artist_name TEXT NOT NULL,death_date TEXT NOT NULL,status TEXT NOT NULL,
      first_detected_at INTEGER NOT NULL,last_confirmed_at INTEGER NOT NULL,
      reviewed_by TEXT,reviewed_at INTEGER,review_history TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL
    );
  `);
  return db;
}

test("repository covers MBID-only artists and excludes ambiguous duplicate identities", () => {
  const db = database();
  try {
    db.prepare("INSERT INTO artists (norm,name,mbid,data) VALUES (?,?,?,?)").run("alpha", "Alpha", MBID, "{}");
    db.prepare("INSERT INTO artists (norm,name,mbid,data) VALUES (?,?,?,?)").run("dup-a", "Duplicate A", DUPLICATE_MBID, "{}");
    db.prepare("INSERT INTO artists (norm,name,mbid,data) VALUES (?,?,?,?)").run("dup-b", "Duplicate B", DUPLICATE_MBID, "{}");
    const repository = createArtistDeathWatchRepository(db);
    assert.deepEqual(repository.eligibleArtistsAfter({ limit: 40 }).map((row) => ({ ...row })), [{
      artist_key: "alpha",
      artist_name: "Alpha",
      artist_mbid: MBID,
    }]);
    assert.equal(repository.eligibleArtistCount(), 1);
    assert.equal(repository.catalogArtistForSignal({ artistMbid: MBID }).artist_key, "alpha");
    assert.equal(repository.catalogArtistForSignal({ artistMbid: DUPLICATE_MBID }), null);
  } finally {
    db.close();
  }
});

test("repository persists a private pending candidate and supports reviewed states", () => {
  const db = database();
  try {
    db.prepare("INSERT INTO artists (norm,name,mbid,data) VALUES (?,?,?,?)").run("alpha", "Alpha", MBID, "{}");
    const repository = createArtistDeathWatchRepository(db);
    const saved = repository.saveConfirmedCandidate({
      artistKey: "alpha", artistName: "Alpha", artistMbid: MBID,
      wikidataId: "Q42", deathDate: "2026-08-29", at: 10,
    });
    assert.equal(saved.inserted, true);
    assert.equal(saved.row.status, "pending");
    assert.equal(repository.review({ artistKey: "alpha", status: "dismissed", reviewerId: "mod", at: 11 }).status, "dismissed");
    assert.equal(repository.review({ artistKey: "alpha", status: "pending", reviewerId: "mod", at: 12 }).reviewed_by, null);
    assert.equal(repository.markMemorialized({ artistKey: "alpha", artistMbid: MBID, reviewerId: "admin", at: 13 }).status, "memorialized");
  } finally {
    db.close();
  }
});

test("dismissed alerts reopen only for changed corroborated evidence and retain the prior review", () => {
  const db = database();
  try {
    db.prepare("INSERT INTO artists (norm,name,mbid,data) VALUES (?,?,?,?)").run("alpha", "Alpha", MBID, "{}");
    const repository = createArtistDeathWatchRepository(db);
    repository.saveConfirmedCandidate({
      artistKey: "alpha", artistName: "Alpha", artistMbid: MBID,
      wikidataId: "Q42", deathDate: "2026-08-28", at: 10,
    });
    repository.review({ artistKey: "alpha", status: "dismissed", reviewerId: "mod", at: 11 });

    const same = repository.saveConfirmedCandidate({
      artistKey: "alpha", artistName: "Alpha", artistMbid: MBID,
      wikidataId: "Q42", deathDate: "2026-08-28", at: 12,
    });
    assert.equal(same.reopened, false);
    assert.equal(same.row.status, "dismissed");
    assert.equal(same.row.reviewed_by, "mod");

    const changed = repository.saveConfirmedCandidate({
      artistKey: "alpha", artistName: "Alpha", artistMbid: MBID,
      wikidataId: "Q42", deathDate: "2026-08-29", at: 13,
    });
    assert.equal(changed.reopened, true);
    assert.equal(changed.row.status, "pending");
    assert.equal(changed.row.reviewed_by, null);
    assert.deepEqual(JSON.parse(changed.row.review_history), [{
      status: "dismissed",
      reviewerId: "mod",
      reviewedAt: 11,
      wikidataId: "Q42",
      deathDate: "2026-08-28",
      reopenedAt: 13,
    }]);
  } finally {
    db.close();
  }
});

test("published memorial identities are reconciled out of the actionable queue", () => {
  const db = database();
  try {
    db.prepare("INSERT INTO artists (norm,name,mbid,data) VALUES (?,?,?,?)").run("alpha", "Alpha", MBID, "{}");
    const repository = createArtistDeathWatchRepository(db);
    repository.saveConfirmedCandidate({
      artistKey: "alpha", artistName: "Alpha", artistMbid: MBID,
      wikidataId: "Q42", deathDate: "2026-08-29", at: 10,
    });
    db.prepare("INSERT INTO artist_memorials (artist_key,artist_mbid,status) VALUES (?,?,?)")
      .run("alpha", MBID, "published");

    assert.deepEqual(repository.listCandidates({ status: "pending", limit: 10 }), []);
    assert.equal(repository.findCandidateByKey("alpha").status, "memorialized");
    assert.equal(repository.candidateCounts().memorialized, 1);
  } finally {
    db.close();
  }
});
