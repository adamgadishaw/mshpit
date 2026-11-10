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
  const append = (parent, child) => parent.children.push(child);
  const remove = (parent, child) => { const index = parent.children.indexOf(child); if (index >= 0) parent.children.splice(index, 1); };
  const insert = (parent, child, before) => parent.children.splice(parent.children.indexOf(before), 0, child);
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
  const renderer = createRenderer(), modules = new Map(), persisted = new Map(), intervals = new Map(), reactions = new Set();
  const timers = { set(fn, delay) { const key = {}; intervals.set(key, { fn, delay }); return key; }, clear(key) { intervals.delete(key); } };
  const calls = { news: [], live: [], following: [], intro: [], refresh: [], loadMore: [], actions: [], impressions: [], dwell: [], mutations: [] };
  const pending = name => args => new Promise((resolve, reject) => calls[name].push({ args, resolve, reject }));
  const source = posts || Array.from({ length: 60 }, (_, index) => ({ id: "post" + index, userId: "other" }));
  let accountId = "A", visible = true, appActive = true, admitted = true, revision = 0, suspended = false;
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
    Platform: { OS: platform, select: values => values[platform] || values.default }, StyleSheet: { create: value => value, absoluteFill: {} },
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
    if (name.endsWith("/useFeedPresentation")) return load("src/hooks/useFeedPresentation.ios.js");
    if (name.endsWith("/useAppActive")) return { __esModule: true, default: () => appActive };
    if (name.endsWith("/useFollowingFeed")) return load("src/features/socialReactions/useFollowingFeed.ios.js");
    if (name.endsWith("/socialReactionsApi")) return { readFollowingFeed: pending("following"), subscribeSocialReactionChanges: listener => { reactions.add(listener); return () => reactions.delete(listener); } };
    if (name.endsWith("/useNewsDeskStories")) return load("src/components/news/useNewsDeskStories.ios.js");
    if (name.endsWith("/useNewsIntroduction")) return load("src/components/news/useNewsIntroduction.ios.js");
    if (name.endsWith("/diagnostics")) return { toAppError: error => ({ kind: "app-error", code: "PIT-API-001", message: "Unable to load", ...error }) };
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
  const all = () => walk(renderer.container), list = () => all().find(node => node.type === "FlatList");
  const event = label => { const node = all().find(node => node.props?.accessibilityLabel === label); assert.ok(node, label + ": " + JSON.stringify(all().filter(n => n.props?.accessibilityLabel).map(n => n.props.accessibilityLabel)) + " rows=" + list()?.props.data.length); return node.props.onPress; };
  const render = () => { const element = React.createElement(Feed, { visible, accountId, loggedIn: !!accountId, swipeScope: presentation, swipeEnabled: visible && appActive,
    isCurrentSwipeRoute: presentation.current, feedPresentation: presentation, feedReturn: { key: "lease", current: () => true, read: () => null, save: noop, clear: noop },
    feed: source, localFeed: source, hasMore: true, unread, notifUnread,
    onOpenInbox: activity ? () => calls.actions.push("inbox") : undefined, onOpenNotifications: activity ? () => calls.actions.push("notifications") : undefined, onLoadMore: pending("loadMore"), onRefresh: pending("refresh"),
    onOpenNewsStory: value => calls.actions.push(value), onOpen: value => calls.actions.push(value), onOpenProfile: value => calls.actions.push(value), onNotInterested: value => calls.actions.push(value),
    onImpression: (...args) => calls.impressions.push(args), onDwell: (...args) => calls.dwell.push(args),
    newUser: true, onOpenCountdown: value => calls.actions.push(value), onOpenDiscover: value => calls.actions.push(value),
    showHomeCountdown: countdown, countdownPlan: countdown ? { targetMs: Date.now() + 100_000, event: { artist: "Artist" }, state: "going" } : null });
    renderer.render(React.createElement(React.Suspense, { fallback: React.createElement("Loading") }, React.createElement(ReconnectGate, null, element)));
  };
  render();
  return { all, list, calls, intervals, render, act: renderer.act, event,
    press(label) { renderer.act(() => event(label)()); },
    suspend(value) { suspended = value; render(); },
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
    f.press("Show more posts"); f.press("Show more posts");
    const instance = f.list().props.instance;
    const oldMore = f.event("Show more posts"), oldGuide = f.event("Dismiss getting started guide");
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
    f.press("Load older posts");
    assert.equal(f.calls.following[1].args.cursor, "page2");
    await f.resolve(f.calls.following[1], { posts: Array.from({ length: 8 }, (_, i) => ({ id: "second" + i })), nextCursor: "page3" });
    assert.equal(f.calls.following.length, 2, JSON.stringify(f.calls.following.map(c => ({ cursor: c.args.cursor, aborted: c.args.signal.aborted }))));
    const oldMore = f.event("Load older posts"), instance = f.list().props.instance;
    assert.equal(f.list().props.data.length, 16);
    f.cover(); assert.equal(f.list().props.data.length, 16); assert.equal(f.intervals.size, 0);
    f.uncover(); assert.equal(f.list().props.instance, instance); assert.equal(f.list().props.data.length, 16);
    assert.equal(f.calls.following.length, 2, "No first-page revalidation on Back");
    f.act(() => oldMore()); assert.equal(f.calls.following.length, 2);
    f.press("Load older posts"); assert.equal(f.calls.following[2].args.cursor, "page3");
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
    f.press("Load older stories");
    await f.resolve(f.calls.news.at(-1), { stories: [{ id: "two" }], nextCursor: "oldest" });
    await f.resolve(f.calls.live[0], { events: [{ id: "live", title: "Coverage", live: true, items: [] }] });
    const oldPoll = [...f.intervals.values()].find(timer => timer.delay === 60_000).fn;
    const oldMore = f.event("Load older stories"), instance = f.list().props.instance;
    assert.deepEqual(f.list().props.data.map(row => row.id), ["one", "two"]);
    assert.equal(f.intervals.size, 2);
    f.precommit(); f.act(() => { oldMore(); oldPoll(); }); assert.equal(f.calls.news.length, 3); assert.equal(f.calls.live.length, 1);
    f.cover(); assert.equal(f.intervals.size, 0); assert.deepEqual(f.list().props.data.map(row => row.id), ["one", "two"]);
    f.act(() => { oldMore(); oldPoll(); }); assert.equal(f.calls.news.length, 3); assert.equal(f.calls.live.length, 1);
    f.uncover(); assert.equal(f.list().props.instance, instance); assert.equal(f.calls.news.length, 3);
    f.act(() => { oldMore(); oldPoll(); }); assert.equal(f.calls.news.length, 3); assert.equal(f.calls.live.length, 2);
    f.press("Load older stories"); assert.equal(f.calls.news.at(-1).args.cursor, "oldest");
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

test("actual pager cancels candidate without losing source instance and preserves nested preview effect gates", () => {
  const f = fixture();
  try {
    const source = f.list().props.instance;
    f.act(() => f.all().find(node => node.type === "Rail").props.onPageIntent("negative", 7));
    const lists = f.all().filter(node => node.type === "FlatList");
    assert.equal(lists.length, 2); assert.equal(f.calls.news.length, 2);
    const candidatePage = f.all().find(node => node.props?.testID === "main-tab-page-news");
    assert.equal(candidatePage.props.pointerEvents, "none");
    f.act(() => f.all().find(node => node.type === "Rail").props.onPageCancel());
    assert.equal(f.all().filter(node => node.type === "FlatList").length, 1); assert.equal(f.list().props.instance, source);
    assert.ok(f.calls.news.every(call => call.args.signal.aborted));
    f.cover();
    const page = f.all().find(node => node.props?.testID === "main-tab-page-everyone");
    assert.equal(page.props.pointerEvents, "none"); assert.equal(page.props.accessibilityElementsHidden, true);
    assert.equal(f.all().find(node => node.type === "TicketStub").props.preview, true);
    f.uncover(); assert.equal(f.list().props.instance, source);
  } finally { f.close(); }
});

test("backgrounding the actual iOS owner pauses clocks, reads and analytics without collapsing its source", async () => {
  const f = fixture({ countdown: true });
  try {
    await f.resolve(f.calls.intro[0], { post: null });
    f.press("Show more posts");
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
    f.press("Show more posts");
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
    for (let index = 0; index < 7; index++) f.press("Show more posts");
    assert.equal(f.list().props.data.length, 60);
    f.press("Load older posts"); assert.equal(f.calls.loadMore.length, 1);
    f.cover(); await f.resolve(f.calls.loadMore[0], true); f.uncover();
    assert.equal(f.list().props.data.length, 60);
    assert.equal(f.calls.loadMore.length, 1);
  } finally { f.close(); }
});


test("real Suspense reconnect retains the Feed but never readmits callbacks from its disconnected lifetime", async () => {
  const f = fixture();
  try {
    await f.resolve(f.calls.intro[0], { post: null });
    f.press("Show more posts");
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
    for (let index = 0; index < 4; index++) f.press("Show more posts");
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


for (const control of ["Messages", "Notifications"]) {
  test(`fixed Feed ${control} stays with the list and retires stale presentation presses`, () => {
    const f = fixture({ activity: true, unread: 3, notifUnread: 2 });
    try {
      const label = `${control}, ${control === "Messages" ? 3 : 2} unread`;
      const old = f.event(label), instance = f.list().props.instance;
      const bar = () => f.all().filter(node => node.props?.testID === "feed-activity-controls");
      assert.equal(bar().length, 1);
      f.act(old); assert.deepEqual(f.calls.actions, [control === "Messages" ? "inbox" : "notifications"]);
      f.precommit(); f.act(old); assert.equal(f.calls.actions.length, 1);
      f.cover(); f.act(old); assert.equal(f.calls.actions.length, 1);
      assert.equal(f.all().find(node => node.props?.accessibilityLabel === label).props.disabled, true);
      f.uncover(); assert.equal(f.list().props.instance, instance); assert.equal(bar().length, 1);
      f.act(old); assert.equal(f.calls.actions.length, 1);
      f.press(label); assert.equal(f.calls.actions.length, 2);
      const resumed = f.event(label);
      f.active(false); f.act(resumed); assert.equal(f.calls.actions.length, 2);
      f.active(true); f.act(resumed); assert.equal(f.calls.actions.length, 2);
      f.press(label); assert.equal(f.calls.actions.length, 3);
      const backgroundResumed = f.event(label);
      f.suspend(true); f.act(backgroundResumed); assert.equal(f.calls.actions.length, 3);
      f.suspend(false); f.act(backgroundResumed); assert.equal(f.calls.actions.length, 3);
      f.press(label); assert.equal(f.calls.actions.length, 4);
      const reconnect = f.event(label);
      f.account("B"); f.act(reconnect); assert.equal(f.calls.actions.length, 4);
      f.press(label); assert.equal(f.calls.actions.length, 5);
      const replacement = f.event(label);
      f.close(); f.act(replacement); assert.equal(f.calls.actions.length, 5);
    } finally { f.close(); }
  });
}

test("Feed activity counts remain truthful, readable and absent for missing actions", () => {
  const f = fixture({ activity: true, unread: 123.8, notifUnread: -4 });
  try {
    assert.ok(f.event("Messages, 123 unread")); assert.ok(f.event("Notifications"));
    assert.ok(f.all().some(node => node.text === "99+"));
    assert.ok(!f.all().some(node => node.props?.accessibilityLabel?.includes("-4")));
  } finally { f.close(); }
  const missing = fixture();
  try { assert.ok(!missing.all().some(node => node.props?.testID === "feed-activity-controls")); }
  finally { missing.close(); }
});
