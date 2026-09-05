import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import {
  artistHasPublishedMemorial,
  tourDateHasNoPublishedMemorialSql,
} from "./artistMemorialTourDateVisibility.js";
import { visibleTourDateRowsFrom } from "./tourDateVisibility.js";

function fixture() {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY,is_banned INTEGER NOT NULL DEFAULT 0,suspended_until INTEGER);
    CREATE TABLE blocks (blocker_id TEXT,blocked_id TEXT);
    CREATE TABLE artists (norm TEXT PRIMARY KEY,name TEXT NOT NULL,mbid TEXT);
    CREATE TABLE artist_memorials (artist_key TEXT PRIMARY KEY,artist_mbid TEXT,status TEXT NOT NULL);
    CREATE TABLE tour_dates (
      id TEXT PRIMARY KEY,artist TEXT,artist_key TEXT,owner_id TEXT,release_at INTEGER NOT NULL DEFAULT 0,
      date TEXT,event_end_date TEXT,event_kind TEXT,music_evidence TEXT,billed_artists TEXT,
      music_qualified INTEGER,provider_active INTEGER NOT NULL DEFAULT 1
    );
  `);
  const addArtist = database.prepare("INSERT INTO artists (norm,name,mbid) VALUES (?,?,?)");
  const addMemorial = database.prepare("INSERT INTO artist_memorials (artist_key,artist_mbid,status) VALUES (?,?,?)");
  const addDate = database.prepare(`INSERT INTO tour_dates
    (id,artist,artist_key,date,event_end_date,music_qualified,provider_active) VALUES (?,?,?,?,?,1,1)`);
  return { database, addArtist, addMemorial, addDate };
}

test("tour-date memorial SQL rejects unsafe aliases", () => {
  assert.throws(() => tourDateHasNoPublishedMemorialSql("td;drop"), /Invalid tour-date SQL alias/);
});

test("upcoming reads reject provider passes, series, and classes but retain real festivals", () => {
  const { database } = fixture();
  const add = database.prepare(`INSERT INTO tour_dates
    (id,artist,date,event_end_date,event_kind,music_evidence,billed_artists,music_qualified,provider_active)
    VALUES (?,?,?,?,?,?,?,1,1)`);
  try {
    add.run("entry-all", "Entry to All Shows", "2026-01-01", "2026-12-31", "multi_day",
      "ticketmaster:classification:music", "[]");
    add.run("season-pass", "Morning Melodies", "2026-02-23", "2026-12-07", "multi_day",
      "ticketmaster:classification:music", JSON.stringify(["Morning Melodies"]));
    add.run("beginner-class", "Koto Beginner Class", "2026-08-23", "2026-11-08", "multi_day",
      "ticketmaster:classification:music", "[]");
    add.run("real-festival", "Riverfront Jazz Festival", "2026-09-03", "2026-09-07", "festival",
      "ticketmaster:classification:music", JSON.stringify(["Gladys Knight", "Samara Joy"]));
    add.run("real-multi-day", "Touring Artist", "2026-09-04", "2026-09-06", "multi_day",
      "ticketmaster:classification:music", JSON.stringify(["Touring Artist"]));

    assert.deepEqual(visibleTourDateRowsFrom(database, null, {
      today: "2026-09-04",
      at: Date.UTC(2026, 8, 5),
    }).map((row) => row.id), ["real-festival", "real-multi-day"]);
    assert.deepEqual(visibleTourDateRowsFrom(database, null, {
      at: Date.UTC(2026, 8, 5),
    }).map((row) => row.id), ["entry-all", "season-pass", "beginner-class", "real-festival", "real-multi-day"],
    "historical/admin read paths retain the stored rows for diagnosis and repair");
  } finally {
    database.close();
  }
});

test("published exact-identity memorials suppress current and future dates but preserve history", () => {
  const { database, addArtist, addMemorial, addDate } = fixture();
  try {
    addArtist.run("remembered", "Remembered Artist", "mbid-remembered");
    addArtist.run("living", "Living Artist", "mbid-living");
    addMemorial.run("remembered", "mbid-remembered", "published");
    addDate.run("remembered-future", "Remembered Artist", "remembered", "2026-09-10", null);
    addDate.run("remembered-legacy", "Remembered Artist", null, "2026-09-11", null);
    addDate.run("remembered-past", "Remembered Artist", "remembered", "2026-08-01", null);
    addDate.run("living-future", "Living Artist", "living", "2026-09-12", null);

    const upcoming = visibleTourDateRowsFrom(database, null, { today: "2026-08-28", at: Date.UTC(2026, 7, 28) });
    assert.deepEqual(upcoming.map(({ id }) => id), ["living-future"]);

    const completeHistory = visibleTourDateRowsFrom(database, null, { at: Date.UTC(2026, 7, 28) });
    assert.deepEqual(completeHistory.map(({ id }) => id), [
      "remembered-past", "remembered-future", "remembered-legacy", "living-future",
    ]);
  } finally {
    database.close();
  }
});

test("draft or stale memorial identity never suppresses another artist", () => {
  const { database, addArtist, addMemorial, addDate } = fixture();
  try {
    addArtist.run("draft", "Draft Artist", "mbid-draft");
    addArtist.run("reassigned", "Reassigned Artist", "mbid-current");
    addMemorial.run("draft", "mbid-draft", "draft");
    addMemorial.run("reassigned", "mbid-old", "published");
    addDate.run("draft-future", "Draft Artist", "draft", "2026-09-01", null);
    addDate.run("reassigned-future", "Reassigned Artist", "reassigned", "2026-09-02", null);

    const upcoming = visibleTourDateRowsFrom(database, null, { today: "2026-08-28", at: Date.UTC(2026, 7, 28) });
    assert.deepEqual(upcoming.map(({ id }) => id), ["draft-future", "reassigned-future"]);
    assert.equal(artistHasPublishedMemorial(database, { artistKey: "draft", artist: "Draft Artist" }), false);
    assert.equal(artistHasPublishedMemorial(database, { artistKey: "reassigned", artist: "Reassigned Artist" }), false);
  } finally {
    database.close();
  }
});

test("exact tour-date lookup stays bounded and preserves public visibility rules", () => {
  const { database, addDate } = fixture();
  try {
    addDate.run("wanted", "Wanted Artist", null, "2026-09-01", null);
    addDate.run("other", "Other Artist", null, "2026-09-02", null);
    assert.deepEqual(visibleTourDateRowsFrom(database, null, {
      id: "wanted",
      at: Date.UTC(2026, 7, 28),
      limit: 2,
    }).map(({ id }) => id), ["wanted"]);
    assert.deepEqual(visibleTourDateRowsFrom(database, null, {
      id: "missing",
      at: Date.UTC(2026, 7, 28),
      limit: 2,
    }), []);
  } finally {
    database.close();
  }
});

test("published memorial lookup accepts a current exact key or unique display name", () => {
  const { database, addArtist, addMemorial } = fixture();
  try {
    addArtist.run("remembered", "Remembered Artist", "mbid-remembered");
    addMemorial.run("remembered", "mbid-remembered", "published");
    assert.equal(artistHasPublishedMemorial(database, { artistKey: "remembered" }), true);
    assert.equal(artistHasPublishedMemorial(database, { artist: "Remembered Artist" }), true);
    assert.equal(artistHasPublishedMemorial(database, {
      artistKey: "someone-else",
      artist: "Remembered Artist",
    }), false, "an explicit, different identity must never fall back to the display name");
    assert.equal(artistHasPublishedMemorial(database, { artist: "Someone Else" }), false);
  } finally {
    database.close();
  }
});
