import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

process.env.PIT_DATA_DIR = mkdtempSync(join(tmpdir(), "pit-warm-"));

const { db, q } = await import("./db.js");
const {
  warmYouTubeCache,
  COST_FIRST_TRACK,
  COST_CACHED_ARTIST,
  resetWarmProgress,
  isCacheWarmSchedulerEnabled,
  isYouTubePlaybackWarmEnabled,
  runCacheWarmJobSafely,
} = await import("./cacheWarmer.js");
const {
  bandsintownRows,
  collectTourProviderResults,
  DEFAULT_TICKETMASTER_COUNTRIES,
  hasSuccessfulTourProviderWork,
  isTourDateSchedulerEnabled,
  reconcileStaleProviderTourDates,
  runTourDateJobSafely,
  shouldRefreshTourDates,
  ticketmasterArtistPageSize,
  ticketmasterCountryBatchSize,
  ticketmasterCountryCodes,
  ticketmasterCountryRotation,
  ticketmasterEventSearchUrl,
  ticketmasterArtistIdentity,
  ticketmasterFutureBoundary,
  ticketmasterRequestDelayMs,
  ticketmasterRows,
  upsertProviderTourDateRows,
} = await import("./tourdates.js");
const { visibleTourDateRowsFrom } = await import("./tourDateVisibility.js");
const { youtubeCacheKey } = await import("./musicProviders.js");

// Seed a few artists with top tracks, most-popular first, and clear the resume
// cursor between tests so each starts fresh.
function seed(artists) {
  db.prepare("DELETE FROM tour_dates").run();
  db.prepare("DELETE FROM artists").run();
  db.prepare("DELETE FROM app_meta WHERE key LIKE 'warm:%'").run();
  db.prepare("DELETE FROM yt_cache").run();
  const ins = db.prepare("INSERT INTO artists (norm,name,popularity,rank_score,data,source,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)");
  for (const a of artists) {
    ins.run(a.name.toLowerCase(), a.name, a.popularity, a.popularity,
      JSON.stringify({ topTracks: a.tracks.map((t) => ({ title: t, duration: 200 })) }), "test", 1, 1);
  }
}

// A resolver that records what it was asked and always "finds" a video, unless
// told to fail a specific title.
function fakeResolver({ fail = new Set() } = {}) {
  const calls = [];
  const options = [];
  const resolve = async (title, artist, resolverOptions = {}) => {
    calls.push(`${artist}|${title}`);
    options.push(resolverOptions);
    return fail.has(title) ? { videoId: null, status: "not_found" } : { videoId: "vid_" + calls.length };
  };
  return { resolve, calls, options };
}

const noSleep = { sleepMs: 0 };
const noCircuit = () => ({ dataCircuitOpen: false });

test("background schedulers stay local-default-on but require hosted opt-in", () => {
  assert.equal(isCacheWarmSchedulerEnabled({}), true);
  assert.equal(isTourDateSchedulerEnabled({}), true);
  assert.equal(isCacheWarmSchedulerEnabled({ RENDER: "true" }), false);
  assert.equal(isTourDateSchedulerEnabled({ RENDER: "true" }), false);

  for (const value of ["1", "true", "TRUE", "yes", "on", "enabled"]) {
    assert.equal(isCacheWarmSchedulerEnabled({ RENDER: "true", CACHE_WARM_ENABLED: value }), true, `cache switch accepts ${value}`);
    assert.equal(isTourDateSchedulerEnabled({ RENDER: "true", TOURDATE_REFRESH_ENABLED: value }), true, `tour switch accepts ${value}`);
  }

  for (const value of ["0", "false", "FALSE", "no", "off", "disabled"]) {
    assert.equal(isCacheWarmSchedulerEnabled({ CACHE_WARM_ENABLED: value }), false, `cache switch accepts ${value}`);
    assert.equal(isTourDateSchedulerEnabled({ TOURDATE_REFRESH_ENABLED: value }), false, `tour switch accepts ${value}`);
  }

  for (const typo of ["flase", "tru", "2", "maybe"]) {
    assert.equal(isCacheWarmSchedulerEnabled({ CACHE_WARM_ENABLED: typo }), false, `cache switch fails closed for ${typo}`);
    assert.equal(isTourDateSchedulerEnabled({ TOURDATE_REFRESH_ENABLED: typo }), false, `tour switch fails closed for ${typo}`);
  }
});

test("scheduled-job boundaries contain synchronous throws and async rejections", async () => {
  for (const runSafely of [runCacheWarmJobSafely, runTourDateJobSafely]) {
    const reported = [];
    assert.equal(await runSafely(() => { throw new Error("sync"); }, (error) => reported.push(error.message)), false);
    assert.equal(await runSafely(async () => { throw new Error("async"); }, (error) => reported.push(error.message)), false);
    assert.deepEqual(reported, ["sync", "async"]);
    assert.equal(await runSafely(async () => {}, () => { throw new Error("reporter must not matter"); }), true);
    assert.equal(await runSafely(async () => { throw new Error("job"); }, () => { throw new Error("reporter"); }), false);
  }
});

test("tour-date restarts skip provider fan-out while the persisted refresh is fresh", () => {
  const now = Date.UTC(2026, 6, 29, 12);
  assert.equal(shouldRefreshTourDates(0, now, 12), true);
  assert.equal(shouldRefreshTourDates(now - 60 * 60 * 1000, now, 12), false);
  assert.equal(shouldRefreshTourDates(now - 13 * 60 * 60 * 1000, now, 12), true);
});

test("the paused product keeps catalogue enrichment available without YouTube playback warming", () => {
  assert.equal(isCacheWarmSchedulerEnabled({}), true, "keyless catalogue enrichment remains available locally");
  assert.equal(isYouTubePlaybackWarmEnabled({ YOUTUBE_API_KEY: "configured" }), false);
  assert.equal(isYouTubePlaybackWarmEnabled({}), false);
});

test("Ticketmaster searches request all locales and keep artist pages bounded", () => {
  const url = new URL(ticketmasterEventSearchUrl({
    apiKey: "test-key",
    keyword: "Björk & Friends",
    size: ticketmasterArtistPageSize(500),
    startDateTime: ticketmasterFutureBoundary(Date.UTC(2026, 7, 24, 12, 34, 56)),
  }));
  assert.equal(url.origin, "https://app.ticketmaster.com");
  assert.equal(url.pathname, "/discovery/v2/events.json");
  assert.equal(url.searchParams.get("keyword"), "Björk & Friends");
  assert.equal(url.searchParams.get("classificationName"), "music");
  assert.equal(url.searchParams.get("locale"), "*");
  assert.equal(url.searchParams.get("includeTBA"), "no");
  assert.equal(url.searchParams.get("includeTBD"), "no");
  assert.equal(url.searchParams.get("startDateTime"), "2026-08-24T12:34:56Z");
  assert.equal(url.searchParams.get("size"), "200");
  assert.equal(url.searchParams.get("sort"), "date,asc");
  assert.equal(url.searchParams.get("apikey"), "test-key");
  assert.equal(ticketmasterArtistPageSize(undefined), 50);
  assert.equal(ticketmasterArtistPageSize(1), 8);
  assert.equal(ticketmasterArtistPageSize("not-a-number"), 50);
  assert.equal(ticketmasterArtistIdentity("Beyoncé"), "beyonce");
  assert.equal(ticketmasterArtistIdentity("P!nk"), "p nk");
  assert.equal(ticketmasterArtistIdentity("Simon & Garfunkel"), "simon and garfunkel");
});

test("Ticketmaster global countries rotate deterministically within a bounded batch", () => {
  assert.deepEqual(ticketmasterCountryCodes(" gb,JP,gb,invalid,de, br "), ["GB", "JP", "DE", "BR"]);
  assert.ok(DEFAULT_TICKETMASTER_COUNTRIES.includes("GB"));
  assert.ok(DEFAULT_TICKETMASTER_COUNTRIES.includes("JP"));
  assert.ok(DEFAULT_TICKETMASTER_COUNTRIES.includes("AU"));
  assert.ok(DEFAULT_TICKETMASTER_COUNTRIES.includes("BR"));
  assert.ok(DEFAULT_TICKETMASTER_COUNTRIES.includes("ZA"));

  const first = ticketmasterCountryRotation(["GB", "JP", "AU", "BR"], 3, 3);
  assert.deepEqual(first, { countries: ["BR", "GB", "JP"], nextCursor: 2 });
  const next = ticketmasterCountryRotation(["GB", "JP", "AU", "BR"], first.nextCursor, 3);
  assert.deepEqual(next, { countries: ["AU", "BR", "GB"], nextCursor: 1 });
  assert.deepEqual(ticketmasterCountryRotation(["GB", "JP"], -1, 1), { countries: ["JP"], nextCursor: 0 });
  assert.deepEqual(ticketmasterCountryRotation([], 10, 10), { countries: [], nextCursor: 0 });
  assert.equal(ticketmasterCountryBatchSize(undefined), 10);
  assert.equal(ticketmasterCountryBatchSize(999), 25);
  assert.equal(ticketmasterCountryBatchSize(-1), 0);
});

test("Ticketmaster request pacing stays below the conservative published limit", () => {
  assert.equal(ticketmasterRequestDelayMs(undefined), 550);
  assert.equal(ticketmasterRequestDelayMs(1), 500);
  assert.equal(ticketmasterRequestDelayMs(200), 500);
  assert.equal(ticketmasterRequestDelayMs(750), 750);
  assert.equal(ticketmasterRequestDelayMs(99999), 5000);

  const countryUrl = new URL(ticketmasterEventSearchUrl({ apiKey: "test-key", countryCode: "jp", size: 999 }));
  assert.equal(countryUrl.searchParams.get("countryCode"), "JP");
  assert.equal(countryUrl.searchParams.get("locale"), "*");
  assert.equal(countryUrl.searchParams.get("size"), "200");
});

test("tour refresh can distinguish an empty success from total provider failure", async () => {
  const partial = await collectTourProviderResults([
    async () => [],
    async () => { throw new Error("provider down"); },
  ]);
  assert.deepEqual(partial, { rows: [], successes: 1, failures: 1 });

  const failed = await collectTourProviderResults([
    async () => { throw new Error("first down"); },
    async () => { throw new Error("second down"); },
  ]);
  assert.deepEqual(failed, { rows: [], successes: 0, failures: 2 });
});

test("partial tour-provider success advances freshness without weakening total-outage failure", () => {
  assert.equal(hasSuccessfulTourProviderWork(1), true);
  assert.equal(hasSuccessfulTourProviderWork(200), true);
  assert.equal(hasSuccessfulTourProviderWork(0), false);
  assert.equal(hasSuccessfulTourProviderWork(-1), false);
  assert.equal(hasSuccessfulTourProviderWork("not-a-number"), false);
});

test("provider projections retain stable event, clock, status, and venue identity", () => {
  const [ticketmaster] = ticketmasterRows({
    _embedded: {
      events: [{
        id: "tm-provider-42",
        name: "Foundation World Tour",
        url: "https://www.ticketmaster.com/event/42",
        dates: {
          start: {
            localDate: "2032-05-10",
            localTime: "19:30:00",
            dateTime: "2032-05-10T23:30:00Z",
          },
          status: { code: "offsale" },
        },
        _embedded: {
          attractions: [{ name: "Foundation Artist" }],
          venues: [{
            id: "tm-venue-7",
            name: "Foundation Hall",
            timezone: "America/Toronto",
            address: { line1: "1 Music Way", line2: "Suite 2" },
            city: { name: "Toronto" },
            state: { name: "Ontario", stateCode: "ON" },
            postalCode: "M5V 1A1",
            country: { name: "Canada", countryCode: "CA" },
            location: { latitude: "43.64", longitude: "-79.39" },
          }],
        },
      }],
    },
  }, { requestedArtist: "Foundation Artist" });

  assert.equal(ticketmaster.provider_event_id, "tm-provider-42");
  assert.equal(ticketmaster.event_name, "Foundation World Tour");
  assert.equal(ticketmaster.start_date_time, "2032-05-10T23:30:00.000Z");
  assert.equal(ticketmaster.start_local_time, "2032-05-10T19:30:00");
  assert.equal(ticketmaster.event_timezone, "America/Toronto");
  assert.equal(ticketmaster.event_status, "offsale");
  assert.equal(ticketmaster.sold_out, 0, "offsale is not evidence that an event sold out");
  assert.equal(ticketmaster.venue_provider_id, "tm-venue-7");
  assert.equal(ticketmaster.venue_address_line1, "1 Music Way");
  assert.equal(ticketmaster.venue_address_line2, "Suite 2");
  assert.equal(ticketmaster.venue_city, "Toronto");
  assert.equal(ticketmaster.venue_region, "ON");
  assert.equal(ticketmaster.venue_postal_code, "M5V 1A1");
  assert.equal(ticketmaster.venue_country_code, "CA");
  assert.equal(ticketmaster.venue_country, "Canada");

  const [bandsintown, localOnly] = bandsintownRows([{
    id: 84,
    title: "Foundation Artist Live",
    datetime: "2032-06-01T20:00:00-04:00",
    status: "rescheduled",
    url: "https://www.bandsintown.com/e/84",
    venue: {
      id: 9,
      name: "Second Hall",
      timezone: "America/Toronto",
      street_address: "2 Music Way",
      street_address_2: "Floor 3",
      city: "Toronto",
      region: "ON",
      postal_code: "M5V 2B2",
      country_code: "ca",
      country: "Canada",
    },
  }, {
    id: 85,
    datetime: "2032-06-02T20:00:00",
    venue: { name: "Local Clock Hall", city: "Paris", country: "France" },
  }], { requestedArtist: "Foundation Artist" });

  assert.equal(bandsintown.provider_event_id, "84");
  assert.equal(bandsintown.start_date_time, "2032-06-02T00:00:00.000Z");
  assert.equal(bandsintown.start_local_time, "2032-06-01T20:00:00-04:00");
  assert.equal(bandsintown.event_status, "rescheduled");
  assert.equal(bandsintown.venue_provider_id, "9");
  assert.equal(bandsintown.venue_country_code, "CA");
  assert.equal(localOnly.start_date_time, null,
    "a provider-local wall clock without an offset must not be mislabeled as UTC");
});

test("tour reconciliation is isolated by provider and preserves rows as inactive", () => {
  const ownerId = "u_tour_reconcile_owner";
  if (!q.userById.get(ownerId)) {
    q.insertUser.run(ownerId, "tour-reconcile@example.com", "Tour Owner", "tourreconcile", "hash",
      "artist", null, null, null, "TR", "#111111", Date.now());
  }
  const insert = db.prepare(`INSERT OR REPLACE INTO tour_dates
    (id,artist,source,updated_at,last_seen_at,provider_active,owner_id) VALUES (?,?,?,?,?,?,?)`);
  insert.run("tour_reconcile_tm_stale", "A", "ticketmaster", 1000, null, 1, null);
  insert.run("tour_reconcile_bit_stale", "B", "bandsintown", 1000, 1000, 1, null);
  insert.run("tour_reconcile_owner_stale", "C", "ticketmaster", 1000, 1000, 1, ownerId);
  insert.run("tour_reconcile_tm_fresh", "D", "ticketmaster", 1000, 3000, 1, null);
  insert.run("tour_reconcile_unknown", "E", "legacy-import", 1000, 1000, 1, null);

  assert.equal(reconcileStaleProviderTourDates(db, {
    successfulSources: ["ticketmaster"], staleBefore: 2000,
  }), 1);
  assert.equal(db.prepare("SELECT provider_active FROM tour_dates WHERE id='tour_reconcile_tm_stale'").get().provider_active, 0);
  assert.equal(db.prepare("SELECT provider_active FROM tour_dates WHERE id='tour_reconcile_bit_stale'").get().provider_active, 1,
    "one provider's success cannot deactivate another provider's cache");
  assert.equal(db.prepare("SELECT provider_active FROM tour_dates WHERE id='tour_reconcile_owner_stale'").get().provider_active, 1,
    "provider reconciliation cannot deactivate member-authored dates");
  assert.equal(db.prepare("SELECT provider_active FROM tour_dates WHERE id='tour_reconcile_tm_fresh'").get().provider_active, 1,
    "last_seen_at is the authoritative provider freshness clock");
  assert.equal(db.prepare("SELECT provider_active FROM tour_dates WHERE id='tour_reconcile_unknown'").get().provider_active, 1);
  assert.equal(reconcileStaleProviderTourDates(db, {
    successfulSources: ["ticketmaster"], staleBefore: 2000,
  }), 0, "deactivation is idempotent");

  assert.equal(reconcileStaleProviderTourDates(db, {
    successfulSources: ["bandsintown"], staleBefore: 2000,
  }), 1);
  assert.equal(db.prepare("SELECT provider_active FROM tour_dates WHERE id='tour_reconcile_bit_stale'").get().provider_active, 0);
});

test("provider upserts persist the durable fields and reactivate a returned event", () => {
  const row = {
    id: "tm_foundation_upsert",
    artist: "Radiohead",
    venue: "Upsert Hall",
    place: "Toronto, Ontario, Canada",
    lat: 43.64,
    lng: -79.39,
    date: "2033-01-02",
    ticket_url: "https://www.ticketmaster.com/event/foundation",
    sold_out: 0,
    source: "ticketmaster",
    provider_event_id: "foundation-upstream-id",
    event_name: "Upsert Artist Live",
    start_date_time: "2033-01-03T00:00:00.000Z",
    start_local_time: "2033-01-02T19:00:00",
    event_timezone: "America/Toronto",
    event_status: "onsale",
    venue_provider_id: "upstream-venue-id",
    venue_address_line1: "3 Music Way",
    venue_address_line2: "Unit 4",
    venue_city: "Toronto",
    venue_region: "ON",
    venue_postal_code: "M5V 3C3",
    venue_country_code: "CA",
    venue_country: "Canada",
  };

  assert.equal(upsertProviderTourDateRows(db, [row], { seenAt: 5000 }), 1);
  db.prepare("INSERT OR IGNORE INTO artists (norm,name,data,rank_score,source,updated_at) VALUES (?,?,?,?,?,?)").run("radiohead", row.artist, "{}", 0, "test", 1);
  assert.equal(upsertProviderTourDateRows(db, [row], { seenAt: 5000 }), 1);
  const inserted = db.prepare("SELECT * FROM tour_dates WHERE id=?").get(row.id);
  for (const field of [
    "provider_event_id", "event_name", "start_date_time", "start_local_time", "event_timezone",
    "event_status", "venue_provider_id", "venue_address_line1", "venue_address_line2", "venue_city",
    "venue_region", "venue_postal_code", "venue_country_code", "venue_country",
  ]) assert.equal(inserted[field], row[field], `${field} should survive the provider upsert`);
  assert.equal(inserted.provider_active, 1);
  assert.equal(inserted.last_seen_at, 5000);
  assert.equal(inserted.updated_at, 5000);

  db.prepare("UPDATE tour_dates SET provider_active=0 WHERE id=?").run(row.id);
  assert.equal(upsertProviderTourDateRows(db, [{ ...row, event_status: "offsale" }], { seenAt: 6000 }), 1);
  assert.equal(db.prepare("SELECT artist_key FROM tour_dates WHERE id=?").get(row.id).artist_key, "radiohead");
  const returned = db.prepare("SELECT provider_active,last_seen_at,updated_at,event_status,sold_out FROM tour_dates WHERE id=?").get(row.id);
  assert.deepEqual({ ...returned }, { provider_active: 1, last_seen_at: 6000, updated_at: 6000, event_status: "offsale", sold_out: 0 });
  upsertProviderTourDateRows(db, [{ ...row, event_name: null, event_status: null, venue_address_line2: null }], { seenAt: 7000 });
  const partial = db.prepare("SELECT event_name,event_status,venue_address_line2,last_seen_at,updated_at FROM tour_dates WHERE id=?").get(row.id);
  assert.deepEqual({ ...partial }, {
    event_name: row.event_name,
    event_status: "offsale",
    venue_address_line2: row.venue_address_line2,
    last_seen_at: 7000,
    updated_at: 6000,
  }, "a thinner provider response refreshes liveness without erasing richer known metadata");
  upsertProviderTourDateRows(db, [{ ...row, event_status: "offsale" }], { seenAt: 8000 });
  assert.deepEqual(
    { ...db.prepare("SELECT last_seen_at,updated_at FROM tour_dates WHERE id=?").get(row.id) },
    { last_seen_at: 8000, updated_at: 6000 },
    "an identical refresh advances liveness without manufacturing a public content change",
  );
  upsertProviderTourDateRows(db, [{ ...row, event_status: "offsale", venue: "Upsert Hall Annex" }], { seenAt: 9000 });
  assert.deepEqual(
    { ...db.prepare("SELECT venue,last_seen_at,updated_at FROM tour_dates WHERE id=?").get(row.id) },
    { venue: "Upsert Hall Annex", last_seen_at: 9000, updated_at: 9000 },
    "a material provider correction advances both the liveness and public revision clocks",
  );
});

test("public tour visibility hides inactive upcoming providers without hiding authored dates or history", () => {
  const ownerId = "u_tour_visibility_owner";
  if (!q.userById.get(ownerId)) {
    q.insertUser.run(ownerId, "tour-visibility@example.com", "Tour Visibility", "tourvisibility", "hash",
      "artist", null, null, null, "TV", "#222222", Date.now());
  }
  const artist = "Provider Visibility Foundation";
  const at = Date.parse("2035-01-01T12:00:00.000Z");
  const insert = db.prepare(`INSERT OR REPLACE INTO tour_dates
    (id,artist,venue,date,source,updated_at,owner_id,release_at,provider_active,last_seen_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`);
  insert.run("tour_visibility_history", artist, "History Hall", "2034-06-01", "ticketmaster", 1, null, 0, 0, 1);
  insert.run("tour_visibility_active", artist, "Active Hall", "2035-06-01", "ticketmaster", 1, null, 0, 1, 1);
  insert.run("tour_visibility_inactive", artist, "Inactive Hall", "2035-07-01", "ticketmaster", 1, null, 0, 0, 1);
  insert.run("tour_visibility_authored", artist, "Authored Hall", "2035-08-01", "artist-submitted", 1, ownerId, 0, 0, null);
  insert.run("tour_visibility_unreleased", artist, "Private Hall", "2035-09-01", "artist-submitted", 1, ownerId, at + 1000, 0, null);

  const ids = (viewer) => visibleTourDateRowsFrom(db, viewer, { artist, at }).map((row) => row.id);
  assert.deepEqual(ids(null), [
    "tour_visibility_history",
    "tour_visibility_active",
    "tour_visibility_authored",
  ]);
  assert.deepEqual(visibleTourDateRowsFrom(db, null, {
    artist,
    today: "2035-01-01",
    at,
  }).map((row) => row.id), [
    "tour_visibility_active",
    "tour_visibility_authored",
  ], "upcoming reads exclude both history and an inactive provider event");
  assert.deepEqual(ids({ id: ownerId, role: "artist" }), [
    "tour_visibility_history",
    "tour_visibility_active",
    "tour_visibility_authored",
    "tour_visibility_unreleased",
  ]);
  assert.deepEqual(ids({ id: "admin", role: "admin", is_banned: 0, suspended_until: 0 }), [
    "tour_visibility_history",
    "tour_visibility_active",
    "tour_visibility_inactive",
    "tour_visibility_authored",
    "tour_visibility_unreleased",
  ]);
});

test("a dry run estimates cost and coverage without resolving or recording anything", async () => {
  seed([{ name: "A", popularity: 90, tracks: ["a1", "a2"] }, { name: "B", popularity: 80, tracks: ["b1"] }]);
  const { resolve, calls } = fakeResolver();
  const stats = await warmYouTubeCache({ dryRun: true, resolve, providerStatus: noCircuit, ...noSleep });
  assert.equal(calls.length, 0, "dry run must not call the resolver");
  assert.equal(stats.resolved, 3, "3 tracks would be resolved");
  // A(first 13 + second 2) + B(first 13) = 28
  assert.equal(stats.spent, COST_FIRST_TRACK * 2 + COST_CACHED_ARTIST);
  // Nothing recorded, so a real run afterwards still has work to do.
  const marker = db.prepare("SELECT value FROM app_meta WHERE key='warm:youtube:v1'").get();
  assert.equal(marker, undefined);
});

test("popular artists are warmed first, and the first track costs more than the rest", async () => {
  seed([{ name: "Popular", popularity: 99, tracks: ["p1", "p2", "p3"] }, { name: "Niche", popularity: 10, tracks: ["n1"] }]);
  const { resolve, calls } = fakeResolver();
  const stats = await warmYouTubeCache({ resolve, providerStatus: noCircuit, ...noSleep });
  assert.equal(calls[0], "Popular|p1", "the most popular artist is resolved first");
  assert.equal(stats.resolved, 4);
  // Popular(13 + 2 + 2) + Niche(13) = 30
  assert.equal(stats.spent, COST_FIRST_TRACK * 2 + COST_CACHED_ARTIST * 2);
});

test("a budget stops the run early and marks it, leaving the rest for next time", async () => {
  seed([{ name: "A", popularity: 90, tracks: ["a1", "a2", "a3"] }, { name: "B", popularity: 80, tracks: ["b1"] }]);
  const { resolve, calls } = fakeResolver();
  // Budget only covers A's first track (13); the next would push past it.
  const stats = await warmYouTubeCache({ budget: 13, resolve, providerStatus: noCircuit, ...noSleep });
  assert.equal(stats.stoppedEarly, true);
  assert.ok(calls.length >= 1 && calls.length <= 2, "stops within a track of the budget");

  const resumed = fakeResolver();
  await warmYouTubeCache({ budget: 13, resolve: resumed.resolve, providerStatus: noCircuit, ...noSleep });
  assert.equal(resumed.calls[0], "A|a1", "a partially visited artist is not permanently marked complete");
});

test("already-cached songs are skipped, not re-resolved", async () => {
  seed([{ name: "A", popularity: 90, tracks: ["a1", "a2"] }]);
  // Pretend a1 is already cached and fresh.
  db.prepare("INSERT INTO yt_cache (key,video_id,updated_at,expires_at,rejected_ids) VALUES (?,?,?,?,?)")
    .run(youtubeCacheKey("a1", "A"), "already", Date.now(), Date.now() + 60_000, "[]");
  const { resolve, calls } = fakeResolver();
  const stats = await warmYouTubeCache({ resolve, providerStatus: noCircuit, ...noSleep });
  assert.equal(calls.includes("A|a1"), false, "the cached song is not resolved again");
  assert.equal(stats.skipped, 1);
  assert.equal(stats.resolved, 1);
});

test("background warming always disables search for every resolver call", async () => {
  seed([{ name: "Catalogue Only", popularity: 90, tracks: ["first", "second"] }]);
  const { resolve, options } = fakeResolver();
  await warmYouTubeCache({ resolve, providerStatus: noCircuit, ...noSleep });
  assert.equal(options.length, 2);
  assert.ok(options.every((entry) => entry.allowSearch === false), "the warmer must preserve interactive search capacity");
});

test("a resume run skips artists already done in a previous pass", async () => {
  seed([{ name: "A", popularity: 90, tracks: ["a1"] }, { name: "B", popularity: 80, tracks: ["b1"] }]);
  const first = fakeResolver();
  await warmYouTubeCache({ resolve: first.resolve, providerStatus: noCircuit, ...noSleep });
  assert.equal(first.calls.length, 2, "first pass resolves both");
  // Second pass with a fresh resolver: both artists are marked done, so nothing
  // is re-resolved. (yt_cache is not populated by the fake, so only the resume
  // cursor prevents rework here.)
  const second = fakeResolver();
  const stats = await warmYouTubeCache({ resolve: second.resolve, providerStatus: noCircuit, ...noSleep });
  assert.equal(second.calls.length, 0, "already-done artists are skipped on resume");
  assert.equal(stats.artistsTouched, 0);
});

test("resetting progress makes the next run re-walk the catalogue", async () => {
  seed([{ name: "A", popularity: 90, tracks: ["a1"] }]);
  await warmYouTubeCache({ resolve: fakeResolver().resolve, providerStatus: noCircuit, ...noSleep });
  resetWarmProgress();
  const again = fakeResolver();
  await warmYouTubeCache({ resolve: again.resolve, providerStatus: noCircuit, ...noSleep });
  assert.equal(again.calls.length, 1, "after a reset the artist is warmed again");
});

test("a tripped circuit breaker stops the run instead of hammering the provider", async () => {
  seed([{ name: "A", popularity: 90, tracks: ["a1", "a2", "a3"] }, { name: "B", popularity: 80, tracks: ["b1"] }]);
  const { resolve, calls } = fakeResolver();
  let open = false;
  const providerStatus = () => ({ dataCircuitOpen: open });
  // Trip the breaker after the first resolve.
  const trippingResolve = async (t, a, o) => { const r = await resolve(t, a, o); open = true; return r; };
  const stats = await warmYouTubeCache({ resolve: trippingResolve, providerStatus, ...noSleep });
  assert.equal(calls.length, 1, "stops after the breaker opens");
  assert.equal(stats.stoppedEarly, true);
});

test("artists people actually play are warmed before more-popular ones nobody played", async () => {
  // The deadlock the owner hit: the warmer walked popularity-first and never
  // reached the older tracks a listener was actually queuing, so those previewed
  // forever. A niche artist with real plays must now jump the queue.
  seed([
    { name: "FamousUnplayed", popularity: 99, tracks: ["f1"] },
    { name: "NichePlayed", popularity: 5, tracks: ["n1"] },
  ]);
  db.prepare("DELETE FROM plays").run();
  db.prepare("INSERT INTO users (id,email,name,handle,pass_hash,created_at) VALUES (?,?,?,?,?,?)")
    .run("u_warm", "warm@example.com", "Warm", "warm", "x", 1);
  for (let i = 0; i < 3; i++) {
    db.prepare("INSERT INTO plays (id,user_id,title,artist,created_at) VALUES (?,?,?,?,?)")
      .run("pl_" + i, "u_warm", "n1", "NichePlayed", 100 + i);
  }
  const { resolve, calls } = fakeResolver();
  await warmYouTubeCache({ resolve, providerStatus: noCircuit, ...noSleep });
  assert.equal(calls[0], "NichePlayed|n1", "the played niche artist is discovered before the unplayed famous one");
  // The famous one still gets warmed after, just not first.
  assert.ok(calls.includes("FamousUnplayed|f1"));
});
