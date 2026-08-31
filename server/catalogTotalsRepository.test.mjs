import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { createCatalogTotalsReader } from "./catalogTotalsRepository.js";

function fixtureDatabase() {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE artists (norm TEXT PRIMARY KEY);
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      is_banned INTEGER NOT NULL DEFAULT 0,
      suspended_until INTEGER
    );
    CREATE TABLE tour_dates (
      id TEXT PRIMARY KEY,
      venue TEXT,
      venue_city TEXT,
      venue_country_code TEXT,
      venue_country TEXT,
      release_at INTEGER NOT NULL DEFAULT 0,
      music_qualified INTEGER,
      owner_id TEXT,
      provider_active INTEGER NOT NULL DEFAULT 1
    );
  `);
  return database;
}

test("catalog totals count public artists and distinct structured venues with a bounded cache", () => {
  const database = fixtureDatabase();
  const base = 1_000_000;
  const addVenue = database.prepare(`INSERT INTO tour_dates
    (id,venue,venue_city,venue_country_code,venue_country,release_at,music_qualified,owner_id,provider_active)
    VALUES (?,?,?,?,?,?,?,?,?)`);

  database.prepare("INSERT INTO artists (norm) VALUES (?),(?)").run("alpha", "beta");
  database.prepare("INSERT INTO users (id,is_banned) VALUES (?,0),(?,1)").run("active-owner", "banned-owner");
  addVenue.run("toronto-1", "Shared Room", "Toronto", "CA", "Canada", 0, 1, null, 1);
  addVenue.run("toronto-2", " shared room ", " toronto ", "ca", "Canada", 0, 1, null, 1);
  addVenue.run("montreal", "Shared Room", "Montreal", "CA", "Canada", 0, 1, null, 1);
  addVenue.run("inactive", "Inactive Hall", "Toronto", "CA", "Canada", 0, 1, null, 0);
  addVenue.run("non-music", "Conference Hall", "Toronto", "CA", "Canada", 0, 0, null, 1);
  addVenue.run("unreleased", "Later Hall", "Toronto", "CA", "Canada", base + 10_000, 1, null, 1);
  addVenue.run("owner", "Owner Hall", "Ottawa", "CA", "Canada", 0, 1, "active-owner", 0);
  addVenue.run("banned", "Banned Hall", "Ottawa", "CA", "Canada", 0, 1, "banned-owner", 1);

  const readTotals = createCatalogTotalsReader(database, { cacheMs: 1_000 });
  assert.deepEqual(readTotals({ at: base }), { artists: 2, venues: 3 });

  database.prepare("INSERT INTO artists (norm) VALUES (?)").run("gamma");
  addVenue.run("fresh", "Fresh Hall", "Hamilton", "CA", "Canada", 0, 1, null, 1);
  assert.deepEqual(readTotals({ at: base + 500 }), { artists: 2, venues: 3 },
    "the same cache bucket does not repeat aggregate scans");
  assert.deepEqual(readTotals({ at: base + 1_000 }), { artists: 3, venues: 4 });

  database.close();
});
