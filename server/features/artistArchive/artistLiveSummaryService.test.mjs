import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { registerPitSqliteFunctions } from "../../sqliteFunctions.js";
import { artistScheduleFilters, createArtistLiveSummaryService } from "./artistLiveSummaryService.js";
import { artistScheduleCandidateIndex, ensureArtistScheduleRevisionSchema } from "./artistScheduleCandidateIndex.js";
import { storedBillingMatchesArtist } from "../../artistBillingIdentity.js";

const NOW = Date.parse("2026-09-07T02:00:00Z");
function fixture() {
  const database = registerPitSqliteFunctions(new DatabaseSync(":memory:"));
  database.exec(`
    CREATE TABLE users(id TEXT PRIMARY KEY,is_banned INTEGER DEFAULT 0,suspended_until INTEGER,dormant_at INTEGER,profile_audience TEXT DEFAULT 'everyone');
    INSERT INTO users(id) VALUES ('viewer'),('fan'),('blocked');
    CREATE TABLE blocks(blocker_id TEXT,blocked_id TEXT);
    CREATE TABLE artists(norm TEXT PRIMARY KEY,name TEXT,mbid TEXT);
    INSERT INTO artists VALUES ('alpha','Alpha','mbid-alpha'),('beta','Beta','mbid-beta'),('chris brown','Chris Brown','mbid-chris'),('usher','Usher','mbid-usher');
    CREATE TABLE artist_memorials(artist_key TEXT,artist_mbid TEXT,status TEXT,death_date TEXT);
    CREATE TABLE artist_tourdate_refresh_queue(artist_key TEXT PRIMARY KEY,status TEXT,attempted_at INTEGER,succeeded_at INTEGER,
      ticketmaster_coverage_limited INTEGER DEFAULT 0,last_error_code TEXT);
    CREATE TABLE tour_dates(id TEXT PRIMARY KEY,artist_key TEXT,artist TEXT DEFAULT 'Alpha',venue TEXT DEFAULT 'Hall',
      date TEXT DEFAULT '2026-10-01',event_end_date TEXT,event_timezone TEXT,owner_id TEXT,release_at INTEGER DEFAULT 0,
      source TEXT DEFAULT 'ticketmaster',provider_active INTEGER DEFAULT 1,music_qualified INTEGER DEFAULT 1,
      event_kind TEXT DEFAULT 'concert',music_evidence TEXT,billed_artists TEXT,venue_city TEXT DEFAULT 'Toronto',venue_country_code TEXT DEFAULT 'CA');
    CREATE TABLE posts(id TEXT PRIMARY KEY,user_id TEXT DEFAULT 'fan',artist TEXT DEFAULT 'Alpha',artist_key TEXT DEFAULT 'alpha',
      venue TEXT DEFAULT 'Hall',venue_key TEXT DEFAULT 'hall',date TEXT DEFAULT '2026-08-01',kind TEXT DEFAULT 'review',
      experience_type TEXT DEFAULT 'in_person',overall REAL DEFAULT 4,band REAL,room REAL,dims TEXT DEFAULT '{}',
      review TEXT DEFAULT 'A review',removed INTEGER DEFAULT 0,created_at INTEGER DEFAULT 1);
  `);
  ensureArtistScheduleRevisionSchema(database);
  function add(table, id, fields = {}) {
    const entries = Object.entries({ id, ...fields });
    database.prepare(`INSERT INTO ${table}(${entries.map(([key]) => key).join(",")}) VALUES(${entries.map(() => "?").join(",")})`)
      .run(...entries.map(([, value]) => value));
  }
  const service = createArtistLiveSummaryService({ database, projectDate: (row) => ({ id: row.id, date: row.date, artist: row.artist }),
    clock: () => NOW, providersConfigured: () => true });
  const read = (query = {}, viewer = null, key = "alpha") => service.read({
    artist: database.prepare("SELECT * FROM artists WHERE norm=?").get(key), query, viewer,
  });
  return { database, addDate: (id, fields) => add("tour_dates", id, fields),
    addPost: (id, fields) => add("posts", id, fields), read };
}

test("shared billing candidates never cache current visibility or viewer privacy", () => {
  const f = fixture();
  try {
    f.addDate("joint", { artist_key: "beta", artist: "Beta", music_evidence: "music", billed_artists: '["Beta","Alpha"]' });
    f.addDate("owned", { artist_key: "alpha", owner_id: "fan" });
    const index = artistScheduleCandidateIndex(f.database);
    assert.equal(f.read({}, { id: "viewer" }).schedule.total, 2);
    assert.equal(index.diagnostics().buildCount, 1);
    const second = createArtistLiveSummaryService({ database: f.database, projectDate: (row) => row, clock: () => NOW });
    assert.equal(second.read({ artist: { norm: "alpha", name: "Alpha" } }).schedule.total, 2);
    assert.equal(index.diagnostics().buildCount, 1);
    f.database.exec("UPDATE tour_dates SET provider_active=0 WHERE id='joint'");
    assert.equal(f.read().schedule.total, 1);
    f.database.exec("UPDATE tour_dates SET provider_active=1,music_qualified=0 WHERE id='joint'");
    assert.equal(f.read().schedule.total, 1);
    f.database.exec(`UPDATE tour_dates SET music_qualified=1,release_at=${NOW + 1000} WHERE id='joint'`);
    assert.equal(f.read().schedule.total, 1);
    f.database.exec("UPDATE tour_dates SET release_at=0 WHERE id='joint'; INSERT INTO blocks VALUES('fan','viewer')");
    assert.equal(f.read({}, { id: "viewer" }).schedule.total, 1);
    assert.equal(f.read().schedule.total, 2);
    f.database.exec("UPDATE users SET is_banned=1 WHERE id='fan'");
    assert.equal(f.read().schedule.total, 1);
    f.database.exec("UPDATE tour_dates SET date='2020-01-01' WHERE id='joint'");
    assert.equal(f.read().schedule.total, 0);
    assert.equal(index.diagnostics().buildCount, 1);
  } finally { f.database.close(); }
});

test("billing candidates refresh for insert, rename, ownership and deletion without losing exact matches", () => {
  const f = fixture();
  try {
    const fields = { artist_key: "beta", artist: "Beta", music_evidence: "music", billed_artists: '["Alpha"]' };
    const index = artistScheduleCandidateIndex(f.database);
    assert.equal(f.read().schedule.total, 0);
    f.addDate("joint", fields);
    assert.equal(f.read().schedule.total, 1);
    f.database.exec("UPDATE tour_dates SET billed_artists='[\"Beta\"]' WHERE id='joint'");
    assert.equal(f.read().schedule.total, 0);
    f.database.exec("UPDATE tour_dates SET billed_artists='[\"Alpha\"]',owner_id='fan' WHERE id='joint'");
    assert.equal(f.read().schedule.total, 0);
    f.database.exec("UPDATE tour_dates SET owner_id=NULL WHERE id='joint'");
    assert.equal(f.read().schedule.total, 1);
    f.database.exec("INSERT INTO artists VALUES('alpha-alias','ALPHA',NULL)");
    assert.equal(f.read().schedule.total, 0);
    f.database.exec("UPDATE artists SET name='Not Alpha' WHERE norm='alpha-alias'");
    assert.equal(f.read().schedule.total, 1);
    f.database.exec("UPDATE tour_dates SET artist_key='alpha',artist='Earlier name',billed_artists='[]' WHERE id='joint'");
    assert.equal(f.read().schedule.total, 1);
    f.database.exec("DELETE FROM tour_dates WHERE id='joint'");
    assert.equal(f.read().schedule.total, 0);
    assert.equal(index.diagnostics().buildCount, 9);
  } finally { f.database.close(); }
});

test("large catalogs build billing candidates once and warm pages examine only indexed matches", (t) => {
  const f = fixture();
  try {
    f.database.exec(`CREATE INDEX idx_fixture_artist_names ON artists(name COLLATE NOCASE);
      CREATE INDEX idx_fixture_tour_artist ON tour_dates(artist_key,release_at,date,provider_active,id);
      CREATE INDEX idx_fixture_tour_name ON tour_dates(LOWER(artist),date,id);
      CREATE INDEX idx_fixture_tour_public ON tour_dates(provider_active,date,id) WHERE owner_id IS NULL; BEGIN;`);
    const insertArtist = f.database.prepare("INSERT INTO artists(norm,name) VALUES(?,?)");
    const insertDate = f.database.prepare("INSERT INTO tour_dates(id,artist_key,artist,music_evidence,billed_artists) VALUES(?,?,?,'music',?)");
    for (let i = 0; i < 20_000; i += 1) insertArtist.run(`other-${i}`, `Other ${i}`);
    for (let i = 0; i < 30_000; i += 1) insertDate.run(`date-${i}`, `other-${i % 20_000}`, `Other ${i % 20_000}`,
      JSON.stringify([`Other ${i % 20_000}`, ...(i % 1000 === 0 ? ["Alpha"] : [])]));
    f.database.exec("COMMIT");
    const index = artistScheduleCandidateIndex(f.database);
    let billingChecks = 0;
    f.database.function("pit_live_billing_matches", { deterministic: true }, (...args) => {
      billingChecks += 1; return storedBillingMatchesArtist(...args) ? 1 : 0;
    });
    const timings = [];
    for (let i = 0; i < 7; i += 1) {
      billingChecks = 0;
      const start = performance.now();
      const result = f.read();
      timings.push(performance.now() - start);
      assert.equal(result.schedule.total, 30);
      assert.equal(result.schedule.items.length, 12);
      assert.ok(billingChecks <= 60, `Expected only 30 candidates per count/page, not a catalog scan; got ${billingChecks}`);
    }
    assert.equal(index.diagnostics().buildCount, 1);
    f.database.exec("UPDATE tour_dates SET provider_active=0 WHERE id='date-0'");
    assert.equal(f.read().schedule.total, 29);
    assert.equal(index.diagnostics().buildCount, 1);
    f.database.exec("UPDATE tour_dates SET billed_artists='[\"Other 1\",\"Alpha\"]' WHERE id='date-1'");
    const revisedStart = performance.now();
    assert.equal(f.read().schedule.total, 30);
    const revisedMs = performance.now() - revisedStart;
    assert.equal(index.diagnostics().buildCount, 2);
    t.diagnostic(`Synthetic 20k artists/30k events, milliseconds: cold=${timings[0].toFixed(1)}, warm=${timings.slice(1).map((n) => n.toFixed(1)).join(",")}, after identity revision=${revisedMs.toFixed(1)}`);
  } finally { f.database.close(); }
});

test("artist pages query the full stored calendar and cursor-page without global feed limits", () => {
  const f = fixture();
  try {
    for (let i = 0; i < 600; i += 1) f.addDate(`other-${i}`, { artist: "Beta", artist_key: "beta" });
    for (let i = 0; i < 125; i += 1) f.addDate(`alpha-${String(i).padStart(3, "0")}`, { date: "2027-05-01" });
    let result = f.read({ limit: 50 });
    assert.equal(result.schedule.total, 125);
    assert.equal(result.schedule.items.length, 50);
    assert.equal(result.schedule.coverage.status, "unknown");
    const ids = result.schedule.items.map((row) => row.id);
    while (result.schedule.nextCursor) {
      result = f.read({ limit: 50, after: result.schedule.nextCursor });
      ids.push(...result.schedule.items.map((row) => row.id));
      assert.equal(result.schedule.total, 125);
    }
    assert.equal(ids.length, 125);
    assert.equal(new Set(ids).size, 125);
    assert.equal(result.schedule.hasMore, false);
  } finally { f.database.close(); }
});

test("canonical primary keys and verified individual billing match, not tribute title fragments", () => {
  const f = fixture();
  try {
    f.addDate("renamed", { artist_key: "alpha", artist: "Former name" });
    f.addDate("lineup", { artist_key: "beta", artist: "Beta", music_evidence: "ticketmaster:classification:music", billed_artists: '["Beta","Alpha"]' });
    f.addDate("tribute", { artist: "A tribute to Alpha", billed_artists: '["A tribute to Alpha"]', music_evidence: "music" });
    f.addDate("unsupported", { artist: "Beta", source: "unknown", billed_artists: '["Alpha"]', music_evidence: "music" });
    f.addDate("bad-json", { artist: "Beta", billed_artists: "{", music_evidence: "music" });
    f.addDate("not-evidence", { artist: "Beta", billed_artists: '["Alpha"]' });
    assert.deepEqual(f.read().schedule.items.map((row) => row.id), ["lineup", "renamed"]);
    f.database.exec("INSERT INTO artists VALUES ('another-alpha','Alpha','different-mbid')");
    assert.deepEqual(f.read().schedule.items.map((row) => row.id), ["renamed"]);
  } finally { f.database.close(); }
});

test("retained verified joint billing reaches both individual pages exactly once", () => {
  const f = fixture();
  try {
    f.addDate("joint", { artist: "USHER RAYMOND & CHRIS BROWN", music_evidence: "ticketmaster:classification:music",
      billed_artists: '["USHER RAYMOND & CHRIS BROWN"]' });
    f.addDate("unverified", { artist: "Chris Brown & Somebody", music_evidence: "music", billed_artists: '["Chris Brown & Somebody"]' });
    assert.deepEqual(f.read({}, null, "chris brown").schedule.items.map((row) => row.id), ["joint"]);
    assert.deepEqual(f.read({}, null, "usher").schedule.items.map((row) => row.id), ["joint"]);
  } finally { f.database.close(); }
});

test("schedule preserves release, account, block, classification, local-day and provider lifecycle boundaries", () => {
  const f = fixture();
  try {
    f.addDate("public");
    f.addDate("scheduled", { owner_id: "fan", release_at: NOW + 1000 });
    f.addDate("blocked", { owner_id: "blocked" });
    f.addDate("deleted-owner", { owner_id: "missing" });
    f.addDate("inactive", { provider_active: 0 });
    f.addDate("sports", { music_qualified: 0 });
    f.addDate("expired", { date: "2026-01-01" });
    f.addDate("tokyo", { date: "2026-09-06", event_timezone: "Asia/Tokyo" });
    f.addDate("la", { date: "2026-09-06", event_timezone: "America/Los_Angeles" });
    f.addDate("unbounded-pass", { date: "2026-01-01", event_end_date: "2026-12-01", event_kind: "multi_day" });
    f.database.exec("INSERT INTO blocks VALUES ('blocked','viewer')");
    assert.deepEqual(f.read({}, { id: "viewer" }).schedule.items.map((row) => row.id), ["la", "public"]);
    assert.equal(f.read({}, { id: "fan" }).schedule.items.some((row) => row.id === "scheduled"), true);
    f.database.exec("UPDATE users SET is_banned=1 WHERE id='fan'");
    assert.equal(f.read({}, { id: "fan" }).schedule.items.some((row) => row.id === "scheduled"), false);
  } finally { f.database.close(); }
});

test("schedule filters are exact and a cursor cannot be reused for another artist or location", () => {
  const f = fixture();
  try {
    f.addDate("ca-1"); f.addDate("ca-2");
    f.addDate("us", { venue_city: "New York", venue_country_code: "US" });
    const page = f.read({ limit: 1, city: "Toronto", countryCode: "ca" });
    assert.equal(page.schedule.total, 2);
    assert.throws(() => f.read({ limit: 1, after: page.schedule.nextCursor }), { code: "VALIDATION_FAILED" });
    assert.throws(() => f.read({ limit: 1, city: "Toronto", countryCode: "CA", after: page.schedule.nextCursor }, null, "beta"), { code: "VALIDATION_FAILED" });
    assert.equal(f.read({ city: "Toronto", countryCode: "CA", after: page.schedule.nextCursor }).schedule.items[0].id, "ca-2");
    assert.throws(() => f.read({ after: "not-json" }), { code: "VALIDATION_FAILED" });
    for (const query of [{ limit: 0 }, { limit: 1000 }, { countryCode: "CAX" }, { city: "x".repeat(121) }]) {
      assert.throws(() => artistScheduleFilters(query), { code: "VALIDATION_FAILED" });
    }
  } finally { f.database.close(); }
});

test("public artist preview excludes all scheduled dates and binds pagination to that visibility", () => {
  const f = fixture();
  try {
    f.addDate("public-1"); f.addDate("public-2");
    f.addDate("scheduled", { owner_id: "viewer", release_at: NOW + 10_000 });
    const viewer = { id: "viewer", role: "admin" };
    assert.equal(f.read({}, viewer).schedule.total, 3);
    const preview = f.read({ publicPreview: "1", limit: 1 }, viewer).schedule;
    assert.equal(preview.total, 2);
    assert.equal(preview.items[0].id, "public-1");
    assert.throws(() => f.read({ after: preview.nextCursor }, viewer), { code: "VALIDATION_FAILED" });
    assert.equal(f.read({ after: preview.nextCursor, publicPreview: "1" }, viewer).schedule.items[0].id, "public-2");
  } finally { f.database.close(); }
});

test("reputation includes more than 2,000 eligible reviews and counts votes, not likes", () => {
  const f = fixture();
  try {
    for (let i = 0; i < 2100; i += 1) f.addPost(`show-${i}`, { venue_key: `venue-${i}`, overall: 5 });
    f.addPost("old-vote", { venue_key: "duplicate", overall: 1 });
    f.addPost("latest-vote", { venue_key: "duplicate", overall: 4, created_at: 2, band: 4.5, room: 3,
      dims: '{"performance":5,"setlist":4,"experience":4.5,"crowd":0}' });
    f.addPost("online", { experience_type: "online", overall: 1 });
    f.addPost("future", { date: "2027-01-01", overall: 1 });
    f.addPost("removed", { removed: 1, overall: 1 });
    const score = f.read().reputation;
    assert.equal(score.ratingCount, 2101);
    assert.equal(score.reviewCount, 2101);
    assert.equal(score.showCount, 2101);
    assert.equal(score.avgRating, (2100 * 5 + 4) / 2101);
    assert.equal(score.avgBand, 4.5);
    assert.equal(score.dimensions.performance, 5);
    assert.equal(score.dimensions.crowd, null);
    assert.equal(score.dimensions.experience, 4.5);
  } finally { f.database.close(); }
});

test("reputation immediately reflects bidirectional blocks and private, disabled or deleted accounts", () => {
  const f = fixture();
  try {
    f.addPost("public", { user_id: "viewer", overall: 5 });
    f.addPost("private", { overall: 1 });
    f.addPost("blocked", { user_id: "blocked", overall: 2 });
    f.addPost("deleted", { user_id: "missing", overall: 1 });
    f.database.exec("UPDATE users SET profile_audience='only_me' WHERE id='fan'; INSERT INTO blocks VALUES ('blocked','viewer')");
    assert.equal(f.read({}, { id: "viewer" }).reputation.avgRating, 5);
    f.database.exec("UPDATE users SET is_banned=1 WHERE id='viewer'");
    assert.equal(f.read({}, { id: "viewer" }).reputation.ratingCount, 0);
    f.database.exec("UPDATE users SET profile_audience='members' WHERE id='fan'");
    assert.equal(f.read().reputation.ratingCount, 1);
    assert.equal(f.read({}, { id: "fan" }).reputation.ratingCount, 2);
  } finally { f.database.close(); }
});

test("legacy and modern memorials cannot advertise dates; historical reputation remains only for modern artists", () => {
  const f = fixture();
  try {
    f.addDate("future"); f.addPost("past");
    f.database.exec("INSERT INTO artist_memorials VALUES ('alpha','mbid-alpha','published','2025-01-01')");
    const modern = f.read();
    assert.equal(modern.schedule.total, 0);
    assert.equal(modern.schedule.coverage.status, "disabled");
    assert.equal(modern.reputation.ratingCount, 1);
    f.database.exec("UPDATE artist_memorials SET death_date='1969-01-01'");
    const legacy = f.read();
    assert.equal(legacy.schedule.legacy, true);
    assert.equal(legacy.reputation.avgRating, null);
    assert.equal(legacy.reputation.ratingCount, 0);
  } finally { f.database.close(); }
});

test("provider failures retain stored dates with honest coverage and no private error details", () => {
  const f = fixture();
  try {
    f.addDate("stored");
    const insert = f.database.prepare("INSERT INTO artist_tourdate_refresh_queue VALUES ('alpha','cooldown',?,?,0,?)");
    insert.run(NOW - 1000, NOW - 1000, null);
    assert.equal(f.read().schedule.coverage.status, "fresh");
    f.database.exec(`UPDATE artist_tourdate_refresh_queue SET succeeded_at=${NOW - 13 * 3600000}`);
    assert.equal(f.read().schedule.coverage.status, "stale");
    f.database.exec("UPDATE artist_tourdate_refresh_queue SET last_error_code='private-error-text',status='pending'");
    const partial = f.read().schedule;
    assert.equal(partial.coverage.status, "partial");
    assert.equal(partial.coverage.errorCode, "PROVIDER_UNAVAILABLE");
    assert.equal(partial.coverage.refreshPending, true);
    assert.equal(JSON.stringify(partial).includes("private-error-text"), false);
    f.database.exec("DELETE FROM tour_dates");
    assert.equal(f.read().schedule.coverage.status, "unavailable");
    f.database.exec("DROP TABLE tour_dates");
    assert.throws(() => f.read(), /no such table/u);
  } finally { f.database.close(); }
});
