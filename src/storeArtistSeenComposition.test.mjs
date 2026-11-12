import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = process.env.PIT_STORE_COMPOSITION_ROOT || fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(new URL("../package.json", import.meta.url));
const React = require("react"), reconciler = require("react-reconciler");
const { transformSync } = require("@babel/core");
const noop = () => {};
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

function createRenderer() {
  const context = {}, container = { children: [] };
  let priority = 0;
  const append = (parent, child) => parent.children.push(child);
  const remove = (parent, child) => { const index = parent.children.indexOf(child); if (index >= 0) parent.children.splice(index, 1); };
  const insert = (parent, child, before) => parent.children.splice(parent.children.indexOf(before), 0, child);
  const renderer = reconciler({
    supportsMutation: true, isPrimaryRenderer: true, supportsPersistence: false, supportsHydration: false,
    getRootHostContext: () => context, getChildHostContext: () => context, getPublicInstance: node => node,
    prepareForCommit: () => null, resetAfterCommit: noop,
    createInstance: (type, props) => ({ type, props, children: [] }), createTextInstance: text => ({ text }),
    appendInitialChild: append, appendChild: append, appendChildToContainer: append,
    removeChild: remove, removeChildFromContainer: remove, insertBefore: insert, insertInContainerBefore: insert,
    finalizeInitialChildren: () => false, shouldSetTextContent: () => false,
    commitUpdate: (node, type, oldProps, newProps) => { node.props = newProps; }, commitTextUpdate: (node, oldText, text) => { node.text = text; },
    hideInstance: noop, unhideInstance: noop, hideTextInstance: noop, unhideTextInstance: noop,
    clearContainer: node => { node.children = []; }, resetTextContent: noop, commitMount: noop,
    scheduleTimeout: setTimeout, cancelTimeout: clearTimeout, noTimeout: -1, supportsMicrotasks: true, scheduleMicrotask: queueMicrotask,
    getCurrentUpdatePriority: () => priority, setCurrentUpdatePriority: value => { priority = value; }, resolveUpdatePriority: () => priority || 32,
    shouldAttemptEagerTransition: () => false, detachDeletedInstance: noop, maySuspendCommit: () => false, preloadInstance: () => true,
    startSuspendingCommit: noop, suspendInstance: noop, waitForCommitToBeReady: () => null, NotPendingTransition: null,
    HostTransitionContext: React.createContext(null), resetFormInstance: noop, bindToConsole: (method, args) => console[method].bind(console, ...args),
  });
  const fail = error => { throw error; };
  const root = renderer.createContainer(container, 1, null, false, null, "", fail, fail, fail, null);
  const flush = () => { for (let i = 0; i < 5; i++) { renderer.flushSyncWork(); if (!renderer.flushPassiveEffects()) break; } };
  return { container, render(element) { renderer.updateContainerSync(element, root, null, null); flush(); },
    act(callback) { renderer.flushSyncFromReconciler(callback); flush(); } };
}


// Mount the COMPLETE production StoreProvider in original declaration order.
// Only platform IO, transport, storage and static catalogs are fixtures. Hooks,
// account hydration, service factories, normalizer and count cache are real.
// The block-scoping transform mirrors Metro's lowering: a late const dependency
// is captured as undefined rather than failing with a Node-only TDZ error.
function fixture(platform) {
  const renderer = createRenderer(), modules = new Map(), storage = new Map(), requests = [];
  const events = new Map();
  let now = Date.parse("2026-11-12T12:00:00Z");
  class FixtureDate extends Date { static now() { return now; } }
  let user = { id: "member-A", name: "Fixture Member", handle: "fixture", role: "fan", emailVerified: true };
  let current = null, nextSeen = () => Promise.resolve({ count: 3 });
  const native = {
    Platform: { OS: platform, select: choices => choices[platform] ?? choices.native ?? choices.default },
    AppState: { currentState: "active", addEventListener(name, callback) {
      const listeners = events.get(name) || new Set(); events.set(name, listeners); listeners.add(callback);
      return { remove: () => listeners.delete(callback) };
    } },
  };
  const api = async (url, options = {}) => {
    requests.push({ url, options });
    assert.equal(options.method || "GET", "GET", "Fixture must never mutate a server");
    if (url === "/api/me") return { user };
    if (url.startsWith("/api/artists/seen?")) return nextSeen(url, options);
    return { users: [], posts: [], items: [], rows: [], events: [], dates: [], follows: [], artists: [],
      venues: [], notifications: [], requests: [], plays: [], following: [], blocked: [], muted: [],
      messages: [], fanclubs: [], memberships: [], plans: [], total: 0, nextCursor: null };
  };
  const io = new Map([
    ["src/lib/api.js", { api, AppError: class extends Error {}, captureAppError: error => error, configureApiIdentity: noop }],
    ["src/lib/persist.js", { load: (key, seed) => storage.has(key) ? storage.get(key) : seed, save: (key, value) => { storage.set(key, value); }, remove: key => { storage.delete(key); }, setPersistErrorHandler: noop }],
    ["src/lib/authTransitions.js", { AUTH_INTENT_KEY: "fixture.auth", authTransitions: {
      blocked: () => false, pending: () => false, revision: () => 0, onPendingRevocation: () => noop,
    } }],
    ["src/theme.js", { clearStoredTheme: noop, setTheme: noop, syncThemeFromAccount: noop, syncNativeAccountTheme: noop }],
    ["src/lib/productAnalytics.js", { configureProductAnalytics: noop, installProductAnalyticsLifecycle: () => noop,
      productAnalyticsPlatform: () => platform, purgeProductAnalyticsAccount: noop, trackProductEvent: noop }],
    ["src/lib/mediaDraftStaging.js", { deleteMediaDraftsForOwner: async () => {}, pruneStaleMediaDraftAssets: async () => {}, releaseMediaDraftAssets: async () => {} }],
    ["src/data.js", { seedFeed: [], ratedShows: [], haversineKm: () => 0, installDemoCatalogShows: noop }],
    ["src/seed/ingested.js", { artistMeta: {}, installIngestedCatalog: noop }],
    ["src/seed/arenas.js", { arenaVenues: [] }],
  ]);
  function load(file) {
    if (io.has(file)) return io.get(file);
    if (modules.has(file)) return modules.get(file).exports;
    const absolute = path.join(root, file), module = { exports: {} };
    modules.set(file, module);
    const code = transformSync(readFileSync(absolute, "utf8"), {
      filename: absolute, babelrc: false, configFile: false,
      plugins: [require("@babel/plugin-transform-block-scoping"),
        [require("@babel/plugin-transform-react-jsx"), { runtime: "automatic" }],
        require("@babel/plugin-transform-modules-commonjs")],
    }).code;
    new Function("require", "module", "exports", "Date", code)(name => {
      if (name === "react-native") return native;
      if (!name.startsWith(".")) return require(name);
      const stem = path.resolve(path.dirname(absolute), name);
      const plain = path.relative(root, stem.replace(/\.(?:ios\.|native\.)?(?:mjs|js)$/, "") + ".js").replaceAll("\\", "/");
      if (io.has(plain)) return io.get(plain);
      const candidates = path.extname(stem) ? [stem] : [
        ...(platform === "ios" ? [stem + ".ios.js", stem + ".ios.mjs"] : []),
        ...(platform !== "web" ? [stem + ".native.js"] : []),
        stem + ".js", stem + ".mjs", stem + ".jsx", path.join(stem, "index.js"),
      ];
      const resolved = candidates.find(existsSync);
      assert.ok(resolved, "Resolve Store dependency: " + name);
      // Device adapters above must stay platform-independent in this harness.
      return load(path.relative(root, resolved).replaceAll("\\", "/"));
    }, module, module.exports, FixtureDate);
    return module.exports;
  }
  const { StoreProvider, useStore } = load("src/store.js");
  function ProfileProbe() { current = useStore(); return React.createElement("Profile", { accountId: current.session?.id }); }
  renderer.render(React.createElement(StoreProvider, null, React.createElement(ProfileProbe)));
  const settle = async () => {
    for (let i = 0; i < 12; i++) { await new Promise(resolve => setImmediate(resolve)); renderer.act(noop); }
  };
  return {
    requests, settle, get store() { return current; },
    nextSeen(fn) { nextSeen = fn; },
    async changeUser(next) {
      user = next;
      for (const callback of events.get("change") || []) callback("background");
      now += 61_000;
      for (const callback of events.get("change") || []) callback("active");
      await settle();
    },
    unmount() { renderer.render(null); },
  };
}

for (const platform of ["ios", "web", "android"]) {
  test(`${platform}: real Store composition initializes artist count dependency before capture`, async t => {
    const f = fixture(platform); t.after(() => f.unmount()); await f.settle();
    assert.equal(f.store.session?.id, "member-A", "Real /api/me hydration completed");
    assert.deepEqual(await f.store.artistSeenCount("  Fixture Artist  "), { count: 3 });
    assert.deepEqual(await f.store.artistSeenCount("fixture artist"), { count: 3 }, "Normalized key reuses count");
    assert.equal(f.requests.filter(row => row.url.startsWith("/api/artists/seen?")).length, 1);
    assert.equal(await f.store.artistSeenCount(""), null);
    if (platform === "ios") assert.equal(f.requests.find(row => row.url.startsWith("/api/artists/seen?")).options.expectedAccountId, "member-A");
  });

  test(`${platform}: mounted Store retires count cache and pending results on account handoff`, async t => {
    const f = fixture(platform); t.after(() => f.unmount()); await f.settle();
    assert.deepEqual(await f.store.artistSeenCount("Fixture Artist"), { count: 3 });
    const old = deferred(); f.nextSeen(() => old.promise);
    const pending = f.store.artistSeenCount("Other Artist");
    await f.changeUser({ id: "member-B", name: "Other member", handle: "other", role: "fan", emailVerified: true });
    assert.equal(f.store.session?.id, "member-B");
    old.resolve({ count: 99 }); assert.equal(await pending, null, "Old account result stays private");
    f.nextSeen(async () => ({ count: 1 }));
    assert.deepEqual(await f.store.artistSeenCount("Fixture Artist"), { count: 1 }, "New account never reuses A's cache");
    await f.changeUser(null); assert.equal(f.store.session, null);
    const before = f.requests.length;
    assert.equal(await f.store.artistSeenCount("Fixture Artist"), null);
    assert.equal(f.requests.length, before, "Guest count does not request private history");
  });
}

test("iOS real Store respects abort and failed optional reads without poisoning the count cache", async t => {
  const f = fixture("ios"); t.after(() => f.unmount()); await f.settle();
  const controller = new AbortController(), old = deferred();
  f.nextSeen(() => old.promise);
  const pending = f.store.artistSeenCount("Fixture Artist", { signal: controller.signal });
  controller.abort(); old.resolve({ count: 99 }); assert.equal(await pending, null);
  const reads = f.requests.length;
  assert.equal(await f.store.artistSeenCount("Fixture Artist", { signal: controller.signal }), null);
  assert.equal(f.requests.length, reads, "Already aborted callback dispatches nothing");
  f.nextSeen(async () => { throw new Error("Fixture offline"); });
  assert.equal(await f.store.artistSeenCount("Fixture Artist"), null);
  f.nextSeen(async () => ({ count: 2, last: "2026-10-01" }));
  assert.deepEqual(await f.store.artistSeenCount("Fixture Artist"), { count: 2, last: "2026-10-01" });
});

