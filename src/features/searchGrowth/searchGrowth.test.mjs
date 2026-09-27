import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { readSearchGrowth, setSearchGrowthMode, validateSearchGrowth, SEARCH_GROWTH_PATH } from "./searchGrowthApi.mjs";
import { createSearchGrowthController, searchGrowthScope, growthNumber, growthPercent, growthTime, growthWindow, growthConnectionLabel, visibleGrowthOpportunities } from "./searchGrowthState.mjs";
const payload = (mode = "monitor", overrides = {}) => ({
  enabled: true, configured: true, mode, connection: { state: "ready", property: "sc-domain:mshpit.com" },
  lastSuccessAt: null, nextRunAt: null, lastErrorCode: null, running: false,
  window: null, previousWindow: null, totals: { current: null, previous: null }, truncated: false,
  opportunities: [], limits: { maxPages: 1000, maxPrioritiesPerDay: 10, retentionDays: 90 }, history: [], measurement: { state: "not_connected" },
  ...overrides,
});
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const appError = (error) => Object.assign(new Error("Safe failure"), { name: "AppError", code: "PIT-NET-001", retryable: true, status: error?.status || 0 });
function setup(overrides = {}) {
  const states = [], changes = [];
  const controller = createSearchGrowthController({
    accountId: "admin-a", scope: "scope-a", read: async () => payload(),
    change: async options => { changes.push(options); return payload(options.mode); },
    normalizeError: appError, onState: state => states.push(state), ...overrides,
  });
  return { controller, states, changes, last: () => states.at(-1) };
}
test("status read is bound to one administrator and forwards cancellation", async () => {
  const signal = new AbortController().signal;
  let request;
  const status = await readSearchGrowth({ accountId: "admin-a", signal }, { apiCall: async (...args) => { request = args; return payload(); } });
  assert.equal(status.mode, "monitor");
  assert.equal(request[0], SEARCH_GROWTH_PATH);
  assert.equal(request[1].expectedAccountId, "admin-a");
  assert.equal(request[1].signal, signal);
  assert.equal(request[1].silent, true);
  assert.equal(request[1].method, undefined);
});
test("mode write sends only strict mode and expectedMode, never a job trigger or credentials", async () => {
  let request;
  await setSearchGrowthMode({ accountId: "admin-a", mode: "prioritize", expectedMode: "monitor", accessToken: "not-forwarded", runNow: true }, {
    apiCall: async (...args) => { request = args; return payload("prioritize"); },
  });
  assert.equal(request[0], SEARCH_GROWTH_PATH);
  assert.deepEqual(request[1].body, { mode: "prioritize", expectedMode: "monitor" });
  assert.equal(request[1].expectedAccountId, "admin-a");
  assert.equal(request[1].method, "POST");
});
test("missing account, invalid modes, and unconfirmed successful writes fail closed", async () => {
  let calls = 0;
  const apiCall = async () => { calls += 1; return payload(); };
  await assert.rejects(readSearchGrowth({}, { apiCall }), /administrator/);
  for (const options of [{ mode: "publish", expectedMode: "monitor" }, { mode: "paused" }, { mode: "monitor", expectedMode: "unknown" }]) {
    await assert.rejects(setSearchGrowthMode({ accountId: "a", ...options }, { apiCall }));
  }
  assert.equal(calls, 0);
  await assert.rejects(setSearchGrowthMode({ accountId: "a", mode: "paused", expectedMode: "monitor" }, { apiCall }), /did not confirm/);
});
test("malformed status cannot enable controls while valid no-report and disabled data remain honest", () => {
  assert.equal(validateSearchGrowth(payload("paused", { enabled: false, configured: false })).mode, "paused");
  for (const bad of [null, [], {}, payload("unknown"), payload("monitor", { enabled: "true" }), payload("monitor", { opportunities: null }), payload("monitor", { totals: null })]) assert.throws(() => validateSearchGrowth(bad));
});
test("only a verified administrator receives a private Search Growth scope", () => {
  for (const input of [{}, { accountId: "a", role: "moderator", emailVerified: true }, { accountId: "a", role: "admin", emailVerified: false }, { accountId: "a", role: "admin" }]) assert.equal(searchGrowthScope(input), null);
  assert.notEqual(searchGrowthScope({ accountId: "a", role: "admin", emailVerified: true }), searchGrowthScope({ accountId: "b", role: "admin", emailVerified: true }));
});
test("initial loading/failure never looks like an empty report and refresh recovers", async () => {
  let fail = true;
  const s = setup({ read: async () => { if (fail) throw new Error("secret SQL text"); return payload(); } });
  const pending = s.controller.refresh();
  assert.equal(s.last().resource.status, "loading");
  assert.equal(s.last().resource.data, null);
  await pending;
  assert.equal(s.last().resource.status, "error");
  assert.equal(s.last().confirmed, false);
  assert.doesNotMatch(s.last().errorMessage, /SQL|secret/u);
  fail = false;
  await s.controller.refresh();
  assert.equal(s.last().resource.status, "ready");
  assert.equal(s.last().confirmed, true);
});
test("refresh failure retains the same account's snapshot but disables mode changes until confirmed", async () => {
  let fail = false;
  const s = setup({ read: async () => { if (fail) throw new Error("offline"); return payload(); } });
  await s.controller.refresh();
  const data = s.last().resource.data;
  fail = true;
  await s.controller.refresh();
  assert.equal(s.last().resource.data, data);
  assert.equal(s.last().confirmed, false);
  await s.controller.setMode("paused");
  assert.equal(s.changes.length, 0);
  fail = false;
  await s.controller.refresh();
  await s.controller.setMode("paused");
  assert.equal(s.changes.length, 1);
});
test("mode changes are single-flight, use compare-and-set, and never optimistically report success", async () => {
  const save = deferred();
  let writes = 0, options;
  const s = setup({ change: async args => { writes += 1; options = args; return save.promise; } });
  await s.controller.refresh();
  const pending = s.controller.setMode("prioritize");
  await s.controller.setMode("paused");
  await s.controller.refresh();
  assert.equal(writes, 1);
  assert.equal(options.expectedMode, "monitor");
  assert.equal(options.accountId, "admin-a");
  assert.equal(s.last().resource.data.mode, "monitor");
  assert.equal(s.last().pendingMode, "prioritize");
  save.resolve(payload("prioritize"));
  await pending;
  assert.equal(s.last().resource.data.mode, "prioritize");
  assert.equal(s.last().pendingMode, null);
  assert.match(s.last().notice, /No run was started/);
});
test("uncertain save requires reconciliation before retry and preserves the saved snapshot", async () => {
  let writes = 0;
  const s = setup({ change: async () => { writes += 1; throw new Error("timeout"); } });
  await s.controller.refresh();
  await s.controller.setMode("paused");
  assert.equal(s.last().resource.data.mode, "monitor");
  assert.equal(s.last().confirmed, false);
  assert.match(s.last().errorMessage, /server may already have saved/);
  await s.controller.setMode("paused");
  assert.equal(writes, 1);
  await s.controller.refresh();
  assert.equal(s.last().confirmed, true);
});
test("role/access loss clears private snapshots on both read and write failures", async () => {
  for (const writing of [false, true]) {
    let denied = false;
    const failure = Object.assign(new Error("forbidden"), { status: 403 });
    const s = setup({ read: async () => { if (denied) throw failure; return payload(); }, change: async () => { throw failure; } });
    await s.controller.refresh();
    if (writing) await s.controller.setMode("paused");
    else { denied = true; await s.controller.refresh(); }
    assert.equal(s.last().resource.data, null);
    assert.equal(s.last().confirmed, false);
    assert.match(s.last().errorMessage, /Administrator access/);
  }
});
test("ACCOUNT_CHANGED clears the snapshot even without an HTTP status", async () => {
  let denied = false;
  const s = setup({ read: async () => { if (denied) throw Object.assign(new Error("changed"), { serverCode: "ACCOUNT_CHANGED" }); return payload(); } });
  await s.controller.refresh(); denied = true; await s.controller.refresh();
  assert.equal(s.last().resource.data, null);
});
test("dispose cancels old reads and writes, including a return to the same account", async () => {
  for (const writing of [false, true]) {
    const response = deferred();
    let signal;
    const s = setup(writing ? { change: options => { signal = options.signal; return response.promise; } } : { read: options => { signal = options.signal; return response.promise; } });
    if (writing) await s.controller.refresh();
    const pending = writing ? s.controller.setMode("paused") : s.controller.refresh();
    const before = s.states.length;
    s.controller.dispose();
    const next = setup(); await next.controller.refresh();
    response.resolve(payload("paused")); await pending;
    assert.equal(signal.aborted, true);
    assert.equal(s.states.length, before);
    assert.equal(next.last().resource.data.mode, "monitor");
  }
});
test("resuming from a cached snapshot retains figures without authorizing writes before refresh", async () => {
  const first = setup(); await first.controller.refresh(); first.controller.dispose();
  const next = setup({ initialState: first.last() });
  await next.controller.setMode("paused");
  assert.equal(next.changes.length, 0);
  await next.controller.refresh();
  assert.equal(next.last().confirmed, true);
});
test("display metrics distinguish missing values from zeros and preserve CTR fraction units", () => {
  assert.equal(growthPercent(0.005), "0.50%");
  assert.equal(growthPercent(0), "0.00%");
  assert.equal(growthNumber(0), "0");
  for (const absent of [null, undefined, NaN, -1, "0"]) {
    assert.equal(growthNumber(absent), "Unavailable");
    assert.equal(growthPercent(absent), "Unavailable");
  }
  assert.equal(growthTime(null), "Not recorded");
  assert.equal(growthTime("bad"), "Unavailable");
  assert.equal(growthWindow(null), "Not recorded");
  assert.equal(growthWindow({ startDate: "2026-09-01", endDate: "2026-09-14" }), "2026-09-01 to 2026-09-14");
  assert.equal(growthConnectionLabel({ configured: false }), "Google access not configured");
  assert.match(growthConnectionLabel({ configured: true, connection: { state: "awaiting_import" } }), /awaiting the first report/);
  assert.match(growthConnectionLabel({ configured: true, connection: { state: "disabled" } }), /disabled/);
  assert.equal(growthConnectionLabel({ configured: true, connection: { state: "connected" } }), "Google access verified");
});
test("opportunity display remains bounded and rejects external/control-character paths", () => {
  const rows = [{ path: "https://evil.test/" }, { path: "//evil.test/" }, { path: "/artist/abc\nunsafe" }, ...Array.from({ length: 30 }, (_, i) => ({ path: "/artist/" + i }))];
  assert.equal(visibleGrowthOpportunities({ opportunities: rows }).length, 10);
  assert.equal(visibleGrowthOpportunities({ opportunities: rows })[0].path, "/artist/0");
});
test("hook and panel wiring hide account-generation data synchronously and use no interval polling", async () => {
  const hook = await readFile(new URL("./useSearchGrowth.js", import.meta.url), "utf8");
  const panel = await readFile(new URL("./SearchGrowthPanel.jsx", import.meta.url), "utf8");
  const admin = await readFile(new URL("../../screens/AdminScreen.jsx", import.meta.url), "utf8");
  assert.match(hook, /if \(ownerRef.current.scope !== scope\) ownerRef.current = \{ scope \}/);
  assert.match(hook, /saved\?\.owner === owner \? saved.state : emptySearchGrowthState\(scope\)/);
  assert.match(hook, /controller.dispose\(\)/);
  assert.match(hook, /refreshRegistry.current.searchGrowth = refresh/);
  assert.doesNotMatch(hook, /setInterval/);
  assert.match(admin, /session\?\.role === "admin" && session\?\.emailVerified === true \? <SearchGrowthPanel/);
  assert.match(panel, /Signup conversion measurement is not connected/);
  assert.match(panel, /Partial report/);
  assert.match(panel, /docs\/search-growth-automation.md/);
  assert.doesNotMatch(panel, /TextInput|access_token|client_secret/);
});
