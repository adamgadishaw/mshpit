import assert from "node:assert/strict";
import { readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL("../../", import.meta.url));
const require = createRequire(new URL("../../package.json", import.meta.url));
const React = require("react"), reconciler = require("react-reconciler");
const { transformSync } = require("@babel/core");
// Use RN 0.86's installed StyleSheet API; a mock of removed absoluteFillObject
// previously let zero-height Feed pages pass the entire suite.
const styleFile = realpathSync(new URL("../../node_modules/react-native/Libraries/StyleSheet/StyleSheetExports.js", import.meta.url));
const styleCode = transformSync(readFileSync(styleFile, "utf8"), { filename: styleFile, babelrc: false, configFile: false,
  presets: [[require("babel-preset-expo"), { platform: "ios" }]], caller: { name: "metro", platform: "ios", supportsStaticESM: false } }).code;
const styleModule = { exports: {} };
new Function("require", "module", "exports", "__DEV__", styleCode)(name => name.startsWith("@babel/") ? require(name) : name.includes("PixelRatio")
  ? { default: { roundToNearestPixel: () => 0.5, get: () => 2 } } : {}, styleModule, styleModule.exports, false);
const installedStyleSheet = styleModule.exports.default;
const noop = () => {};
const codes = new Map();
function execute(file, imports, timers) {
  const absolute = path.join(root, file);
  if (!codes.has(file)) codes.set(file, transformSync(readFileSync(absolute, "utf8"), {
    filename: absolute, babelrc: false, configFile: false,
    plugins: [[require("@babel/plugin-transform-react-jsx"), { runtime: "automatic" }], require("@babel/plugin-transform-modules-commonjs")],
  }).code);
  const module = { exports: {} };
  new Function("require", "module", "exports", "setInterval", "clearInterval", "setTimeout", "clearTimeout", codes.get(file))(
    name => imports(name, createRequire(absolute)), module, module.exports, timers?.set || setInterval, timers?.clear || clearInterval, timers?.set || setTimeout, timers?.clear || clearTimeout);
  return module.exports;
}
function createRenderer() {
  const context = {}, container = { children: [] };
  let priority = 0;
  const append = (parent, child) => { const existing = parent.children.indexOf(child); if (existing >= 0) parent.children.splice(existing, 1); parent.children.push(child); };
  const remove = (parent, child) => { const index = parent.children.indexOf(child); if (index >= 0) parent.children.splice(index, 1); };
  const insert = (parent, child, before) => { const existing = parent.children.indexOf(child); if (existing >= 0) parent.children.splice(existing, 1); parent.children.splice(parent.children.indexOf(before), 0, child); };
  const renderer = reconciler({
    supportsMutation: true, isPrimaryRenderer: true, supportsPersistence: false, supportsHydration: false,
    getRootHostContext: () => context, getChildHostContext: () => context, getPublicInstance: node => node,
    prepareForCommit: () => null, resetAfterCommit: noop,
    createInstance: (type, props) => {
      const node = { type, props, children: [], animations: [] };
      if (type === "ExpoImage") {
        node.startAnimating = () => { node.animations.push("play"); return Promise.resolve(); };
        node.stopAnimating = () => { node.animations.push("stop"); return Promise.resolve(); };
      }
      return node;
    }, createTextInstance: text => ({ text }),
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

// Real React reconciliation of the production iOS owner, filter pager, page
// boundaries and FeedContent. Host layout/animation and network are test seams;
// this suite proves lifecycle ownership, not device frame rate or native scroll.
const walk = node => [node, ...(node.children || []).flatMap(walk)];
const settle = () => new Promise(resolve => setImmediate(resolve));
let serial = 0;
function fixture({ filter = "everyone", platform = "ios", countdown = false, actualCards = false, posts = null, activity = false, unread = 0, notifUnread = 0 } = {}) {
  const renderer = createRenderer(), modules = new Map(), persisted = new Map(), intervals = new Map(), pagingTimers = new Map(), reactions = new Set();
  const timers = { set(fn, delay) { const key = {}; intervals.set(key, { fn, delay }); return key; }, clear(key) { intervals.delete(key); } };
  const calls = { news: [], live: [], following: [], intro: [], refresh: [], loadMore: [], actions: [], impressions: [], dwell: [], mutations: [] };
  const pending = name => args => new Promise((resolve, reject) => calls[name].push({ args, resolve, reject }));
  let hasMore = true;
  let source = posts || Array.from({ length: 60 }, (_, index) => ({ id: "post" + index, userId: "other" }));
  let accountId = "A", visible = true, appActive = true, admitted = true, revision = 0, suspended = false, inheritedPreview = false;
  const pendingReveal = new Promise(() => {});
  const ReconnectGate = ({ children }) => { if (suspended) throw pendingReveal; return children; };
  let interactions = { session: { id: accountId }, authReady: true, followedArtists: ["Artist"], blockedIds: [], mutedIds: [], removedIds: [],
    likeInfo: (_id, count = 3, liked = false) => ({ count, liked }),
    toggleLike: (...args) => { calls.mutations.push(["like", ...args]); return Promise.resolve({ ok: true }); },
    setPostRepost: (...args) => { calls.mutations.push(["repost", ...args]); return Promise.resolve({ ok: true }); },
  };
  const City = React.createContext(null);
  const store = () => ({ ...interactions, userById: () => null, userBadges: () => [], commentsFor: () => [], refreshFeed: noop });
  const newPresentation = () => { const version = ++revision; return { current: () => admitted && visible && appActive && version === revision }; };
  let presentation = newPresentation();
  const contexts = require("./src/components/nativeTabPreviewContext.mjs");
  const usePreview = () => React.useContext(contexts.NativeTabPreviewContext);
  const FlatList = props => {
    const instance = React.useRef(++serial).current;
    React.useImperativeHandle(props.ref, () => ({ recordInteraction: noop }));
    return React.createElement("FlatList", { ...props, instance }, props.ListHeaderComponent, props.ListFooterComponent,
      ...props.data.map((item, index) => React.createElement(React.Fragment, { key: props.keyExtractor(item) }, props.renderItem({ item, index }))));
  };
  const native = { View: "View", Text: "Text", Pressable: "Pressable", ScrollView: "ScrollView", Modal: "Modal", Alert: { alert: noop }, Linking: { openURL: (...args) => { calls.actions.push(args); return Promise.resolve(); } },
    Platform: { OS: platform, select: values => values[platform] || values.default }, StyleSheet: installedStyleSheet,
    useWindowDimensions: () => ({ width: 393, height: 852, fontScale: 1 }), FlatList };
  const component = name => props => React.createElement(name, { ...props, preview: usePreview() }, props.children);
  const load = file => {
    if (!modules.has(file)) modules.set(file, execute(file, imports, timers));
    return modules.get(file);
  };
  const imports = (name, local) => {
    if (name === "react" || name === "react/jsx-runtime") return require(name);
    if (name === "react-native") return native;
    if (name.endsWith("/useIOSDetailPresentation")) return require("./src/hooks/useIOSDetailPresentation.js");
    if (actualCards) {
      if (name === "expo-image") return { Image: "ExpoImage" };
      if (name.endsWith("/TicketStub")) return load("src/components/TicketStub.ios.jsx");
      if (name.endsWith("/usePostCardData.ios")) return load("src/hooks/usePostCardData.ios.js");
      if (name.endsWith("/NewsStoryCard")) return load("src/components/news/NewsStoryCard.ios.jsx");
      if (name.endsWith("/NewsPostActions")) return load("src/components/news/NewsPostActions.ios.jsx");
      if (name.endsWith("/useTicketPresentation")) return load("src/hooks/useTicketPresentation.ios.js");
      if (name.endsWith("/SocialReactionButtons")) return load("src/components/SocialReactionButtons.ios.jsx");
      if (name.endsWith("/SocialShareStudio")) return { SocialShareButton: component("SocialShareButton") };
      if (name.endsWith("/showIOSPostActions")) return { __esModule: true, default: noop };
      if (name.endsWith("/useReducedMotion")) return { __esModule: true, default: () => false };
      if (name.endsWith("/store")) return { useStore: store };
      if (name.endsWith("/CityNavigationContext")) return { CityNavigationContext: City };
      if (name.endsWith("/cityIdentity.js")) return { cityIdentityForLocation: () => null };
      if (name.endsWith("/PublicWebLinks")) return { PublicPressableLink: "PublicPressableLink", PublicTextLink: "PublicTextLink" };
      if (name.endsWith("/Badge")) return { BadgeRow: "BadgeRow" };
    }
    if (name === "react-native-reanimated") return { __esModule: true, default: { View: "AnimatedView" }, useAnimatedStyle: fn => fn() };
    if (name.endsWith("/nativeTabPreviewContext.mjs")) return contexts;
    if (name.endsWith("/NativeTabScroll")) return native;
    if (name.endsWith("/NativeLargeTitle.ios")) return { __esModule: true, default: component("NativeLargeTitle"), NativeLargeTitleProvider: props => props.children };
    if (name.endsWith("/useNativeTabPreview")) return { __esModule: true, default: usePreview };
    if (name.endsWith("/useNativeTabContentReady")) return load("src/hooks/useNativeTabContentReady.ios.js");
    if (name.endsWith("/NativeTabPages.ios")) return load("src/components/NativeTabPages.ios.jsx");
    if (name.endsWith("/NativeFeedFilterPager.ios")) return load("src/components/NativeFeedFilterPager.ios.jsx");
    if (name.endsWith("/FeedScreen.jsx")) return load("src/screens/FeedScreen.jsx");
    if (name.endsWith("/NativeSwipeRail")) return { __esModule: true, default: props => React.createElement("Rail", props, props.renderPages({ get: () => 0 }, { get: () => 393 }, { get: () => props.pageIndex })) };
    if (name.endsWith("/useIOSFeedReturn")) return { __esModule: true, default: () => null, FeedReturnProvider: p => p.children };
    if (name.endsWith("/feedHeadStatus")) return { useFeedHeadStatus: () => null };
    if (name.endsWith("/feedImageRetry")) return { useFeedImageRetry: () => ({ value: null, isCurrent: () => true, accept: noop }), FeedImageRetryProvider: p => p.children };
    if (name.endsWith("/theme")) return { colors: new Proxy({}, { get: (_, key) => String(key) }), radius: {}, shadow: {}, glow: {}, font: "", roleColor: () => null, space: value => value * 4 };
    if (name.endsWith("/persist")) return { load: (key, value) => persisted.get(key) ?? value, save: (key, value) => persisted.set(key, value) };
    if (name.endsWith("/useIOSFeedSelection")) return load("src/hooks/useIOSFeedSelection.ios.js");
    if (name.endsWith("/useEndlessFeed")) return load(platform === "ios" ? "src/hooks/useEndlessFeed.ios.js" : "src/hooks/useEndlessFeed.js");
    if (name.endsWith("/endlessFeed.mjs")) return { createEndlessFeed: args => local(name).createEndlessFeed({ ...args,
      schedule: (fn, delay) => { const key = {}; pagingTimers.set(key, { fn, delay }); return key; }, cancel: key => pagingTimers.delete(key) }) };
    if (name.endsWith("/useFeedPresentation")) return load("src/hooks/useFeedPresentation.ios.js");
    if (name.endsWith("/useAppActive")) return { __esModule: true, default: () => appActive };
    if (name.endsWith("/useFollowingFeed")) return load("src/features/socialReactions/useFollowingFeed.ios.js");
    if (name.endsWith("/socialReactionsApi")) return { readFollowingFeed: pending("following"), subscribeSocialReactionChanges: listener => { reactions.add(listener); return () => reactions.delete(listener); } };
    if (name.endsWith("/useNewsDeskStories")) return load("src/components/news/useNewsDeskStories.ios.js");
    if (name.endsWith("/useNewsIntroduction")) return load("src/components/news/useNewsIntroduction.ios.js");
    if (name.endsWith("/diagnostics")) return { toAppError: error => Object.assign(new Error("Unable to load"), { name: "AppError", code: "PIT-API-001", retryable: true }, error) };
    if (name.endsWith("/newsIntroductionSession.mjs")) return { newsIntroductionSession: introductionSession };
    if (name.endsWith("/newsDeskApi")) return { fetchNewsDeskStories: pending("news"), requestNewsIntroduction: pending("intro"), fetchLiveCoverage: pending("live") };
    if (name.endsWith("/NewsInteractionContext")) return { useNewsInteractions: () => interactions };
    if (name.endsWith("/useLiveCoverage")) return load("src/components/news/useLiveCoverage.ios.js");
    if (name.endsWith("/lazyWithRetry")) return { lazyWithRetry: (_import, label) => load(label === "HomeShowCountdown" ? "src/components/HomeShowCountdown.ios.jsx" : "src/components/news/LiveCoverageCard.ios.jsx").default };
    if (name.endsWith(".mjs")) return local(name);
    if (name.startsWith("../components/") || name === "./Icon" || (actualCards && (name.startsWith("./") || name === "../Icon"))) return { __esModule: true, default: component(name.split("/").at(-1)) };
    return local(name);
  };
  const introductionSession = require("./src/domain/newsIntroductionSession.mjs").createNewsIntroductionSession();
  persisted.set(require("./src/domain/feedExperience.mjs").feedFilterStorageKey(accountId), filter);
  const Feed = load("src/screens/FeedScreen.ios.jsx").default;
  const useSelection = load("src/hooks/useIOSFeedSelection.ios.js").default;
  let selection;
  function SelectedFeed(props) { selection = useSelection(props.accountId); return React.createElement(Feed, { ...props, feedSelection: selection }); }
  const all = () => walk(renderer.container);
  const page = filter => all().find(node => node.props?.testID === `main-tab-page-${filter}`);
  const listFor = filter => page(filter) && walk(page(filter)).find(node => node.type === "FlatList");
  const list = () => { const selected = all().find(node => node.props?.testID?.startsWith("main-tab-page-") && node.props.pointerEvents === "auto"); return selected ? walk(selected).find(node => node.type === "FlatList") : all().find(node => node.type === "FlatList"); };
  const event = label => { const node = all().find(node => node.props?.accessibilityLabel === label); assert.ok(node, label + ": " + JSON.stringify(all().filter(n => n.props?.accessibilityLabel).map(n => n.props.accessibilityLabel)) + " rows=" + list()?.props.data.length); return node.props.onPress; };
  const render = () => { const element = React.createElement(SelectedFeed, { visible, accountId, loggedIn: !!accountId, swipeScope: presentation, swipeEnabled: visible && appActive,
    isCurrentSwipeRoute: presentation.current, feedPresentation: presentation, feedReturn: { key: "lease", current: () => true, read: () => null, save: noop, clear: noop },
    feed: source, localFeed: source, hasMore, unread, notifUnread,
    onOpenInbox: activity ? () => calls.actions.push("inbox") : undefined, onOpenNotifications: activity ? () => calls.actions.push("notifications") : undefined, onLoadMore: pending("loadMore"), onRefresh: pending("refresh"),
    onOpenNewsStory: value => calls.actions.push(value), onOpen: value => calls.actions.push(value), onOpenProfile: value => calls.actions.push(value), onNotInterested: value => calls.actions.push(value),
    onImpression: (...args) => calls.impressions.push(args), onDwell: (...args) => calls.dwell.push(args),
    newUser: true, onOpenCountdown: value => calls.actions.push(value), onOpenDiscover: value => calls.actions.push(value),
    showHomeCountdown: countdown, countdownPlan: countdown ? { targetMs: Date.now() + 100_000, event: { artist: "Artist" }, state: "going" } : null });
    renderer.render(React.createElement(React.Suspense, { fallback: React.createElement("Loading") }, React.createElement(ReconnectGate, null, React.createElement(contexts.NativeTabPreviewContext.Provider, { value: inheritedPreview }, element))));
  };
  render();
  return { all, list, listFor, page, calls, intervals, pagingTimers, render, act: renderer.act, event,
    selectFilter(value) { renderer.act(() => selection.select(value)); },
    selection: () => selection,
    data(rows, more) { source = rows; hasMore = more; render(); },
    endReached: () => list().props.onEndReached,
    advance() {
      renderer.act(() => { list().props.onContentSizeChange(393, 10000); list().props.onEndReached(); });
      const [key, timer] = [...pagingTimers][0] || [];
      assert.ok(timer, "end-reached schedules pagination");
      pagingTimers.delete(key); renderer.act(() => timer.fn());
      // This lifecycle suite takes one step at a time. Measurement moves the
      // end away after each step, as the newly revealed cards do on device.
      renderer.act(() => { list().props.onLayout({ nativeEvent: { layout: { height: 800 } } }); list().props.onContentSizeChange(393, 10000); list().props.onScroll({ nativeEvent: { contentOffset: { y: 0 } } }); });
    },
    measure({ height = 800, content = 600, offset = 0 } = {}) { renderer.act(() => {
      list().props.onLayout({ nativeEvent: { layout: { height } } }); list().props.onContentSizeChange(393, content); list().props.onScroll({ nativeEvent: { contentOffset: { y: offset } } });
    }); },
    tickPage() { const [key, timer] = [...pagingTimers][0] || []; assert.ok(timer, "pagination timer"); pagingTimers.delete(key); renderer.act(() => timer.fn()); return timer.delay; },
    press(label) { renderer.act(() => event(label)()); },
    suspend(value) { suspended = value; render(); },
    preview(value) { inheritedPreview = value; render(); },
    precommit() { admitted = false; },
    cover() { visible = false; presentation = newPresentation(); render(); },
    uncover() { admitted = true; visible = true; presentation = newPresentation(); render(); },
    active(value) { appActive = value; presentation = newPresentation(); render(); },
    changed(changedAccount = accountId) { for (const listener of reactions) listener(changedAccount); },
    privacy() { interactions = { ...interactions, blockedIds: ["blocked"] }; render(); },
    account(value) { accountId = value; interactions = { ...interactions, session: { id: value } }; presentation = newPresentation(); render(); },
    async resolve(call, value) { call.resolve(value); await settle(); render(); },
    close() { renderer.render(null); },
  };
}

test("actual iOS Feed owner/pager retains expanded list and denies covered/precommit/retired actions", async () => {
  const f = fixture({ countdown: true });
  try {
    await f.resolve(f.calls.intro[0], { post: null });
    f.advance(); f.advance();
    const instance = f.list().props.instance;
    const oldMore = f.endReached(), oldGuide = f.event("Dismiss getting started guide");
    const oldOpen = f.event("Find a show");
    const oldRefresh = f.all().find(node => node.props?.testID === "feed-refresh").props.onRefresh;
    const analytics = f.list().props.viewabilityConfigCallbackPairs[1].onViewableItemsChanged;
    f.precommit();
    f.act(() => { oldOpen(); oldMore(); oldGuide(); oldRefresh(); analytics({ changed: [{ item: { id: "queued" }, index: 0, isViewable: true }] }); });
    assert.equal(f.calls.refresh.length, 0); assert.equal(f.calls.actions.length, 0); assert.equal(f.calls.impressions.length, 0);
    f.cover();
    assert.equal(f.list().props.instance, instance); assert.equal(f.list().props.data.length, 24);
    assert.equal(f.all().find(node => node.type === "TicketStub").props.preview, true);
    assert.equal(f.all().find(node => node.type === "TicketStub").props.mediaViewable, false);
    assert.equal(f.intervals.size, 0, "Countdown and resource clocks are stopped");
    f.act(() => { oldOpen(); oldMore(); oldRefresh(); });
    f.uncover();
    assert.equal(f.list().props.instance, instance); assert.equal(f.list().props.data.length, 24);
    f.act(() => { oldOpen(); oldMore(); oldRefresh(); });
    assert.equal(f.calls.actions.length, 0); assert.equal(f.calls.refresh.length, 0); assert.equal(f.list().props.data.length, 24);
    f.press("Find a show");
    assert.equal(f.calls.actions.length, 1); assert.equal(f.calls.intro.length, 1);
  } finally { f.close(); }
});

test("actual iOS Feed aborts running refresh and ignores its completion and old callbacks after return", async () => {
  const f = fixture();
  try {
    const refresh = f.all().find(node => node.props?.testID === "feed-refresh").props.onRefresh;
    f.act(() => { void refresh(); });
    assert.equal(f.calls.refresh.length, 1);
    const pending = f.calls.refresh[0];
    f.cover(); assert.equal(pending.args.signal.aborted, true);
    await f.resolve(pending, true);
    assert.equal(f.all().find(node => node.props?.testID === "feed-refresh").props.refreshing, false);
    f.uncover(); f.act(() => { void refresh(); }); assert.equal(f.calls.refresh.length, 1);
    f.act(() => { void f.all().find(node => node.props?.testID === "feed-refresh").props.onRefresh(); });
    assert.equal(f.calls.refresh.length, 2);
  } finally { f.close(); }
});

test("actual iOS Following owner keeps multiple pages, count and cursor through cover and Back", async () => {
  const f = fixture({ filter: "following" });
  try {
    await f.resolve(f.calls.following[0], { posts: Array.from({ length: 8 }, (_, i) => ({ id: "first" + i })), nextCursor: "page2" });
    f.advance();
    assert.equal(f.calls.following[1].args.cursor, "page2");
    await f.resolve(f.calls.following[1], { posts: Array.from({ length: 8 }, (_, i) => ({ id: "second" + i })), nextCursor: "page3" });
    assert.equal(f.calls.following.length, 2, JSON.stringify(f.calls.following.map(c => ({ cursor: c.args.cursor, aborted: c.args.signal.aborted }))));
    const oldMore = f.endReached(), instance = f.list().props.instance;
    assert.equal(f.list().props.data.length, 16);
    f.cover(); assert.equal(f.list().props.data.length, 16); assert.equal(f.intervals.size, 0);
    f.uncover(); assert.equal(f.list().props.instance, instance); assert.equal(f.list().props.data.length, 16);
    assert.equal(f.calls.following.length, 2, "No first-page revalidation on Back");
    f.act(() => oldMore()); assert.equal(f.calls.following.length, 2);
    f.advance(); assert.equal(f.calls.following[2].args.cursor, "page3");
    f.cover(); assert.equal(f.calls.following[2].args.signal.aborted, true);
    f.privacy(); assert.deepEqual(f.list().props.data, []);
  } finally { f.close(); }
});

test("actual iOS News owner preserves story pages/cursor and silences live coverage while covered", async () => {
  const f = fixture({ filter: "news" });
  try {
    const latest = f.calls.news.find(call => call.args.sort === "latest"), top = f.calls.news.find(call => call.args.sort === "top");
    await f.resolve(latest, { stories: [{ id: "one" }], nextCursor: "older" });
    await f.resolve(top, { stories: [{ id: "top" }], nextCursor: null });
    f.advance();
    await f.resolve(f.calls.news.at(-1), { stories: [{ id: "two" }], nextCursor: "oldest" });
    await f.resolve(f.calls.live[0], { events: [{ id: "live", title: "Coverage", live: true, items: [] }] });
    const oldPoll = [...f.intervals.values()].find(timer => timer.delay === 60_000).fn;
    const oldMore = f.endReached(), instance = f.list().props.instance;
    assert.deepEqual(f.list().props.data.map(row => row.id), ["one", "two"]);
    assert.equal(f.intervals.size, 2);
    f.precommit(); f.act(() => { oldMore(); oldPoll(); }); assert.equal(f.calls.news.length, 3); assert.equal(f.calls.live.length, 1);
    f.cover(); assert.equal(f.intervals.size, 0); assert.deepEqual(f.list().props.data.map(row => row.id), ["one", "two"]);
    f.act(() => { oldMore(); oldPoll(); }); assert.equal(f.calls.news.length, 3); assert.equal(f.calls.live.length, 1);
    f.uncover(); assert.equal(f.list().props.instance, instance); assert.equal(f.calls.news.length, 3);
    f.act(() => { oldMore(); oldPoll(); }); assert.equal(f.calls.news.length, 3); assert.equal(f.calls.live.length, 2);
    f.advance(); assert.equal(f.calls.news.at(-1).args.cursor, "oldest");
  } finally { f.close(); }
});

test("actual iOS introduction row remains in place when its completed command is paused", async () => {
  const f = fixture();
  try {
    const post = { id: "news_one", news: { artists: [{ name: "Artist" }] } };
    await f.resolve(f.calls.intro[0], { post });
    assert.equal(f.list().props.data[0].id, post.id);
    f.cover(); assert.equal(f.list().props.data[0].id, post.id);
    f.uncover(); assert.equal(f.list().props.data[0].id, post.id); assert.equal(f.calls.intro.length, 1);
    f.cover(); f.privacy(); assert.notEqual(f.list().props.data[0]?.id, post.id);
  } finally { f.close(); }
});

test("Feed uses its filter rail while inherited previews keep every retained pane inert", () => {
  const f = fixture();
  try {
    const source = f.list();
    assert.equal(f.all().some(node => node.type === "Rail"), true, "the existing Feed pager owns filter gestures");
    assert.equal(f.all().some(node => node.props?.accessibilityRole === "tablist"), false);
    f.selectFilter("local"); const local = f.list(); assert.notEqual(local, source);
    f.cover();
    for (const name of ["everyone", "local"]) {
      assert.equal(f.page(name).props.pointerEvents, "none"); assert.equal(f.page(name).props.accessibilityElementsHidden, true);
    }
    f.uncover(); assert.equal(f.list(), local); f.selectFilter("everyone"); assert.equal(f.list(), source);
  } finally { f.close(); }
});

test("backgrounding the actual iOS owner pauses clocks, reads and analytics without collapsing its source", async () => {
  const f = fixture({ countdown: true });
  try {
    await f.resolve(f.calls.intro[0], { post: null });
    f.advance();
    const instance = f.list().props.instance;
    const oldOpen = f.event("Find a show");
    const analytics = f.list().props.viewabilityConfigCallbackPairs[1].onViewableItemsChanged;
    f.act(() => analytics({ changed: [{ item: { id: "seen" }, index: 0, isViewable: true }] }));
    assert.equal(f.calls.impressions.length, 1);
    const timers = [...f.intervals.values()].map(timer => timer.fn);
    f.active(false);
    assert.equal(f.intervals.size, 0); assert.equal(f.list().props.instance, instance);
    f.act(() => { oldOpen(); timers.forEach(fn => fn()); analytics({ changed: [{ item: { id: "hidden" }, index: 1, isViewable: true }] }); });
    assert.equal(f.calls.actions.length, 0); assert.equal(f.calls.impressions.length, 1); assert.equal(f.calls.dwell.length, 1);
    f.active(true);
    assert.equal(f.list().props.data.length, 16); assert.equal(f.calls.intro.length, 1);
    f.act(() => oldOpen()); assert.equal(f.calls.actions.length, 0);
  } finally { f.close(); }
});

test("account replacement and unmount retire real iOS owner callbacks instead of resurrecting them", async () => {
  const f = fixture();
  try {
    await f.resolve(f.calls.intro[0], { post: null });
    f.advance();
    const firstInstance = f.list().props.instance;
    const oldRefresh = f.all().find(node => node.props?.testID === "feed-refresh").props.onRefresh;
    const oldOpen = f.event("Find a show");
    f.cover(); f.account("B"); f.account("A"); f.uncover();
    assert.notEqual(f.list().props.instance, firstInstance); assert.equal(f.list().props.data.length, 8);
    f.act(() => { oldOpen(); oldRefresh(); });
    assert.equal(f.calls.actions.length, 0); assert.equal(f.calls.refresh.length, 0);
    const currentOpen = f.event("Find a show");
    f.close(); currentOpen(); oldRefresh();
    assert.equal(f.calls.actions.length, 0); assert.equal(f.calls.refresh.length, 0);
  } finally { f.close(); }
});

test("a completed primary page read cannot expand the covered Feed count or replay on Back", async () => {
  const f = fixture();
  try {
    for (let index = 0; index < 7; index++) f.advance();
    assert.equal(f.list().props.data.length, 60);
    f.advance(); assert.equal(f.calls.loadMore.length, 1);
    f.cover(); await f.resolve(f.calls.loadMore[0], true); f.uncover();
    assert.equal(f.list().props.data.length, 60);
    assert.equal(f.calls.loadMore.length, 1);
  } finally { f.close(); }
});


test("real Suspense reconnect retains the Feed but never readmits callbacks from its disconnected lifetime", async () => {
  const f = fixture();
  try {
    await f.resolve(f.calls.intro[0], { post: null });
    f.advance();
    const instance = f.list().props.instance;
    const oldRefresh = f.all().find(node => node.props?.testID === "feed-refresh").props.onRefresh;
    const oldOpen = f.event("Find a show");
    f.suspend(true);
    f.act(() => { oldOpen(); oldRefresh(); });
    assert.equal(f.calls.actions.length, 0); assert.equal(f.calls.refresh.length, 0);
    f.suspend(false);
    assert.equal(f.list().props.instance, instance); assert.equal(f.list().props.data.length, 16);
    f.act(() => { oldOpen(); oldRefresh(); });
    assert.equal(f.calls.actions.length, 0); assert.equal(f.calls.refresh.length, 0);
    f.press("Find a show");
    assert.equal(f.calls.actions.length, 1);
  } finally { f.close(); }
});


test("privacy changes retire actual card and refresh actions without leaving Feed", () => {
  const f = fixture({ actualCards: true, posts: [{ id: "private-row", userId: "author", kind: "status", review: "A concert", likes: 3 }] });
  try {
    const oldLike = f.event("Like, 3 likes");
    const oldRefresh = f.all().find(node => node.props?.testID === "feed-refresh").props.onRefresh;
    f.privacy();
    f.act(() => { oldLike(); oldRefresh(); });
    assert.equal(f.calls.mutations.length, 0); assert.equal(f.calls.refresh.length, 0);
    f.press("Like, 3 likes"); assert.equal(f.calls.mutations.length, 1);
  } finally { f.close(); }
});

test("departure reports already-earned dwell once at its cutoff, never hidden duration or queued events", async () => {
  const realNow = Date.now;
  let now = 1000, f;
  Date.now = () => now;
  try {
    f = fixture(); await f.resolve(f.calls.intro[0], { post: null });
    const analytics = f.list().props.viewabilityConfigCallbackPairs[1].onViewableItemsChanged;
    f.act(() => analytics({ changed: [{ item: { id: "earned" }, index: 0, isViewable: true }] }));
    now = 2500; f.cover();
    assert.equal(f.calls.dwell.length, 1); assert.equal(f.calls.dwell[0][1], 1500);
    now = 9000;
    f.act(() => analytics({ changed: [{ item: { id: "earned" }, index: 0, isViewable: false }, { item: { id: "hidden" }, index: 1, isViewable: true }] }));
    f.uncover(); f.cover();
    assert.equal(f.calls.dwell.length, 1); assert.equal(f.calls.impressions.length, 1);
  } finally { f?.close(); Date.now = realNow; }
});


test("Following reconciles hidden reaction changes on Back without fetching while covered or losing unchanged history", async () => {
  const f = fixture({ filter: "following" });
  try {
    await f.resolve(f.calls.following[0], { posts: Array.from({ length: 40 }, (_, i) => ({ id: "old" + i })), nextCursor: "older" });
    for (let index = 0; index < 4; index++) f.advance();
    assert.equal(f.list().props.data.length, 40);
    f.cover(); f.changed("another-account"); f.uncover();
    assert.equal(f.calls.following.length, 1); assert.equal(f.list().props.data.length, 40);
    f.cover(); f.changed(); f.changed();
    assert.equal(f.calls.following.length, 1, "Hidden unfollow/repost invalidations only mark the account dirty");
    assert.equal(f.intervals.size, 0);
    f.uncover();
    assert.equal(f.calls.following.length, 2, "Back reconciles dirty expanded history even above the polling threshold");
    assert.equal(f.calls.following[1].args.cursor, null);
    await f.resolve(f.calls.following[1], { posts: [{ id: "still-followed" }], nextCursor: null });
    assert.deepEqual(f.list().props.data.map(row => row.id), ["still-followed"]);
    f.cover(); f.uncover(); assert.equal(f.calls.following.length, 2);
  } finally { f.close(); }
});


const compositionStory = { id: "story", postId: "news_story", headline: "Artist concert announcement", summary: "Announced today", body: "A new concert.",
  publishedAt: "2026-11-01T00:00:00Z", category: "music", author: { id: "author", name: "News desk" }, likes: 4, reposts: 2,
  artists: [{ key: "artist", name: "Artist" }], sources: [{ id: "source", kind: "article", name: "Source", url: "https://fixture.invalid/story" }] };

test("full production iOS Feed/Ticket composition enables first-frame Like and campaign motion, then fresh Back actions", () => {
  const campaign = { id: "campaign", userId: "author", user: { id: "author", name: "Artist" }, kind: "status", review: "Artist update", likes: 3,
    campaign: { version: 1, treatment: "after-dark", backgroundAssetId: "ma_fixture_art" },
    photos: ["https://fixture.invalid/art.gif"], media: [{ id: "ma_fixture_art", kind: "image", uri: "https://fixture.invalid/art.gif", status: "ready" }] };
  const f = fixture({ actualCards: true, posts: [campaign] });
  try {
    const image = () => f.all().find(node => node.type === "ExpoImage" && node.props.contentFit === "cover");
    assert.equal(image().props.autoplay, true); assert.equal(image().animations.at(-1), "play");
    const old = f.event("Like, 3 likes"), list = f.list().props.instance;
    const oldNavigate = f.all().find(node => node.type === "PublicTextLink" && node.props.onNavigate).props.onNavigate;
    f.act(oldNavigate); assert.equal(f.calls.actions.length, 1);
    f.act(old); assert.equal(f.calls.mutations.length, 1, "No unrelated render or fetch is needed to admit Like");
    f.cover(); assert.equal(image().props.autoplay, false); assert.equal(image().animations.at(-1), "stop");
    f.act(old); assert.equal(f.calls.mutations.length, 1);
    f.uncover(); assert.equal(f.list().props.instance, list); assert.equal(image().props.autoplay, true); assert.equal(image().animations.at(-1), "play");
    f.act(() => { old(); oldNavigate(); }); assert.equal(f.calls.mutations.length, 1); assert.equal(f.calls.actions.length, 1);
    f.act(f.all().find(node => node.type === "PublicTextLink" && node.props.onNavigate).props.onNavigate); assert.equal(f.calls.actions.length, 2);
    f.press("Like, 3 likes"); assert.equal(f.calls.mutations.length, 2);
    f.suspend(true); f.suspend(false); f.press("Like, 3 likes"); assert.equal(f.calls.mutations.length, 3);
  } finally { f.close(); }
});

for (const surface of ["news", "everyone"]) test(`full production Feed/${surface} News card composition admits fresh controls after Back`, async () => {
  const post = { id: compositionStory.postId, userId: "author", news: compositionStory };
  const f = fixture({ actualCards: true, filter: surface, posts: surface === "everyone" ? [post] : [] });
  try {
    if (surface === "news") {
      await f.resolve(f.calls.news.find(call => call.args.sort === "latest"), { stories: [compositionStory], nextCursor: null });
      await f.resolve(f.calls.news.find(call => call.args.sort === "top"), { stories: [], nextCursor: null });
    }
    const old = f.event("4 likes"), instance = f.list().props.instance;
    f.act(old); assert.equal(f.calls.mutations.length, 1);
    f.cover(); f.act(old); assert.equal(f.calls.mutations.length, 1);
    f.uncover(); assert.equal(f.list().props.instance, instance);
    f.act(old); assert.equal(f.calls.mutations.length, 1);
    f.press("4 likes"); assert.equal(f.calls.mutations.length, 2, "The actual NewsPostActions owner is admitted on Back");
  } finally { f.close(); }
});


test("Feed keeps its title and selected label in the list, with no fixed tabs or activity cards", () => {
  const f = fixture({ activity: true, unread: 3, notifUnread: 2 });
  try {
    assert.equal(f.all().some(node => ["feed-fixed-navigation", "feed-activity-controls"].includes(node.props?.testID)), false);
    assert.equal(f.all().some(node => node.props?.accessibilityRole === "tablist"), false);
    assert.ok(f.all().some(node => node.props?.accessibilityLabel === "Current feed: For You"));
    f.selectFilter("local"); assert.ok(f.all().some(node => node.props?.accessibilityLabel === "Current feed: Local"));
    assert.ok(f.list().props.ListHeaderComponent, "ordinary native list header scrolls with posts");
  } finally { f.close(); }
});

test("returning to visited Feed filters retains each exact expanded list and pauses hidden actions", () => {
  const f = fixture({ activity: true });
  try {
    for (let index = 0; index < 4; index++) f.advance();
    const original = f.list(), oldMore = f.endReached();
    assert.equal(original.props.data.length, 40);
    f.selectFilter("local");
    const local = f.list(); assert.notEqual(local, original);
    assert.equal(f.listFor("everyone"), original); assert.equal(original.props.data.length, 40);
    assert.equal(f.page("everyone").props.pointerEvents, "none");
    assert.equal(f.page("everyone").props.accessibilityElementsHidden, true);
    assert.equal(f.page("everyone").props.style[2].opacity, 0);
    f.act(oldMore); assert.equal(original.props.data.length, 40);
    assert.equal(f.calls.following.length, 0); assert.equal(f.calls.news.length, 0);
    f.selectFilter("everyone"); assert.equal(f.list(), original); assert.equal(f.list().props.data.length, 40);
    f.act(oldMore); assert.equal(original.props.data.length, 40, "Returning does not revive old callbacks");
    f.advance(); assert.equal(original.props.data.length, 48);
    f.selectFilter("local"); assert.equal(f.list(), local);
    f.selectFilter("everyone"); assert.equal(f.list(), original); assert.equal(f.list().props.data.length, 48);
    assert.equal(f.all().filter(node => node.props?.testID === "feed-activity-controls").length, 0);
    f.account("B"); assert.notEqual(f.listFor("everyone"), original); assert.notEqual(f.list(), original);
    assert.equal(f.all().filter(node => node.type === "FlatList").length, 1);
  } finally { f.close(); }
});

test("visited Following preserves loaded pages and cursor, pauses reads, and reconciles hidden changes", async () => {
  const f = fixture({ filter: "following" });
  try {
    await f.resolve(f.calls.following[0], { posts: Array.from({ length: 40 }, (_, i) => ({ id: "followed" + i })), nextCursor: "older" });
    for (let index = 0; index < 4; index++) f.advance();
    const following = f.list(), oldMore = f.endReached();
    assert.equal(following.props.data.length, 40);
    f.selectFilter("local"); assert.equal(f.listFor("following"), following); assert.equal(f.intervals.size, 0);
    f.act(oldMore); assert.equal(f.calls.following.length, 1);
    f.selectFilter("following"); assert.equal(f.list(), following); assert.equal(following.props.data.length, 40);
    assert.equal(f.calls.following.length, 1, "An unchanged visited filter does not refetch");
    f.advance(); assert.equal(f.calls.following[1].args.cursor, "older");
    await f.resolve(f.calls.following[1], { posts: [{ id: "page2" }], nextCursor: "last" });
    f.selectFilter("local"); f.changed(); assert.equal(f.calls.following.length, 2, "Hidden mutation only invalidates");
    f.selectFilter("following"); assert.equal(f.calls.following.length, 3); assert.equal(f.calls.following[2].args.cursor, null);
    await f.resolve(f.calls.following[2], { posts: [{ id: "current" }], nextCursor: null });
    assert.equal(f.list(), following); assert.deepEqual(following.props.data.map(post => post.id), ["current"]);
  } finally { f.close(); }
});

test("visited News keeps paginated stories and pending replies cannot mutate it after switching filters", async () => {
  const f = fixture({ filter: "news" });
  try {
    await f.resolve(f.calls.news.find(call => call.args.sort === "latest"), { stories: [{ id: "story1" }], nextCursor: "page2" });
    await f.resolve(f.calls.news.find(call => call.args.sort === "top"), { stories: [], nextCursor: null });
    const news = f.list();
    f.advance();
    const page = f.calls.news.at(-1); assert.equal(page.args.cursor, "page2");
    await f.resolve(page, { stories: [{ id: "story2" }], nextCursor: "page3" });
    f.selectFilter("local"); assert.equal(f.listFor("news"), news); assert.equal(f.intervals.size, 0);
    const reads = f.calls.news.length;
    f.selectFilter("news"); assert.equal(f.list(), news); assert.equal(f.calls.news.length, reads);
    assert.deepEqual(news.props.data.map(story => story.id), ["story1", "story2"]);
    f.advance(); const late = f.calls.news.at(-1); assert.equal(late.args.cursor, "page3");
    f.selectFilter("local"); assert.equal(late.args.signal.aborted, true);
    await f.resolve(late, { stories: [{ id: "late" }], nextCursor: null });
    f.selectFilter("news"); assert.deepEqual(news.props.data.map(story => story.id), ["story1", "story2"]);
  } finally { f.close(); }
});


test("cached Feed cards cannot act from an inherited preview or revive retired callbacks", () => {
  const f = fixture();
  try {
    const old = f.event("Find a show"); f.selectFilter("local");
    const local = f.list(); const oldLocal = f.event("Find a show");
    f.preview(true); f.act(old); f.act(oldLocal); assert.deepEqual(f.calls.actions, []);
    f.preview(false); f.act(old); f.act(oldLocal); assert.deepEqual(f.calls.actions, []);
    assert.equal(f.list(), local);
    // The selected pane's new action is admitted, while hidden panes stay inert.
    const fresh = walk(f.page("local")).find(node => node.props?.accessibilityLabel === "Find a show").props.onPress;
    f.act(fresh); assert.equal(f.calls.actions.length, 1);
  } finally { f.close(); }
});

test("hidden visited News drops old private-scope stories before it can be shown again", async () => {
  const f = fixture({ filter: "news" });
  try {
    await f.resolve(f.calls.news.find(call => call.args.sort === "latest"), { stories: [{ id: "old-scope" }], nextCursor: "page2" });
    await f.resolve(f.calls.news.find(call => call.args.sort === "top"), { stories: [], nextCursor: null });
    f.selectFilter("local"); const reads = f.calls.news.length;
    f.privacy(); assert.deepEqual(f.listFor("news").props.data, []); assert.equal(f.calls.news.length, reads);
    f.selectFilter("news"); assert.deepEqual(f.list().props.data, []); assert.equal(f.calls.news.length, reads + 2);
    const latest = f.calls.news.slice(reads).find(call => call.args.sort === "latest");
    await f.resolve(latest, { stories: [{ id: "new-scope" }], nextCursor: null });
    assert.deepEqual(f.list().props.data.map(story => story.id), ["new-scope"]);
  } finally { f.close(); }
});

for (const filter of ["everyone", "local", "following", "news"]) {
  test(`actual ${filter} Feed automatically traverses short pages, stops on error and retries the same page`, async () => {
    const f = fixture({ filter, posts: [] });
    const collection = filter === "following" ? "following" : filter === "news" ? "news" : "loadMore";
    const payload = (rows, cursor) => filter === "news" ? { stories: rows, nextCursor: cursor } : { posts: rows, nextCursor: cursor };
    try {
      if (filter === "following") await f.resolve(f.calls.following[0], payload([], "page2"));
      else if (filter === "news") {
        await f.resolve(f.calls.news.find(call => call.args.sort === "latest"), payload([], "page2"));
        await f.resolve(f.calls.news.find(call => call.args.sort === "top"), payload([], null));
      } else if (filter === "everyone") await f.resolve(f.calls.intro[0], { post: null });
      const before = f.calls[collection].length;
      assert.equal(f.all().some(node => /^(?:Show more|Load older|See more|Load more)/.test(node.props?.accessibilityLabel || "")), false);
      f.measure(); assert.equal(f.tickPage(), 250);
      assert.equal(f.calls[collection].length, before + 1);
      if (collection === "loadMore") assert.equal(f.calls.loadMore.at(-1).args.requireProgress, true);
      else assert.equal(f.calls[collection].at(-1).args.cursor, "page2");
      await f.resolve(f.calls[collection].at(-1), collection === "loadMore" ? true : payload([], "page3"));
      assert.equal(f.tickPage(), 500, "empty projection continues without another scroll or end-reached event");
      const failed = f.calls[collection].at(-1);
      if (collection === "loadMore") await f.resolve(failed, false);
      else { failed.reject(Error("offline")); await settle(); f.render(); }
      assert.equal(f.pagingTimers.size, 0);
      f.act(() => { f.list().props.onEndReached(); f.list().props.onScroll({ nativeEvent: { contentOffset: { y: 0 } } }); });
      assert.equal(f.pagingTimers.size, 0, "failed pages do not automatically retry");
      const count = f.calls[collection].length;
      f.press("Retry loading feed"); assert.equal(f.calls[collection].length, count + 1);
      if (collection !== "loadMore") assert.equal(f.calls[collection].at(-1).args.cursor, "page3");
      if (collection === "loadMore") f.data([{ id: "found" }], false);
      await f.resolve(f.calls[collection].at(-1), collection === "loadMore" ? true : payload([{ id: "found" }], null));
      assert.deepEqual(f.list().props.data.map(row => row.id), ["found"]);
      assert.equal(f.pagingTimers.size, 0);
      assert.equal(f.all().some(node => node.text === "You're caught up"), true);
    } finally { f.close(); }
  });
}

test("pagination timers from a real preview/covered Feed cannot load after its admission retires", async () => {
  const f = fixture({ posts: [] });
  try {
    await f.resolve(f.calls.intro[0], { post: null });
    f.measure(); const old = [...f.pagingTimers.values()][0].fn;
    f.preview(true); assert.equal(f.pagingTimers.size, 0); f.act(old); assert.equal(f.calls.loadMore.length, 0);
    f.preview(false); f.measure();
    const current = [...f.pagingTimers.values()][0].fn;
    f.cover(); assert.equal(f.pagingTimers.size, 0); f.act(current); assert.equal(f.calls.loadMore.length, 0);
    f.uncover(); f.measure(); f.tickPage(); assert.equal(f.calls.loadMore.length, 1);
  } finally { f.close(); }
});

for (const filter of ["following", "news"]) {
  test(`actual ${filter} retry replays a failed head refresh instead of revealing cache or appending`, async () => {
    const f = fixture({ filter });
    const payload = rows => filter === "following" ? { posts: rows, nextCursor: "page2" } : { stories: rows, nextCursor: "page2" };
    const source = Array.from({ length: 40 }, (_, i) => ({ id: "retained" + i }));
    try {
      if (filter === "following") await f.resolve(f.calls.following[0], payload(source));
      else {
        await f.resolve(f.calls.news.find(call => call.args.sort === "latest"), payload(source));
        await f.resolve(f.calls.news.find(call => call.args.sort === "top"), { stories: [], nextCursor: null });
      }
      const visibleBefore = f.list().props.data.length;
      const before = f.calls[filter].length;
      f.act(() => { void f.all().find(node => node.props?.testID === "feed-refresh").props.onRefresh(); });
      for (const call of f.calls[filter].slice(before)) call.reject(Error("offline head"));
      await settle(); f.render();
      assert.equal(f.pagingTimers.size, 0);
      f.press("Retry loading feed");
      const retry = f.calls[filter].at(-1);
      assert.equal(retry.args.cursor, null);
      assert.equal(f.list().props.data.length, visibleBefore, "retry never merely expands cached rows");
      await f.resolve(retry, payload(source));
      assert.equal(f.all().some(node => node.props?.accessibilityLabel === "Retry loading feed"), false);
    } finally { f.close(); }
  });
  test(`actual ${filter} initial error retries without an existing page cursor`, async () => {
    const f = fixture({ filter });
    try {
      for (const call of f.calls[filter]) call.reject(Error("offline"));
      await settle(); f.render();
      const before = f.calls[filter].length;
      f.press("Retry loading feed");
      assert.equal(f.calls[filter].length, before + 1); assert.equal(f.calls[filter].at(-1).args.cursor, null);
    } finally { f.close(); }
  });
}

test("menu-selected retained Feed panes use installed native absolute bounds without hiding their layout", () => {
  assert.equal(installedStyleSheet.absoluteFillObject, undefined, "fixture must expose the installed RN 0.86 API");
  const f = fixture();
  const geometry = name => Object.assign({}, ...f.page(name).props.style.filter(Boolean));
  try {
    for (let i = 0; i < 4; i++) f.advance();
    const original = f.list(); original.nativeContentOffset = 1240;
    const oldGeometry = geometry("everyone");
    assert.deepEqual([oldGeometry.position, oldGeometry.top, oldGeometry.right, oldGeometry.bottom, oldGeometry.left], ["absolute", 0, 0, 0, 0]);
    f.selectFilter("local"); const local = f.list(); local.nativeContentOffset = 580;
    const parked = geometry("everyone");
    assert.equal(parked.opacity, 0); assert.notEqual(parked.display, "none");
    for (const key of ["position", "top", "right", "bottom", "left"]) assert.equal(parked[key], oldGeometry[key]);
    f.selectFilter("everyone"); assert.equal(f.list(), original); assert.equal(f.list().nativeContentOffset, 1240); assert.equal(f.list().props.data.length, 40);
    f.selectFilter("local"); assert.equal(f.list(), local); assert.equal(f.list().nativeContentOffset, 580);
  } finally { f.close(); }
});

test("a shared menu selection while Feed is covered opens that filter without resetting another retained list", () => {
  const f = fixture();
  try {
    for (let i = 0; i < 3; i++) f.advance();
    const everyone = f.list();
    f.cover(); f.selectFilter("local"); assert.equal(f.page("local").props.pointerEvents, "none");
    assert.equal(f.calls.loadMore.length, 0); f.uncover(); const local = f.list(); assert.notEqual(local, everyone);
    f.cover(); f.selectFilter("everyone"); f.uncover();
    assert.equal(f.list(), everyone); assert.equal(f.list().props.data.length, 32); assert.equal(f.listFor("local"), local);
    const oldSelect = f.selection().select;
    f.account("B"); f.act(() => oldSelect("news"));
    assert.equal(f.selection().filter, "everyone"); assert.equal(f.listFor("news"), undefined);
  } finally { f.close(); }
});
