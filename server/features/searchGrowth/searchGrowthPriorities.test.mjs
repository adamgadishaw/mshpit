import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { generateKeyPairSync } from "node:crypto";
import { registerPitSqliteFunctions } from "../../sqliteFunctions.js";
import { createSearchGrowthService } from "./searchGrowthService.js";
import { ensureSearchGrowthPrioritySchema, rememberSearchGrowthPriorities,
  searchGrowthArtistPriorityKeys, searchGrowthVenuePriorityRows } from "./searchGrowthPriorities.js";
import { ensureCatalogResearchSchema, nextArtistResearchSubject, nextVenueResearchSubject,
  runCatalogResearchPass } from "../catalogResearch/catalogResearchService.js";

const AT = Date.parse("2026-09-27T12:00:00Z"), DAY = 86_400_000;
const KEY = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" });
function fixture(t) {
  const database = registerPitSqliteFunctions(new DatabaseSync(":memory:"));
  t.after(() => database.close());
  const env = { SEARCH_GROWTH_ENABLED: "true", SEARCH_CONSOLE_PROPERTY: "sc-domain:mshpit.com",
    SEARCH_CONSOLE_SERVICE_ACCOUNT_EMAIL: "growth@fixture.iam.gserviceaccount.com", SEARCH_CONSOLE_PRIVATE_KEY: KEY };
  const service = createSearchGrowthService({ database, env, now: () => AT });
  ensureSearchGrowthPrioritySchema(database);
  database.exec(`CREATE TABLE app_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE artists(norm TEXT PRIMARY KEY,name TEXT NOT NULL,public_slug TEXT,source TEXT,
      bio TEXT,genre TEXT,country TEXT,mbid TEXT,rank_score INTEGER DEFAULT 0);
    CREATE TABLE artist_profiles(artist_key TEXT PRIMARY KEY,bio TEXT,owner_id TEXT,removed INTEGER DEFAULT 0);
    CREATE TABLE tour_dates(id TEXT PRIMARY KEY,artist TEXT,artist_key TEXT,venue TEXT,date TEXT,
      owner_id TEXT,release_at INTEGER DEFAULT 0,music_qualified INTEGER DEFAULT 1,provider_active INTEGER DEFAULT 1,
      artist_identity_status TEXT,source TEXT DEFAULT 'ticketmaster',venue_provider_id TEXT,
      venue_city TEXT DEFAULT 'Toronto',venue_region TEXT DEFAULT 'Ontario',venue_country_code TEXT DEFAULT 'CA',venue_address_line1 TEXT);`);
  ensureCatalogResearchSchema(database);
  database.prepare("UPDATE search_growth_state SET mode='prioritize',last_success_at=?,snapshot_property=? WHERE id=1").run(AT, env.SEARCH_CONSOLE_PROPERTY);
  const remember = paths => rememberSearchGrowthPriorities(database, { at: AT, pages: paths.map((path, index) => ({ path, score: 100 - index })) }, env);
  const artist = (key, overrides = {}) => {
    const value = { name: key, slug: key, source: "musicbrainz", rank: 0, ...overrides };
    database.prepare("INSERT INTO artists(norm,name,public_slug,source,rank_score) VALUES (?,?,?,?,?)").run(key, value.name, value.slug, value.source, value.rank);
  };
  const event = (id, key, venue, overrides = {}) => {
    database.prepare("INSERT INTO tour_dates(id,artist,artist_key,venue,venue_provider_id,date) VALUES (?,?,?,?,?,?)").run(id, key, key, venue, `id-${id}`, "2026-10-01");
    for (const [column, value] of Object.entries(overrides)) {
      assert.ok(["owner_id", "release_at", "music_qualified", "provider_active", "artist_identity_status", "venue_city", "venue_country_code"].includes(column));
      database.prepare(`UPDATE tour_dates SET ${column}=? WHERE id=?`).run(value, id);
    }
  };
  return { database, env, service, remember, artist, event, options: { env, at: AT } };
}

test("bridge is additive, idle without its schema, and never creates tables while reading", t => {
  const database = new DatabaseSync(":memory:"); t.after(() => database.close());
  assert.deepEqual(searchGrowthArtistPriorityKeys(database), []);
  assert.deepEqual(searchGrowthVenuePriorityRows(database), []);
  assert.equal(database.prepare("SELECT count(*) n FROM sqlite_master WHERE type='table'").get().n, 0);
});

test("priority hints obey master switch, saved mode, property, expiry and future timestamp gates", t => {
  const f = fixture(t); f.artist("priority"); f.remember(["/artist/priority"]);
  assert.deepEqual(searchGrowthArtistPriorityKeys(f.database, f.options), ["priority"]);
  for (const options of [{ ...f.options, env: {} }, { ...f.options, at: AT + 2 * DAY }, { ...f.options, at: AT - 1 },
    { ...f.options, env: { ...f.env, SEARCH_CONSOLE_PROPERTY: "https://www.mshpit.com/" } }]) {
    assert.deepEqual(searchGrowthArtistPriorityKeys(f.database, options), []);
  }
  f.service.setMode("monitor");
  assert.deepEqual(searchGrowthArtistPriorityKeys(f.database, f.options), []);
  f.service.setMode("paused");
  assert.deepEqual(searchGrowthArtistPriorityKeys(f.database, f.options), []);
});

test("stored hint replacement is bounded and ignores untrusted or unsupported paths", t => {
  const f = fixture(t);
  rememberSearchGrowthPriorities(f.database, { at: AT, pages: Array.from({ length: 30 }, (_, i) => ({ path: `/artist/act-${i}`, score: i })) }, f.env);
  assert.equal(f.database.prepare("SELECT count(*) n FROM search_growth_priority_pages").get().n, 10);
  f.remember(["/user/private", "/artist/a?email=private", "/artist/../x", "/city/ca/toronto", "https://evil.test/artist/a", "/artist/allowed"]);
  assert.deepEqual(f.database.prepare("SELECT path FROM search_growth_priority_pages").all().map(row => row.path), ["/artist/allowed"]);
  f.remember([]);
  assert.equal(f.database.prepare("SELECT count(*) n FROM search_growth_priority_pages").get().n, 0);
});

test("exact artist and public event bindings only; never infer ambiguous artist names", t => {
  const f = fixture(t); f.artist("priority"); f.artist("created", { source: "artist-created" });
  f.artist("duplicate-a", { slug: "ambiguous" }); f.artist("duplicate-b", { slug: "ambiguous" });
  f.event("public", "priority", "Rebel");
  f.event("member", "created", "Private room", { owner_id: "private-user" });
  f.remember(["/artist/ambiguous", "/artist/created", "/event/member", "/event/public", "/artist/missing", "/artist/priority"]);
  assert.deepEqual(searchGrowthArtistPriorityKeys(f.database, f.options), ["priority"]);
});

test("private, unreleased, nonmusic, inactive and unresolved events cannot promote a subject", t => {
  const f = fixture(t); f.artist("priority");
  const cases = [{ owner_id: "member" }, { release_at: AT + 1 }, { music_qualified: 0 }, { provider_active: 0 },
    { artist_identity_status: "pending" }, { artist_identity_status: "conflict" }];
  cases.forEach((attributes, i) => f.event(`event-${i}`, "priority", "Rebel", attributes));
  f.remember(cases.map((_, i) => `/event/event-${i}`));
  assert.deepEqual(searchGrowthArtistPriorityKeys(f.database, f.options), []);
  assert.deepEqual(searchGrowthVenuePriorityRows(f.database, f.options), []);
});

test("venue event/provider identities work but ambiguous same-name rooms are not guessed", t => {
  const f = fixture(t); f.artist("priority");
  f.event("toronto", "priority", "Rebel"); f.event("london", "priority", "Rebel", { venue_city: "London", venue_country_code: "GB" });
  f.remember(["/venue/rebel"]);
  assert.deepEqual(searchGrowthVenuePriorityRows(f.database, f.options), []);
  f.remember(["/venue/ticketmaster-id-toronto", "/event/toronto"]);
  const rooms = searchGrowthVenuePriorityRows(f.database, f.options);
  assert.equal(rooms.length, 1); assert.equal(rooms[0].city, "Toronto");
});

test("search priority keeps existing claimed/staff/due-date eligibility checks", t => {
  const f = fixture(t); f.artist("priority"); f.artist("regular", { rank: 50 });
  f.remember(["/artist/priority"]);
  assert.equal(nextArtistResearchSubject(f.database, { ...f.options, prioritizeSearch: true }).key, "priority");
  f.database.exec("INSERT INTO artist_profiles(artist_key,owner_id) VALUES ('priority','owner')");
  assert.equal(nextArtistResearchSubject(f.database, { ...f.options, prioritizeSearch: true }).key, "regular");
  f.database.exec("UPDATE artist_profiles SET owner_id=NULL,bio='Staff biography' WHERE artist_key='priority'");
  assert.equal(nextArtistResearchSubject(f.database, { ...f.options, prioritizeSearch: true }).key, "regular");
  f.database.exec("UPDATE artist_profiles SET bio=NULL WHERE artist_key='priority'; UPDATE artists SET bio='Existing biography' WHERE norm='priority'");
  assert.equal(nextArtistResearchSubject(f.database, { ...f.options, prioritizeSearch: true }).key, "regular");
});

test("artist and venue priority turns are independent, persist between passes and preserve paid budget admission", async t => {
  const f = fixture(t); f.artist("priority"); f.artist("regular", { rank: 100 });
  f.event("one", "regular", "Regular Room"); f.event("two", "regular", "Regular Room"); f.event("three", "priority", "Priority Room");
  f.remember(["/artist/priority", "/venue/ticketmaster-id-three"]);
  assert.equal(nextVenueResearchSubject(f.database, { ...f.options, prioritizeSearch: true }).name, "Priority Room");
  const calls = [], env = { ...f.env, ANTHROPIC_API_KEY: "fixture", CATALOG_RESEARCH_DAILY_USD: "1" };
  const research = async subject => { calls.push(`${subject.type}:${subject.name}`); return { findings: { match: "not_found" }, searchedUrls: [], model: "claude-sonnet-5", costMicroUsd: 10_000 }; };
  const pass = () => runCatalogResearchPass({ database: f.database, env, now: () => AT, research, maxItems: 2 });
  await pass(); await pass();
  assert.deepEqual(calls, ["artist:priority", "venue:Priority Room", "artist:regular", "venue:Regular Room"]);
  f.artist("another");
  const limited = await runCatalogResearchPass({ database: f.database, env: { ...env, CATALOG_RESEARCH_DAILY_USD: "0.01" }, now: () => AT, research });
  assert.equal(limited.stopped, "daily_budget"); assert.equal(calls.length, 4);
});
