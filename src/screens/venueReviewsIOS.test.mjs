import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
const require = createRequire(import.meta.url);
const React = require("react"), reconciler = require("react-reconciler");
const { transformSync } = require("@babel/core");
const codes = new Map(), noop = () => {};
function execute(path, imports, timers = { setTimeout, clearTimeout }) {
  const file = new URL(path, import.meta.url);
  if (!codes.has(path)) codes.set(path, transformSync(readFileSync(file, "utf8"), {
    filename: file.pathname, babelrc: false, configFile: false,
    plugins: [[require("@babel/plugin-transform-react-jsx"), { runtime: "automatic" }], require("@babel/plugin-transform-modules-commonjs")],
  }).code);
  const module = { exports: {} };
  new Function("require", "module", "exports", "setTimeout", "clearTimeout", codes.get(path))(
    name => imports(name, createRequire(file)), module, module.exports, timers.setTimeout, timers.clearTimeout);
  return module.exports;
}
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
    createInstance: (type, props) => ({ type, props, children: [], focus() {}, scrollToEnd() {} }), createTextInstance: text => ({ text }),
    appendInitialChild: append, appendChild: append, appendChildToContainer: append,
    removeChild: remove, removeChildFromContainer: remove, insertBefore: insert, insertInContainerBefore: insert,
    finalizeInitialChildren: () => false, shouldSetTextContent: () => false,
    commitUpdate: (node, type, oldProps, newProps) => { node.props = newProps; }, commitTextUpdate: (node, oldText, text) => { node.text = text; },
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
const nodes = node => [node, ...(node.children || []).flatMap(nodes)];
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };

const settle = () => new Promise(resolve => setImmediate(resolve));
const note = { id: "note", userId: "fixture", name: "Fixture fan", text: "Saved sound note", rating: 4 };
// Actual VenueScreen + platform hook + scoped refresh. All Store/network calls
// are synthetic; no real account, review writes, or native UI is opened.
function fixture({ platform = "ios", cached = [], strict = false } = {}) {
  const renderer = createRenderer(), reads = [];
  let account = "A", epoch = 1, privacy = 0, venue = "Fixture Hall", identity = "EXACT", cache = cached;
  const native = { View: "View", Text: "Text", Pressable: "Pressable", ScrollView: "ScrollView",
    Platform: { OS: platform, select: x => x[platform] || x.default }, StyleSheet: { create: x => x }, useWindowDimensions: () => ({ width: 390, fontScale: 1 }), Linking: {} };
  let hook, refresh;
  const imports = (name, local) => {
    if (name === "./CreatorPostsPanel") return "CreatorPostsSection";
    if (name === "../lib/lazyWithRetry") return { lazyWithRetry: (_read, label) => label };
    if (name === "react") return React;
    if (name === "react/jsx-runtime") return require(name);
    if (name === "react-native") return native;
    if (name === "../hooks/useIOSVenueReviews") return hook;
    if (name === "../hooks/useScopedRefresh") return refresh;
    if (name === "../features/venuePublic/usePublicVenueSnapshot") return () => ({
      resource: { scope: JSON.stringify([account, venue, identity]), status: "ready", data: null }, load: async () => null });
    if (name === "../components/useIOSTicketAction") return () => ({});
    if (name === "../components/concertDetailLayout") return { concertDetailStyles: x => x, concertDetailWide: () => false };
    if (name === "../components/VenueDiscoveryCards") return { UpcomingEventCard: "UpcomingEventCard" };
    if (name === "../components/WebProfileBlocks") return { VenueVisitorDetails: "VenueVisitorDetails" };
    if (name === "../theme") return { colors: {}, radius: {}, space: x => x * 4, shadow: {}, mono: "mono" };
    if (name === "../store") return { useStore: () => ({
      session: account ? { id: account } : null, chatAuthEpoch: epoch, venuePhotoPrivacyRevision: privacy,
      venueSummary: () => ({ nights: [], avgRoom: 0, totalShows: 0 }), venueReviewsFor: () => cache,
      venueRating: () => cache.length ? 4 : 0, venueTopPhotos: () => [], venuePhotos: () => [],
      venuePhotoState: () => ({ status: "ready" }), loadVenuePhotos: async () => [], userByHandle: () => null,
      loadVenueReviews: (name, options) => { const request = { ...deferred(), name, options }; reads.push(request); return request.promise; },
    }) };
    if (name.startsWith("../components/") || name === "../features/catalogEditor/CatalogText") return name.split("/").at(-1);
    return local(name);
  };
  hook = execute(`../hooks/useIOSVenueReviews${platform === "ios" ? ".ios" : ""}.js`, imports);
  refresh = execute("../hooks/useScopedRefresh.js", imports);
  const Screen = execute("./VenueScreen.jsx", imports).default;
  const render = () => renderer.render(strict ? React.createElement(React.StrictMode, null, React.createElement(Screen, { venueName: venue })) : React.createElement(Screen, { venueName: venue }));
  const all = () => nodes(renderer.container);
  const text = () => all().map(n => n.text || (["MentionText", "ExpandableText"].includes(n.type) ? n.props.text : "") || "").join(" ");
  const press = label => renderer.act(() => all().find(n => n.props?.accessibilityLabel === label).props.onPress());
  const flush = async () => { await settle(); render(); renderer.act(noop); };
  return { reads, render, text, all, press, flush,
    refresh: () => { let promise; renderer.act(() => { promise = all().find(n => n.type === "VinylRefreshBoundary").props.onRefresh(); }); return promise; },
    route: (name, id = identity) => { venue = name; identity = id; render(); },
    account: (id, nextEpoch = epoch + 1) => { account = id; epoch = nextEpoch; render(); },
    privacy: () => { privacy++; render(); },
    cache: notes => { cache = notes; render(); },
    resolve: async (i, result, notes) => { if (notes) cache = notes; reads[i].resolve(result); await flush(); },
    unmount: () => renderer.render(null),
  };
}
test("iOS cold failure is not an empty room; explicit accessible retry succeeds", async () => {
  const f = fixture(); f.render(); await f.flush();
  assert.match(f.text(), /Loading fan notes/); assert.doesNotMatch(f.text(), /Nobody has described|No written reviews yet|Write the first review/);
  await f.resolve(0, { ok: false, error: new Error("offline") });
  assert.match(f.text(), /Fan notes could not load/); assert.doesNotMatch(f.text(), /Nobody has described/);
  f.press("Reviews venue page section"); assert.match(f.text(), /Fan notes could not load/);
  const retry = f.all().find(n => n.props?.accessibilityLabel === "Retry loading fan notes");
  assert.equal(retry.props.accessibilityRole, "button");
  assert.ok(retry.props.style({ pressed: false })[0].minHeight >= 44);
  const retryAgain = retry.props.onPress; f.press("Retry loading fan notes"); retryAgain(); await f.flush();
  assert.equal(f.reads.length, 2);
  await f.resolve(1, { ok: true, reviews: [] }); assert.match(f.text(), /Nobody has described this room yet/); f.unmount();
});
test("cached notes survive failure and successful fresh cache/own submission remain visible", async () => {
  const f = fixture({ cached: [note] }); f.render(); await f.flush();
  assert.match(f.text(), /Saved sound note/);
  await f.resolve(0, { ok: false, error: new Error("offline") });
  assert.match(f.text(), /Showing saved notes/); assert.match(f.text(), /Saved sound note/);
  f.press("Retry loading fan notes"); await f.flush();
  const fresh = { ...note, text: "Fresh note" };
  await f.resolve(1, { ok: true, reviews: [fresh] }, [fresh]); assert.match(f.text(), /Fresh note/);
  f.cache([{ ...note, id: "own-note", text: "Own confirmed note" }, fresh]); assert.match(f.text(), /Own confirmed note/); f.unmount();
});
test("mount/retry/page refresh share the accepted read and explicit refresh later re-reads", async () => {
  const f = fixture(); f.render(); await f.flush(); const a = f.refresh(), b = f.refresh(); await f.flush();
  assert.equal(f.reads.length, 1); assert.equal(f.reads[0].options.signal.aborted, false);
  await f.resolve(0, { ok: true, reviews: [] }); await Promise.all([a,b]);
  const next = f.refresh(); await f.flush(); assert.equal(f.reads.length, 2);
  await f.resolve(1, { ok: false, error: new Error("offline") }); await next;
  assert.match(f.text(), /Fan notes could not load/); assert.doesNotMatch(f.text(), /Nobody has described/); f.unmount();
});
test("venue A-B-A, exact identity and account/epoch inversions reject stale error/empty results", async () => {
  const f = fixture(); f.render(); await f.flush();
  f.route("Other Hall"); await f.flush(); f.route("Fixture Hall"); await f.flush();
  await f.resolve(0, { ok: true, reviews: [] }); await f.resolve(1, { ok: false, error: "late" });
  assert.match(f.text(), /Loading fan notes/); assert.doesNotMatch(f.text(), /Nobody has described|Fan notes could not load/);
  f.route("Fixture Hall", "exact"); await f.flush();
  await f.resolve(2, { ok: true, reviews: [] }); assert.doesNotMatch(f.text(), /Nobody has described/);
  f.account("B"); await f.flush(); f.account("A"); await f.flush();
  await f.resolve(3, { ok: true, reviews: [] }); await f.resolve(4, { ok: false, error: "late" });
  assert.match(f.text(), /Loading fan notes/);
  f.account("A"); await f.flush(); await f.resolve(5, { ok: true, reviews: [] });
  assert.doesNotMatch(f.text(), /Nobody has described/);
  await f.resolve(6, { ok: true, reviews: [] }); assert.match(f.text(), /Nobody has described/);
  assert.ok(f.reads.slice(0,6).every(r => r.options.signal.aborted)); f.unmount();
});
test("ambiguous Store results are recoverable, not evidence of empty; thrown loads recover", async () => {
  for (const result of [null, {}, { ok: true }, { ok: false, stale: true }, { ok: false, aborted: true }]) {
    const f = fixture(); f.render(); await f.flush(); await f.resolve(0, result);
    assert.match(f.text(), /Fan notes could not load/); assert.doesNotMatch(f.text(), /Nobody has described/); f.unmount();
  }
  const f = fixture(); f.render(); await f.flush(); f.reads[0].reject(new Error("synthetic")); await f.flush();
  assert.match(f.text(), /Fan notes could not load/); f.unmount();
});
test("unmount and StrictMode reconnect abort old visit requests without stale adoption", async () => {
  const f = fixture({ strict: true }); f.render(); await f.flush(); assert.equal(f.reads.length, 1);
  f.unmount(); assert.equal(f.reads[0].options.signal.aborted, true);
  f.render(); await f.flush(); await f.resolve(0, { ok: true, reviews: [] });
  assert.match(f.text(), /Loading fan notes/); await f.resolve(1, { ok: true, reviews: [] }); f.unmount();
});
for (const platform of ["android", "web"]) test(`${platform} preserves original read and empty-copy path`, async () => {
  const f = fixture({ platform }); f.render(); await f.flush(); assert.equal(f.reads.length, 1);
  await f.resolve(0, { ok: false, error: "offline" });
  assert.match(f.text(), /Nobody has described/); assert.doesNotMatch(f.text(), /Fan notes could not load/); f.unmount();
});

test("privacy revision retries with current Store filtering; guest never starts a review read", async () => {
  const f = fixture(); f.render(); await f.flush(); f.privacy(); await f.flush();
  assert.equal(f.reads.length, 2); assert.equal(f.reads[0].options.signal.aborted, true);
  await f.resolve(0, { ok: true, reviews: [] }); assert.doesNotMatch(f.text(), /Nobody has described/);
  await f.resolve(1, { ok: true, reviews: [] }); assert.match(f.text(), /Nobody has described/);
  f.account(null); await f.flush(); assert.equal(f.reads.length, 2); f.unmount();
});

test("a retained retry callback cannot read for a replaced account or venue", async () => {
  const f = fixture(); f.render(); await f.flush(); await f.resolve(0, { ok: false, error: "offline" });
  const retry = f.all().find(n => n.props?.accessibilityLabel === "Retry loading fan notes").props.onPress;
  f.route("Other Hall"); await f.flush(); retry(); await f.flush(); assert.equal(f.reads.length, 2);
  f.account("B"); await f.flush(); retry(); await f.flush(); assert.equal(f.reads.length, 3);
  await f.resolve(1, { ok: false, error: "late" }); assert.doesNotMatch(f.text(), /Fan notes could not load/);
  f.unmount(); assert.equal(f.reads[2].options.signal.aborted, true);
});
