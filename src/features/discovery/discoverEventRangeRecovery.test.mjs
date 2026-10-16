import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parse } from "@babel/parser";
import * as rangeDomain from "../../domain/discoverEventRange.mjs";
import { sanitizeTourDates } from "../../domain/dataPolicy.mjs";
import { discoverCountryIdentity } from "../../domain/discoverScene.mjs";
import { LIVE_EVENT_SCOPE } from "../../domain/liveDiscovery.mjs";
import { discoverEventRecovery } from "../../components/discover/discovery-recovery.mjs";

const screen = readFileSync(new URL("../../screens/DiscoverScreen.jsx", import.meta.url), "utf8");
const store = readFileSync(new URL("../../store.js", import.meta.url), "utf8");
const service = readFileSync(new URL("./tourDateRangeApi.mjs", import.meta.url), "utf8");
function extract(source) {
  const named = new Map(); let errorCondition;
  const visit = (node) => {
    if (!node || typeof node !== "object") return;
    if (node.type === "VariableDeclarator" && node.id?.type === "Identifier") {
      named.set(node.id.name, node.init?.callee?.name === "useCallback" ? node.init.arguments[0] : node.init);
    }
    if (node.type === "FunctionDeclaration" && node.id) named.set(node.id.name, node);
    if (node.type === "ConditionalExpression" && source.slice(node.consequent.start, node.consequent.end).includes("Couldn't load more dates. Try again.")) {
      errorCondition = node.test;
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(visit);
      else if (value?.type) visit(value);
    }
  };
  visit(parse(source, { sourceType: "module", plugins: ["jsx"] }));
  return {
    named: (name) => { const node = named.get(name); assert.ok(node, name); return source.slice(node.start, node.end); },
    errorCondition: errorCondition && source.slice(errorCondition.start, errorCondition.end),
  };
}
const screenCode = extract(screen), storeCode = extract(store), serviceCode = extract(service);
const evaluate = (code, bindings) => new Function(...Object.keys(bindings), `return (${code});`)(...Object.values(bindings));
const apiWith = (api) => ({
  range: evaluate(serviceCode.named("fetchDiscoverTourDateRange"), { api, ...rangeDomain }),
  startup: evaluate(serviceCode.named("fetchStartupTourDates"), { api, ...rangeDomain }),
});
const event = { id: "retained", date: "2026-10-17", artist: "Fixture", venue: "Room", local: true };
const populated = { upcomingEvents: [event] };
const empty = { upcomingEvents: [] };

function harness() {
  const responses = [], calls = [];
  const { range } = apiWith(async (path, options) => {
    calls.push({ path, options });
    assert.ok(responses.length, "fixture response available");
    const response = responses.shift();
    if (response instanceof Error) throw response;
    return response;
  });
  const load = evaluate(storeCode.named("loadDiscoverTourDateRange"), {
    fetchDiscoverTourDateRange: range, sanitizeTourDates, ENABLE_DEMO_DATA: false,
  });
  const state = { current: { scopeKey: "", days: null, through: null, rows: [], nextCursor: null, status: "idle" } };
  const rangeScopeKey = "local|Canada|Toronto|Canada";
  const request = evaluate(screenCode.named("requestEventRange"), {
    rangeRequestRef: { current: { sequence: 0, controller: null } }, requestedCursorRef: { current: null },
    eventRangeRef: state, rangeScopeKey, setEventRange: value => { state.current = value; },
    liveScope: LIVE_EVENT_SCOPE.LOCAL, region: "Canada", LIVE_EVENT_SCOPE, discoverCountryIdentity,
    rangeLoaderRef: { current: load }, ...rangeDomain,
  });
  return {
    responses, calls, request, state: () => state.current,
    showError: () => evaluate(screenCode.errorCondition, {
      eventRange: state.current, rangeScopeKey, visibleLiveEvents: state.current.rows,
    }),
    recovery: () => discoverEventRecovery({ status: state.current.status, count: state.current.rows.length,
      days: 30, ranges: rangeDomain.DISCOVER_RANGE_DAYS, local: true, region: "Canada" }),
  };
}

test("Discover accepts authoritative empty refreshes and removes its visible retry error", async () => {
  const f = harness(); f.responses.push(populated, new Error("fixture offline"), empty);
  assert.equal(await f.request(30), true);
  assert.equal(await f.request(30), false);
  assert.equal(f.showError(), true, "the actual JSX retry condition is visible for a failed request");
  assert.deepEqual(f.state().rows.map(row => row.id), ["retained"]);
  assert.equal(await f.request(30), true, "an empty successful retry is authoritative");
  assert.equal(f.state().status, "ready");
  assert.deepEqual(f.state().rows, []);
  assert.equal(f.showError(), false, "the actual JSX retry condition must clear");
  assert.equal(f.recovery().kind, "empty");
  assert.equal(f.recovery().message, "No events are listed near your home area over the next 30 days.");
  assert.ok(f.calls.every(call => call.path === "/api/discovery/sidebar?days=30&limit=500"));
});

test("Discover rejects malformed success payloads, retains rows and recovers through the same visible retry", async () => {
  const invalid = [{ unexpected: true }, { upcomingEvents: "wrong shape" }, { tourDates: "broken", items: [] }, { items: null, upcomingEvents: [] }];
  const f = harness(); f.responses.push(populated, ...invalid, empty);
  assert.equal(await f.request(30), true);
  for (let i = 0; i < invalid.length; i += 1) {
    assert.equal(await f.request(30), false);
    assert.equal(f.showError(), true);
    assert.deepEqual(f.state().rows.map(row => row.id), ["retained"]);
  }
  assert.equal(await f.request(30), true);
  assert.equal(f.showError(), false);
  assert.deepEqual(f.state().rows, []);
});

test("Discover initial malformed success is an error while a valid empty response is empty", async () => {
  const f = harness(); f.responses.push({}, empty);
  assert.equal(await f.request(30), false);
  assert.equal(f.state().status, "error");
  assert.equal(f.recovery().kind, "error");
  assert.equal(await f.request(30), true);
  assert.equal(f.state().status, "ready");
  assert.equal(f.recovery().kind, "empty");
});

test("Discover retains current rows when a nonempty response contains malformed rows", async () => {
  for (const invalid of [null, 7, "event", false, [], {}, { id: " " }, { artist: "Incomplete" }]) {
    for (const rows of [[invalid], [event, invalid]]) {
      const f = harness(); f.responses.push(populated, { upcomingEvents: rows }, empty);
      assert.equal(await f.request(30), true);
      assert.equal(await f.request(30), false, "malformed rows cannot become an authoritative empty or partial list");
      assert.equal(f.showError(), true);
      assert.deepEqual(f.state().rows.map(row => row.id), ["retained"]);
      assert.equal(await f.request(30), true);
      assert.equal(f.showError(), false);
      assert.deepEqual(f.state().rows, []);
    }
  }
});

test("empty final pages retain prior shows and clear the pagination cursor", async () => {
  const f = harness(); f.responses.push({ ...populated, nextCursor: "next" }, empty);
  await f.request(30);
  assert.equal(await f.request(30, { after: "next", append: true }), true);
  assert.equal(f.state().status, "ready");
  assert.deepEqual(f.state().rows.map(row => row.id), ["retained"]);
  assert.equal(f.state().nextCursor, null);
  assert.equal(f.showError(), false);
});

test("startup preserves each valid lane when the other response is malformed", async () => {
  for (const invalidCountry of [false, true]) {
    const calls = [];
    const { startup } = apiWith(async (path, options) => {
      calls.push({ path, options });
      const country = new URL(path, "https://example.test").searchParams.has("country");
      return country === invalidCountry ? { unexpected: true } : {
        tourDates: [{ id: country ? "home" : "worldwide" }], nextCursor: null, range: { through: "2026-11-15" },
      };
    });
    const controller = new AbortController();
    const result = await startup({ signal: controller.signal, expectedAccountId: "fixture-account", homeCountry: "Canada" });
    assert.deepEqual(result.tourDates.map(row => row.id), [invalidCountry ? "worldwide" : "home"]);
    assert.equal(result.partial, true);
    assert.equal(result.through, "2026-11-15");
    assert.equal(calls.length, 2);
    assert.ok(calls.every(call => call.options.signal === controller.signal && call.options.expectedAccountId === "fixture-account"));
  }
});

test("startup rejects all-malformed lanes and accepts valid empty fallback lanes", async () => {
  const malformed = apiWith(async () => ({ unexpected: true }));
  await assert.rejects(malformed.startup({ homeCountry: "Canada" }), TypeError);
  await assert.rejects(malformed.startup({}), TypeError);
  const partial = apiWith(async path => {
    if (!new URL(path, "https://example.test").searchParams.has("country")) throw Error("fixture offline");
    return { tourDates: [], nextCursor: null };
  });
  assert.deepEqual(await partial.startup({ homeCountry: "Canada" }), {
    tourDates: [], nextCursor: null, through: null, partial: true,
  });
});

test("startup treats invalid row arrays as failed lanes and preserves a valid counterpart", async () => {
  for (const invalidCountry of [false, true]) {
    const { startup } = apiWith(async path => {
      const country = new URL(path, "https://example.test").searchParams.has("country");
      return { tourDates: country === invalidCountry ? [event, null] : [{ id: "valid-lane" }] };
    });
    const result = await startup({ homeCountry: "Canada" });
    assert.deepEqual(result.tourDates, [{ id: "valid-lane" }]);
    assert.equal(result.partial, true);
  }
  const invalid = apiWith(async () => ({ tourDates: [null] }));
  await assert.rejects(invalid.startup({ homeCountry: "Canada" }), TypeError);
});
