import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL("../../", import.meta.url));
const require = createRequire(new URL("../../package.json", import.meta.url));
const React = require("react"), reconciler = require("react-reconciler");
const { transformSync } = require("@babel/core");
const noop = () => {};
const codes = new Map();
function execute(file, imports) {
  const absolute = path.join(root, file);
  if (!codes.has(file)) codes.set(file, transformSync(readFileSync(absolute, "utf8"), {
    filename: absolute, babelrc: false, configFile: false,
    plugins: [[require("@babel/plugin-transform-react-jsx"), { runtime: "automatic" }], require("@babel/plugin-transform-modules-commonjs")],
  }).code);
  const module = { exports: {} };
  new Function("require", "module", "exports", codes.get(file))(
    name => imports(name, createRequire(absolute)), module, module.exports);
  return module.exports;
}
function createRenderer(nativeActions = []) {
  const context = {}, container = { children: [] };
  let priority = 0;
  const append = (parent, child) => parent.children.push(child);
  const remove = (parent, child) => { const index = parent.children.indexOf(child); if (index >= 0) parent.children.splice(index, 1); };
  const insert = (parent, child, before) => parent.children.splice(parent.children.indexOf(before), 0, child);
  const renderer = reconciler({
    supportsMutation: true, isPrimaryRenderer: true, supportsPersistence: false, supportsHydration: false,
    getRootHostContext: () => context, getChildHostContext: () => context, getPublicInstance: node => node,
    prepareForCommit: () => null, resetAfterCommit: noop,
    createInstance: (type, props) => ({ type, props, children: [], focus: () => nativeActions.push("focus"), blur: () => nativeActions.push("blur"), scrollTo: () => nativeActions.push("scroll") }), createTextInstance: text => ({ text }),
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

const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const walk = n => [n, ...(n.children || []).flatMap(walk)];
async function fixture({ platform = "ios", reader = true, restored = false, unknown = false, strict = false } = {}) {
  const nativeActions = [];
  const renderer = createRenderer(nativeActions), said = [], calls = [], jobs = [], appListeners = new Set(), readerListeners = new Set();
  const retiredApp = [], retiredReader = [], initialReader = deferred();
  let readCount = 0, hidden = false;
  const originalSet = globalThis.setTimeout, originalClear = globalThis.clearTimeout;
  globalThis.setTimeout = (run, delay, ...args) => {
    if (delay !== 250 && delay !== 450) return originalSet(run, delay, ...args);
    const job = { run, delay, cancelled: false }; jobs.push(job); return job;
  };
  globalThis.clearTimeout = job => { if (jobs.includes(job)) job.cancelled = true; else originalClear(job); };
  const AppState = { currentState: "active", addEventListener: (name, fn) => { appListeners.add(fn); retiredApp.push(fn); return { remove: () => appListeners.delete(fn) }; } };
  const AccessibilityInfo = {
    announceForAccessibilityWithOptions: (...args) => said.push(args),
    isScreenReaderEnabled: () => { readCount++; return unknown ? initialReader.promise : Promise.resolve(reader); },
    addEventListener: (name, fn) => { readerListeners.add(fn); retiredReader.push(fn); return { remove: () => readerListeners.delete(fn) }; },
  };
  const native = { ActivityIndicator: "ActivityIndicator", View: "View", Text: "Text", ScrollView: "ScrollView", TextInput: "TextInput", Pressable: "Pressable", Image: "Image", Platform: { OS: platform, select: x => x[platform] || x.default }, useWindowDimensions: () => ({ width: 393, height: 852, fontScale: 1 }), StyleSheet: { create: x => x }, AccessibilityInfo, AppState };
  const store = { session: { id: "synthetic" }, chatAuthEpoch: 1, blockedIds: [], tourDates: [], artistsAlphabetical: () => [], searchVenues: () => [], fanClubsDirectory: () => [], fanClubDirectoryStatus: "ready", loadFanClubsDirectory: () => Promise.resolve({ ok: true }), track: noop, isFollowing: () => false, follow: noop, unfollow: noop, searchPeople: () => Promise.resolve([]), searchArtistsApi: (query) => { if (!query) return Promise.resolve([]); const d = deferred(); calls.push({ query, ...d }); return d.promise; }, resolveArtist: () => Promise.resolve(null), recentSearches: [], addRecentSearch: noop, removeRecentSearch: noop, clearRecentSearches: noop, searchSongsApi: () => Promise.resolve([]) };
  let speech, preference;
  const imports = (name, local) => {
    if (name.endsWith('/NativeTabScroll')) return native;
    if (name.endsWith('/NativeTabSwipeExclusion')) return { __esModule: true, default: p => p.children };
    if (name === "react-native") return native;
    if (name.endsWith("/useIOSSearchAnnouncement")) return speech;
    if (name.endsWith("/useScreenReaderEnabled")) return preference;
    if (name.endsWith("/store")) return { useStore: () => store };
    if (name.endsWith("/theme")) return { colors: new Proxy({}, { get: () => "black" }), focusRing: {}, mono: "mono", radius: {}, roleColor: () => null };
    if (name.endsWith("/data")) return { ratedShows: [] };
    if (name.endsWith("/seed/ingested")) return { ingestedArtists: {} };
    if (name.endsWith("/config/runtime.mjs")) return { ENABLE_DEMO_DATA: false, ENABLE_MUSIC_PLAYER: false };
    if (name.endsWith("/ticketLinks")) return { openTicketLink: () => assert.fail("No external link") };
    if (name.endsWith("/guestSearchAnalyticsApi.mjs")) return { recordGuestSearch: () => assert.fail("No guest analytics") };
    if (name.endsWith("/artistSearchApi.mjs")) return { artistLookupFailureMessage: () => "Lookup unavailable" };
    if (name.includes("/components/") && !name.endsWith(".mjs") || name.endsWith("/CityDiscoveryTiles")) return { __esModule: true, default: p => React.createElement(name, p, p.children) };
    return local(name);
  };
  if (platform === "ios") preference = execute("src/hooks/useScreenReaderEnabled.ios.js", imports);
  speech = execute(`src/hooks/useIOSSearchAnnouncement${platform === "ios" ? ".ios" : ""}.js`, imports);
  const Search = execute("src/screens/SearchScreen.jsx", imports).default;
  const props = { browseReturn: restored ? { read: () => ({ query: "sza", category: "all" }), save: noop } : undefined };
  const never = new Promise(noop);
  function Gate() { if (hidden) throw never; return React.createElement(Search, props); }
  const render = () => renderer.render(React.createElement(strict ? React.StrictMode : React.Fragment, null, React.createElement(React.Suspense, { fallback: React.createElement("Loading") }, React.createElement(Gate))));
  const settle = async () => { for (let i = 0; i < 30; i++) { await Promise.resolve(); renderer.act(noop); } render(); };
  const fire = (delay, cancelled = false) => renderer.act(() => { for (const job of jobs.splice(0).filter(j => { if (j.delay !== delay) { jobs.push(j); return false; } return true; })) if (cancelled || !job.cancelled) job.run(); });
  const input = () => walk(renderer.container).find(n => n.type === "TextInput").props.onChangeText;
  const text = value => renderer.act(() => input()(value));
  const press = label => renderer.act(() => { const node = walk(renderer.container).find(n => n.props?.accessibilityLabel === label); assert.ok(node, label); node.props.onPress(); });
  render(); await settle();
  return { said, calls, jobs, text, input, press, fire, settle, store, render, retiredApp, retiredReader, initialReader, nativeActions,
    handler: label => walk(renderer.container).find(n => n.props?.accessibilityLabel === label)?.props.onPress,
    value: () => walk(renderer.container).find(n => n.type === "TextInput").props.value,
    readerReads: () => readCount, subscriptions: () => appListeners.size + readerListeners.size,
    app: value => { AppState.currentState = value; for (const fn of appListeners) fn(value); },
    reader: value => { reader = value; for (const fn of readerListeners) fn(value); },
    hide: value => { hidden = value; render(); },
    unmount: () => renderer.render(null),
    close: () => { renderer.render(null); globalThis.setTimeout = originalSet; globalThis.clearTimeout = originalClear; },
  };
}
async function search(f, value = "sza") { f.text(value); f.fire(250); await f.settle(); }
async function result(f, rows = [], error = false) { const call = f.calls.at(-1); assert.ok(call); if (error) call.reject(new Error("Synthetic failure")); else call.resolve(rows); await f.settle(); }
const artist = [{ name: "SZA", id: "synthetic-artist" }];
for (const mode of ["all", "category", "none", "error", "retry", "category-none", "category-error", "category-retry"]) test(`actual Search ${mode} settles through unified search and speaks once`, async () => {
  const f = await fixture();
  try {
    await search(f);
    if (mode.startsWith("category")) f.press("Artists");
    await result(f, ["all", "category"].includes(mode) ? artist : [], mode.endsWith("error") || mode.endsWith("retry"));
    f.fire(450); assert.equal(f.said.length, 1); assert.deepEqual(f.said[0][1], { queue: true });
    if (["all", "category"].includes(mode)) assert.equal(f.said[0][0], "1 result across 1 category for sza.");
    f.render(); f.fire(450); assert.equal(f.said.length, 1);
    if (mode.endsWith("retry")) { f.press("Retry search"); await f.settle(); await result(f, artist); f.fire(450); assert.equal(f.said.length, 2); }
  } finally { f.close(); }
});
for (const phase of ["flight", "queued"]) for (const boundary of ["background", "inactive", "reader", "clear", "query", "unmount", "account", "epoch", "suspense"]) test(`actual Search ${phase} ${boundary} permanently revokes speech`, async () => {
  const f = await fixture();
  try {
    await search(f); if (phase === "queued") await result(f);
    if (["background", "inactive"].includes(boundary)) { f.app(boundary); f.app("active"); }
    if (boundary === "reader") { f.reader(false); f.reader(true); }
    if (boundary === "clear") f.text("");
    if (boundary === "query") f.text("mitski");
    if (boundary === "unmount") f.unmount();
    if (boundary === "account") { f.store.session = { id: "other" }; f.render(); f.store.session = { id: "synthetic" }; f.render(); }
    if (boundary === "epoch") { f.store.chatAuthEpoch = 2; f.render(); f.store.chatAuthEpoch = 1; f.render(); }
    if (boundary === "suspense") { f.hide(true); f.hide(false); }
    if (phase === "flight") await result(f);
    f.fire(450, true); assert.equal(f.said.length, 0);
  } finally { f.close(); }
});
for (const mode of ["off", "unknown", "restored", "android", "web"]) test(`actual Search ${mode} cannot acquire announcement intent`, async () => {
  const f = await fixture({ reader: mode !== "off", unknown: mode === "unknown", restored: mode === "restored", platform: ["android", "web"].includes(mode) ? mode : "ios" });
  try {
    if (mode !== "restored") await search(f);
    if (mode === "unknown") { f.reader(true); f.initialReader.resolve(false); }
    if (mode === "off") f.reader(true);
    await result(f, artist); f.fire(450, true); assert.equal(f.said.length, 0);
    if (["android", "web"].includes(mode)) { assert.equal(f.readerReads(), 0); assert.equal(f.subscriptions(), 0); }
  } finally { f.close(); }
});
test("actual Search StrictMode and Suspense reject retired controls, timers and subscriptions", async () => {
  const f = await fixture({ strict: true });
  try {
    const oldInput = f.input(); await search(f); await result(f); const oldTimer = f.jobs.find(j => j.delay === 450);
    const oldApp = f.retiredApp.at(-1), oldReader = f.retiredReader.at(-1);
    f.hide(true); f.hide(false); await f.settle();
    await search(f, "mitski"); await result(f);
    // Retired handlers cannot change the current presentation or revoke its intent.
    oldInput("sza"); oldApp("background"); oldReader(false); oldTimer.run();
    f.fire(450, true); assert.equal(f.value(), "mitski"); assert.equal(f.said.length, 1); assert.match(f.said[0][0], /mitski/);
  } finally { f.close(); }
});
for (const unknown of [false, true]) test(`live ${unknown ? "unknown" : "off"} reader preserves query, clear and Retry data actions`, async () => {
  const f = await fixture({ reader: false, unknown });
  try {
    await search(f); assert.equal(f.value(), "sza"); await result(f, [], true);
    const before = f.calls.length; f.press("Retry search"); await f.settle();
    assert.equal(f.calls.length, before + 1); await result(f, artist); f.fire(450, true);
    assert.equal(f.said.length, 0); f.press("Clear search"); assert.equal(f.value(), "");
  } finally { f.close(); }
});
test("normalized-equivalent edits do not create an extra request or speech", async () => {
  const f = await fixture();
  try {
    await search(f); await result(f, artist); f.fire(450); const before = f.calls.length;
    f.text(" SZA "); f.fire(250); await f.settle(); f.fire(450);
    assert.equal(f.calls.length, before); assert.equal(f.said.length, 1); assert.equal(f.value(), " SZA ");
  } finally { f.close(); }
});
test("retired Retry, Clear and Cancel cannot alter a new presentation or create reads", async () => {
  const f = await fixture();
  try {
    await search(f); await result(f, [], true);
    const retired = ["Retry search", "Clear search", "Cancel search"].map(f.handler);
    assert.ok(retired.every(Boolean));
    f.hide(true); f.hide(false); await f.settle();
    await search(f, "mitski"); await result(f);
    const requests = f.calls.length, effects = f.nativeActions.length;
    for (const handler of retired) handler();
    await f.settle(); f.fire(450, true);
    assert.equal(f.value(), "mitski"); assert.equal(f.calls.length, requests); assert.equal(f.nativeActions.length, effects);
    assert.equal(f.said.length, 1); assert.match(f.said[0][0], /mitski/);
  } finally { f.close(); }
});
test("current action after an interruption may speak, without replaying its predecessor", async () => {
  const f = await fixture();
  try {
    await search(f); await result(f, [], true);
    f.app("background"); f.app("active"); f.reader(false); f.reader(true);
    f.fire(450, true); assert.equal(f.said.length, 0);
    f.press("Retry search"); await f.settle(); await result(f, artist); f.fire(450, true);
    assert.equal(f.said.length, 1); assert.equal(f.said[0][0], "1 result across 1 category for sza.");
  } finally { f.close(); }
});
