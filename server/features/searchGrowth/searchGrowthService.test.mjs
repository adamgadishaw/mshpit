import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { generateKeyPairSync } from "node:crypto";
import { createSearchGrowthService, readSearchGrowthPriorityState, searchGrowthEnabled, searchGrowthPublicPath,
  searchGrowthWindows, startSearchGrowthScheduler } from "./searchGrowthService.js";

const KEY = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" });
const AT = Date.parse("2026-10-01T12:00:00Z");
const DAY = 86_400_000;
const configured = () => ({ SEARCH_GROWTH_ENABLED: "true", SEARCH_CONSOLE_PROPERTY: "sc-domain:mshpit.com",
  SEARCH_CONSOLE_SERVICE_ACCOUNT_EMAIL: "search-growth@fixture-project.iam.gserviceaccount.com", SEARCH_CONSOLE_PRIVATE_KEY: KEY });
const row = (path, overrides = {}) => ({ page: `https://www.mshpit.com${path}`, clicks: 1, impressions: 100, position: 7, ctr: 0.01, ...overrides });
const window = (pages = [row("/artist/bryson-tiller")]) => ({ totals: { clicks: 10, impressions: 1000, ctr: 0.01, position: 8 }, pages, truncated: false });
function fixture(t, options = {}) {
  const database = new DatabaseSync(":memory:");
  t.after(() => database.close());
  const env = options.env || configured();
  let clock = AT, calls = [];
  const client = options.client || { readWindow: async request => { calls.push(request); return window(); } };
  const now = () => clock;
  const service = createSearchGrowthService({ database, env, client, now, onPriorities: options.onPriorities });
  return { database, env, service, now, calls, setTime: value => { clock = value; } };
}
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

test("default-off service has no foreground network side effects or invented measurements", async t => {
  const f = fixture(t, { env: {} });
  assert.equal(f.service.collectStatus().enabled, false);
  assert.equal(f.service.collectStatus().configured, false);
  assert.deepEqual(f.service.collectStatus().totals, { current: null, previous: null });
  assert.equal(f.service.collectStatus().measurement.state, "not_connected");
  f.service.setMode("prioritize");
  assert.deepEqual(await f.service.runOnce(), { outcome: "disabled" });
  assert.equal(f.calls.length, 0);
  for (const value of ["true", "1", "YES", " On "]) assert.equal(searchGrowthEnabled({ SEARCH_GROWTH_ENABLED: value }), true);
  for (const value of [undefined, "", "false", "development", "enabled", "2"]) assert.equal(searchGrowthEnabled({ SEARCH_GROWTH_ENABLED: value }), false);
});

test("public path allowlist rejects private routes, off-site URLs, traversal, credentials and query data", () => {
  for (const path of ["/artist/bryson-tiller", "/artist/bj%C3%B6rk", "/venue/rebel", "/event/tm_a-1", "/city/ca/toronto", "/venues/gb/london"]) {
    assert.equal(searchGrowthPublicPath(`https://www.mshpit.com${path}`), path);
  }
  for (const url of ["https://evil.test/artist/a", "http://www.mshpit.com/artist/a", "https://www.mshpit.com.evil.test/artist/a",
    "https://user:secret@www.mshpit.com/artist/a", "https://www.mshpit.com:8443/artist/a", "https://www.mshpit.com/user/private",
    "https://www.mshpit.com/artist/a?email=secret", "https://www.mshpit.com/artist/a#secret", "https://www.mshpit.com/artist/../secret",
    "https://www.mshpit.com/artist/%2E%2e", "https://www.mshpit.com/artist/%2Fsecret", "https://www.mshpit.com/artist/%252fsecret",
    "https://www.mshpit.com/artist/%00secret", "https://www.mshpit.com/artist/a\\b", "https://www.mshpit.com//artist/a", "/artist/a"]) {
    assert.equal(searchGrowthPublicPath(url), null, url);
  }
});

test("completed reporting windows use Pacific calendar days across DST and UTC midnight", () => {
  assert.deepEqual(searchGrowthWindows(AT), { window: { startDate: "2026-09-01", endDate: "2026-09-28" }, previousWindow: { startDate: "2026-08-04", endDate: "2026-08-31" } });
  assert.deepEqual(searchGrowthWindows(Date.parse("2026-03-09T06:30:00Z")), {
    window: { startDate: "2026-02-06", endDate: "2026-03-05" }, previousWindow: { startDate: "2026-01-09", endDate: "2026-02-05" } });
  assert.equal(searchGrowthWindows(Date.parse("2026-11-01T07:30:00Z")).window.endDate, "2026-10-29");
});

test("daily imports persist only bounded page aggregates and opportunities, with prior window comparison", async t => {
  const pages = [...Array.from({ length: 1100 }, (_, i) => row(`/artist/act-${i}`)), row("/user/secret")];
  let requests = 0;
  const f = fixture(t, { client: { readWindow: async () => window(requests++ ? [row("/artist/act-0", { clicks: 4 })] : pages) } });
  assert.equal((await f.service.runOnce()).outcome, "success");
  const status = f.service.collectStatus();
  assert.equal(status.connection.state, "connected");
  assert.equal(status.opportunities.length, 200);
  assert.equal(status.truncated, true);
  assert.equal(status.opportunities.find(item => item.path === "/artist/act-0").previousCtr, 0.04);
  assert.equal(f.database.prepare("SELECT COUNT(*) n FROM search_growth_pages WHERE window_key='current'").get().n, 1000);
  assert.equal(f.database.prepare("SELECT COUNT(*) n FROM search_growth_pages WHERE window_key='previous'").get().n, 1);
  assert.deepEqual(await f.service.runOnce(), { outcome: "not_due" });
  assert.equal(requests, 2);
  assert.equal(status.nextRunAt, AT + DAY);
});

test("opportunity heuristics are bounded signals, not conversion or uplift estimates", async t => {
  let call = 0;
  const f = fixture(t, { client: { readWindow: async () => window(call++ ? [row("/venue/changed", { impressions: 200, clicks: 20, position: 3 })]
    : [row("/artist/too-small", { impressions: 49 }), row("/artist/top", { position: 3 }), row("/artist/too-far", { position: 21 }),
      row("/artist/high-ctr", { clicks: 15 }), row("/venue/changed", { impressions: 100, clicks: 10, position: 8 }),
      row("/event/ctr", { clicks: 0 }), row("/artist/bad", { impressions: -1 }), row("/artist/leak?private=secret")]) } });
  await f.service.runOnce();
  const status = f.service.collectStatus();
  assert.deepEqual(status.opportunities.map(item => item.reason).sort(), ["content_visibility", "ctr_opportunity"]);
  assert.equal(JSON.stringify(status).includes("secret"), false);
  assert.equal(JSON.stringify(status).includes("uplift"), false);
  assert.equal(status.measurement.state, "not_connected");
});

test("failed or partially malformed imports retain last good data and back off for six hours across restart", async t => {
  const f = fixture(t);
  await f.service.runOnce();
  const before = f.service.collectStatus();
  f.setTime(AT + DAY);
  let calls = 0;
  const broken = createSearchGrowthService({ database: f.database, env: f.env, now: f.now, client: { readWindow: async () => {
    if (calls++) throw Object.assign(new Error("secret token and private query"), { code: "query_rejected" });
    return window([row("/artist/new")]);
  } } });
  assert.deepEqual(await broken.runOnce(), { outcome: "failed", code: "query_rejected" });
  assert.deepEqual(broken.collectStatus().opportunities, before.opportunities);
  assert.equal(broken.collectStatus().lastSuccessAt, before.lastSuccessAt);
  assert.equal(broken.collectStatus().nextRunAt, AT + DAY + 6 * 3_600_000);
  assert.equal(JSON.stringify(broken.collectStatus()).includes("secret"), false);
  const restarted = createSearchGrowthService({ database: f.database, env: f.env, now: f.now, client: { readWindow: () => assert.fail("persistent backoff") } });
  assert.deepEqual(await restarted.runOnce(), { outcome: "not_due" });
});

test("snapshot replacement is transactional when a database insert fails", async t => {
  const f = fixture(t);
  await f.service.runOnce();
  const before = f.service.collectStatus();
  f.setTime(AT + DAY);
  f.database.exec("CREATE TRIGGER reject_growth_snapshot BEFORE INSERT ON search_growth_opportunities BEGIN SELECT RAISE(ABORT,'fixture'); END");
  assert.equal((await f.service.runOnce()).outcome, "failed");
  assert.deepEqual(f.service.collectStatus().opportunities, before.opportunities);
  assert.equal(f.database.prepare("SELECT COUNT(*) n FROM search_growth_pages").get().n, 2);
});

test("durable owner lease prevents duplicate workers and stale owner commits after expiry", async t => {
  const pending = deferred();
  const f = fixture(t, { client: { readWindow: async () => pending.promise } });
  const stale = f.service.runOnce();
  const second = createSearchGrowthService({ database: f.database, env: f.env, now: f.now, client: { readWindow: async () => window([row("/artist/winner")]) } });
  assert.deepEqual(await second.runOnce(), { outcome: "not_due" });
  f.setTime(AT + 91_000);
  assert.equal((await second.runOnce()).outcome, "success");
  pending.resolve(window([row("/artist/stale")]));
  assert.equal((await stale).outcome, "aborted");
  assert.equal(second.collectStatus().opportunities[0].path, "/artist/winner");
});

test("pause or master disable during import prevents the next read, commit and priority delivery", async t => {
  for (const change of ["pause", "disable"]) {
    let calls = 0, deliveries = 0, f;
    f = fixture(t, { onPriorities: () => { deliveries++; }, client: { readWindow: async () => {
      calls++;
      if (change === "pause") f.service.setMode("paused"); else f.env.SEARCH_GROWTH_ENABLED = "false";
      return window();
    } } });
    f.service.setMode("prioritize");
    assert.equal((await f.service.runOnce()).outcome, "aborted");
    assert.equal(calls, 1);
    assert.equal(deliveries, 0);
    assert.equal(f.service.collectStatus().lastSuccessAt, null);
  }
});

test("priority hints are post-commit, capped at ten per UTC day and fail closed on pause, expiry or missing schema", async t => {
  let f;
  const deliveries = [];
  f = fixture(t, { client: { readWindow: async () => window(Array.from({ length: 15 }, (_, i) => row(`/artist/priority-${i}`))) },
    onPriorities: batch => { assert.equal(f.database.prepare("SELECT COUNT(*) n FROM search_growth_opportunities").get().n, 15); deliveries.push(batch); } });
  f.service.setMode("prioritize");
  await f.service.runOnce();
  assert.equal(deliveries[0].pages.length, 10);
  f.database.exec("UPDATE search_growth_state SET next_run_at=0");
  await f.service.runOnce();
  assert.equal(deliveries.length, 1);
  assert.equal(readSearchGrowthPriorityState({ database: f.database, env: f.env, at: AT }).enabled, true);
  assert.equal(readSearchGrowthPriorityState({ database: f.database, env: f.env, at: AT + 2 * DAY }).enabled, false);
  f.service.setMode("paused");
  assert.equal(readSearchGrowthPriorityState({ database: f.database, env: f.env, at: AT }).enabled, false);
  const empty = new DatabaseSync(":memory:");
  t.after(() => empty.close());
  assert.equal(readSearchGrowthPriorityState({ database: empty, env: f.env }).enabled, false);
  assert.equal(empty.prepare("SELECT COUNT(*) n FROM sqlite_master").get().n, 0);
});

test("shutdown revokes the lease and finishes even if an injected client ignores abort", async t => {
  const pending = deferred();
  let calls = 0;
  const f = fixture(t, { client: { readWindow: () => { calls++; return pending.promise; } } });
  const run = f.service.runOnce();
  await Promise.resolve();
  await f.service.stop({ abortActive: true });
  assert.equal((await run).outcome, "aborted");
  assert.equal(f.service.collectStatus().running, false);
  pending.resolve(window());
  await Promise.resolve();
  assert.equal(calls, 1);
  assert.equal(f.service.collectStatus().lastSuccessAt, null);
  assert.deepEqual(await f.service.runOnce(), { outcome: "disabled" });
});

test("run history is pruned to at most one hundred rows and ninety days", async t => {
  const f = fixture(t);
  const insert = f.database.prepare("INSERT INTO search_growth_runs VALUES (?,?,?,0)");
  for (let i = 0; i < 150; i++) insert.run(`recent-${i}`, AT - i * 1000, "success");
  insert.run("expired", AT - 91 * DAY, "failed");
  await f.service.runOnce();
  assert.equal(f.database.prepare("SELECT COUNT(*) n FROM search_growth_runs").get().n, 100);
  assert.equal(f.database.prepare("SELECT 1 FROM search_growth_runs WHERE id='expired'").get(), undefined);
});

test("scheduler uses the shared coordinator and drains cleanly without foreground import triggers", async () => {
  let coordinated = 0, runs = 0, stops = 0;
  const delays = [];
  const scheduler = startSearchGrowthScheduler({ service: { runOnce: async () => { runs++; }, stop: async () => { stops++; } },
    coordinate: job => { coordinated++; return job(); }, setTimer: (_, delay) => { delays.push(delay); return 1; },
    setRepeatingTimer: (_, delay) => { delays.push(delay); return 2; }, clearTimer: () => {}, clearRepeatingTimer: () => {} });
  assert.equal(runs, 0);
  assert.deepEqual(delays, [180_000, 3_600_000]);
  await scheduler.trigger();
  assert.deepEqual([runs, coordinated], [1, 1]);
  await scheduler.stop({ abortActive: true });
  await scheduler.trigger();
  assert.deepEqual([runs, stops], [1, 1]);
});

test("the one-minute deadline aborts a stalled client and persists a safe retry", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture(t, { client: { readWindow: () => new Promise(() => {}) } });
  const run = f.service.runOnce();
  await Promise.resolve();
  t.mock.timers.tick(60_000);
  assert.deepEqual(await run, { outcome: "failed", code: "request_timeout" });
  assert.equal(f.service.collectStatus().running, false);
  assert.equal(f.service.collectStatus().lastSuccessAt, null);
  assert.equal(f.service.collectStatus().nextRunAt, AT + 6 * 3_600_000);
});

test("pause or disable after snapshot commit still prevents delivery of priority hints", async t => {
  for (const change of ["pause", "disable"]) {
    const f = fixture(t);
    let armed = true, deliveries = 0, service;
    const observed = { prepare: sql => f.database.prepare(sql), exec: sql => {
      f.database.exec(sql);
      if (sql === "COMMIT" && armed) {
        armed = false;
        if (change === "pause") service.setMode("paused"); else f.env.SEARCH_GROWTH_ENABLED = "false";
      }
    } };
    service = createSearchGrowthService({ database: observed, env: f.env, now: f.now,
      client: { readWindow: async () => window() }, onPriorities: () => { deliveries++; } });
    service.setMode("prioritize");
    assert.equal((await service.runOnce()).outcome, "aborted");
    assert.equal(deliveries, 0);
    assert.equal(service.collectStatus().lastSuccessAt, AT, "the fully imported report is preserved, but no new work is enqueued");
    assert.equal(readSearchGrowthPriorityState({ database: f.database, env: f.env, at: AT }).enabled, false);
  }
});

test("city and collection opportunities remain visible without consuming automatic entity priority slots", async t => {
  const deliveries = [];
  const pages = [...Array.from({ length: 20 }, (_, index) => row(`/${index % 2 ? "venues" : "city"}/ca/city-${index}`, { impressions: 1_000_000, clicks: 0 })),
    row("/artist/actionable")];
  const f = fixture(t, { client: { readWindow: async () => window(pages) }, onPriorities: batch => deliveries.push(batch) });
  f.service.setMode("prioritize");
  await f.service.runOnce();
  assert.equal(f.service.collectStatus().opportunities.length, 21);
  assert.deepEqual(deliveries[0].pages.map(item => item.path), ["/artist/actionable"]);
  assert.equal(f.database.prepare("SELECT priority_count FROM search_growth_state WHERE id=1").get().priority_count, 1);
});

test("apex and www observations merge by public path without losing clicks, impressions or weighted position", async t => {
  const f = fixture(t, { client: { readWindow: async () => window([
    row("/artist/canonical", { clicks: 50, impressions: 1000, position: 4 }),
    { ...row("/artist/canonical", { clicks: 0, impressions: 9000, position: 8 }), page: "https://mshpit.com/artist/canonical" },
  ]) } });
  assert.equal((await f.service.runOnce()).outcome, "success");
  const [opportunity] = f.service.collectStatus().opportunities;
  assert.equal(opportunity.path, "/artist/canonical");
  assert.equal(opportunity.clicks, 50);
  assert.equal(opportunity.impressions, 10000);
  assert.equal(opportunity.ctr, 0.005);
  assert.equal(opportunity.position, 7.6);
  assert.equal(f.database.prepare("SELECT COUNT(*) n FROM search_growth_pages WHERE window_key='current'").get().n, 1);
});
