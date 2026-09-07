import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { registerPitSqliteFunctions } from "../../sqliteFunctions.js";
import { createEventCoverageService } from "./eventCoverageService.js";

const NOW = Date.parse("2026-09-07T02:00:00Z");

function fixture() {
  const database = registerPitSqliteFunctions(new DatabaseSync(":memory:"));
  database.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY,is_banned INTEGER DEFAULT 0,suspended_until INTEGER);
    INSERT INTO users VALUES ('member',0,NULL),('banned',1,NULL),('suspended',0,9999999999999);
    CREATE TABLE artists (norm TEXT PRIMARY KEY,name TEXT,mbid TEXT);
    CREATE TABLE artist_memorials (artist_key TEXT,artist_mbid TEXT,status TEXT);
    CREATE TABLE tour_dates (
      id TEXT PRIMARY KEY,artist TEXT DEFAULT 'Artist',artist_key TEXT,
      venue TEXT DEFAULT 'Venue',venue_city TEXT DEFAULT 'City',venue_country_code TEXT DEFAULT 'FR',venue_country TEXT,
      date TEXT DEFAULT '2026-09-10',event_end_date TEXT,event_timezone TEXT,
      owner_id TEXT,release_at INTEGER DEFAULT 0,provider_active INTEGER DEFAULT 1,music_qualified INTEGER DEFAULT 1,
      event_kind TEXT DEFAULT 'concert',music_evidence TEXT,billed_artists TEXT
    );
  `);
  const add = (id, fields = {}) => {
    const entries = Object.entries({ id, ...fields });
    database.prepare(`INSERT INTO tour_dates (${entries.map(([key]) => key).join(",")}) VALUES (${entries.map(() => "?").join(",")})`)
      .run(...entries.map(([, value]) => value));
  };
  return { database, add };
}

test("country totals include events past the first global page and merge country aliases", () => {
  const { database, add } = fixture();
  try {
    for (let index = 0; index < 600; index += 1) add(`us-${index}`, { venue_country_code: "US" });
    add("france");
    add("france-name", { venue_country_code: "", venue_country: "France", venue: "Another venue" });
    add("portugal", { venue_country_code: "PT" });
    const result = createEventCoverageService({ database, clock: () => NOW }).read();
    assert.equal(result.total, 603);
    assert.deepEqual(result.countries.find((row) => row.country === "France"), { country: "France", countryCode: "FR", count: 2, venueCount: 2 });
    assert.equal(result.countries.find((row) => row.country === "Portugal").count, 1);
  } finally { database.close(); }
});

test("public coverage excludes hidden, removed-provider, non-music, expired and memorial artist dates", () => {
  const { database, add } = fixture();
  try {
    add("visible");
    add("unreleased", { owner_id: "member", release_at: NOW + 1000 });
    add("banned", { owner_id: "banned" });
    add("suspended", { owner_id: "suspended" });
    add("deleted", { owner_id: "deleted" });
    add("provider-removed", { provider_active: 0 });
    add("nonmusic", { music_qualified: 0 });
    add("expired", { date: "2026-09-01" });
    add("bad-range", { date: "2026-01-01", event_end_date: "2026-12-31", event_kind: "multi_day" });
    database.exec("INSERT INTO artists VALUES ('legacy','Legacy','mbid'); INSERT INTO artist_memorials VALUES ('legacy','mbid','published');");
    add("memorial", { artist: "Legacy", artist_key: "legacy" });
    const result = createEventCoverageService({ database, clock: () => NOW }).read();
    assert.equal(result.total, 1);
    assert.equal(result.venueTotal, 1);
  } finally { database.close(); }
});

test("event counts keep a Los Angeles show until its local day ends and expire Tokyo's previous day", () => {
  const { database, add } = fixture();
  try {
    add("los-angeles", { date: "2026-09-06", event_timezone: "America/Los_Angeles", venue_country_code: "US" });
    add("tokyo", { date: "2026-09-06", event_timezone: "Asia/Tokyo", venue_country_code: "JP" });
    add("festival", { date: "2026-09-05", event_end_date: "2026-09-08", event_kind: "festival", music_evidence: "music", billed_artists: '["Artist"]' });
    const service = createEventCoverageService({ database, clock: () => NOW });
    assert.equal(service.read().total, 2);
    assert.equal(service.read().countries.some((row) => row.country === "Japan"), false);
  } finally { database.close(); }
});

test("coverage caches aggregates for one minute and can be invalidated after a catalog update", () => {
  const { database, add } = fixture();
  let clock = NOW;
  try {
    add("first");
    const service = createEventCoverageService({ database, clock: () => clock });
    const first = service.read();
    add("second");
    assert.equal(service.read(), first);
    clock += 60_000;
    assert.equal(service.read().total, 2);
    add("third");
    service.invalidate();
    assert.equal(service.read().total, 3);
  } finally { database.close(); }
});
