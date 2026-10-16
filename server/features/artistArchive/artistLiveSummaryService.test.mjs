import { ensureArtistAccessRetentionTables } from "../artistAccounts/artistAccessRetention.js";
import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { registerPitSqliteFunctions } from "../../sqliteFunctions.js";
import { artistScheduleFilters, createArtistLiveSummaryService } from "./artistLiveSummaryService.js";
import { artistScheduleCandidateIndex, ensureArtistScheduleRevisionSchema } from "./artistScheduleCandidateIndex.js";
import { storedBillingMatchesArtist } from "../../artistBillingIdentity.js";
import { createArtistOverviewController } from "../../../src/features/artistOverview/artistOverviewController.mjs";
import { artistOverviewFromResponse, artistOverviewRequest } from "../../../src/features/artistOverview/artistOverviewRequest.mjs";

const NOW = Date.parse("2026-09-07T02:00:00Z");
function fixture() {
  const database = registerPitSqliteFunctions(new DatabaseSync(":memory:"));
  database.exec(`
    CREATE TABLE users(id TEXT PRIMARY KEY,is_banned INTEGER DEFAULT 0,suspended_until INTEGER,dormant_at INTEGER,profile_audience TEXT DEFAULT 'everyone');
    INSERT INTO users(id) VALUES ('viewer'),('fan'),('blocked');
    CREATE TABLE blocks(blocker_id TEXT,blocked_id TEXT);
    CREATE TABLE artists(norm TEXT PRIMARY KEY,name TEXT,mbid TEXT,source TEXT);
    CREATE TABLE artist_profiles (artist_key TEXT PRIMARY KEY,owner_id TEXT,removed INTEGER DEFAULT 0,identity_review_status TEXT DEFAULT 'clear');
    INSERT INTO artists(norm,name,mbid) VALUES ('alpha','Alpha','mbid-alpha'),('beta','Beta','mbid-beta'),('chris brown','Chris Brown','mbid-chris'),('usher','Usher','mbid-usher'),
      ('sports','Sports','mbid-sports'),('sports-dot','sports.','mbid-sports-dot');
    CREATE TABLE artist_memorials(artist_key TEXT,artist_mbid TEXT,status TEXT,death_date TEXT);
    CREATE TABLE artist_tourdate_refresh_queue(artist_key TEXT PRIMARY KEY,status TEXT,attempted_at INTEGER,succeeded_at INTEGER,
      ticketmaster_coverage_limited INTEGER DEFAULT 0,last_error_code TEXT);
    CREATE TABLE tour_dates(id TEXT PRIMARY KEY,artist_key TEXT,artist TEXT DEFAULT 'Alpha',venue TEXT DEFAULT 'Hall',
      artist_identity_status TEXT,
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
  ensureArtistAccessRetentionTables(database);
  const service = createArtistLiveSummaryService({ database, projectDate: (row) => ({ id: row.id, date: row.date, artist: row.artist }),
    clock: () => NOW, providersConfigured: () => true });
  const read = (query = {}, viewer = null, key = "alpha") => service.read({
    artist: database.prepare("SELECT * FROM artists WHERE norm=?").get(key), query, viewer,
  });
  return { database, addDate: (id, fields) => add("tour_dates", id, fields),
    addPost: (id, fields) => add("posts", id, fields), read };
}

test("pending and conflicting provider identities cannot bind by key, display name, or cached billing", () => {
  const f = fixture();
  try {
    f.addDate("exact", { artist_key: "alpha" });
    f.addDate("name", { artist_key: null });
    f.addDate("billing", { artist_key: "beta", artist: "Beta", music_evidence: "music", billed_artists: '["Beta","Alpha"]' });
    f.addDate("owned", { artist_key: "alpha", owner_id: "fan", artist_identity_status: "pending" });
    assert.equal(f.read().schedule.total, 4);
    f.database.exec("UPDATE tour_dates SET artist_identity_status='conflict' WHERE id='exact'; UPDATE tour_dates SET artist_identity_status='pending' WHERE id IN ('name','billing')");
    f.database.exec("PRAGMA query_only=ON");
    assert.deepEqual(f.read().schedule.items.map(({ id }) => id), ["owned"]);
    f.database.exec("PRAGMA query_only=OFF; UPDATE tour_dates SET artist_identity_status='registered' WHERE owner_id IS NULL");
    assert.equal(f.read().schedule.total, 4, "reviewed registration immediately restores eligible existing bindings");
  } finally { f.database.close(); }
});

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
    f.database.exec("INSERT INTO artists(norm,name,mbid) VALUES('alpha-alias','ALPHA',NULL)");
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
    f.database.exec("INSERT INTO artists(norm,name,mbid) VALUES ('another-alpha','Alpha','different-mbid')");
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

test("provider billing never merges Sports with the distinct punctuated sports. identity", () => {
  const f = fixture();
  try {
    f.addDate("plain-support", { artist_key: "jungle", artist: "Jungle", date: "2026-10-01",
      music_evidence: "ticketmaster:classification:music", billed_artists: '["Jungle","Sports"]' });
    f.addDate("punctuated-support", { artist_key: "jungle", artist: "Jungle", date: "2026-10-02",
      music_evidence: "ticketmaster:classification:music", billed_artists: '["Jungle","sports."]' });
    // The old fuzzy exact-demand import could key this row to sports. even
    // though its provider billing only proved the different artist Sports.
    f.addDate("previously-miskeyed", { artist_key: "sports-dot", artist: "sports.", date: "2026-10-03",
      music_evidence: "ticketmaster:classification:music", billed_artists: '["Jungle","Sports"]' });
    f.addDate("keyless-contradiction", { artist_key: null, artist: "sports.", date: "2026-10-04",
      music_evidence: "ticketmaster:classification:music", billed_artists: '["Jungle","Sports"]' });
    assert.deepEqual(f.read({}, null, "sports-dot").schedule.items.map((row) => row.id), ["punctuated-support"]);
    assert.deepEqual(f.read({}, null, "sports").schedule.items.map((row) => row.id), [
      "plain-support", "previously-miskeyed", "keyless-contradiction",
    ]);
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

const scheduleCursor = (date, id, v = 1, scope = JSON.stringify(["alpha", null, null, false])) =>
  Buffer.from(JSON.stringify({ v, scope, date, id })).toString("base64url");
const readScheduleCursor = (value) => JSON.parse(Buffer.from(value, "base64url").toString("utf8"));

test("new artist schedule pages order mixed date formats chronologically with stable same-day IDs", () => {
  const f = fixture();
  try {
    const events = [
      ["legacy-second", "2026 · 10 · 02"], ["iso-first", "2026-10-01"],
      ["c-same-legacy", "2026 · 10 · 03"], ["b-same-iso", "2026-10-03"],
      ["a-same-legacy", "2026 · 10 · 03"], ["iso-last", "2026-10-04"],
    ];
    for (const [id, date] of events) f.addDate(id, { date });
    const ids = []; let after = null;
    do {
      const page = f.read({ limit: 1, after }).schedule;
      assert.equal(page.total, events.length);
      assert.equal(page.items.length, 1);
      const row = page.items[0]; ids.push(row.id);
      assert.equal(row.date, events.find(([id]) => id === row.id)[1], "display dates are preserved");
      assert.equal(Object.hasOwn(row, "cursor_date"), false);
      after = page.nextCursor;
      if (after) {
        const cursor = readScheduleCursor(after);
        assert.equal(cursor.v, 2);
        assert.match(cursor.date, /^\d{4}-\d{2}-\d{2}$/u);
      }
      assert.ok(ids.length <= events.length, "pagination must terminate");
    } while (after);
    assert.deepEqual(ids, ["iso-first", "legacy-second", "a-same-legacy", "b-same-iso", "c-same-legacy", "iso-last"]);
    assert.equal(new Set(ids).size, events.length);
  } finally { f.database.close(); }
});

test("already-issued v1 legacy and ISO cursors finish their original ordering without skipping or replaying dates", () => {
  const f = fixture();
  try {
    const events = [["legacy-one", "2026 · 10 · 02"], ["legacy-two", "2026 · 10 · 03"],
      ["iso-one", "2026-10-01"], ["iso-two", "2026-10-02"], ["iso-three", "2026-10-04"]];
    for (const [id, date] of events) f.addDate(id, { date });
    for (const [start, expected] of [
      [0, ["legacy-two", "iso-one", "iso-two", "iso-three"]],
      [2, ["iso-two", "iso-three"]],
    ]) {
      const [id, date] = events[start]; let after = scheduleCursor(date, id); const ids = [];
      do {
        const page = f.read({ limit: 1, after }).schedule;
        ids.push(...page.items.map(row => row.id)); after = page.nextCursor;
        if (after) assert.equal(readScheduleCursor(after).v, 1, "the entire old chain retains its ordering");
        assert.ok(ids.length <= expected.length, "old pagination must terminate");
      } while (after);
      assert.deepEqual(ids, expected);
    }
  } finally { f.database.close(); }
});

test("artist pagination validates versions, actual calendar dates, bounds and scope before reading a page", () => {
  const f = fixture();
  try {
    f.addDate("later", { date: "2028-03-01" });
    for (const version of [1, 2]) {
      assert.equal(f.read({ after: scheduleCursor("2028-02-29", "earlier", version) }).schedule.items[0].id, "later");
      for (const date of ["2026-02-29", "2026-04-31", "2026-13-01", "1969-12-31", "2026/10/01", "2026-10-01T00:00:00Z", "2026-10-01\n", "2026-10-01" + " ".repeat(31), null, 20261001, {}]) {
        assert.throws(() => f.read({ after: scheduleCursor(date, "earlier", version) }), { code: "VALIDATION_FAILED" }, JSON.stringify(date));
      }
    }
    assert.equal(f.read({ after: scheduleCursor("2028 · 02 · 29", "earlier") }).schedule.items[0].id, "later");
    assert.throws(() => f.read({ after: scheduleCursor("2028 · 02 · 29", "earlier", 2) }), { code: "VALIDATION_FAILED" });
    for (const v of [0, 3, "2", null]) assert.throws(() => f.read({ after: scheduleCursor("2028-02-29", "earlier", v) }), { code: "VALIDATION_FAILED" });
    for (const id of ["", "x".repeat(241), null, 1]) assert.throws(() => f.read({ after: scheduleCursor("2028-02-29", id) }), { code: "VALIDATION_FAILED" });
    assert.throws(() => f.read({ after: scheduleCursor("2028-02-29", "earlier", 2, "wrong scope") }), { code: "VALIDATION_FAILED" });
  } finally { f.database.close(); }
});

test("actual artist client request, response and controller load all mixed-format server pages", async () => {
  const f = fixture();
  try {
    f.addDate("legacy", { date: "2026 · 10 · 01" }); f.addDate("iso", { date: "2026-10-02" });
    const requests = [];
    const controller = createArtistOverviewController({ artistKey: "alpha", pageSize: 1, asError: error => error,
      read: async options => {
        const request = artistOverviewRequest(options); requests.push(request);
        return artistOverviewFromResponse(f.read(Object.fromEntries(new URL(request.path, "https://example.test").searchParams)));
      },
    });
    assert.equal((await controller.reload()).ok, true);
    assert.equal((await controller.loadMore()).ok, true);
    const state = controller.getSnapshot();
    assert.equal(state.moreError, null);
    assert.equal(state.resource.data.schedule.hasMore, false);
    assert.deepEqual(state.resource.data.schedule.items.map(row => row.id), ["legacy", "iso"]);
    assert.equal(requests.length, 2);
    assert.match(requests[1].path, /&after=/u);
    controller.dispose();
  } finally { f.database.close(); }
});
