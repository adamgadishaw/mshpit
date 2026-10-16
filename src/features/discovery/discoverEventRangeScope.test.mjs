import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

// The override permits running this file from scratch before installing it at
// src/features/discovery. The component source is always read unchanged.
const root = process.env.DISCOVER_SCOPE_REPO_ROOT || fileURLToPath(new URL("../../../", import.meta.url));
const require = createRequire(resolve(root, "package.json"));
const React = require("react");
const reconciler = require("react-reconciler");
const { parse } = require("@babel/parser");
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const domain = (path) => import(pathToFileURL(resolve(root, "src/domain", path)).href);
const [area, live, range, scene, geo] = await Promise.all([
  domain("discoverArea.mjs"), domain("liveDiscovery.mjs"), domain("discoverEventRange.mjs"),
  domain("discoverScene.mjs"), domain("geo.mjs"),
]);

const source = readFileSync(resolve(root, "src/screens/DiscoverScreen.jsx"), "utf8");
const tree = parse(source, { sourceType: "module", plugins: ["jsx"] });
const component = tree.program.body.find((node) => node.type === "ExportDefaultDeclaration").declaration;
const selected = new Set([
  "accountId", "homeCity", "homeCountry", "homeCoordinates", "areaContext", "areaChoice",
  "resolvedArea", "region", "liveScope", "rangeScopeKey", "eventRange", "eventWeek",
  "requestedCursorRef", "rangeLoaderRef", "eventRangeRef", "rangeRequestRef",
  "rangeMatchesScene", "requestEventRange",
]);
const statements = component.body.body.filter((node) => {
  if (node.type === "VariableDeclaration") {
    return node.declarations.some(({ id }) => selected.has(id.name || id.elements?.[0]?.name));
  }
  const code = source.slice(node.start, node.end);
  if (/^(rangeLoaderRef|eventRangeRef)\.current =/.test(code)) return true;
  if (node.type !== "ExpressionStatement" || node.expression.callee?.name !== "useEffect") return false;
  const effect = source.slice(node.expression.arguments[0].start, node.expression.arguments[0].end);
  return effect.includes("requestEventRange(DISCOVER_RANGE_DAYS[0])") || effect.includes("syncDiscoverAreaChoice(current,");
}).map((node) => source.slice(node.start, node.end)).join("\n");
assert.match(statements, /requestEventRange\(DISCOVER_RANGE_DAYS\[0\]\)/);
assert.match(statements, /rangeRequestRef.current.sequence \+= 1/);
const initialRange = tree.program.body.find((node) => node.type === "VariableDeclaration"
  && node.declarations.some(({ id }) => id.name === "EMPTY_EVENT_RANGE"));
assert.ok(initialRange, "Use the actual initial range state");

// Match the real App key: an account switch must remount Discover, including
// when both accounts have the same saved city and coordinates.
const app = readFileSync(resolve(root, "App.js"), "utf8");
let keyExpression;
function visit(node) {
  if (!node || typeof node !== "object") return;
  if (node.type === "JSXOpeningElement" && node.name.name === "DiscoverScreen") {
    const key = node.attributes.find((attribute) => attribute.name?.name === "key")?.value?.expression;
    assert.ok(key, "App must provide Discover's real account key");
    keyExpression = app.slice(key.start, key.end);
  }
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach(visit);
    else if (value?.type) visit(value);
  }
}
visit(parse(app, { sourceType: "module", plugins: ["jsx"] }));
assert.ok(keyExpression);
const discoverKey = new Function("session", `return (${keyExpression});`);

const noop = () => {};
const context = {};
let priority = 0;
// Installed React reconciles the extracted hooks, effects and dependencies.
// The host renderer needs no UI nodes because this fixture returns null.
const renderer = reconciler({
  supportsMutation: true, isPrimaryRenderer: true, supportsPersistence: false, supportsHydration: false,
  getRootHostContext: () => context, getChildHostContext: () => context, getPublicInstance: (node) => node,
  prepareForCommit: () => null, resetAfterCommit: noop,
  createInstance: (type, props) => ({ type, props, children: [] }), createTextInstance: (text) => ({ text }),
  appendInitialChild: noop, appendChild: noop, appendChildToContainer: noop,
  removeChild: noop, removeChildFromContainer: noop, insertBefore: noop, insertInContainerBefore: noop,
  finalizeInitialChildren: () => false, shouldSetTextContent: () => false,
  commitUpdate: noop, commitTextUpdate: noop, clearContainer: noop, resetTextContent: noop, commitMount: noop,
  scheduleTimeout: setTimeout, cancelTimeout: clearTimeout, noTimeout: -1,
  supportsMicrotasks: true, scheduleMicrotask: queueMicrotask,
  getCurrentUpdatePriority: () => priority, setCurrentUpdatePriority: (value) => { priority = value; },
  resolveUpdatePriority: () => priority || 32, shouldAttemptEagerTransition: () => false,
  detachDeletedInstance: noop, maySuspendCommit: () => false, preloadInstance: () => true,
  startSuspendingCommit: noop, suspendInstance: noop, waitForCommitToBeReady: () => null,
  NotPendingTransition: null, HostTransitionContext: React.createContext(null), resetFormInstance: noop,
  bindToConsole: (method, args) => console[method].bind(console, ...args),
});

function fixture() {
  let snapshot;
  const calls = [];
  const bindings = { ...React, ...area, ...live, ...range, ...scene, ...geo,
    expose: (value) => { snapshot = value; },
  };
  const Probe = new Function(...Object.keys(bindings), `
    ${source.slice(initialRange.start, initialRange.end)}
    return function Probe({session, discoverySidebar, loadDiscoverTourDateRange}) {
      ${statements}
      expose({rangeScopeKey, eventRange, rangeMatchesScene, setAreaChoice});
      return null;
    };`)(...Object.values(bindings));
  const fail = (error) => { throw error; };
  const container = renderer.createContainer({ children: [] }, 1, null, false, null, "", fail, fail, fail, null);
  const load = (options) => new Promise((resolve) => calls.push({ options, resolve }));
  const flush = (element) => React.act(() => {
    renderer.updateContainerSync(element, container, null, null);
    renderer.flushSyncWork(); renderer.flushPassiveEffects();
  });
  return {
    calls,
    render(session, discoverySidebar = null) {
      flush(React.createElement(Probe, { key: discoverKey(session), session, discoverySidebar, loadDiscoverTourDateRange: load }));
    },
    snapshot: () => snapshot,
    chooseCountry(country) {
      React.act(() => snapshot.setAreaChoice((current) => area.selectDiscoverCountryArea(current, country)));
    },
    async settle(index, ids) {
      await React.act(async () => calls[index].resolve({
        tourDates: ids.map((id) => ({ id, local: true, date: "2026-11-01", releaseAt: 0 })),
        nextCursor: null, through: "2026-11-15",
      }));
    },
    close() { flush(null); },
  };
}

const account = (lat = null, lng = null, { id = "member", city = "Toronto" } = {}) => ({ id, home: { city, lat, lng } });

test("Discover cancels a pending nearby range when coordinates hydrate without changing the city", async () => {
  const f = fixture();
  try {
    f.render(account()); assert.equal(f.calls.length, 1);
    f.render(account(43.6532, -79.3832));
    assert.equal(f.calls.length, 2, "coordinate hydration must request a new local range");
    assert.equal(f.calls[0].options.signal.aborted, true);
    assert.equal(f.calls[1].options.local, true);
    assert.equal(f.snapshot().rangeMatchesScene, false);
    await f.settle(0, ["old-location"]);
    assert.deepEqual(f.snapshot().eventRange.rows, [], "a late old-location success cannot repopulate the range");
    await f.settle(1, ["new-location"]);
    assert.equal(f.snapshot().eventRange.status, "ready");
    assert.deepEqual(f.snapshot().eventRange.rows.map((row) => row.id), ["new-location"]);
  } finally { f.close(); }
});

test("Discover replaces completed nearby dates when coordinates change within the same city", async () => {
  const f = fixture();
  try {
    f.render(account(43.6532, -79.3832)); await f.settle(0, ["old-location"]);
    f.render(account(43.72, -79.50), {
      location: { city: "Toronto", lat: 43.6532, lng: -79.3832 }, upcomingEvents: [{ id: "old-sidebar" }],
    });
    assert.equal(f.calls.length, 2, "saved coordinates own the scope even while the sidebar still has old coordinates");
    assert.equal(f.snapshot().rangeMatchesScene, false);
    assert.deepEqual(f.snapshot().eventRange.rows, []);
    await f.settle(1, ["new-location"]);
    assert.deepEqual(f.snapshot().eventRange.rows.map((row) => row.id), ["new-location"]);
  } finally { f.close(); }
});

test("equivalent numeric coordinate strings keep the same nearby range request", async () => {
  const f = fixture();
  try {
    f.render(account(43.6532, -79.3832));
    f.render(account("43.6532", "-79.3832"));
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0].options.signal.aborted, false);
    await f.settle(0, ["same-location"]);
    f.render(account(43.6532, -79.3832));
    assert.equal(f.calls.length, 1);
    assert.deepEqual(f.snapshot().eventRange.rows.map((row) => row.id), ["same-location"]);
  } finally { f.close(); }
});

test("missing and nonfinite coordinate values do not churn nearby range requests", async () => {
  const f = fixture();
  try {
    f.render(account());
    for (const value of [undefined, "", "not-a-number", Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, null]) {
      f.render({ id: "member", home: { city: "Toronto", lat: value, lng: value } });
      assert.equal(f.calls.length, 1, `invalid coordinates ${String(value)} share the missing-location scope`);
      assert.equal(f.calls[0].options.signal.aborted, false);
    }
    await f.settle(0, ["city-only"]);
    assert.deepEqual(f.snapshot().eventRange.rows.map((row) => row.id), ["city-only"]);
  } finally { f.close(); }
});

test("country and worldwide ranges ignore changes to nearby coordinates", async () => {
  for (const country of ["United States", "Worldwide"]) {
    const f = fixture();
    try {
      f.render(account(43.6532, -79.3832)); f.chooseCountry(country);
      assert.equal(f.calls.length, 2); assert.equal(f.calls[1].options.local, false);
      assert.equal(f.calls[1].options.country, country === "Worldwide" ? undefined : country);
      f.render(account(43.72, -79.50));
      assert.equal(f.calls.length, 2, `${country} must not reload for coordinates it does not use`);
      assert.equal(f.calls[1].options.signal.aborted, false);
      await f.settle(1, ["country-result"]);
      assert.deepEqual(f.snapshot().eventRange.rows.map((row) => row.id), ["country-result"]);
    } finally { f.close(); }
  }
});

test("real App account keys and city changes reject the outgoing range response", async () => {
  for (const next of [account(43.6532, -79.3832, { id: "other-member" }), account(43.6532, -79.3832, { city: "Vancouver" })]) {
    const f = fixture();
    try {
      f.render(account(43.6532, -79.3832)); f.render(next);
      assert.equal(f.calls.length, 2); assert.equal(f.calls[0].options.signal.aborted, true);
      await f.settle(0, ["stale"]); assert.deepEqual(f.snapshot().eventRange.rows, []);
      await f.settle(1, ["current"]); assert.deepEqual(f.snapshot().eventRange.rows.map((row) => row.id), ["current"]);
    } finally { f.close(); }
  }
});

test("changing country cancels the old local range, and unmount cancels its replacement", async () => {
  const f = fixture();
  try {
    f.render(account(43.6532, -79.3832)); f.chooseCountry("United States");
    assert.equal(f.calls.length, 2); assert.equal(f.calls[0].options.signal.aborted, true);
    await f.settle(0, ["old-local"]); assert.deepEqual(f.snapshot().eventRange.rows, []);
    f.close(); assert.equal(f.calls[1].options.signal.aborted, true);
    await f.settle(1, ["after-unmount"]);
  } finally { f.close(); }
});
