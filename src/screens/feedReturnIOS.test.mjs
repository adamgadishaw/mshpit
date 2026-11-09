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

const { parse } = require("@babel/parser");
const { createIOSFeedReturnStore } = require("./src/domain/iosFeedReturn.mjs");
const { retainNativeFeedForMedia: retainLegacyMedia } = require("./src/domain/nativeFeedMediaRetention.mjs");
const { retainNativeFeedForMedia: retainIOSMedia } = require("./src/domain/nativeFeedRetention.ios.js");
const walk = node => [node, ...(node.children || []).flatMap(walk)];
function find(n, predicate) {
  if (!n || typeof n !== "object") return [];
  return [...(predicate(n) ? [n] : []), ...Object.values(n).flatMap(v => Array.isArray(v) ? v.flatMap(x => find(x, predicate)) : find(v, predicate))];
}
// Execute the exact Root retention conditional, not a replacement navigation model.
const app = readFileSync(path.join(root, "App.js"), "utf8");
const ast = parse(app, { sourceType: "module", plugins: ["jsx"] });
const branch = find(ast, n => n.type === "ConditionalExpression" && find(n.test, node => node.type === "Identifier" && node.name === "retainNativeFeed").length > 0 && n.consequent?.openingElement?.name?.name === "NativeFeedMediaLayer")[0];
assert.ok(branch);
assert.match(app.slice(branch.consequent.start, branch.consequent.end), /performanceKey=\{Platform.OS === "ios" \? screenKey : "main:feed"\}/);
assert.match(app.slice(branch.test.start, branch.test.end), /retainNativeFeed \|\| \(Platform.OS === "ios" && !overlay\)/);
const names = "stack,chatAuthEpoch,openSignIn,retainNativeFeed,session,overlay,NativeFeedMediaLayer,NativeAppHeader,activeTab,switchTab,Platform,iosTabSwipeScope,iosTabSwipeEnabled,isCurrentIOSTabSwipe,openMainMenu,iosMenuOpener,requireVerifiedMutation,go,openProfileManagement,mobileTabBar,Suspense,ScreenLoading,ScreenTransition,screenKey,screenDirection,IosDetailNavigation,iosBackGestureAllowed,nav,linkedNavigationScope,linkedNavigationRef,navigationRef,back,tabScreens";
const module = { exports: {} };
const code = transformSync(`export default function RootSlice(p) { const {${names}} = p; const nativeTabPage = tabScreens; return (${app.slice(branch.start, branch.end)}); }`, {
  babelrc: false, configFile: false, plugins: [[require("@babel/plugin-transform-react-jsx"), { runtime: "automatic" }], require("@babel/plugin-transform-modules-commonjs")],
}).code;
new Function("require", "module", "exports", code)(require, module, module.exports);
const RootSlice = module.exports.default;
let serial = 0;
function fixture(platform = "ios", options = {}) {
  const renderer = createRenderer(), persisted = new Map(), owner = createIOSFeedReturnStore();
  let account = "A", epoch = 1, tab = "feed", frames = [{}], admitted = true, presentation = null, width = 393, fontScale = 1;
  const readiness = [], followingReads = [];
  let primary = { head: null, following: { posts: [], status: "ready", loaded: true }, news: { stories: [], status: "ready" }, ...options };
  if (options.filter) persisted.set(require("./src/domain/feedExperience.mjs").feedFilterStorageKey("A"), options.filter);
  let rows = options.rows || Array.from({ length: 80 }, (_, index) => ({ id: "post" + index, userId: "synthetic" }));
  let heights = null;
  const rowY = index => 400 + Array.from({ length: index }, (_, i) => heights?.[i] ?? 300).reduce((a, b) => a + b, 0);
  let hook, highest = 2, mountedId, measurements = [], scrolls = [], attempts = [], pendingBatch = false, currentOffset = 0;
  // Models the native list's unmeasured-tail clamp. Each manually flushed batch
  // renders only the existing maxToRenderPerBatch=2, never the requested target.
  const FlatList = props => {
    const instance = React.useRef(++serial).current;
    mountedId = instance;
    React.useImperativeHandle(props.ref, () => ({
      scrollToIndex({ index }) {
        attempts.push(index);
        if (index > highest) props.onScrollToIndexFailed?.({ index, highestMeasuredFrameIndex: highest, averageItemLength: (rowY(highest + 1) - 400) / (highest + 1) });
        else scrolls.push({ index, offset: rowY(index), exact: true });
      },
      scrollToOffset({ offset }) {
        const ceiling = rowY(highest + 1);
        currentOffset = Math.min(offset, ceiling);
        scrolls.push({ offset: currentOffset, requested: offset, exact: offset <= ceiling });
        if (offset >= ceiling - 300 && highest < props.data.length - 1) pendingBatch = true;
      },
    }));
    return React.createElement("FlatList", { ...props, instance }, props.ListHeaderComponent, props.ListFooterComponent,
      ...props.data.slice(0, highest + 1).map((item, index) => props.CellRendererComponent
        ? React.createElement(props.CellRendererComponent, { key: props.keyExtractor(item), cellKey: props.keyExtractor(item), index, item, onFocusCapture: noop, style: { flexDirection: "column" }, onLayout: () => measurements.push(index) }, React.createElement("Row")) : null));
  };
  const native = { View: "View", Text: "Text", FlatList, Pressable: "Pressable", ScrollView: "ScrollView", Platform: { OS: platform, select: v => v[platform] || v.default }, StyleSheet: { create: v => v, absoluteFill: {} }, useWindowDimensions: () => ({ width, height: 852, fontScale }) };
  const imports = (name, local) => {
    if (name.endsWith('/NativeTabScroll')) return native;
    if (name.endsWith('/NativeTabSwipeExclusion')) return { __esModule: true, default: p => p.children };
    if (name === "react" || name === "react/jsx-runtime") return require(name);
    if (name === "react-native") return native;
    if (name.endsWith("/useIOSFeedReturn")) return hook;
    if (name.endsWith("/useFeedPresentation")) return execute("src/hooks/useFeedPresentation" + (platform === "ios" ? ".ios" : "") + ".js", imports);
    if (name.endsWith("/feedHeadStatus")) return { useFeedHeadStatus: () => primary.head };
    if (name.endsWith("/useNativeTabPreview")) return { __esModule: true, default: () => !!primary.preview };
    if (name.endsWith("/useNativeTabContentReady")) return { __esModule: true, default: ready => { readiness.push(ready); } };
    if (name.endsWith("/feedImageRetry")) return { useFeedImageRetry: () => ({ value: null, isCurrent: () => true, accept: noop }), FeedImageRetryProvider: p => p.children };
    if (name.endsWith("/theme")) return { colors: {}, radius: {}, shadow: {}, space: v => v * 4 };
    if (name.endsWith("/persist")) return { load: (key, value) => persisted.get(key) ?? value, save: (key, value) => persisted.set(key, value) };
    if (name.endsWith("/useAppActive")) return { __esModule: true, default: () => true };
    if (name.endsWith("/useFollowingFeed")) return { __esModule: true, default: args => { followingReads.push(args); return primary.following; } };
    if (name.endsWith("/useNewsDeskStories")) return { __esModule: true, default: () => primary.news };
    if (name.endsWith("/useNewsIntroduction")) return { __esModule: true, default: () => ({ post: null, dismiss: noop }) };
    if (name.endsWith("/NewsInteractionContext")) return { useNewsInteractions: () => ({}) };
    if (name.endsWith("/lazyWithRetry")) return { lazyWithRetry: () => "Lazy" };
    if (name.endsWith(".mjs")) return local(name);
    if (name.startsWith("../components/")) return { __esModule: true, default: name.split("/").at(-1) };
    return local(name);
  };
  hook = execute("src/hooks/useIOSFeedReturn" + (platform === "ios" ? ".ios" : "") + ".js", imports);
  const Feed = execute("src/screens/FeedScreen.jsx", imports).default;
  const Layer = execute("src/components/NativeFeedMediaLayer.jsx", imports).default;
  const all = () => walk(renderer.container), list = () => all().find(n => n.type === "FlatList");
  const pass = p => p.children;
  const render = () => {
    const lease = platform === "ios" ? owner.reconcile(account, epoch, tab === "feed" ? frames[0] : null) : null;
    if (presentation?.frames !== frames || presentation?.account !== account || presentation?.epoch !== epoch || presentation?.tab !== tab) {
      const currentFrames = frames, currentAccount = account, currentEpoch = epoch, currentTab = tab;
      presentation = { frames, account, epoch, tab, current: () => admitted && frames === currentFrames && account === currentAccount && epoch === currentEpoch && tab === currentTab && frames.length === 1 };
    }
    const overlay = frames.length > 1 ? React.createElement("Detail") : null;
    const retain = (platform === "ios" ? retainIOSMedia : retainLegacyMedia)({ platform, accountId: account, tab, frames, hasOverlay: !!overlay });
    renderer.render(React.createElement(RootSlice, { stack: frames, chatAuthEpoch: epoch, openSignIn: noop, retainNativeFeed: retain, session: { id: account }, overlay, NativeFeedMediaLayer: Layer, NativeAppHeader: "Header", activeTab: tab, switchTab: noop, Platform: native.Platform, iosTabSwipeEnabled: false, isCurrentIOSTabSwipe: () => true, openMainMenu: noop, requireVerifiedMutation: noop, go: noop, openProfileManagement: noop, mobileTabBar: React.createElement("Tabs"), Suspense: React.Suspense, ScreenLoading: "Loading", ScreenTransition: pass, screenKey: overlay ? "detail" : "main:feed", screenDirection: "forward", IosDetailNavigation: pass, iosBackGestureAllowed: () => false, nav: frames.at(-1), linkedNavigationScope: {}, linkedNavigationRef: { current: { ownsScope: () => true } }, navigationRef: { current: { stack: frames } }, back: noop,
      tabScreens: tab === "feed" ? React.createElement("View", null, React.createElement(Feed, { key: lease?.key, feedReturn: lease, feedPresentation: presentation, feed: rows, localFeed: rows, loggedIn: true, accountId: account, visible: !overlay && !primary.preview, hasMore: false, onRefresh: async () => true, onLoadMore: () => assert.fail("No service reads") })) : React.createElement("OtherTab") }));
  };
  const press = label => { const node = all().find(n => n.props?.accessibilityLabel === label); assert.ok(node, label); renderer.act(() => node.props.onPress()); };
  const measure = () => {
    const cells = all().filter(n => n.type === "View" && n.props?.onLayout && n.children?.[0]?.type === "Row");
    renderer.act(() => cells.forEach((node, index) => node.props.onLayout({ nativeEvent: { layout: { y: rowY(index), height: heights?.[index] ?? 300 } } })));
  };
  render();
  return { all, list, press, render, measure, scrolls, attempts, measurements, readiness, followingReads,
    primary(patch) { primary = { ...primary, ...patch }; render(); },
    get instance() { return mountedId; },
    get snapshot() { return owner.reconcile(account, epoch, tab === "feed" ? frames[0] : null)?.read("local"); },
    freshBase() { frames = [{}]; render(); },
    act: renderer.act,
    heights(value) { heights = value; },
    rowY,
    precommitDepart() { admitted = false; },
    reveal() { press("Local feed"); press("Show more posts"); press("Show more posts"); },
    capture(index = 20, offset = 40) { highest = list().props.data.length - 1; render(); measure(); renderer.act(() => list().props.onScroll({ nativeEvent: { contentOffset: { y: rowY(index) + offset } } })); },
    layout() { measure(); renderer.act(() => list().props.onContentSizeChange?.(393, 8000)); },
    batches() { for (let batch = 0; batch < 15 && pendingBatch; batch++) { pendingBatch = false; highest = Math.min(highest + 2, list().props.data.length - 1); render(); measure();
      if (rowY(highest + 1) < currentOffset + 852 * 2 && highest < list().props.data.length - 1) pendingBatch = true;
    } },
    depart(frame = { reporting: { id: "post20" } }) { frames = [frames[0], frame]; render(); },
    back() { frames = [frames[0]]; highest = 2; render(); },
    scope(id, value = epoch) { account = id; epoch = value; render(); },
    tab(value) { tab = value; render(); },
    rows(value) { rows = value; render(); },
    geometry(value, scale = fontScale) { width = value; fontScale = scale; render(); },
    close() { renderer.render(null); },
  };
}
for (const [kind, frame] of [["Post", { post: { id: "p" } }], ["Profile", { profileId: "other" }], ["Show", { openLog: { id: "show" } }]]) {
  test(`actual Root/Feed ${kind} return retains the exact list and 24 cached Local rows`, () => {
    const f = fixture(); f.reveal(); f.capture(); const instance = f.instance;
    f.depart(frame); assert.ok(f.list()); assert.equal(f.instance, instance); f.back();
    assert.equal(f.instance, instance); assert.equal(f.list().props.data.length, 24);
    assert.equal(f.list().props.initialNumToRender, 3); assert.equal(f.list().props.maxToRenderPerBatch, 2); assert.equal(f.list().props.updateCellsBatchingPeriod, 75);
    f.layout(); f.batches();
    assert.equal(f.attempts.length, 0); assert.equal(f.scrolls.length, 0); assert.ok(f.measurements.length > 0); f.close();
  });
}
test("direct gallery retains exact list instance and cached rows", () => {
  const f = fixture(); f.reveal(); const instance = f.instance;
  f.depart({ photos: { images: [{ uri: "synthetic.jpg" }] } }); assert.equal(f.instance, instance);
  f.back(); assert.equal(f.instance, instance); assert.equal(f.list().props.data.length, 24); f.close();
});
for (const boundary of ["account", "epoch", "tab"]) test(`${boundary} revokes saved count and stale callbacks`, () => {
  const f = fixture(); f.reveal(); f.capture(); const old = f.list().props;
  if (boundary === "account") { f.scope("B"); f.scope("A"); }
  else if (boundary === "epoch") { f.scope("A", 2); f.scope("A", 1); }
  else { f.tab("search"); f.tab("feed"); }
  old.onScroll({ nativeEvent: { contentOffset: { y: 6440 } } }); old.onContentSizeChange();
  assert.equal(f.list().props.data.length, 8); assert.equal(f.attempts.length, 0); f.close();
});
for (const intent of ["drag", "filter", "refresh"]) test(`${intent} cancels pending restoration and captured native callbacks`, () => {
  const f = fixture(); f.reveal(); f.capture(); f.depart(); f.back(); const old = f.list().props;
  if (intent === "drag") old.onScrollBeginDrag();
  else if (intent === "filter") f.press("For You feed");
  else f.all().find(n => n.props?.testID === "feed-refresh").props.onRefresh();
  old.onContentSizeChange(); old.onScrollToIndexFailed({ index: 20, averageItemLength: 300 });
  old.onScroll({ nativeEvent: { contentOffset: { y: 6440 } } });
  assert.equal(f.attempts.length, 0); assert.equal(f.scrolls.length, 0); f.close();
});
test("changed or missing anchor does not jump to old rows", () => {
  const f = fixture(); f.reveal(); f.capture(); f.depart();
  f.rows(Array.from({ length: 32 }, (_, i) => ({ id: "replacement" + i })));
  f.back(); f.layout(); assert.equal(f.attempts.length, 0); f.close();
});
for (const platform of ["android", "web"]) test(`${platform} preserves the legacy unmount count and has no return handlers`, () => {
  const f = fixture(platform); f.reveal(); f.depart(); f.back();
  assert.equal(f.list().props.data.length, 8); assert.equal(f.list().props.onScroll, undefined); assert.equal(f.list().props.CellRendererComponent, undefined); f.close();
});

test("For You cached return has the same bounded continuity", () => {
  const f = fixture(); f.press("Show more posts"); f.press("Show more posts"); f.capture();
  f.depart(); f.back(); assert.equal(f.list().props.data.length, 24); f.layout(); f.batches();
  assert.equal(f.scrolls.at(-1)?.requested, 6440); f.close();
});
test("replacement Feed base frame clears saved state even under the same account and tab", () => {
  const f = fixture(); f.reveal(); f.capture(); f.freshBase();
  assert.equal(f.list().props.data.length, 8); f.layout(); assert.equal(f.attempts.length, 0); f.close();
});
test("new geometry or changed order before layout cancels pending anchor", () => {
  for (const boundary of ["width", "order"]) {
    const f = fixture(); f.reveal(); f.capture(); f.depart(); f.back(); const old = f.list().props;
    if (boundary === "width") f.geometry(700);
    else f.rows(Array.from({ length: 80 }, (_, i) => ({ id: "post" + (79 - i), userId: "synthetic" })));
    old.onContentSizeChange(); f.layout(); assert.equal(f.attempts.length, 0); f.close();
  }
});
test("drag after coarse seek retires queued layout/scroll callbacks and never snaps again", () => {
  const f = fixture(); f.reveal(); f.capture(); f.depart(); f.back(); f.layout();
  const old = f.list().props, before = f.attempts.length;
  const oldLayouts = f.all().filter(n => n.type === "View" && n.props.onLayout).map(n => n.props.onLayout);
  f.act(() => old.onScrollBeginDrag());
  oldLayouts.forEach(onLayout => onLayout({ nativeEvent: { layout: { y: 6400, height: 300 } } }));
  old.onContentSizeChange(); old.onScroll({ nativeEvent: { contentOffset: { y: 6440 } } });
  f.batches(); assert.equal(f.attempts.length, before); assert.equal(f.snapshot?.anchor ?? null, null); f.close();
});
test("exhaustion never records provisional coarse position or schedules an unbounded retry", () => {
  const f = fixture(); f.reveal(); for (let i = 0; i < 5; i++) f.press("Show more posts");
  assert.equal(f.list().props.data.length, 64); f.capture(60); f.depart(); f.back(); f.layout(); f.batches();
  assert.equal(f.attempts.length, 6); const before = f.scrolls.length;
  f.list().props.onScroll({ nativeEvent: { contentOffset: { y: 1000 } } });
  f.layout(); f.batches(); assert.equal(f.scrolls.length, before); assert.equal(f.snapshot.anchor, "post60"); f.close();
});
test("Following and News have no return seek or synthetic pagination", () => {
  for (const label of ["Following feed", "News feed"]) {
    const f = fixture(); f.press(label); f.depart(); f.back();
    assert.equal(f.list().props.onScroll, undefined); assert.equal(f.list().props.CellRendererComponent, undefined); f.close();
  }
});
test("Root store accepts only bounded UI fields and revokes old leases", () => {
  const store = createIOSFeedReturnStore(), frame = {};
  const old = store.reconcile("A", 1, frame);
  old.save({ filter: "local", count: 24, order: "[]", anchor: "p", offset: 20, width: 393, fontScale: 1, posts: [{ id: "secret" }] });
  assert.equal("posts" in old.read("local"), false);
  store.reconcile("B", 1, frame); const fresh = store.reconcile("A", 1, frame);
  old.save({ filter: "local", count: 24, order: "[]" }); assert.equal(fresh.read("local"), null);
  fresh.save({ filter: "local", count: 72, order: "[]" }); assert.equal(fresh.read("local"), null);
});

test("precommit departure rejects native callbacks without revoking the return snapshot", () => {
  const f = fixture(); f.reveal(); f.capture(); const old = f.list().props, snapshot = f.snapshot;
  f.precommitDepart(); old.onScroll({ nativeEvent: { contentOffset: { y: 0 } } }); old.onScrollBeginDrag();
  assert.deepEqual(f.snapshot, snapshot); assert.equal(f.attempts.length, 0); f.close();
});
test("gallery presentation does not revive a captured old Feed callback on return", () => {
  const f = fixture(); f.reveal(); f.capture(); const old = f.list().props, snapshot = f.snapshot;
  f.depart({ photos: { images: [] } }); f.back();
  old.onScroll({ nativeEvent: { contentOffset: { y: 0 } } }); old.onScrollBeginDrag();
  assert.deepEqual(f.snapshot, snapshot); f.close();
});
for (const lifecycle of ["StrictMode", "Suspense"]) test(`${lifecycle} retires callbacks across layout-effect teardown/setup`, () => {
  const renderer = createRenderer(), store = createIOSFeedReturnStore(), lease = store.reconcile("A", 1, {});
  const hook = execute("src/hooks/useIOSFeedReturn.ios.js", (name, local) => name === "react-native" ? { View: "View" } : local(name)).default;
  const rows = Array.from({ length: 8 }, (_, i) => ({ id: "p" + i })), presentation = { current: () => true }, callbacks = [];
  let paused = false, current;
  const never = new Promise(() => {});
  function Screen() {
    current = hook({ lease, presentation, filter: "local", count: 8, rows, keyExtractor: row => row.id, width: 393, fontScale: 1, active: true });
    React.useLayoutEffect(() => { callbacks.push(current.props); });
    if (paused) throw never;
    return React.createElement("List", current.props);
  }
  const render = () => renderer.render(React.createElement(lifecycle === "StrictMode" ? React.StrictMode : React.Suspense, { fallback: React.createElement("Loading") }, React.createElement(Screen)));
  render(); const old = callbacks[0];
  if (lifecycle === "Suspense") { paused = true; render(); paused = false; render(); }
  render(); // Commit the fresh handlers requested by the effect replay.
  const sentinel = { ...lease.read("local"), anchor: "p4", offset: 40 }; lease.save(sentinel);
  old.onScroll({ nativeEvent: { contentOffset: { y: 0 } } });
  assert.equal(lease.read("local").anchor, "p4");
  current.props.onScroll({ nativeEvent: { contentOffset: { y: 0 } } });
  assert.equal(lease.read("local").anchor, null, JSON.stringify({revision:current.provider.revision,liveRevision:current.provider.owner.revision,mounted:current.provider.owner.mounted,active:current.provider.owner.active,pending:current.provider.owner.pending}));
  renderer.render(null);
});

for (const geometry of ["width", "fontScale"]) test(`${geometry} change cannot relabel an old anchor for a later return`, () => {
  const f = fixture(); f.reveal(); f.capture(); f.depart(); f.back();
  f.geometry(geometry === "width" ? 700 : 393, geometry === "fontScale" ? 1.5 : 1);
  assert.equal(f.snapshot.anchor, null); assert.equal(f.snapshot.count, 24);
  f.depart(); f.back(); f.layout(); f.batches(); assert.equal(f.attempts.length, 0); f.close();
});
test("actual Root owner/presentation statements revoke account, epoch, base and precommit route admission", () => {
  const ownership = app.slice(app.indexOf("  const feedReturnRef ="), app.indexOf("  const artistReturnRef ="));
  const admission = app.slice(app.indexOf("  const feedPresentation ="), app.indexOf("  const retainNativeFeed ="));
  const RootOwner = new Function("React", "createFeedReturnOwner", `return function RootOwner(p) {
    const { useRef, useMemo } = React;
    const { session, chatAuthEpoch, activeTab, stack, tab, landing, feedSurfaceVisible, linkedNavigationScope, linkedNavigationRef, navigationRef, Platform } = p;
    ${ownership}
    ${admission}
    p.capture(feedReturn, feedPresentation);
    return null;
  };`)(React, createIOSFeedReturnStore);
  const renderer = createRenderer(), base = {}, scope = {}, navigationRef = { current: null };
  let lease, presentation;
  const props = { session: { id: "A" }, chatAuthEpoch: 1, activeTab: "feed", stack: [base], tab: "feed", landing: false, feedSurfaceVisible: true,
    linkedNavigationScope: scope, linkedNavigationRef: { current: { ownsScope: value => value === scope } }, navigationRef, Platform: { OS: "ios" }, capture: (a, b) => { lease = a; presentation = b; } };
  const render = () => { navigationRef.current = { stack: props.stack, tab: props.tab, landing: props.landing }; renderer.render(React.createElement(RootOwner, props)); };
  render(); const original = lease; assert.equal(presentation.current(), true);
  navigationRef.current = { ...navigationRef.current, stack: [base, { post: {} }] };
  assert.equal(presentation.current(), false); assert.equal(original.current(), true);
  props.stack = navigationRef.current.stack; props.feedSurfaceVisible = false; render(); assert.equal(lease, original);
  props.stack = [base]; props.feedSurfaceVisible = true; render(); assert.equal(lease, original);
  props.chatAuthEpoch = 2; render(); assert.equal(original.current(), false);
  const epochLease = lease; props.session = { id: "B" }; render(); assert.equal(epochLease.current(), false);
  const accountLease = lease; props.stack = [{}]; render(); assert.equal(accountLease.current(), false);
  const frameLease = lease; props.activeTab = "search"; props.tab = "search"; render(); assert.equal(lease, null); assert.equal(frameLease.current(), false);
  renderer.render(null);
});
test("default return owner factory imports no iOS implementation and allocates no store", () => {
  const factory = execute("src/lib/feedReturnOwner.js", name => assert.fail("Unexpected platform import " + name));
  assert.equal(factory.createFeedReturnOwner(), null);
});

test("variable-height return resolves against current measured anchor layout, never saved absolute Y", () => {
  const f = fixture(); f.reveal(); f.heights(Array.from({ length: 80 }, (_, i) => i % 2 ? 450 : 220)); f.capture();
  const previousY = f.rowY(20) + 40; f.depart();
  f.heights(Array.from({ length: 80 }, (_, i) => i % 3 ? 380 : 230)); f.back(); f.layout(); f.batches();
  assert.notEqual(f.rowY(20) + 40, previousY); assert.equal(f.scrolls.at(-1)?.requested, f.rowY(20) + 40); f.close();
});
test("deadline retires captured callbacks without jumping to top or saving a coarse position", () => {
  const set = globalThis.setTimeout, clear = globalThis.clearTimeout, timers = new Set(); let deadline, f;
  globalThis.setTimeout = (callback, delay, ...args) => {
    if (delay !== 1500) return set(callback, delay, ...args);
    const handle = {}; timers.add(handle); deadline = callback; return handle;
  };
  globalThis.clearTimeout = handle => { if (!timers.delete(handle)) clear(handle); };
  try {
    f = fixture(); f.reveal(); f.capture(); f.depart(); f.back(); f.layout();
    const callbacks = f.list().props, snapshot = f.snapshot, before = f.scrolls.length;
    assert.equal(typeof deadline, "function"); deadline();
    callbacks.onScroll({ nativeEvent: { contentOffset: { y: 1000 } } }); callbacks.onContentSizeChange();
    callbacks.onScrollToIndexFailed({ index: 20, averageItemLength: 300 }); f.batches(); deadline();
    assert.equal(f.scrolls.length, before); assert.deepEqual(f.snapshot, snapshot);
  } finally { f?.close(); globalThis.setTimeout = set; globalThis.clearTimeout = clear; }
});
test("Feed preview reports cold primary head pending, cached rows usable, terminal empty/error ready", () => {
  const f = fixture("ios", { preview: true, rows: [], head: { status: "loading", verified: false } });
  assert.equal(f.readiness.at(-1), false);
  f.primary({ head: { status: "ready", verified: true } }); assert.equal(f.readiness.at(-1), true);
  f.primary({ head: { status: "error", verified: false } }); assert.equal(f.readiness.at(-1), true);
  f.primary({ head: { status: "loading", verified: false } }); f.rows([{ id: "cached", userId: "synthetic" }]);
  assert.equal(f.readiness.at(-1), true); f.close();
});
test("Following preview starts normal intent read without visible admission and waits for its own result", () => {
  const f = fixture("ios", { preview: true, filter: "following", rows: [], following: { posts: [], loaded: false, status: "loading" } });
  assert.equal(f.followingReads.at(-1).enabled, true); assert.equal(f.readiness.at(-1), false);
  f.primary({ following: { posts: [], loaded: true, status: "ready" } }); assert.equal(f.readiness.at(-1), true);
  f.primary({ following: { posts: [], loaded: false, status: "error" } }); assert.equal(f.readiness.at(-1), true);
  f.primary({ following: { posts: [{ id: "cached-follow" }], loaded: false, status: "loading" } }); assert.equal(f.readiness.at(-1), true);
  f.close();
});
test("News preview waits for its scoped stories or terminal result, not unrelated cached feed rows", () => {
  const f = fixture("ios", { preview: true, filter: "news", news: { stories: [], status: "loading" } });
  assert.equal(f.readiness.at(-1), false);
  f.primary({ news: { stories: [], status: "ready" } }); assert.equal(f.readiness.at(-1), true);
  f.primary({ news: { stories: [], status: "error" } }); assert.equal(f.readiness.at(-1), true);
  f.primary({ news: { stories: [{ id: "story" }], status: "loading" } }); assert.equal(f.readiness.at(-1), true);
  f.close();
});
