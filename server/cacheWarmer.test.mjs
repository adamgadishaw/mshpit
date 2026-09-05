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
  startCacheWarmScheduler,
} = await import("./cacheWarmer.js");
const {
  bandsintownRows,
  collectNamedTourProviderResults,
  collectTicketmasterCityPages,
  collectTicketmasterCountryPages,
  collectTicketmasterMarketPartitions,
  collectTourProviderResults,
  dedupeTourProviderRows,
  DEFAULT_TICKETMASTER_COUNTRIES,
  hasSuccessfulTourProviderWork,
  isTourDateSchedulerEnabled,
  reconcileStaleProviderTourDates,
  reconcileStaleProviderTourDatesForArtists,
  readTicketmasterMarketCoverageState,
  runTourDateJobSafely,
  selectTourDateRefreshArtists,
  shouldRefreshTourDateIngestion,
  shouldRefreshTourDates,
  sourcesEligibleForStaleReconciliation,
  TOURDATE_INGESTION_REVISION,
  tourDateArtistRotationSize,
  ticketmasterArtistPageSize,
  ticketmasterActiveAndFutureRange,
  ticketmasterCountryBatchSize,
  ticketmasterCountryCodes,
  ticketmasterCountryRotation,
  ticketmasterEventSearchUrl,
  ticketmasterArtistIdentity,
  ticketmasterFutureBoundary,
  ticketmasterRequestDelayMs,
  ticketmasterRows,
  persistTicketmasterMarketResult,
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

function ticketmasterPageEvent(id, date) {
  return {
    id,
    name: `Artist ${id} Live`,
    classifications: [{ segment: { name: "Music" } }],
    dates: { start: { localDate: date, localTime: "20:00:00" } },
    _embedded: {
      attractions: [{ name: `Artist ${id}` }],
      venues: [{
        id: `venue-${id}`,
        name: "Pagination Hall",
        city: { name: "Toronto" },
        state: { name: "Ontario", stateCode: "ON" },
        country: { name: "Canada", countryCode: "CA" },
      }],
    },
  };
}

function ticketmasterPage(number, totalPages, events) {
  return {
    _embedded: { events },
    page: {
      number,
      size: 200,
      totalPages,
      totalElements: totalPages * 200,
    },
  };
}

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

test("catalogue warming exposes an owned scheduler with a same-day recovery retry", async () => {
  let configuration = null;
  const handle = { trigger() {}, stop() { return Promise.resolve(); } };
  const scheduler = startCacheWarmScheduler({
    logger: { log() {}, warn() {}, error() {} },
    schedule: (options) => { configuration = options; return handle; },
  });

  assert.equal(scheduler, handle);
  assert.equal(configuration.initialDelayMs, 60_000);
  assert.equal(configuration.intervalMs, 24 * 60 * 60_000);
  assert.equal(configuration.retryDelayMs, 30 * 60_000);
  assert.equal(typeof configuration.run, "function");
  await scheduler.stop();
});

test("a material collector revision forces one safe refresh despite a fresh clock", () => {
  const now = Date.UTC(2026, 7, 28, 12);
  const fresh = now - 60 * 60 * 1000;
  assert.equal(shouldRefreshTourDateIngestion({
    lastRefreshAt: fresh,
    storedRevision: "previous-collector",
    now,
    refreshHours: 12,
  }), true, "a materially newer deployed collector must not wait for stale cache age");
  assert.equal(shouldRefreshTourDateIngestion({
    lastRefreshAt: fresh,
    storedRevision: TOURDATE_INGESTION_REVISION,
    now,
    refreshHours: 12,
  }), false, "recording the current revision prevents a replay on the next restart");
  assert.equal(shouldRefreshTourDateIngestion({
    lastRefreshAt: now - 13 * 60 * 60 * 1000,
    storedRevision: TOURDATE_INGESTION_REVISION,
    now,
    refreshHours: 12,
  }), true, "the ordinary refresh interval still applies after the forced run");
});

test("tour-date artist lane uses live non-private demand and never private attendance", () => {
  seed([
    { name: "Famous Artist", popularity: 99, tracks: [] },
    { name: "Other Artist", popularity: 80, tracks: [] },
    { name: "Demanded Artist", popularity: 1, tracks: [] },
    { name: "Private Artist", popularity: 0, tracks: [] },
  ]);
  db.prepare("DELETE FROM show_attendance").run();
  db.prepare("DELETE FROM shows").run();
  db.prepare("DELETE FROM posts").run();
  db.prepare("DELETE FROM fan_club_members").run();
  db.prepare("DELETE FROM artist_profiles").run();
  db.prepare("DELETE FROM missing_artists").run();
  db.prepare("INSERT OR IGNORE INTO users (id,email,name,handle,pass_hash,created_at) VALUES (?,?,?,?,?,?)")
    .run("u_tour_public", "tour-public@example.com", "Public", "tourpublic", "x", 1);
  db.prepare("INSERT OR IGNORE INTO users (id,email,name,handle,pass_hash,created_at) VALUES (?,?,?,?,?,?)")
    .run("u_tour_private", "tour-private@example.com", "Private", "tourprivate", "x", 1);
  db.prepare(`INSERT INTO shows
    (id,canonical_key,artist,artist_key,venue,date,lifecycle,public_eligible,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run("show_tour_public", "tour-public", "Demanded Artist", "demanded artist", "Hall", "2099-01-01", "upcoming", 1, 1, 1);
  db.prepare(`INSERT INTO shows
    (id,canonical_key,artist,artist_key,venue,date,lifecycle,public_eligible,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run("show_tour_private", "tour-private", "Private Artist", "private artist", "Hall", "2099-01-02", "upcoming", 1, 1, 1);
  db.prepare(`INSERT INTO show_attendance
    (show_id,user_id,state,visibility,created_at,updated_at) VALUES (?,?,?,?,?,?)`)
    .run("show_tour_public", "u_tour_public", "going", "members", 1, 1);
  db.prepare(`INSERT INTO show_attendance
    (show_id,user_id,state,visibility,created_at,updated_at) VALUES (?,?,?,?,?,?)`)
    .run("show_tour_private", "u_tour_private", "going", "private", 1, 1);

  const selected = selectTourDateRefreshArtists(db, {
    limit: 3,
    rotationSize: 0,
    fallbackArtists: [{ name: "Bundled Only", popularity: 1000 }],
  }).artists.map((artist) => artist.name);
  assert.deepEqual(selected, ["Demanded Artist", "Famous Artist", "Other Artist"]);
  assert.equal(selected.includes("Private Artist"), false);
  assert.equal(selected.includes("Bundled Only"), false, "a populated live catalogue outranks the bundled safety net");
});

test("restricted accounts cannot influence any user-owned tour-date demand signal", () => {
  const activeAt = Date.UTC(2026, 7, 28, 12);
  const allowed = [
    { name: "Allowed One", popularity: 100, tracks: [] },
    { name: "Allowed Two", popularity: 99, tracks: [] },
    { name: "Allowed Three", popularity: 98, tracks: [] },
    { name: "Allowed Four", popularity: 97, tracks: [] },
    { name: "Allowed Five", popularity: 96, tracks: [] },
    { name: "Allowed Six", popularity: 95, tracks: [] },
  ];
  const restricted = [
    { name: "Banned Post Artist", popularity: 0, tracks: [] },
    { name: "Suspended Fan Artist", popularity: 0, tracks: [] },
    { name: "Banned Attendance Artist", popularity: 0, tracks: [] },
    { name: "Suspended Profile Artist", popularity: 0, tracks: [] },
  ];
  seed([...allowed, ...restricted]);
  db.prepare("DELETE FROM show_attendance").run();
  db.prepare("DELETE FROM shows").run();
  db.prepare("DELETE FROM posts").run();
  db.prepare("DELETE FROM fan_club_members").run();
  db.prepare("DELETE FROM artist_profiles").run();
  db.prepare("DELETE FROM missing_artists").run();

  const insertUser = db.prepare(
    "INSERT OR IGNORE INTO users (id,email,name,handle,pass_hash,created_at) VALUES (?,?,?,?,?,?)",
  );
  insertUser.run("u_tour_banned_signal", "tour-banned-signal@example.com", "Banned", "tourbannedsignal", "x", 1);
  insertUser.run("u_tour_suspended_signal", "tour-suspended-signal@example.com", "Suspended", "toursuspendedsignal", "x", 1);
  db.prepare("UPDATE users SET is_banned=1,suspended_until=0 WHERE id=?").run("u_tour_banned_signal");
  db.prepare("UPDATE users SET is_banned=0,suspended_until=? WHERE id=?")
    .run(activeAt + 60_000, "u_tour_suspended_signal");

  db.prepare(`INSERT INTO posts
    (id,user_id,artist,artist_key,venue,city,date,overall,removed,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
    "post_tour_banned_signal",
    "u_tour_banned_signal",
    "Banned Post Artist",
    "banned post artist",
    "Hall",
    "Toronto",
    "2026-09-01",
    5,
    0,
    activeAt,
  );
  db.prepare("INSERT INTO fan_club_members (artist,user_id) VALUES (?,?)")
    .run("suspended fan artist", "u_tour_suspended_signal");
  db.prepare(`INSERT INTO shows
    (id,canonical_key,artist,artist_key,venue,date,lifecycle,public_eligible,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
    "show_tour_banned_signal",
    "tour-banned-signal",
    "Banned Attendance Artist",
    "banned attendance artist",
    "Hall",
    "2026-09-02",
    "upcoming",
    1,
    activeAt,
    activeAt,
  );
  db.prepare(`INSERT INTO show_attendance
    (show_id,user_id,state,visibility,created_at,updated_at) VALUES (?,?,?,?,?,?)`)
    .run("show_tour_banned_signal", "u_tour_banned_signal", "going", "members", activeAt, activeAt);
  db.prepare(`INSERT INTO artist_profiles
    (artist_key,owner_id,removed,updated_at) VALUES (?,?,0,?)`)
    .run("suspended profile artist", "u_tour_suspended_signal", activeAt);

  const selected = selectTourDateRefreshArtists(db, {
    limit: allowed.length,
    rotationSize: 0,
    now: activeAt,
  }).artists.map((artist) => artist.name);
  assert.deepEqual(selected, allowed.map((artist) => artist.name));
  for (const artist of restricted) {
    assert.equal(selected.includes(artist.name), false, `${artist.name} must not be demand-ranked`);
  }
});

test("tour-date artist rotation is restart-stable and converges across the live catalogue", () => {
  seed([
    { name: "Alpha", popularity: 10, tracks: [] },
    { name: "Beta", popularity: 20, tracks: [] },
    { name: "Gamma", popularity: 30, tracks: [] },
    { name: "Delta", popularity: 40, tracks: [] },
    { name: "Epsilon", popularity: 90, tracks: [] },
    { name: "Zeta", popularity: 100, tracks: [] },
  ]);
  db.prepare("DELETE FROM show_attendance").run();
  db.prepare("DELETE FROM shows").run();
  db.prepare("DELETE FROM posts").run();
  db.prepare("DELETE FROM fan_club_members").run();
  db.prepare("DELETE FROM artist_profiles").run();
  db.prepare("DELETE FROM missing_artists").run();

  assert.equal(tourDateArtistRotationSize(undefined, 150), 100);
  const first = selectTourDateRefreshArtists(db, { limit: 4, rotationSize: 2, cursor: "" });
  const restarted = selectTourDateRefreshArtists(db, { limit: 4, rotationSize: 2, cursor: "" });
  assert.deepEqual(restarted, first, "an uncommitted cursor repeats the same provider slice after restart");
  assert.deepEqual(first.artists.map((artist) => artist.name), ["Zeta", "Epsilon", "Alpha", "Beta"]);
  assert.equal(first.nextCursor, "beta");

  const second = selectTourDateRefreshArtists(db, { limit: 4, rotationSize: 2, cursor: first.nextCursor });
  assert.deepEqual(second.artists.map((artist) => artist.name), ["Zeta", "Epsilon", "Delta", "Gamma"]);
  assert.equal(second.nextCursor, "gamma");
  assert.deepEqual(new Set([...first.artists, ...second.artists].map((artist) => artist.name)),
    new Set(["Alpha", "Beta", "Gamma", "Delta", "Epsilon", "Zeta"]));
});

test("tour-date artist selection tolerates optional demand tables during isolated startup", () => {
  const minimalDatabase = {
    prepare(sql) {
      if (/FROM artists\s+WHERE length\(TRIM\(name\)\)/.test(sql)) {
        return { all: () => [{ name: "Live Minimal", popularity: 2, rank_score: 3, demand_score: 0 }] };
      }
      throw new Error("no such table: optional_signal");
    },
  };
  assert.deepEqual(selectTourDateRefreshArtists(minimalDatabase, {
    limit: 2,
    rotationSize: 0,
    fallbackArtists: [{ name: "Bundled Fallback", popularity: 1 }],
  }).artists, [
    { name: "Live Minimal", popularity: 2 },
    { name: "Bundled Fallback", popularity: 1 },
  ]);
});

test("the paused product keeps catalogue enrichment available without YouTube playback warming", () => {
  assert.equal(isCacheWarmSchedulerEnabled({}), true, "keyless catalogue enrichment remains available locally");
  assert.equal(isYouTubePlaybackWarmEnabled({ YOUTUBE_API_KEY: "configured" }), false);
  assert.equal(isYouTubePlaybackWarmEnabled({}), false);
});

test("Ticketmaster searches request all locales and keep artist pages bounded", () => {
  const overlap = ticketmasterActiveAndFutureRange(Date.UTC(2026, 7, 24, 12, 34, 56), 30);
  const url = new URL(ticketmasterEventSearchUrl({
    apiKey: "test-key",
    keyword: "Björk & Friends",
    size: ticketmasterArtistPageSize(500),
    startEndDateTime: overlap,
  }));
  assert.equal(url.origin, "https://app.ticketmaster.com");
  assert.equal(url.pathname, "/discovery/v2/events.json");
  assert.equal(url.searchParams.get("keyword"), "Björk & Friends");
  assert.equal(url.searchParams.get("classificationName"), "music");
  assert.equal(url.searchParams.get("locale"), "*");
  assert.equal(url.searchParams.get("includeTBA"), "no");
  assert.equal(url.searchParams.get("includeTBD"), "no");
  assert.equal(url.searchParams.get("startDateTime"), null);
  assert.equal(url.searchParams.get("startEndDateTime"), "2026-08-24T12:34:56Z,2026-09-23T12:34:56Z");
  assert.equal(url.searchParams.get("size"), "200");
  assert.equal(url.searchParams.get("sort"), "date,asc");
  assert.equal(url.searchParams.get("apikey"), "test-key");
  assert.equal(ticketmasterArtistPageSize(undefined), 200);
  assert.equal(ticketmasterArtistPageSize(1), 8);
  assert.equal(ticketmasterArtistPageSize("not-a-number"), 200);
  assert.equal(ticketmasterArtistIdentity("Beyoncé"), "beyonce");
  assert.equal(ticketmasterArtistIdentity("P!nk"), "p nk");
  assert.equal(ticketmasterArtistIdentity("Simon & Garfunkel"), "simon and garfunkel");
});

test("Ticketmaster search URLs propagate pages without crossing the deep-page boundary", () => {
  const pageFour = new URL(ticketmasterEventSearchUrl({
    apiKey: "test-key",
    city: "Toronto",
    size: 200,
    page: 4,
  }));
  assert.equal(pageFour.searchParams.get("page"), "4");
  assert.equal(pageFour.searchParams.get("size"), "200");

  const clamped = new URL(ticketmasterEventSearchUrl({
    apiKey: "test-key",
    city: "Toronto",
    size: 200,
    page: 99,
  }));
  assert.equal(clamped.searchParams.get("page"), "4",
    "size 200 permits only zero-based pages 0 through 4");

  const legacy = new URL(ticketmasterEventSearchUrl({ apiKey: "test-key", city: "Toronto" }));
  assert.equal(legacy.searchParams.get("page"), null,
    "existing one-page callers do not gain a query parameter unless they opt in");
});

test("dense city pagination includes page-two events beyond day 90 and deduplicates overlaps", async () => {
  const requests = [];
  const waits = [];
  const pages = [
    ticketmasterPage(0, 3, [
      ticketmasterPageEvent("duplicate", "2026-08-20"),
      {
        ...ticketmasterPageEvent("filtered-late", "2026-11-10"),
        classifications: [{ segment: { name: "Sports" } }],
      },
    ]),
    ticketmasterPage(1, 3, [
      ticketmasterPageEvent("duplicate", "2026-08-20"),
      ticketmasterPageEvent("after-day-90", "2026-11-01"),
    ]),
  ];
  const result = await collectTicketmasterCityPages({
    apiKey: "test-key",
    city: "Toronto",
    startEndDateTime: ["2026-08-01T00:00:00Z", "2029-08-01T00:00:00Z"],
    fetchJson: async (value) => {
      const url = new URL(value);
      requests.push({
        page: Number(url.searchParams.get("page")),
        range: url.searchParams.get("startEndDateTime"),
      });
      return pages[Number(url.searchParams.get("page"))];
    },
    wait: async (delay) => { waits.push(delay); },
    requestDelayMs: 550,
  });

  assert.deepEqual(requests, [
    { page: 0, range: "2026-08-01T00:00:00Z,2029-08-01T00:00:00Z" },
    { page: 1, range: "2026-08-01T00:00:00Z,2029-08-01T00:00:00Z" },
  ], "pagination preserves the existing multi-year query range");
  assert.deepEqual(waits, [550], "extra pages retain provider request pacing");
  assert.equal(result.complete, true);
  assert.equal(result.coverageReached, true);
  assert.equal(result.pagesFetched, 2);
  assert.deepEqual(result.rows.map((row) => row.provider_event_id), [
    "duplicate",
    "after-day-90",
  ], "a later raw event that fails music qualification cannot end pagination early");
});

test("country ingestion pages until it proves 90-day coverage", async () => {
  const requests = [];
  const waits = [];
  const pages = [
    ticketmasterPage(0, 3, [ticketmasterPageEvent("country-near", "2026-08-20")]),
    ticketmasterPage(1, 3, [ticketmasterPageEvent("country-day-90", "2026-11-01")]),
  ];
  const result = await collectTicketmasterCountryPages({
    apiKey: "test-key",
    countryCode: "jp",
    startEndDateTime: ["2026-08-01T00:00:00Z", "2029-08-01T00:00:00Z"],
    fetchJson: async (value) => {
      const url = new URL(value);
      requests.push({
        page: Number(url.searchParams.get("page")),
        countryCode: url.searchParams.get("countryCode"),
        city: url.searchParams.get("city"),
      });
      return pages[Number(url.searchParams.get("page"))];
    },
    wait: async (delay) => { waits.push(delay); },
    requestDelayMs: 550,
  });

  assert.deepEqual(requests, [
    { page: 0, countryCode: "JP", city: null },
    { page: 1, countryCode: "JP", city: null },
  ]);
  assert.deepEqual(waits, [550]);
  assert.equal(result.complete, true);
  assert.equal(result.coverageReached, true);
  assert.equal(result.pagesFetched, 2);
  assert.deepEqual(result.rows.map((row) => row.provider_event_id), ["country-near", "country-day-90"]);
});

test("partitioned market integration issues bounded dated country queries", async () => {
  const requests = [];
  const result = await collectTicketmasterMarketPartitions({
    apiKey: "test-key",
    countryCode: "pt",
    now: Date.parse("2026-08-28T12:00:00Z"),
    horizonDays: 7,
    defaultWindowDays: 7,
    maxRequests: 1,
    fetchJson: async (value) => {
      const url = new URL(value);
      requests.push({
        countryCode: url.searchParams.get("countryCode"),
        city: url.searchParams.get("city"),
        range: url.searchParams.get("startEndDateTime"),
        page: url.searchParams.get("page"),
        size: url.searchParams.get("size"),
      });
      return ticketmasterPage(0, 1, [ticketmasterPageEvent("portugal-window", "2026-09-01")]);
    },
    wait: async () => {},
  });

  assert.deepEqual(requests, [{
    countryCode: "PT",
    city: null,
    range: "2026-08-28T00:00:00Z,2026-09-03T23:59:59Z",
    page: "0",
    size: "200",
  }]);
  assert.equal(result.requestComplete, true);
  assert.equal(result.cycleComplete, true);
  assert.equal(result.coverageComplete, true);
  assert.equal(result.complete, false,
    "one market window must remain ineligible for whole-provider stale cleanup");
  assert.deepEqual(result.rows.map((row) => row.provider_event_id), ["portugal-window"]);
});

test("market progress advances atomically after empty success and not after a partial request", () => {
  const market = { countryCode: "PT" };
  db.prepare("DELETE FROM app_meta WHERE key LIKE 'tourdates:ticketmaster-market-coverage:%'").run();
  db.prepare("DELETE FROM tour_dates WHERE id='tm_partition_partial'").run();
  const firstState = {
    version: 1,
    cursorDate: "2026-09-04",
    windowDays: 7,
    cycleStartedDate: "2026-08-28",
    lastCycleCompletedAt: null,
    lastCompleteThrough: null,
    gaps: [],
  };
  const emptySuccess = persistTicketmasterMarketResult(db, {
    market,
    result: { rows: [], requestComplete: true, nextState: firstState },
    seenAt: 1000,
  });
  assert.deepEqual(emptySuccess, { changed: 0, stateAdvanced: true });
  assert.deepEqual(readTicketmasterMarketCoverageState(db, market), firstState,
    "an empty provider window is still durable coverage progress");

  const secondState = { ...firstState, cursorDate: "2026-09-11" };
  const partial = persistTicketmasterMarketResult(db, {
    market,
    result: {
      rows: [{
        id: "tm_partition_partial",
        artist: "Partition Artist",
        venue: "Partition Hall",
        place: "Lisbon, Portugal",
        date: "2026-09-05",
        source: "ticketmaster",
        provider_event_id: "partition-partial",
        event_kind: "concert",
        music_qualified: 1,
      }],
      requestComplete: false,
      nextState: secondState,
    },
    seenAt: 2000,
  });
  assert.equal(partial.changed, 1, "verified partial rows remain useful catalogue data");
  assert.equal(partial.stateAdvanced, false);
  assert.equal(db.prepare("SELECT provider_event_id FROM tour_dates WHERE id='tm_partition_partial'").get().provider_event_id,
    "partition-partial");
  assert.deepEqual(readTicketmasterMarketCoverageState(db, market), firstState,
    "a failed page cannot skip the unproven market window");
});

test("dense city pagination stops at Ticketmaster's five-page budget", async () => {
  const requests = [];
  const result = await collectTicketmasterCityPages({
    apiKey: "test-key",
    city: "Dense City",
    startEndDateTime: ["2026-08-01T00:00:00Z", "2029-08-01T00:00:00Z"],
    fetchJson: async (value) => {
      const page = Number(new URL(value).searchParams.get("page"));
      requests.push(page);
      return ticketmasterPage(page, 99, [
        ticketmasterPageEvent("shared", "2026-08-10"),
        ticketmasterPageEvent(`page-${page}`, "2026-08-10"),
      ]);
    },
    requestDelayMs: 0,
  });

  assert.deepEqual(requests, [0, 1, 2, 3, 4]);
  assert.equal(result.complete, false,
    "hitting the request cap without 90-day coverage must not claim a complete scan");
  assert.equal(result.coverageReached, false);
  assert.equal(result.pagesFetched, 5);
  assert.equal(result.rows.filter((row) => row.provider_event_id === "shared").length, 1);
  assert.equal(result.rows.length, 6);
});

test("a later city page failure keeps verified rows but blocks Ticketmaster stale reconciliation", async () => {
  const partial = await collectTicketmasterCityPages({
    apiKey: "test-key",
    city: "Toronto",
    startEndDateTime: ["2026-08-01T00:00:00Z", "2029-08-01T00:00:00Z"],
    fetchJson: async (value) => {
      const page = Number(new URL(value).searchParams.get("page"));
      if (page === 1) throw new Error("page two failed");
      return ticketmasterPage(0, 3, [ticketmasterPageEvent("verified-page-one", "2026-08-20")]);
    },
    requestDelayMs: 0,
  });
  assert.equal(partial.complete, false);
  assert.equal(partial.pagesFetched, 1);
  assert.deepEqual(partial.rows.map((row) => row.provider_event_id), ["verified-page-one"]);

  const collected = await collectNamedTourProviderResults([
    { source: "ticketmaster", run: async () => partial },
    { source: "bandsintown", run: async () => [] },
  ]);
  assert.equal(collected.successes, 2, "partial verified rows remain useful work");
  assert.equal(collected.failures, 1, "an incomplete fulfilled scan is still a provider failure");
  assert.deepEqual(collected.outcomes, [
    { source: "ticketmaster", ok: false },
    { source: "bandsintown", ok: true },
  ]);
  const providerStats = new Map([
    ["ticketmaster", { successes: 1, failures: 1 }],
    ["bandsintown", { successes: 1, failures: 0 }],
  ]);
  assert.deepEqual(sourcesEligibleForStaleReconciliation(providerStats), ["bandsintown"],
    "a partial Ticketmaster page cannot authorize source-wide stale cleanup");
});

test("successful market slices are healthy requests but remain stale-reconciliation ineligible", async () => {
  const collected = await collectNamedTourProviderResults([{
    source: "ticketmaster",
    run: async () => ({
      rows: [],
      complete: false,
      requestComplete: true,
      coverageComplete: false,
    }),
  }]);
  assert.equal(collected.successes, 1);
  assert.equal(collected.failures, 0,
    "an intentionally bounded slice must not manufacture a provider outage");
  assert.deepEqual(collected.outcomes, [{ source: "ticketmaster", ok: false }],
    "the same slice still cannot authorize stale cleanup outside its proven scope");
});

test("an incomplete zero-row provider result cannot suppress total-outage retry", async () => {
  const collected = await collectNamedTourProviderResults([{
    source: "ticketmaster",
    run: async () => ({
      rows: [],
      complete: false,
      requestComplete: false,
    }),
  }]);
  assert.equal(collected.successes, 0);
  assert.equal(collected.failures, 1);
  assert.deepEqual(collected.outcomes, [{ source: "ticketmaster", ok: false }]);
  assert.equal(hasSuccessfulTourProviderWork(collected.successes), false,
    "a page-zero outage must leave the worldwide refresh immediately due");
});

test("provider dedupe preserves distinct same-day shows and removes only repeated stable identities", () => {
  const early = {
    id: "tm_early",
    provider_event_id: "early",
    source: "ticketmaster",
    artist: "Two Show Artist",
    venue: "Same Hall",
    date: "2026-09-16",
    start_local_time: "14:00:00",
  };
  const late = {
    id: "tm_late",
    provider_event_id: "late",
    source: "ticketmaster",
    artist: "Two Show Artist",
    venue: "Same Hall",
    date: "2026-09-16",
    start_local_time: "20:00:00",
  };
  const repeatedEarly = { ...early, ticket_url: "https://example.com/repeated-copy" };

  const deduped = dedupeTourProviderRows([early, late, repeatedEarly]);
  assert.deepEqual(deduped, [early, late],
    "provider identity, not venue plus date, distinguishes separate performances");
});

test("Ticketmaster global countries rotate deterministically within a bounded batch", () => {
  assert.deepEqual(ticketmasterCountryCodes(" gb,JP,gb,invalid,de, br "), ["GB", "JP", "DE", "BR"]);
  const supportedEuropeanCountries = [
    "AD", "AT", "AZ", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FO", "FI",
    "FR", "GE", "DE", "GI", "GB", "GR", "HU", "IS", "IE", "IL", "IT", "LV",
    "LT", "LU", "MT", "MC", "ME", "NL", "NO", "PL", "PT", "RO", "RS", "SK",
    "SI", "ES", "SE", "CH", "TR", "UA",
  ];
  for (const countryCode of supportedEuropeanCountries) {
    assert.ok(DEFAULT_TICKETMASTER_COUNTRIES.includes(countryCode),
      `default Ticketmaster sweep should include ${countryCode}`);
    const url = new URL(ticketmasterEventSearchUrl({ apiKey: "test-key", countryCode }));
    assert.equal(url.searchParams.get("countryCode"), countryCode);
    assert.equal(url.searchParams.get("locale"), "*");
  }
  assert.equal(new Set(DEFAULT_TICKETMASTER_COUNTRIES).size, DEFAULT_TICKETMASTER_COUNTRIES.length,
    "the expanded rotation should not spend quota on duplicate markets");
  assert.ok(!DEFAULT_TICKETMASTER_COUNTRIES.includes("RU"));
  for (const countryCode of ["JP", "AU", "BR", "ZA", "CA", "US"]) {
    assert.ok(DEFAULT_TICKETMASTER_COUNTRIES.includes(countryCode),
      `expanded Europe coverage should preserve global market ${countryCode}`);
  }

  const deploymentBatch = ticketmasterCountryRotation(DEFAULT_TICKETMASTER_COUNTRIES, 0, undefined);
  assert.deepEqual(deploymentBatch.countries,
    ["PT", "ES", "FR", "DE", "IT", "NL", "BE", "AT", "IE", "PL"],
    "a reset cursor should cover Portugal, Spain, and a broad EU set immediately");

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
        images: [{
          url: "https://s1.ticketm.net/dam/a/foundation-world-tour.jpg",
          ratio: "16_9",
          width: 2048,
          height: 1152,
          fallback: false,
          attribution: "Ticketmaster / Foundation Artist",
        }],
        dates: {
          start: {
            localDate: "2032-05-10",
            localTime: "19:30:00",
            dateTime: "2032-05-10T23:30:00Z",
          },
          access: {
            startDateTime: "2032-05-10T22:30:00Z",
            startApproximate: true,
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
  assert.equal(ticketmaster.tour_name, "Foundation World Tour");
  assert.equal(ticketmaster.start_date_time, "2032-05-10T23:30:00.000Z");
  assert.equal(ticketmaster.start_local_time, "2032-05-10T19:30:00");
  assert.equal(ticketmaster.access_start_date_time, "2032-05-10T22:30:00.000Z");
  assert.equal(ticketmaster.access_start_approximate, 1);
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
  assert.equal(ticketmaster.event_image_url, "https://s1.ticketm.net/dam/a/foundation-world-tour.jpg");
  assert.equal(ticketmaster.event_image_attribution, "Ticketmaster / Foundation Artist");
  assert.equal(ticketmaster.event_image_width, 2048);
  assert.equal(ticketmaster.event_image_height, 1152);

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
  assert.equal(bandsintown.tour_name, null);
  assert.equal(bandsintown.access_start_date_time, null);
  assert.equal(bandsintown.access_start_approximate, null);
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

test("rotating artist refresh only reconciles exact successful artist scopes", () => {
  const insert = db.prepare(`INSERT OR REPLACE INTO tour_dates
    (id,artist,source,updated_at,last_seen_at,provider_active,owner_id) VALUES (?,?,?,?,?,?,?)`);
  insert.run("tour_scope_seen", "Seen Artist", "bandsintown", 1000, 1000, 1, null);
  insert.run("tour_scope_unvisited", "Unvisited Artist", "bandsintown", 1000, 1000, 1, null);
  insert.run("tour_scope_ticketmaster", "Seen Artist", "ticketmaster", 1000, 1000, 1, null);

  assert.equal(reconcileStaleProviderTourDatesForArtists(db, {
    sourceArtists: new Map([["bandsintown", new Set(["Seen Artist"])]]),
    staleBefore: 2000,
  }), 1);
  assert.equal(db.prepare("SELECT provider_active FROM tour_dates WHERE id='tour_scope_seen'").get().provider_active, 0);
  assert.equal(db.prepare("SELECT provider_active FROM tour_dates WHERE id='tour_scope_unvisited'").get().provider_active, 1,
    "an artist outside this rotating slice must stay active");
  assert.equal(db.prepare("SELECT provider_active FROM tour_dates WHERE id='tour_scope_ticketmaster'").get().provider_active, 1,
    "an exact Bandsintown success cannot reconcile Ticketmaster rows");
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
    event_name: "Upsert Artist - Foundation World Tour",
    tour_name: "Foundation World Tour",
    start_date_time: "2033-01-03T00:00:00.000Z",
    start_local_time: "2033-01-02T19:00:00",
    access_start_date_time: "2033-01-02T23:00:00.000Z",
    access_start_approximate: 0,
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
    event_image_url: "https://s1.ticketm.net/dam/a/foundation-upsert.jpg",
    event_image_attribution: "Ticketmaster / Foundation Artist",
    event_image_width: 2048,
    event_image_height: 1152,
  };

  assert.equal(upsertProviderTourDateRows(db, [row], { seenAt: 5000 }), 1);
  db.prepare("INSERT OR IGNORE INTO artists (norm,name,data,rank_score,source,created_at,updated_at) VALUES (?,?,?,?,?,?,?)")
    .run("radiohead", row.artist, "{}", 0, "test", 1, 1);
  assert.equal(upsertProviderTourDateRows(db, [row], { seenAt: 5000 }), 1);
  const inserted = db.prepare("SELECT * FROM tour_dates WHERE id=?").get(row.id);
  for (const field of [
    "provider_event_id", "event_name", "tour_name", "start_date_time", "start_local_time",
    "access_start_date_time", "access_start_approximate", "event_timezone",
    "event_status", "venue_provider_id", "venue_address_line1", "venue_address_line2", "venue_city",
    "venue_region", "venue_postal_code", "venue_country_code", "venue_country",
    "event_image_url", "event_image_attribution", "event_image_width", "event_image_height",
  ]) assert.equal(inserted[field], row[field], `${field} should survive the provider upsert`);
  assert.equal(inserted.provider_active, 1);
  assert.equal(inserted.last_seen_at, 5000);
  assert.equal(inserted.updated_at, 5000);

  db.prepare("UPDATE tour_dates SET provider_active=0 WHERE id=?").run(row.id);
  assert.equal(upsertProviderTourDateRows(db, [{ ...row, event_status: "offsale" }], { seenAt: 6000 }), 1);
  assert.equal(db.prepare("SELECT artist_key FROM tour_dates WHERE id=?").get(row.id).artist_key, "radiohead");
  const returned = db.prepare("SELECT provider_active,last_seen_at,updated_at,event_status,sold_out FROM tour_dates WHERE id=?").get(row.id);
  assert.deepEqual({ ...returned }, { provider_active: 1, last_seen_at: 6000, updated_at: 6000, event_status: "offsale", sold_out: 0 });
  upsertProviderTourDateRows(db, [{
    ...row,
    event_name: null,
    tour_name: null,
    access_start_date_time: null,
    access_start_approximate: null,
    event_status: null,
    venue_address_line2: null,
  }], { seenAt: 7000 });
  const partial = db.prepare(`SELECT event_name,tour_name,access_start_date_time,access_start_approximate,
    event_status,venue_address_line2,last_seen_at,updated_at FROM tour_dates WHERE id=?`).get(row.id);
  assert.deepEqual({ ...partial }, {
    event_name: row.event_name,
    tour_name: row.tour_name,
    access_start_date_time: row.access_start_date_time,
    access_start_approximate: row.access_start_approximate,
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
  const updatedImage = {
    ...row,
    event_status: "offsale",
    venue: "Upsert Hall Annex",
    event_image_url: "https://s1.ticketm.net/dam/a/foundation-upsert-revised.jpg",
    event_image_width: 1600,
    event_image_height: 900,
  };
  upsertProviderTourDateRows(db, [updatedImage], { seenAt: 10000 });
  assert.deepEqual(
    { ...db.prepare(`SELECT event_image_url,event_image_attribution,event_image_width,event_image_height,
      last_seen_at,updated_at FROM tour_dates WHERE id=?`).get(row.id) },
    {
      event_image_url: updatedImage.event_image_url,
      event_image_attribution: updatedImage.event_image_attribution,
      event_image_width: updatedImage.event_image_width,
      event_image_height: updatedImage.event_image_height,
      last_seen_at: 10000,
      updated_at: 10000,
    },
    "a material provider image change advances the public revision clock",
  );
  const imageRemoved = {
    ...updatedImage,
    event_image_url: null,
    event_image_attribution: null,
    event_image_width: null,
    event_image_height: null,
  };
  upsertProviderTourDateRows(db, [imageRemoved], { seenAt: 11000 });
  assert.deepEqual(
    { ...db.prepare(`SELECT event_image_url,event_image_attribution,event_image_width,event_image_height,
      last_seen_at,updated_at FROM tour_dates WHERE id=?`).get(row.id) },
    {
      event_image_url: null,
      event_image_attribution: null,
      event_image_width: null,
      event_image_height: null,
      last_seen_at: 11000,
      updated_at: 11000,
    },
    "provider removal clears stale event imagery and advances the public revision clock",
  );
  upsertProviderTourDateRows(db, [{
    ...imageRemoved,
    event_name: "Upsert Artist Live",
    tour_name: null,
  }], { seenAt: 12000 });
  assert.deepEqual(
    { ...db.prepare("SELECT event_name,tour_name,last_seen_at,updated_at FROM tour_dates WHERE id=?").get(row.id) },
    { event_name: "Upsert Artist Live", tour_name: null, last_seen_at: 12000, updated_at: 12000 },
    "a new official title clears a previously derived tour instead of retaining stale metadata",
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
    (id,artist,venue,date,event_end_date,source,updated_at,owner_id,release_at,provider_active,last_seen_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
  insert.run("tour_visibility_history", artist, "History Hall", "2034-06-01", null, "ticketmaster", 1, null, 0, 0, 1);
  insert.run("tour_visibility_range", artist, "Festival Grounds", "2034-12-20", "2035-01-10", "ticketmaster", 1, null, 0, 1, 1);
  insert.run("tour_visibility_inactive_range", artist, "Inactive Grounds", "2034-12-21", "2035-01-11", "ticketmaster", 1, null, 0, 0, 1);
  db.prepare(`UPDATE tour_dates SET event_kind='festival',music_evidence=?,billed_artists=?
    WHERE id IN (?,?)`).run(
    "ticketmaster:classification:music",
    JSON.stringify([artist]),
    "tour_visibility_range",
    "tour_visibility_inactive_range",
  );
  insert.run("tour_visibility_active", artist, "Active Hall", "2035-06-01", null, "ticketmaster", 1, null, 0, 1, 1);
  insert.run("tour_visibility_inactive", artist, "Inactive Hall", "2035-07-01", null, "ticketmaster", 1, null, 0, 0, 1);
  insert.run("tour_visibility_authored", artist, "Authored Hall", "2035-08-01", null, "artist-submitted", 1, ownerId, 0, 0, null);
  insert.run("tour_visibility_unreleased", artist, "Private Hall", "2035-09-01", null, "artist-submitted", 1, ownerId, at + 1000, 0, null);

  const ids = (viewer) => visibleTourDateRowsFrom(db, viewer, { artist, at }).map((row) => row.id);
  assert.deepEqual(ids(null), [
    "tour_visibility_history",
    "tour_visibility_range",
    "tour_visibility_active",
    "tour_visibility_authored",
  ]);
  assert.deepEqual(visibleTourDateRowsFrom(db, null, {
    artist,
    today: "2035-01-01",
    at,
  }).map((row) => row.id), [
    "tour_visibility_range",
    "tour_visibility_active",
    "tour_visibility_authored",
  ], "upcoming reads exclude both history and an inactive provider event");
  assert.deepEqual(ids({ id: ownerId, role: "artist" }), [
    "tour_visibility_history",
    "tour_visibility_range",
    "tour_visibility_active",
    "tour_visibility_authored",
    "tour_visibility_unreleased",
  ]);
  assert.deepEqual(ids({ id: "admin", role: "admin", is_banned: 0, suspended_until: 0 }), [
    "tour_visibility_history",
    "tour_visibility_range",
    "tour_visibility_inactive_range",
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
