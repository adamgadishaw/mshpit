import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

import { createArtistDeathWatchRepository } from "./artistDeathWatchRepository.js";
import { createArtistDeathWatchService } from "./artistDeathWatchService.js";

const MBID = "11111111-1111-4111-8111-111111111111";
const DUPLICATE_MBID = "22222222-2222-4222-8222-222222222222";

const candidate = (artistKey, artistMbid, wikidataId, at = 10) => ({
  artistKey, artistMbid, wikidataId, artistName: artistKey,
  deathDate: "2026-08-29", at,
});

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
    assert.equal(repository.catalogArtistCount(), 3);
    assert.equal(repository.eligibleArtistProgress("alpha"), 1);
    assert.equal(repository.eligibleArtistProgress(null), 0);
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
    assert.equal(repository.eligibleArtistCount(), 0);
  } finally {
    db.close();
  }
});

for (const state of ["new", "pending", "dismissed", "memorialized"]) {
  test(`Wikidata ownership conflict preserves both records when incoming candidate is ${state}`, () => {
    const db = database();
    try {
      const repository = createArtistDeathWatchRepository(db);
      repository.saveConfirmedCandidate(candidate("owner", MBID, "Q42"));
      if (state !== "new") {
        repository.saveConfirmedCandidate(candidate("incoming", DUPLICATE_MBID, "Q43"));
        if (state === "dismissed") repository.review({ artistKey: "incoming", status: state, reviewerId: "mod", at: 11 });
        if (state === "memorialized") repository.markMemorialized({ artistKey: "incoming", artistMbid: DUPLICATE_MBID, reviewerId: "mod", at: 11 });
      }
      const before = db.prepare("SELECT * FROM artist_death_candidates ORDER BY artist_key").all();
      const result = repository.saveConfirmedCandidate(candidate("incoming", DUPLICATE_MBID, "Q42", 20));
      assert.equal(result.conflict, true);
      assert.equal(result.row.artist_key, "owner");
      assert.deepEqual(db.prepare("SELECT * FROM artist_death_candidates ORDER BY artist_key").all(), before);
    } finally {
      db.close();
    }
  });
}

test("unrelated SQLite failures still propagate instead of becoming identity conflicts", () => {
  const db = database();
  try {
    const repository = createArtistDeathWatchRepository(db);
    assert.throws(() => repository.saveConfirmedCandidate({
      ...candidate("invalid", MBID, "Q42"), artistName: null,
    }), (error) => error.code === "ERR_SQLITE_ERROR" && error.errcode === 1299);
    assert.equal(repository.findCandidateByKey("invalid"), null);
  } finally {
    db.close();
  }
});

test("a bounded scan continues past a Wikidata identity collision without publishing or replacing candidates", async () => {
  const db = database();
  try {
    const repository = createArtistDeathWatchRepository(db);
    repository.saveConfirmedCandidate(candidate("owner", MBID, "Q42"));
    repository.review({ artistKey: "owner", status: "dismissed", reviewerId: "mod", at: 11 });
    const owner = repository.findCandidateByKey("owner");
    const nextMbid = "33333333-3333-4333-8333-333333333333";
    const insertArtist = db.prepare("INSERT INTO artists (norm,name,mbid,data) VALUES (?,?,?,?)");
    insertArtist.run("alpha", "Alpha", DUPLICATE_MBID, "{}");
    insertArtist.run("beta", "Beta", nextMbid, "{}");
    const service = createArtistDeathWatchService({
      repository, sleep: async () => {}, recentWikidataReader: async () => [],
      wikidataReader: async (artists) => new Map(artists.map((artist) => [artist.artistKey, {
        ...artist, wikidataId: artist.artistKey === "alpha" ? "Q42" : "Q44", deathDate: "2026-08-29",
      }])),
      musicBrainzReader: async (signal) => ({ ...signal, artistType: "Person" }),
    });
    const at = Date.parse("2026-08-30T12:00:00Z");
    const result = await service.scan({ at });
    assert.equal(result.scanned, 2);
    assert.equal(result.inserted, 1);
    assert.equal(result.reopened, 0);
    assert.equal(result.reconfirmed, 0);
    assert.equal(repository.readSettings().last_success_at, at);
    assert.equal(repository.readSettings().last_error_code, null);
    assert.equal(repository.findCandidateByKey("alpha"), null);
    assert.equal(repository.findCandidateByKey("beta").status, "pending");
    assert.deepEqual(repository.findCandidateByKey("owner"), owner);
    assert.equal(db.prepare("SELECT count(*) AS count FROM artist_memorials").get().count, 0);
  } finally {
    db.close();
  }
});
