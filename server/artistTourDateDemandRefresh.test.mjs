import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after, beforeEach } from "node:test";

const dataDir = mkdtempSync(join(tmpdir(), "pit-artist-tour-demand-"));
process.env.PIT_DATA_DIR = dataDir;

const { artistRow, artistStmts, db, q } = await import("./db.js");
const {
  collectExactTicketmasterArtistDates,
  createArtistTourDateDemandRefreshService,
  dedupeExactProviderRows,
  exactBandsintownArtistEvents,
  exactCatalogArtistForDemandRefresh,
  exactTicketmasterAttractionIds,
  reconcileExactArtistTicketmasterWindow,
  refreshExactArtistFromProviders,
  ticketmasterDemandScanWindow,
} = await import("./artistTourDateDemandRefresh.js");

after(() => {
  db.close();
  rmSync(dataDir, { recursive: true, force: true });
});

beforeEach(() => {
  db.prepare("DELETE FROM artist_tourdate_refresh_queue").run();
  db.prepare("DELETE FROM tour_dates").run();
  db.prepare("DELETE FROM app_meta WHERE key GLOB 'tourdates:demand:*'").run();
  db.prepare("DELETE FROM artists").run();
});

function addArtist(name, extra = {}) {
  const key = name.trim().toLowerCase();
  artistStmts.upsert.run(artistRow(key, { name, ...extra }, "test"));
  return artistStmts.byNorm.get(key);
}

function tmEvent({
  id,
  name = "Bryson Tiller Live",
  artist = "Bryson Tiller",
  attractionId = "K8vZ9178ABC",
  date = "2026-09-16",
} = {}) {
  return {
    id,
    name,
    classifications: [{ segment: { name: "Music" } }],
    dates: { start: { localDate: date, localTime: "19:30:00" } },
    _embedded: {
      attractions: [{ id: attractionId, name: artist }],
      venues: [{
        id: "KovZpZAJtA7A",
        name: "RBC Amphitheatre",
        city: { name: "Toronto" },
        state: { name: "Ontario", stateCode: "ON" },
        country: { name: "Canada", countryCode: "CA" },
      }],
    },
  };
}

function tmPage(number, totalPages, events) {
  return {
    page: { number, size: 200, totalPages, totalElements: totalPages * 200 },
    _embedded: { events },
  };
}

test("exact catalog demand matching rejects partial and ambiguous identities", () => {
  const bryson = { norm: "bryson tiller", name: "Bryson Tiller" };
  assert.equal(exactCatalogArtistForDemandRefresh([bryson], "  BRYSON   TILLER "), bryson);
  assert.equal(exactCatalogArtistForDemandRefresh([bryson], "Bryson"), null);
  assert.equal(exactCatalogArtistForDemandRefresh([
    bryson,
    { norm: "bryson-tiller-alt", name: "Bryson Tiller" },
  ], "Bryson Tiller"), null);
});

test("Ticketmaster exact-artist lookup uses 200 rows, pages, exact attractions, and remembers a stable attraction ID", async () => {
  const requests = [];
  const pages = [
    tmPage(0, 2, [
      tmEvent({ id: "exact-1" }),
      tmEvent({ id: "wrong-1", artist: "Bryson Tyler", attractionId: "WRONG1" }),
    ]),
    tmPage(1, 2, [tmEvent({ id: "exact-2", date: "2026-10-01" })]),
  ];
  const result = await collectExactTicketmasterArtistDates({
    apiKey: "test-key",
    artistName: "Bryson Tiller",
    fetchJson: async (value) => {
      const url = new URL(value);
      requests.push({
        keyword: url.searchParams.get("keyword"),
        attractionId: url.searchParams.get("attractionId"),
        size: url.searchParams.get("size"),
        page: url.searchParams.get("page"),
      });
      return pages[Number(url.searchParams.get("page"))];
    },
    wait: async () => {},
  });

  assert.deepEqual(requests, [
    { keyword: "Bryson Tiller", attractionId: null, size: "200", page: "0" },
    { keyword: "Bryson Tiller", attractionId: null, size: "200", page: "1" },
  ]);
  assert.deepEqual(result.rows.map((row) => row.provider_event_id), ["exact-1", "exact-2"]);
  assert.equal(result.attractionId, "K8vZ9178ABC");
  assert.equal(result.complete, true);
  assert.deepEqual(
    exactTicketmasterAttractionIds(pages[0], "Bryson Tiller"),
    ["K8vZ9178ABC"],
  );
});

test("a known Ticketmaster attraction ID replaces fuzzy keyword lookup and still validates every returned event", async () => {
  let request;
  const result = await collectExactTicketmasterArtistDates({
    apiKey: "test-key",
    artistName: "Bryson Tiller",
    attractionId: "K8vZ9178ABC",
    fetchJson: async (value) => {
      const url = new URL(value);
      request = {
        keyword: url.searchParams.get("keyword"),
        attractionId: url.searchParams.get("attractionId"),
      };
      return tmPage(0, 1, [
        tmEvent({ id: "right" }),
        tmEvent({ id: "same-name-wrong-id", attractionId: "DIFFERENT" }),
      ]);
    },
  });
  assert.deepEqual(request, { keyword: null, attractionId: "K8vZ9178ABC" });
  assert.deepEqual(result.rows.map((row) => row.provider_event_id), ["right"]);
});

test("Ticketmaster exact artist paging never crosses pages zero through four", async () => {
  const pages = [];
  const result = await collectExactTicketmasterArtistDates({
    apiKey: "test-key",
    artistName: "Bryson Tiller",
    fetchJson: async (value) => {
      const page = Number(new URL(value).searchParams.get("page"));
      pages.push(page);
      return tmPage(page, 99, [tmEvent({ id: "event-" + page, date: "2026-09-" + String(page + 10) })]);
    },
    wait: async () => {},
  });
  assert.deepEqual(pages, [0, 1, 2, 3, 4]);
  assert.equal(result.complete, false);
  assert.equal(result.rows.length, 5);
});

test("a full Ticketmaster page with a null total fails closed at the paging cap", async () => {
  const pages = [];
  const result = await collectExactTicketmasterArtistDates({
    apiKey: "test-key",
    artistName: "Bryson Tiller",
    fetchJson: async (value) => {
      const page = Number(new URL(value).searchParams.get("page"));
      pages.push(page);
      return {
        page: { number: page, size: 200, totalPages: null, totalElements: null },
        _embedded: {
          events: Array.from({ length: 200 }, (_, index) => tmEvent({
            id: "null-total-" + page + "-" + index,
            date: "2026-09-16",
          })),
        },
      };
    },
    wait: async () => {},
  });
  assert.deepEqual(pages, [0, 1, 2, 3, 4]);
  assert.equal(result.complete, false);
  assert.equal(result.limited, true);
});

test("Bandsintown demand rows require the requested identity in provider billing", () => {
  const exact = { id: "exact", artist: { name: "Bryson Tiller" }, lineup: ["Bryson Tiller"] };
  const wrong = { id: "wrong", artist: { name: "Bryson Tyler" }, lineup: ["Bryson Tyler"] };
  assert.deepEqual(exactBandsintownArtistEvents([exact, wrong], "Bryson Tiller"), [exact]);
});

test("a complete empty fallback cannot hide a partial Ticketmaster artist scan", async () => {
  const result = await refreshExactArtistFromProviders({
    artistName: "Bryson Tiller",
    env: { TICKETMASTER_KEY: "tm", BANDSINTOWN_APP_ID: "bit" },
    fetchJson: async (value) => {
      const url = new URL(value);
      if (url.hostname === "rest.bandsintown.com") return [];
      const page = Number(url.searchParams.get("page"));
      if (page === 1) throw new Error("later Ticketmaster page failed");
      return tmPage(0, 2, [tmEvent({ id: "verified-partial" })]);
    },
    wait: async () => {},
  });
  assert.equal(result.rows.length, 1, "verified partial rows remain available to persist");
  assert.equal(result.completedProviders, 1, "Bandsintown completed even though it was empty");
  assert.equal(result.partialProviders, 1);
  assert.equal(result.complete, false, "the worker must retry rather than enter a long success cooldown");
});

function testService({
  nowRef,
  refreshArtist,
  persisted = [],
  env = { TICKETMASTER_KEY: "test-key" },
  ...options
}) {
  return createArtistTourDateDemandRefreshService({
    database: db,
    env,
    clock: () => nowRef.value,
    runJob: (job) => Promise.resolve().then(job),
    refreshArtist,
    persistRows: (rows, at) => persisted.push({ rows, at }),
    logger: { error() {} },
    autoSchedule: false,
    failureCooldownMs: 1000,
    successCooldownMs: 5000,
    runningLeaseMs: 1000,
    interJobDelayMs: 0,
    ...options,
  });
}

test("authenticated reads persist only a canonical key and a replacement worker drains it after restart", async () => {
  addArtist("Bryson Tiller");
  const nowRef = { value: 2_000_000_000_000 };
  const persisted = [];
  const calls = [];
  const firstProcess = testService({
    nowRef,
    persisted,
    refreshArtist: async () => {
      assert.fail("the enqueueing HTTP process must not perform provider work");
    },
  });

  assert.deepEqual(firstProcess.enqueue({
    artistKey: "bryson tiller",
    authenticated: false,
  }), { queued: false, reason: "authentication_required" });
  assert.deepEqual(firstProcess.enqueue({
    artistKey: "unknown raw query",
    authenticated: true,
  }), { queued: false, reason: "unknown_artist" });
  assert.deepEqual(firstProcess.enqueue({
    artistKey: "bryson tiller",
    authenticated: true,
  }), { queued: true, reason: "queued" });

  const stored = db.prepare("SELECT * FROM artist_tourdate_refresh_queue").get();
  assert.equal(stored.artist_key, "bryson tiller");
  assert.deepEqual(
    Object.keys(stored).sort(),
    [
      "artist_key", "attempt_count", "attempted_at", "bandsintown_refresh_completed",
      "claim_token", "last_error_code", "not_before", "requested_at", "status", "succeeded_at",
      "ticketmaster_attraction_id", "ticketmaster_coverage_limited",
      "ticketmaster_scan_completed", "ticketmaster_scan_cursor_date",
      "ticketmaster_scan_horizon_date", "ticketmaster_window_days", "updated_at",
    ],
    "the durable queue has no raw query, account, IP, or requester column",
  );

  const replacementProcess = testService({
    nowRef,
    persisted,
    refreshArtist: async (request) => {
      calls.push(request);
      return { rows: [{ id: "verified-row" }], complete: true };
    },
  });
  const result = await replacementProcess.runDueOnce();
  assert.equal(result.status, "completed");
  assert.equal(calls[0].artistKey, "bryson tiller");
  assert.equal(calls[0].artistName, "Bryson Tiller", "the worker resolves the canonical name from the catalog");
  assert.deepEqual(persisted, [{ rows: [{ id: "verified-row" }], at: nowRef.value }]);
  assert.equal(db.prepare("SELECT status FROM artist_tourdate_refresh_queue").get().status, "cooldown");
});

test("provider failure survives restart and retries after its durable backoff", async () => {
  addArtist("Retry Artist");
  const nowRef = { value: 2_100_000_000_000 };
  let fail = true;
  let calls = 0;
  const make = () => testService({
    nowRef,
    refreshArtist: async () => {
      calls += 1;
      if (fail) throw new Error("provider unavailable");
      return { rows: [], complete: true };
    },
  });
  const first = make();
  first.enqueue({ artistKey: "retry artist", authenticated: true });
  const failed = await first.runDueOnce();
  assert.equal(failed.status, "retry");
  const queued = db.prepare("SELECT status,not_before,attempt_count,last_error_code FROM artist_tourdate_refresh_queue").get();
  assert.equal(queued.status, "pending");
  assert.equal(queued.attempt_count, 1);
  assert.equal(queued.last_error_code, "provider_refresh_failed");

  const replacement = make();
  assert.equal((await replacement.runDueOnce()).status, "empty", "restart cannot skip the persisted retry delay");
  nowRef.value = queued.not_before;
  fail = false;
  assert.equal((await replacement.runDueOnce()).status, "completed");
  assert.equal(calls, 2);
  assert.equal(db.prepare("SELECT status,attempt_count FROM artist_tourdate_refresh_queue").get().attempt_count, 0);
});

test("a discovered Ticketmaster attraction ID is retained and reused after cooldown", async () => {
  addArtist("Stable Provider Artist");
  const nowRef = { value: 2_150_000_000_000 };
  const first = testService({
    nowRef,
    refreshArtist: async () => ({
      rows: [],
      complete: true,
      ticketmasterAttractionId: "K8vZ917STABLE",
    }),
  });
  first.enqueue({ artistKey: "stable provider artist", authenticated: true });
  assert.equal((await first.runDueOnce()).status, "completed");
  const cooled = db.prepare(
    "SELECT not_before,ticketmaster_attraction_id FROM artist_tourdate_refresh_queue",
  ).get();
  assert.equal(cooled.ticketmaster_attraction_id, "K8vZ917STABLE");

  nowRef.value = cooled.not_before;
  let reused;
  const replacement = testService({
    nowRef,
    refreshArtist: async (request) => {
      reused = request.ticketmasterAttractionId;
      return { rows: [], complete: true, ticketmasterAttractionId: reused };
    },
  });
  assert.equal(
    replacement.enqueue({ artistKey: "stable provider artist", authenticated: true }).queued,
    true,
  );
  assert.equal((await replacement.runDueOnce()).status, "completed");
  assert.equal(reused, "K8vZ917STABLE");
});

test("an expired running lease is recovered after an interrupted deployment", async () => {
  addArtist("Interrupted Artist");
  const nowRef = { value: 2_200_000_000_000 };
  const service = testService({
    nowRef,
    refreshArtist: async () => ({ rows: [], complete: true }),
  });
  service.enqueue({ artistKey: "interrupted artist", authenticated: true });
  db.prepare(
    "UPDATE artist_tourdate_refresh_queue SET status='running',not_before=?,attempt_count=1",
  ).run(nowRef.value - 1);

  const replacement = testService({
    nowRef,
    refreshArtist: async () => ({ rows: [], complete: true }),
  });
  assert.equal((await replacement.runDueOnce()).status, "completed");
  assert.equal(db.prepare("SELECT status FROM artist_tourdate_refresh_queue").get().status, "cooldown");
});

test("the global provider budget defers excess durable work into the next hour", async () => {
  addArtist("Budget One");
  addArtist("Budget Two");
  const nowRef = { value: 2_300_000_000_000 };
  let calls = 0;
  const service = testService({
    nowRef,
    globalHourlyLimit: 1,
    refreshArtist: async () => {
      calls += 1;
      return { rows: [], complete: true };
    },
  });
  service.enqueue({ artistKey: "budget one", authenticated: true });
  service.enqueue({ artistKey: "budget two", authenticated: true });
  assert.equal((await service.runDueOnce()).status, "completed");
  const deferred = await service.runDueOnce();
  assert.equal(deferred.status, "budget");
  assert.equal(calls, 1);
  nowRef.value = deferred.retryAt;
  assert.equal((await service.runDueOnce()).status, "completed");
  assert.equal(calls, 2);
});

test("provider dedupe preserves distinct events that share a venue and date", () => {
  const shared = {
    source: "ticketmaster",
    venue: "Same Room",
    date: "2026-09-16",
  };
  const one = { ...shared, id: "tm_one", provider_event_id: "one" };
  const two = { ...shared, id: "tm_two", provider_event_id: "two" };
  assert.deepEqual(
    dedupeExactProviderRows([one, two, { ...one }]),
    [one, two],
    "only the same provider event identity is a duplicate",
  );
});

test("a stale cached attraction ID gets one exact keyword fallback and only verified identity changes it", async () => {
  const requests = [];
  const replaced = await collectExactTicketmasterArtistDates({
    apiKey: "test-key",
    artistName: "Bryson Tiller",
    attractionId: "STALE_ID",
    fetchJson: async (value) => {
      const url = new URL(value);
      requests.push({
        attractionId: url.searchParams.get("attractionId"),
        keyword: url.searchParams.get("keyword"),
      });
      return url.searchParams.get("attractionId")
        ? tmPage(0, 1, [])
        : tmPage(0, 1, [tmEvent({ id: "new", attractionId: "VERIFIED_NEW" })]);
    },
  });
  assert.deepEqual(requests, [
    { attractionId: "STALE_ID", keyword: null },
    { attractionId: null, keyword: "Bryson Tiller" },
  ]);
  assert.equal(replaced.fallbackAttempted, true);
  assert.equal(replaced.attractionCacheAction, "replace");
  assert.equal(replaced.attractionId, "VERIFIED_NEW");

  const preserved = await collectExactTicketmasterArtistDates({
    apiKey: "test-key",
    artistName: "Bryson Tiller",
    attractionId: "STILL_UNPROVEN",
    fetchJson: async () => tmPage(0, 1, []),
  });
  assert.equal(preserved.fallbackAttempted, true);
  assert.equal(preserved.attractionCacheAction, "keep");
  assert.equal(preserved.attractionId, "STILL_UNPROVEN");
});

test("Ticketmaster windows shrink, regrow after success, and complete the horizon normally", async () => {
  addArtist("Dense Artist");
  const nowRef = { value: Date.parse("2026-08-28T12:00:00Z") };
  const seenWindows = [];
  const limitedResult = {
    rows: [],
    complete: false,
    errorCategory: "ticketmaster_coverage_limited",
    ticketmaster: {
      attempted: true,
      complete: false,
      limited: true,
      attractionCacheAction: "keep",
      errorCategory: "ticketmaster_coverage_limited",
    },
    bandsintown: { attempted: false, complete: false },
  };
  const completeResult = {
    rows: [],
    complete: true,
    errorCategory: null,
    ticketmaster: {
      attempted: true,
      complete: true,
      limited: false,
      attractionCacheAction: "keep",
      errorCategory: null,
    },
    bandsintown: { attempted: false, complete: false },
  };
  const outcomes = [limitedResult, completeResult, completeResult];
  const make = () => testService({
    nowRef,
    ticketmasterWindowDays: 4,
    refreshArtist: async (request) => {
      seenWindows.push([request.scanStartDate, request.scanEndDate]);
      return outcomes.shift();
    },
  });

  const first = make();
  first.enqueue({ artistKey: "dense artist", authenticated: true });
  assert.equal((await first.runDueOnce()).status, "window_narrowed");
  let durable = db.prepare("SELECT * FROM artist_tourdate_refresh_queue").get();
  assert.equal(durable.ticketmaster_window_days, 2);
  const originalCursor = durable.ticketmaster_scan_cursor_date;
  const nearHorizon = new Date(
    Date.parse(originalCursor + "T00:00:00Z") + (5 * 24 * 60 * 60 * 1000),
  ).toISOString().slice(0, 10);
  db.prepare("UPDATE artist_tourdate_refresh_queue "
    + "SET ticketmaster_scan_horizon_date=? WHERE artist_key='dense artist'").run(nearHorizon);
  assert.equal(durable.ticketmaster_coverage_limited, 0);

  nowRef.value = durable.not_before;
  assert.equal((await make().runDueOnce()).status, "continued");
  durable = db.prepare("SELECT * FROM artist_tourdate_refresh_queue").get();
  assert.equal(durable.ticketmaster_window_days, 4, "a pageable slice regrows toward the configured window");
  assert.ok(durable.ticketmaster_scan_cursor_date > originalCursor);
  assert.equal(durable.ticketmaster_coverage_limited, 0);

  nowRef.value = durable.not_before;
  const completedAt = nowRef.value;
  assert.equal((await make().runDueOnce()).status, "completed");
  durable = db.prepare("SELECT * FROM artist_tourdate_refresh_queue").get();
  assert.equal(durable.status, "cooldown");
  assert.equal(durable.ticketmaster_scan_completed, 1);
  assert.equal(durable.ticketmaster_coverage_limited, 0);
  assert.equal(durable.succeeded_at, completedAt);
  assert.deepEqual(seenWindows, [
    [originalCursor, new Date(Date.parse(originalCursor + "T00:00:00Z") + (3 * 24 * 60 * 60 * 1000)).toISOString().slice(0, 10)],
    [originalCursor, new Date(Date.parse(originalCursor + "T00:00:00Z") + (1 * 24 * 60 * 60 * 1000)).toISOString().slice(0, 10)],
    [new Date(Date.parse(originalCursor + "T00:00:00Z") + (2 * 24 * 60 * 60 * 1000)).toISOString().slice(0, 10), nearHorizon],
  ]);
});

test("only an irreducible capped one-day window records a coverage gap", async () => {
  addArtist("Irreducible Artist");
  const nowRef = { value: Date.parse("2026-08-28T12:00:00Z") };
  const service = testService({
    nowRef,
    ticketmasterWindowDays: 1,
    refreshArtist: async () => ({
      rows: [],
      complete: false,
      errorCategory: "ticketmaster_coverage_limited",
      ticketmaster: {
        attempted: true,
        complete: false,
        limited: true,
        attractionCacheAction: "keep",
        errorCategory: "ticketmaster_coverage_limited",
      },
      bandsintown: { attempted: false, complete: false },
    }),
  });
  service.enqueue({ artistKey: "irreducible artist", authenticated: true });
  const today = new Date(nowRef.value).toISOString().slice(0, 10);
  db.prepare("UPDATE artist_tourdate_refresh_queue SET "
    + "ticketmaster_scan_cursor_date=?,ticketmaster_scan_horizon_date=?,"
    + "ticketmaster_window_days=1 WHERE artist_key='irreducible artist'").run(today, today);

  assert.equal((await service.runDueOnce()).status, "coverage_limited");
  const durable = db.prepare("SELECT * FROM artist_tourdate_refresh_queue").get();
  assert.equal(durable.status, "cooldown");
  assert.equal(durable.ticketmaster_scan_completed, 1);
  assert.equal(durable.ticketmaster_coverage_limited, 1);
  assert.equal(durable.succeeded_at, null, "a skipped irreducible day is not reported as a complete success");
});

test("exact complete reconciliation is scoped and partial scans cannot hide stale dates", async () => {
  addArtist("Scope Artist");
  addArtist("Other Artist");
  q.insertUser.run(
    "scope-member", "scope@example.com", "Scope Member", "scope-member", "hash", "member",
    null, null, null, "SM", "#000000", 1,
  );
  const insert = db.prepare("INSERT INTO tour_dates ("
    + "id,artist,artist_key,date,source,updated_at,owner_id,provider_active,last_seen_at,event_status"
    + ") VALUES (?,?,?,?,?,?,?,?,?,?)");
  insert.run("stale-same", "Scope Artist", "scope artist", "2026-09-10", "ticketmaster", 10, null, 1, 10, null);
  insert.run("fresh-same", "Scope Artist", "scope artist", "2026-09-11", "ticketmaster", 100, null, 1, 100, null);
  insert.run("cancelled-same", "Scope Artist", "scope artist", "2026-09-12", "ticketmaster", 100, null, 1, 100, "cancelled");
  insert.run("member-same", "Scope Artist", "scope artist", "2026-09-10", "ticketmaster", 10, "scope-member", 1, 10, null);
  insert.run("other-artist", "Other Artist", "other artist", "2026-09-10", "ticketmaster", 10, null, 1, 10, null);
  insert.run("other-source", "Scope Artist", "scope artist", "2026-09-10", "bandsintown", 10, null, 1, 10, null);
  insert.run("outside-window", "Scope Artist", "scope artist", "2026-10-10", "ticketmaster", 10, null, 1, 10, null);

  assert.equal(reconcileExactArtistTicketmasterWindow(db, {
    artistKey: "scope artist",
    scanStartDate: "2026-09-01",
    scanEndDate: "2026-09-30",
    seenSince: 100,
  }), 2);
  const states = Object.fromEntries(
    db.prepare("SELECT id,provider_active FROM tour_dates").all()
      .map((row) => [row.id, row.provider_active]),
  );
  assert.equal(states["stale-same"], 0);
  assert.equal(states["cancelled-same"], 0);
  for (const id of ["fresh-same", "member-same", "other-artist", "other-source", "outside-window"]) {
    assert.equal(states[id], 1, id + " must stay visible");
  }

  db.prepare("UPDATE tour_dates SET provider_active=1 WHERE id='stale-same'").run();
  const nowRef = { value: Date.parse("2026-08-28T12:00:00Z") };
  const partial = testService({
    nowRef,
    refreshArtist: async () => ({
      rows: [],
      complete: false,
      errorCategory: "provider_unavailable",
      ticketmaster: {
        attempted: true,
        complete: false,
        limited: false,
        errorCategory: "provider_unavailable",
      },
      bandsintown: { attempted: false, complete: false },
    }),
  });
  partial.enqueue({ artistKey: "scope artist", authenticated: true });
  assert.equal((await partial.runDueOnce()).status, "retry");
  assert.equal(
    db.prepare("SELECT provider_active FROM tour_dates WHERE id='stale-same'").get().provider_active,
    1,
    "a partial scan is not authoritative for stale reconciliation",
  );
});

test("expired claim results cannot persist rows, change attraction state, complete, or overwrite retry state", async () => {
  addArtist("Race Artist");
  const nowRef = { value: 2_400_000_000_000 };
  const persisted = [];
  const service = testService({
    nowRef,
    persisted,
    refreshArtist: async () => {
      db.prepare("UPDATE artist_tourdate_refresh_queue "
        + "SET claim_token='replacement-claim',attempted_at=attempted_at+1,not_before=not_before+10000 "
        + "WHERE artist_key='race artist'").run();
      return {
        rows: [{ id: "must-not-persist" }],
        complete: true,
        ticketmasterAttractionId: "MUST_NOT_WRITE",
      };
    },
  });
  service.enqueue({ artistKey: "race artist", authenticated: true });
  assert.equal((await service.runDueOnce()).status, "stale_claim");
  assert.deepEqual(persisted, []);
  let row = db.prepare("SELECT * FROM artist_tourdate_refresh_queue").get();
  assert.equal(row.status, "running");
  assert.equal(row.claim_token, "replacement-claim");
  assert.equal(row.ticketmaster_attraction_id, null);

  db.prepare("UPDATE artist_tourdate_refresh_queue "
    + "SET status='pending',claim_token=NULL,not_before=?,attempted_at=NULL,last_error_code=NULL "
    + "WHERE artist_key='race artist'").run(nowRef.value);
  const failing = testService({
    nowRef,
    refreshArtist: async () => {
      db.prepare("UPDATE artist_tourdate_refresh_queue "
        + "SET claim_token='newer-error-claim',attempted_at=attempted_at+1,not_before=not_before+10000 "
        + "WHERE artist_key='race artist'").run();
      const error = new Error("old worker failed late");
      error.status = 503;
      throw error;
    },
  });
  assert.equal((await failing.runDueOnce()).status, "stale_claim");
  row = db.prepare("SELECT * FROM artist_tourdate_refresh_queue").get();
  assert.equal(row.claim_token, "newer-error-claim");
  assert.equal(row.last_error_code, null, "the old worker cannot overwrite the replacement retry state");
});

test("429 and 5xx provider categories survive into durable backoff state", async () => {
  addArtist("Rate Limited Artist");
  addArtist("Unavailable Artist");
  const nowRef = { value: 2_500_000_000_000 };
  const rateLimited = testService({
    nowRef,
    refreshArtist: async () => {
      const error = new Error("slow down");
      error.status = 429;
      throw error;
    },
  });
  rateLimited.enqueue({ artistKey: "rate limited artist", authenticated: true });
  const rateOutcome = await rateLimited.runDueOnce();
  let row = db.prepare("SELECT * FROM artist_tourdate_refresh_queue WHERE artist_key='rate limited artist'").get();
  assert.equal(row.last_error_code, "provider_rate_limited");
  assert.ok(rateOutcome.retryAt - nowRef.value >= 60 * 60 * 1000);

  const unavailable = testService({
    nowRef,
    refreshArtist: async () => {
      const error = new Error("provider down");
      error.status = 503;
      throw error;
    },
  });
  unavailable.enqueue({ artistKey: "unavailable artist", authenticated: true });
  await unavailable.runDueOnce();
  row = db.prepare("SELECT * FROM artist_tourdate_refresh_queue WHERE artist_key='unavailable artist'").get();
  assert.equal(row.last_error_code, "provider_unavailable");
});
