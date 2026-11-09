import assert from "node:assert/strict";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { parse } from "@babel/parser";
import { createIOSLinkedNavigation } from "../domain/iosLinkedNavigation.mjs";
const require = createRequire(import.meta.url);
const React = require("react"), reconciler = require("react-reconciler");
const { transformSync } = require("@babel/core");
// Execute the installed RN StyleSheet export (with inert unrelated imports),
// rather than inventing removed APIs in the native fixture.
const styleFile = realpathSync(new URL("../../node_modules/react-native/Libraries/StyleSheet/StyleSheetExports.js", import.meta.url));
const styleCode = transformSync(readFileSync(styleFile, "utf8"), { filename: styleFile, babelrc: false, configFile: false,
  presets: [[require("babel-preset-expo"), { platform: "ios" }]], caller: { name: "metro", platform: "ios", supportsStaticESM: false } }).code;
const styleModule = { exports: {} };
new Function("require", "module", "exports", "__DEV__", styleCode)(name => name.startsWith("@babel/") ? require(name) : name.includes("PixelRatio")
  ? { default: { roundToNearestPixel: () => 0.5, get: () => 2 } } : {}, styleModule, styleModule.exports, false);
const installedStyleSheet = styleModule.exports.default;
const noop = () => {}, codes = new Map();
function createRenderer() {
  const context = {}, container = { children: [] };
  let priority = 0;
  const append = (parent, child) => parent.children.push(child);
  const remove = (parent, child) => { const index = parent.children.indexOf(child); if (index >= 0) parent.children.splice(index, 1); };
  const insert = (parent, child, before) => parent.children.splice(parent.children.indexOf(before), 0, child);
  const renderer = reconciler({
    supportsMutation: true,
    hideInstance: node => { node.hidden = true; }, unhideInstance: node => { node.hidden = false; },
    hideTextInstance: node => { node.hidden = true; }, unhideTextInstance: node => { node.hidden = false; }, isPrimaryRenderer: true, supportsPersistence: false, supportsHydration: false,
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
  return { container, render(element, passive = true) { renderer.updateContainerSync(element, root, null, null); renderer.flushSyncWork(); if (passive) flush(); },
    act(callback) { renderer.flushSyncFromReconciler(callback); flush(); } };
}

const nodes = node => [node, ...(node.children || []).flatMap(nodes)];
const sleepForever = new Promise(() => {});
// Actual React, platform-resolved rail and shell components. The native gesture,
// UI/RN scheduler and actions are synthetic: this does not validate a device.
function fixture({ component = "rail", strict = false, reader = false, reduced = false, onCommit, onChange, nativeReader = false, retained = false, page = false, excludedChild = false, active = "following", entryDirection = 0, scrollChild = null, pager = false, shell = false, scrollRef = null, scrollProps = {}, feedScreen = false, selectedFilter = "everyone" } = {}) {
  const renderer = createRenderer(), gestures = [], queue = [], calls = [], shared = [], reactions = [], springs = [], timings = [], animatedStyles = [], appListeners = new Set(), appHistory = [], springCompletions = [];
  let props = { page, entryDirection, enabled: true, active, onCommit: onCommit || (direction => calls.push(direction)), onChange: onChange || (tab => calls.push(tab)), hint: "Swipe for an action",
    post: { id: "post-A", likes: 0 }, accountId: "account-A", likeInfo: () => ({ liked: false }),
    toggleLike: (...args) => { calls.push(["like", ...args]); return Promise.resolve({ ok: true }); },
    setPostRepost: (...args) => { calls.push(["repost", ...args]); return Promise.resolve({ ok: true }); } };
  let suspended = false, confirmed = reader, holdUI = false;
  const uiQueue = [];
  const confirmedSubscriptions = [], nativeReaderListeners = new Set(), nativeReaderHistory = [];
  const useSharedValue = initial => {
    const ref = React.useRef(null);
    if (!ref.current) { let value = initial; ref.current = { get: () => value, set: next => { value = next; } }; shared.push(ref.current); }
    return ref.current;
  };
  const modules = {
    react: React, "react/jsx-runtime": require("react/jsx-runtime"),
    "react-native": { AppState: { currentState: "active", addEventListener: (_event, callback) => { appListeners.add(callback); appHistory.push(callback); return { remove: () => appListeners.delete(callback) }; } }, AccessibilityInfo: { announceForAccessibility: noop }, View: "View", Text: "Text", ScrollView: "ScrollView", FlatList: "FlatList", TextInput: "TextInput", Pressable: "Pressable", StyleSheet: installedStyleSheet, useWindowDimensions: () => ({ width: 412, fontScale: 1 }) },
    "react-native-reanimated": { __esModule: true, default: { View: "AnimatedView", Text: "AnimatedText" }, ReduceMotion: { System: "system" }, useSharedValue,
      useAnimatedStyle: f => { animatedStyles.push(f); return { ...f(), __animate: f }; }, useAnimatedReaction: (prepare, react) => { reactions.push({ prepare, react }); }, withSpring: (value, config, done) => { springs.push(config); springCompletions.push(done); return value; }, withTiming: (value, config, done) => { timings.push({ value, config, done }); return value; } },
    "react-native-worklets": { scheduleOnRN: (fn, ...args) => { queue.push(() => fn(...args)); }, scheduleOnUI: (fn, ...args) => { if (holdUI) uiQueue.push(() => fn(...args)); else fn(...args); } },
    "../theme": { colors: { bg: "bg", surface: "surface" }, font: "System" }, "./Icon": "Icon", "./BrandMark": "BrandMark",
    "../hooks/useReducedMotion": () => reduced, "../hooks/useScreenReaderEnabled": { __esModule: true, default: () => reader,
      getConfirmedScreenReaderEnabled: () => confirmed,
      subscribeConfirmedScreenReaderEnabled: callback => { const entry = { callback, active: true }; confirmedSubscriptions.push(entry); return () => { entry.active = false; }; } },
    "react-native-gesture-handler": { GestureDetector: "GestureDetector", Gesture: { Pan() {
      const handlers = {};
      const builder = new Proxy({ handlers }, { get: (target, name) => name === "handlers" ? handlers : (...values) => { handlers[name] = values.length > 1 ? values : values[0]; return builder; } });
      gestures.push(handlers); return builder;
    } } },
  };
  modules["react-native-gesture-handler"].Gesture.Manual = modules["react-native-gesture-handler"].Gesture.Pan;
  modules["react-native-gesture-handler"].Gesture.Native = modules["react-native-gesture-handler"].Gesture.Pan;
  modules["react-native-gesture-handler"].Gesture.Simultaneous = (...gestures) => ({ simultaneous: gestures });
  function execute(path) {
    const url = new URL(path, import.meta.url);
    if (!codes.has(path)) codes.set(path, transformSync(readFileSync(url, "utf8"), { filename: url.pathname, babelrc: false, configFile: false,
      plugins: [[require("@babel/plugin-transform-react-jsx"), { runtime: "automatic" }], require("@babel/plugin-transform-modules-commonjs")],
    }).code);
    const module = { exports: {} }, local = createRequire(url);
    new Function("require", "module", "exports", codes.get(path))(name => name in modules ? modules[name] : local(name), module, module.exports);
    return module.exports;
  }
  if (nativeReader) {
    modules["react-native"].AccessibilityInfo.isScreenReaderEnabled = () => Promise.resolve(false);
    modules["react-native"].AccessibilityInfo.addEventListener = (_name, callback) => {
      nativeReaderListeners.add(callback); nativeReaderHistory.push(callback);
      return { remove: () => nativeReaderListeners.delete(callback) };
    };
    modules["../hooks/useScreenReaderEnabled"] = execute("../hooks/useScreenReaderEnabled.ios.js");
  }
  modules["./NativeSwipeRail"] = execute("./NativeSwipeRail.ios.jsx");
  modules["./NativeTabPages.ios"] = execute("./NativeTabPages.ios.jsx");
  modules["./NativeFeedFilterPager.ios"] = execute("./NativeFeedFilterPager.ios.jsx");
  modules["./NativeTabRail"] = execute("./NativeTabRail.ios.jsx");
  let Component = component === "rail" ? modules["./NativeSwipeRail"].default : component === "tabs" ? (pager ? modules["./NativeFeedFilterPager.ios"].default : modules["./NativeTabRail"].default)
    : component === "social" ? execute("./PostSwipeActions.native.jsx").default : component === "bar" ? execute("./IosTabBar.ios.jsx").default : execute("./NativeAppHeader.ios.jsx").default;
  const exclusionModule = execute("./NativeTabSwipeExclusion.ios.jsx");
  const Exclusion = exclusionModule.default;
  modules["./NativeTabSwipeExclusion"] = exclusionModule;
  if (component === "social-ios") { modules["./PostSwipeActions.native.jsx"] = execute("./PostSwipeActions.native.jsx"); Component = execute("./PostSwipeActions.ios.jsx").default; }
  const Scroll = execute("./NativeTabScroll.ios.jsx");
  const Child = () => scrollChild === "nested" ? React.createElement(Scroll.ScrollView, { testID: "vertical" }, React.createElement(Scroll.ScrollView, { ...scrollProps, ref: scrollRef, horizontal: true, testID: "horizontal", snapToInterval: 180 }, React.createElement("Pressable", { onPress: () => calls.push("card") }))) : scrollChild ? React.createElement(scrollChild === "input" ? Scroll.TextInput : Scroll.ScrollView, { ...scrollProps, ref: scrollRef, horizontal: scrollChild === "horizontal" }, React.createElement("ExplicitButton")) : excludedChild ? React.createElement(Exclusion, null, React.createElement("ExplicitButton")) : React.createElement("ExplicitButton", { onPress: () => calls.push("explicit") });
  const useContentReady = execute("../hooks/useNativeTabContentReady.ios.js").default;
  const usePreview = execute("../hooks/useNativeTabPreview.ios.js").default;
  let mounted = 0;
  const unmounted = [], { NativeTabPreviewContext: previewContext, NativeTabReadinessContext: readinessContext } = require("./nativeTabPreviewContext.mjs");
  function ActualPage({ tab }) {
    const identity = React.useRef(++mounted).current;
    const preview = usePreview();
    useContentReady(props.contentReady !== false);
    React.useEffect(() => () => unmounted.push(identity), []);
    return React.createElement("ActualPage", { tab, identity, preview }, React.createElement(Child));
  }
  if (pager) { props.renderPage = tab => React.createElement(ActualPage, { tab }); props.member = true; }
  const reads = [], writes = [], impressions = [], dwell = [], leaseWrites = [], introductions = [];
  const persisted = new Map();
  if (feedScreen) {
    const key = require("../domain/feedExperience.mjs").feedFilterStorageKey("account-A");
    persisted.set(key, selectedFilter);
    const helperFile = require.resolve("@react-native/virtualized-lists/Lists/ViewabilityHelper");
    const helperCode = transformSync(readFileSync(helperFile, "utf8"), { filename: helperFile, babelrc: false, configFile: false,
      presets: [[require("babel-preset-expo"), { platform: "ios" }]], caller: { name: "metro", platform: "ios", supportsStaticESM: false } }).code;
    const helperModule = { exports: {} };
    new Function("require", "module", "exports", helperCode)(name => name === "./ListMetricsAggregator" ? {} : require(name), helperModule, helperModule.exports);
    const Helper = helperModule.exports.default;
    let listSerial = 0;
    const FlatList = p => {
      const instance = React.useRef(++listSerial).current;
      const liveProps = React.useRef(p); liveProps.current = p;
      const helpers = React.useRef(null);
      if (!helpers.current) helpers.current = p.viewabilityConfigCallbackPairs.map(pair => ({ ...pair, helper: new Helper(pair.viewabilityConfig) }));
      const update = () => {
        const value = liveProps.current;
        const metrics = { getCellMetrics: index => ({ offset: index * 300, length: 300 }) };
        for (const pair of helpers.current) pair.helper.onUpdate({ ...value, getItemCount: data => data.length, getItem: (data, index) => data[index] }, 0, 600, metrics,
          (index, isViewable, value) => ({ item: value.data[index], key: String(value.data[index].id), index, isViewable }), pair.onViewableItemsChanged);
      };
      React.useImperativeHandle(p.ref, () => ({ recordInteraction() { for (const pair of helpers.current) pair.helper.recordInteraction(); update(); }, scrollToOffset: noop, scrollToIndex: noop }));
      React.useLayoutEffect(update);
      React.useEffect(() => () => { for (const pair of helpers.current) pair.helper.dispose(); }, []);
      return React.createElement("FlatList", { ...p, instance }, p.ListHeaderComponent,
        p.data.length ? p.data.map((item, index) => React.createElement(React.Fragment, { key: item.id }, p.renderItem({ item, index }))) : p.ListEmptyComponent, p.ListFooterComponent);
    };
    Object.assign(modules["react-native"], { FlatList, Platform: { OS: "ios" }, StyleSheet: installedStyleSheet });
    modules["../components/NativeTabScroll"] = { FlatList, ScrollView: "ScrollView" };
    modules["../hooks/useNativeTabPreview"] = execute("../hooks/useNativeTabPreview.ios.js");
    modules["../hooks/useNativeTabContentReady"] = execute("../hooks/useNativeTabContentReady.ios.js");
    modules["../hooks/useIOSFeedReturn"] = execute("../hooks/useIOSFeedReturn.ios.js");
    modules["../hooks/feedHeadStatus"] = { useFeedHeadStatus: () => ({ status: "ready", verified: true }) };
    modules["../hooks/feedImageRetry"] = { FeedImageRetryProvider: p => p.children, useFeedImageRetry: () => ({ value: null, isCurrent: () => true, accept: noop }) };
    modules["../lib/useAppActive"] = () => props.appActive !== false;
    modules["../lib/persist"] = { load: (key, fallback) => persisted.get(key) ?? fallback, save: (key, value) => { writes.push([key, value]); persisted.set(key, value); } };
    modules["../lib/lazyWithRetry"] = { lazyWithRetry: () => "OptionalPanel" };
    modules["../theme"] = { colors: {}, radius: {}, shadow: {}, mono: "mono" };
    const interactions = { useNewsInteractions: () => ({ session: { id: props.accountId }, authReady: true, blockedIds: props.blockedIds || [], mutedIds: [], removedIds: [], followedArtists: [] }) };
    modules["./NewsInteractionContext"] = interactions;
    modules["../components/news/NewsInteractionContext"] = interactions;
    const read = (kind, args) => new Promise(resolve => reads.push({ kind, args, resolve }));
    modules["./socialReactionsApi"] = { readFollowingFeed: args => read("following", args), subscribeSocialReactionChanges: () => noop };
    modules["../features/socialReactions/useFollowingFeed"] = execute("../features/socialReactions/useFollowingFeed.js");
    modules["../../lib/newsDeskApi"] = { fetchNewsDeskStories: args => read("news", args) };
    modules["../components/news/useNewsDeskStories"] = execute("./news/useNewsDeskStories.js");
    modules["../components/news/useNewsIntroduction"] = enabled => { introductions.push(enabled); return { post: null, dismiss: noop }; };
    for (const name of ["TicketStub", "Icon", "SuggestedPittersRail", "news/NewsStoryCard"]) modules["../components/" + name] = name;
    modules["../components/VinylRefreshBoundary"] = p => p.children;
    modules["./FeedScreen.jsx"] = execute("../screens/FeedScreen.jsx");
    modules["../components/NativeFeedFilterPager.ios"] = modules["./NativeFeedFilterPager.ios"];
    Component = execute("../screens/FeedScreen.ios.jsx").default;
    props = { ...props, feed: [{ id: "global", review: "Global post" }], localFeed: [{ id: "nearby", review: "Local post" }], loggedIn: true, visible: true,
      swipeEnabled: true, swipeScope: {}, feedPresentation: { current: () => props.routeCurrent !== false }, isCurrentSwipeRoute: () => props.routeCurrent !== false,
      feedReturn: { key: "lease-A", current: () => props.routeCurrent !== false, read: () => null, save: value => leaseWrites.push(value), clear: () => leaseWrites.push("clear") },
      onImpression: (...args) => impressions.push(args), onDwell: (...args) => dwell.push(args), onLoadMore: () => assert.fail("Preview must not paginate"),
    };
  }
  const Layer = execute("./NativeFeedMediaLayer.jsx").default;
  function Gate() { if (suspended) throw sleepForever; return null; }
  const componentKey = () => pager ? `${props.accountId}:${props.authEpoch || 0}` : component === "social" ? `${props.accountId || "guest"}:${props.post.id}` : "component";
  const f = {
    calls, queue, gestures, shared, reactions, springs, timings, animatedStyles, unmounted, reads, writes, impressions, dwell, leaseWrites, introductions, persisted,
    holdUI(value) { holdUI = value; }, flushUI() { while (uiQueue.length) uiQueue.shift()(); },
    pages: () => f.all().filter(node => node.type === "ActualPage"),
    lists: () => f.all().filter(node => node.type === "FlatList"),
    press(label) { const button = f.all().find(node => node.props?.accessibilityLabel === label); assert.ok(button, label); f.act(button.props.onPress); },
    surface: tab => f.all().find(node => node.props?.testID === `main-tab-page-${tab}`),
    translation: tab => f.surface(tab).props.style[1].__animate().transform[0].translateX,
    ready(tab) { const surface = f.surface(tab); f.act(() => nodes(surface).find(node => node.props?.onLayout)?.props.onLayout()); f.react(); },
    react() { for (const reaction of reactions.slice(-2)) { const next = reaction.prepare(); reaction.react(next, null); } },
    appHistory,
    finishSpring(success = true) { springCompletions.at(-1)?.(success); },
    appState(value) { f.act(() => { for (const callback of [...appListeners]) callback(value); }); },
    finish(index = timings.length - 1, success = true) { timings[index]?.done(success); }, confirmedSubscriptions, nativeReaderListeners, nativeReaderHistory,
    all: () => nodes(renderer.container).filter(node => !node.hidden),
    get gesture() { return f.all().find(node => node.type === "GestureDetector").props.gesture.handlers; },
    render(next = {}, passive = true) { props = { ...props, ...next }; renderer.render(React.createElement(strict ? React.StrictMode : React.Fragment, null,
      React.createElement(React.Suspense, { fallback: React.createElement("Fallback") }, (shell ? React.createElement(Layer, { key: `${props.accountId}:${props.authEpoch || 0}`, obscured: !!props.obscured, header: React.createElement("Header"), tabBar: React.createElement("TabBar"), media: React.createElement("Gallery") }, React.createElement(Component, { ...props, key: componentKey() }, React.createElement(Child))) : retained ? React.createElement(Layer, { obscured: !!props.obscured, tabBar: React.createElement(Component, { ...props, key: componentKey() }, React.createElement(Child)), media: React.createElement("Gallery") }, React.createElement("FixtureFeed")) : React.createElement(Component, { ...props, key: componentKey() }, React.createElement(Child))), React.createElement(Gate))), passive); },
    reader(value) { reader = value; confirmed = value; f.render(); }, reduced(value) { reduced = value; f.render(); },
    suspend(value) { suspended = value; f.render(); },
    act(callback) { renderer.act(callback); },
    flush() { f.act(() => { while (queue.length) queue.shift()(); }); },
    confirmed(value, entry) { confirmed = value; f.act(() => { if (entry) entry.callback(); else for (const current of confirmedSubscriptions.filter(item => item.active)) current.callback(); }); },
    nativeEvents(...values) { f.act(() => { for (const value of values) for (const callback of [...nativeReaderListeners]) callback(value); }); },
    async settle() { for (let i = 0; i < 8; i++) await Promise.resolve(); await new Promise(setImmediate); f.act(noop); },
    close(passive = true) { renderer.render(null, passive); },
  };
  f.render(); return f;
}
function down(gesture, { x = 260, y = 200, touches = 1 } = {}) {
  const manager = { failed: 0, activated: 0, fail() { this.failed++; }, activate() { this.activated++; } };
  gesture.onTouchesDown({ allTouches: [{ absoluteX: x, absoluteY: y }], numberOfTouches: touches }, manager);
  return manager;
}
function release(gesture, { x = 110, y = 201, success = true } = {}) { gesture.onEnd({ absoluteX: x, absoluteY: y, translationX: 0, translationY: 0 }, success); }
const swipe = gesture => { down(gesture); release(gesture); };


for (const interruption of ["disabled", "disabled round trip", "replaced callback", "callback round trip"]) test(`rail: queued action is revoked by ${interruption}`, t => {
  const original = [], replacement = [], callback = value => original.push(value);
  const f = fixture({ onCommit: callback }); t.after(f.close); const old = f.gesture; swipe(old);
  if (interruption.startsWith("disabled")) f.render({ enabled: false }); else f.render({ onCommit: value => replacement.push(value) });
  if (interruption.endsWith("round trip")) f.render({ enabled: true, onCommit: callback });
  f.flush(); assert.deepEqual(original, []); assert.deepEqual(replacement, []);
  swipe(old); f.flush(); assert.deepEqual(original, []); assert.deepEqual(replacement, []);
  if (interruption !== "disabled") { swipe(f.gesture); f.flush(); assert.deepEqual(interruption === "replaced callback" ? replacement : original, ["negative"]); }
});

test("unchanged generic callback survives a normal render and completes exactly once", t => {
  const f = fixture(); t.after(f.close); const old = f.gesture; down(old); f.render({ hint: "Updated hint" });
  assert.equal(f.gesture, old); release(old); release(old); f.flush(); assert.deepEqual(f.calls, ["negative"]);
});
for (const strict of [false, true]) test(`Suspense cleanup/reconnect retires queue and worklets, strict=${strict}`, t => {
  const f = fixture({ strict }); t.after(f.close); const old = f.gesture; swipe(old);
  f.suspend(true); f.suspend(false); const current = f.gesture; assert.notEqual(current, old);
  f.flush(); assert.deepEqual(f.calls, []);
  down(current); current.onUpdate({ absoluteX: 120 }); const before = f.shared.map(value => value.get());
  swipe(old); old.onUpdate({ absoluteX: 340 }); old.onFinalize(); f.flush();
  assert.deepEqual(f.shared.map(value => value.get()), before, "retired handlers cannot mutate the newer gesture");
  release(current); f.flush(); assert.deepEqual(f.calls, ["negative"]);
});
test("StrictMode leaves unpresented initial worklets inert and its live presentation usable", t => {
  const f = fixture({ strict: true }); t.after(f.close);
  // StrictMode also calls memo factories twice for the SAME committed owner;
  // those duplicate factory results were never presented to a native detector.
  for (const gesture of f.gestures.filter(gesture => !gesture.enabled)) swipe(gesture);
  f.flush(); assert.deepEqual(f.calls, []); swipe(f.gesture); f.flush(); assert.deepEqual(f.calls, ["negative"]);
});
test("retired queued hints cannot arm a newer gesture", t => {
  const f = fixture(); t.after(f.close); const reaction = f.reactions.at(-1);
  reaction.react("negative", null); assert.equal(f.queue.length, 1);
  f.render({ enabled: false }); f.render({ enabled: true }); f.flush();
  assert.ok(f.all().some(node => node.type === "Text" && node.props.children === "Swipe for an action"));
  assert.ok(!f.all().some(node => node.type === "Text" && /^Release to/.test(node.props.children)));
});
for (const kind of ["short", "vertical", "canceled", "left edge", "right edge", "multiple down", "multiple move"]) test(`preserved rejection: ${kind}`, t => {
  const f = fixture(); t.after(f.close); const g = f.gesture;
  const manager = down(g, { x: kind === "left edge" ? 10 : kind === "right edge" ? 405 : 260, touches: kind === "multiple down" ? 2 : 1 });
  if (kind === "vertical") g.onTouchesMove({ allTouches: [{ absoluteX: 265, absoluteY: 300 }], numberOfTouches: 1 }, manager);
  if (kind === "multiple move") g.onTouchesMove({ allTouches: [{ absoluteX: 130, absoluteY: 200 }], numberOfTouches: 2 }, manager);
  release(g, { x: kind === "short" ? 230 : 110, success: kind !== "canceled" }); f.flush(); assert.deepEqual(f.calls, []);
  assert.equal(g.maxPointers, 1); assert.equal(g.manualActivation, true);
});
test("original displacement, threshold, translation clamp and spring remain unchanged", t => {
  const f = fixture(); t.after(f.close); const g = f.gesture; down(g, { x: 150 });
  const manager = { fail: () => assert.fail(), activate: noop };
  g.onTouchesMove({ allTouches: [{ absoluteX: 350, absoluteY: 200 }], numberOfTouches: 1 }, manager);
  release(g, { x: 190 }); f.flush(); assert.deepEqual(f.calls, []);
  down(g, { x: 150 }); g.onUpdate({ absoluteX: 400 }); assert.equal(f.shared[3].get(), 128);
  release(g, { x: 280 }); f.flush(); assert.deepEqual(f.calls, ["positive"]);
  g.onFinalize(); assert.equal(f.shared[3].get(), 0);
  assert.deepEqual(f.springs.at(-1), { duration: 400, dampingRatio: 1, overshootClamping: true, reduceMotion: "system" });
});

test("installed Metro resolves only iOS rails to this implementation", () => {
  const { resolve } = require("metro-resolver");
  const context = { originModulePath: fileURLToPath(new URL("../../App.js", import.meta.url)), assetExts: new Set(), sourceExts: ["js", "jsx", "json", "ts", "tsx"],
    preferNativePlatform: true, mainFields: ["react-native", "browser", "main"], getPackageForModule: () => null,
    fileSystemLookup(path) { try { const stat = statSync(path); return { exists: true, type: stat.isDirectory() ? "d" : "f", realPath: realpathSync(path) }; } catch { return { exists: false }; } },
  };
  for (const platform of ["ios", "android", "web"]) for (const name of ["NativeSwipeRail", "NativeTabRail"]) {
    const suffix = platform === "ios" ? ".ios" : platform === "android" ? ".native" : "";
    const result = resolve({ ...context, preferNativePlatform: platform !== "web" }, `./src/components/${name}`, platform);
    assert.equal(result.filePath, fileURLToPath(new URL(`./${name}${suffix}.jsx`, import.meta.url)));
  }
});
test("installed Expo/worklets Babel preset compiles every iOS rail UI callback", () => {
  const file = new URL("./NativeSwipeRail.ios.jsx", import.meta.url);
  const result = transformSync(readFileSync(file, "utf8"), { filename: file.pathname, babelrc: false, configFile: false,
    presets: [[require("babel-preset-expo"), { platform: "ios" }]], caller: { name: "metro", platform: "ios", supportsStaticESM: true } });
  assert.ok((result.code.match(/__workletHash/g) || []).length >= 10);
  assert.match(result.code, /scheduleOnRN/);
});

for (const scope of ["account", "post"]) test(`actual keyed social wrapper revokes queued ${scope} action`, t => {
  const f = fixture({ component: "social" }); t.after(f.close); const old = f.gesture; swipe(old);
  f.render(scope === "account" ? { accountId: "account-B" } : { post: { id: "post-B", likes: 0 } });
  f.render({ accountId: "account-A", post: { id: "post-A", likes: 0 } });
  f.flush(); swipe(old); f.flush(); assert.deepEqual(f.calls, []);
  swipe(f.gesture); f.flush(); assert.deepEqual(f.calls, [["repost", "post-A", true]]);
  const ticket = readFileSync(new URL("./TicketStub.jsx", import.meta.url), "utf8");
  assert.equal((ticket.match(/<PostSwipeActions key=\{`\$\{session\?\.id \|\| "guest"\}:\$\{log\.id\}`\}/g) || []).length, 2);
});
test("rail-owned hint and layout renders preserve its callback owner", t => {
  const f = fixture(); t.after(f.close); const g = f.gesture; down(g);
  f.act(() => f.reactions.at(-1).react("negative", null)); f.flush();
  const rail = f.all().find(node => node.props?.onLayout);
  f.act(() => rail.props.onLayout({ nativeEvent: { layout: { width: 400 } } }));
  assert.equal(f.gesture, g); release(g); f.flush(); assert.deepEqual(f.calls, ["negative"]);
});

test("an inline social callback replacement conservatively cancels the old swipe, not fresh ones", t => {
  const f = fixture({ component: "social" }); t.after(f.close); const old = f.gesture; swipe(old);
  f.render({ post: { id: "post-A", likes: 1 } }); f.flush(); assert.deepEqual(f.calls, []);
  swipe(old); f.flush(); assert.deepEqual(f.calls, []);
  swipe(f.gesture); f.flush(); assert.deepEqual(f.calls, [["repost", "post-A", true]]);
});

// Execute the actual Root's navigation, menu and presentation declarations.
// Rendering is intentionally held back in several tests to exercise the gap
// before React cleanup; navigation state and all callbacks remain synthetic.
function rootNavigationFixture({ platform = "ios" } = {}) {
  const source = readFileSync(new URL("../../App.js", import.meta.url), "utf8");
  const ast = parse(source, { sourceType: "module", plugins: ["jsx"] });
  const names = ["setIosMenuOpen", "openMainMenu", "cancelNewsStory", "cancelPublicRoute", "applyNavigation", "writeNavigation", "runAfterComposerClose", "switchTab", "iosTabSwipeEnabled", "iosTabSwipeScope", "isCurrentIOSTabSwipe"];
  const declarations = new Map();
  const walk = node => {
    if (!node || typeof node !== "object") return;
    if (node.type === "VariableDeclarator" && names.includes(node.id?.name)) declarations.set(node.id.name, `const ${node.id.name} = ${source.slice(node.init.start, node.init.end)};`);
    for (const value of Object.values(node)) { if (Array.isArray(value)) value.forEach(walk); else if (value && typeof value === "object") walk(value); }
  };
  walk(ast); for (const name of names) assert.ok(declarations.has(name), name);
  const owner = createIOSLinkedNavigation(); let account = "A", authEpoch = 1; owner.account(account, authEpoch); owner.mount();
  const initial = { stack: [{}], tab: "feed", landing: false }, navigationRef = { current: initial }, stackRef = { current: initial.stack };
  const queued = [], guards = [], iosTabSwipeRevisionRef = { current: 0 }, composerCloseGuardRef = { current: null };
  let iosMenuOpen = false, iosTabSwipeRevision = 0, root, memo;
  const bindings = {
    Platform: { OS: platform }, web: false, linkedNavigationRef: { current: owner }, navigationRef, stackRef,
    iosTabSwipeRevisionRef, composerCloseGuardRef,
    setIOSMenuOpenState: value => { iosMenuOpen = value; }, setIOSTabSwipeRevision: value => { iosTabSwipeRevision = value; },
    useMemo: (create, deps) => { if (!memo || !deps.every((value, i) => Object.is(value, memo.deps[i]))) memo = { value: create(), deps }; return memo.value; },
    newsLinkedClaimRef: { current: null }, newsOpenRef: { current: 0 }, setNewsStoryNotice: noop,
    publicLookup: {}, publicNavigationPendingRef: { current: null }, publicRouteRequestRef: { current: null }, setPublicNavigationNotice: noop,
    authNavigationAbortRef: { current: noop }, setStack: value => queued.push(value), setTab: noop, setLanding: noop,
    memberTabRequiresAccount: () => false, SearchScreen: {}, DiscoverScreen: {}, YouScreen: {}, browseReturnRef: { current: { reset: noop } },
    MAIN_TAB_PATHS: { feed: "/", search: "/search", discover: "/discover", you: "/you" },
    nativeAccountLinkActive: false, status: "ok", acctOpen: false, welcome: false, resetToken: null, unsubToken: null, verifyToken: null, ownerApprovalToken: null,
  };
  const render = () => {
    const state = { ...bindings, session: account ? { id: account } : null, linkedNavigationScope: owner.account(account, authEpoch), iosMenuOpen, iosTabSwipeRevision,
      ...navigationRef.current, overlay: navigationRef.current.stack.length > 1 };
    const make = new Function(...Object.keys(state), `${names.map(name => declarations.get(name)).join("\n")} return { ${names.join(", ")} };`);
    root = make(...Object.values(state)); return root;
  };
  render();
  return { owner, queued, guards, navigationRef,
    get app() { return root; }, render,
    props() { render(); return { active: navigationRef.current.tab, onChange: root.switchTab, swipeScope: root.iosTabSwipeScope, swipeEnabled: root.iosTabSwipeEnabled, isCurrentSwipeRoute: root.isCurrentIOSTabSwipe, obscured: navigationRef.current.stack.length > 1 }; },
    gallery() { root.writeNavigation({ ...navigationRef.current, stack: [initial.stack[0], { photos: { images: ["fixture"] } }] }, null); },
    restore() { root.writeNavigation(initial, null); },
    account(id, epoch) { account = id; authEpoch = epoch; owner.account(id, epoch); },
    defer() { composerCloseGuardRef.current = request => guards.push(request); },
  };
}




test("retired confirmed listener cannot revoke a reconnected gesture", t => {
  const f = fixture(); t.after(f.close); const stale = f.confirmedSubscriptions.at(-1);
  f.suspend(true); f.suspend(false); const current = f.gesture; down(current); const before = f.shared.map(value => value.get());
  f.confirmed(true, stale); assert.deepEqual(f.shared.map(value => value.get()), before);
  f.confirmed(false, stale); release(current); f.flush(); assert.deepEqual(f.calls, ["negative"]);
});
test("real removed native listener cannot revoke a replacement mount", async t => {
  const f = fixture({ nativeReader: true }); t.after(f.close); await f.settle(); const stale = f.nativeReaderHistory.at(-1);
  f.close(); f.render(); await f.settle(); const current = f.gesture; down(current); const before = f.shared.map(value => value.get());
  f.act(() => stale(true)); assert.deepEqual(f.shared.map(value => value.get()), before); release(current); f.flush(); assert.deepEqual(f.calls, ["negative"]);
});
test("Root routes all iOS shell rails through presentation guards without changing default wrappers", () => {
  const app = readFileSync(new URL("../../App.js", import.meta.url), "utf8");
  assert.equal((app.match(/<NativeAppHeader active=\{activeTab\} onChange=\{switchTab\} swipeScope=/g) || []).length, 2);
  assert.match(app, /<IosTabBar active=\{activeTab\} onChange=\{switchTab\} swipeScope=\{iosTabSwipeScope\}/);
  assert.match(app, /<NativeFeedMediaLayer key=\{Platform.OS === "ios"/);
  assert.match(app, /const nativeTabPage = tabScreens;/);
  for (const name of ["NativeTabRail.native.jsx", "NativeAppHeader.native.jsx", "NativeSwipeRail.native.jsx"]) assert.doesNotMatch(readFileSync(new URL(`./${name}`, import.meta.url), "utf8"), /swipeScope|isCurrentSwipeRoute|subscribeConfirmedScreenReaderEnabled/);
});

for (const platform of ["android", "web"]) test(`${platform} Root tab callbacks ignore the optional iOS-only predicate`, () => {
  const root = rootNavigationFixture({ platform });
  root.app.switchTab("search", () => false);
  assert.equal(root.navigationRef.current.tab, "search");
});

// Page-motion tests exercise production callbacks but not native recognizer arbitration.






















function dragPage(f, dx = -120) {
  const g = f.gesture;
  const manager = down(g);
  g.onTouchesMove({ allTouches: [{ absoluteX: 260 + dx, absoluteY: 201 }], numberOfTouches: 1 }, manager);
  g.onUpdate({ absoluteX: 260 + dx });
  return g;
}
const paneLayout = (f, tab) => nodes(f.surface(tab)).find(node => node.props?.onLayout).props.onLayout;

test("real pager mounts one destination only on direction intent and moves both gaplessly", t => {
  const f = fixture({ component: "tabs", page: true, pager: true }); t.after(f.close);
  assert.deepEqual(f.pages().map(page => page.props.tab), ["following"]);
  const g = dragPage(f); assert.equal(f.translation("following"), 0, "late JS cannot uncover a blank page");
  f.flush(); assert.deepEqual(f.pages().map(page => page.props.tab), ["following", "local"]);
  assert.equal(f.pages()[1].props.preview, true);
  assert.equal(f.surface("local").props.pointerEvents, "none");
  assert.equal(f.surface("local").props.accessibilityElementsHidden, true);
  f.ready("local");
  assert.equal(f.translation("following"), -120);
  assert.equal(f.translation("local"), 260);
  assert.equal(f.translation("local") - f.translation("following"), 380);
  g.onUpdate({ absoluteX: 200 });
  assert.equal(f.translation("following"), -60); assert.equal(f.translation("local"), 320);
  assert.deepEqual(f.calls, []);
});
test("real pager promotes exact candidate instance and removes source only after settle", t => {
  const f = fixture({ component: "tabs", page: true, pager: true }); t.after(f.close);
  const source = f.pages()[0].props.identity, g = dragPage(f); f.flush(); f.ready("local");
  const destination = f.pages()[1].props.identity;
  release(g); g.onFinalize(); assert.equal(f.pages().length, 2); assert.deepEqual(f.calls, []);
  f.finish(); f.flush(); assert.deepEqual(f.calls, ["local"]);
  f.render({ active: "local" });
  assert.deepEqual(f.pages().map(page => [page.props.tab, page.props.identity, page.props.preview]), [["local", destination, false]]);
  assert.ok(f.unmounted.includes(source)); assert.ok(!f.unmounted.includes(destination));
  assert.equal(f.translation("local"), 0);
  f.finish(); f.flush(); assert.deepEqual(f.calls, ["local"]);
});
test("real pager cancellation preserves source instance and retires preview without navigation", t => {
  const f = fixture({ component: "tabs", page: true, pager: true }); t.after(f.close);
  const source = f.pages()[0].props.identity, g = dragPage(f); f.flush(); f.ready("local");
  const destination = f.pages()[1].props.identity;
  release(g, { x: 240 }); g.onFinalize(); f.finishSpring(); f.flush();
  assert.deepEqual(f.pages().map(page => page.props.identity), [source]);
  assert.ok(f.unmounted.includes(destination)); assert.deepEqual(f.calls, []);
});
test("fast release before JS and native layout waits for real ready page, then commits once", t => {
  const f = fixture({ component: "tabs", page: true, pager: true }); t.after(f.close);
  const g = dragPage(f); release(g); g.onFinalize();
  assert.equal(f.translation("following"), 0); assert.equal(f.timings.length, 0);
  f.flush(); assert.equal(f.pages().length, 2); assert.equal(f.timings.length, 0);
  f.ready("local"); assert.equal(f.timings.length, 1);
  f.react(); assert.equal(f.timings.length, 1, "readiness cannot dispatch duplicate settle");
  f.finish(); f.flush(); assert.deepEqual(f.calls, ["local"]);
});
test("primary data loads during drag and release waits for scoped usable content", t => {
  const f = fixture({ component: "tabs", page: true, pager: true }); t.after(f.close);
  f.render({ contentReady: false }); const g = dragPage(f); f.flush(); f.ready("local");
  assert.equal(f.translation("following"), -120, "real screen is visible during loading");
  release(g); g.onFinalize(); f.flush(); assert.equal(f.timings.length, 0);
  f.render({ contentReady: true }); f.react();
  assert.equal(f.timings.length, 1); f.finish(); f.flush(); assert.deepEqual(f.calls, ["local"]);
});
test("canceled JS-late preparation never mounts or navigates", t => {
  const f = fixture({ component: "tabs", page: true, pager: true }); t.after(f.close);
  const g = dragPage(f); release(g, { success: false }); g.onFinalize(); f.finishSpring(); f.flush();
  assert.deepEqual(f.pages().map(page => page.props.tab), ["following"]); assert.deepEqual(f.calls, []);
});
for (const change of ["scope", "reader", "background", "disabled", "reduced", "unmount"]) test(`real pager ready/release is retired by ${change}`, t => {
  const f = fixture({ component: "tabs", page: true, pager: true }); t.after(f.close);
  const g = dragPage(f); f.flush(); const staleLayout = paneLayout(f, "local");
  release(g); g.onFinalize(); f.flush();
  if (change === "scope") f.render({ swipeScope: {} });
  if (change === "reader") f.reader(true);
  if (change === "background") { f.appState("background"); f.appState("active"); }
  if (change === "disabled") f.render({ swipeEnabled: false });
  if (change === "reduced") f.reduced(true);
  if (change === "unmount") f.close();
  f.act(staleLayout); f.react(); f.finish(); f.flush();
  assert.deepEqual(f.calls, []); assert.ok(f.pages().length <= 1);
});
test("superseded destination layout cannot ready A after A to B to A direction changes", t => {
  const f = fixture({ component: "tabs", page: true, pager: true, active: "local" }); t.after(f.close);
  const g = dragPage(f); f.flush(); const stale = paneLayout(f, "everyone");
  g.onUpdate({ absoluteX: 380 }); f.flush(); assert.ok(f.surface("following"));
  g.onUpdate({ absoluteX: 140 }); f.flush();
  f.act(stale); f.react(); assert.equal(f.translation("local"), 0);
  f.ready("everyone"); assert.equal(f.translation("local"), -120);
});
test("same target reuses measured layout after canceled drag without requiring new onLayout", t => {
  const f = fixture({ component: "tabs", page: true, pager: true }); t.after(f.close);
  let g = dragPage(f); f.flush(); f.ready("local");
  const identity = f.pages()[1].props.identity;
  release(g, { x: 240 }); g.onFinalize();
  g = dragPage(f); f.flush(); f.react();
  assert.equal(f.pages()[1].props.identity, identity);
  assert.equal(f.translation("following"), -120);
  f.finishSpring(); f.flush(); assert.equal(f.pages().length, 2, "old cancellation cannot remove new gesture candidate");
});
test("real pager reduced motion commits without displacement or preview mount", t => {
  const f = fixture({ component: "tabs", page: true, pager: true, reduced: true }); t.after(f.close);
  const g = dragPage(f); f.flush(); assert.equal(f.pages().length, 1); assert.equal(f.translation("following"), 0);
  release(g); g.onFinalize(); f.flush(); assert.deepEqual(f.calls, ["local"]);
});


test("slow primary GET settles to real loading UI after cap rather than rejecting navigation", t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture({ component: "tabs", page: true, pager: true }); t.after(f.close);
  f.render({ contentReady: false }); const g = dragPage(f); f.flush(); f.ready("local");
  release(g); g.onFinalize(); f.flush(); assert.equal(f.timings.length, 0);
  t.mock.timers.tick(2500); f.react(); assert.equal(f.timings.length, 1);
  f.finish(); f.flush(); assert.deepEqual(f.calls, ["local"]);
});
test("missing native destination layout times out without uncovering source or navigating", t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture({ component: "tabs", page: true, pager: true }); t.after(f.close);
  const identity = f.pages()[0].props.identity, g = dragPage(f); release(g); g.onFinalize(); f.flush();
  assert.equal(f.translation("following"), 0);
  f.act(() => t.mock.timers.tick(2500)); f.react();
  assert.deepEqual(f.pages().map(page => page.props.identity), [identity]); assert.deepEqual(f.calls, []);
});
test("common Feed shell preserves source through gallery, then promotes Local without remount", t => {
  const f = fixture({ component: "tabs", page: true, pager: true, shell: true }); t.after(f.close);
  const feed = f.pages()[0].props.identity;
  f.render({ obscured: true, swipeEnabled: false, swipeScope: {} });
  assert.equal(f.pages()[0].props.identity, feed);
  f.render({ obscured: false, swipeEnabled: true, swipeScope: {} });
  assert.equal(f.pages()[0].props.identity, feed);
  const g = dragPage(f); f.flush(); f.ready("local"); const search = f.pages()[1].props.identity;
  release(g); g.onFinalize(); f.finish(); f.flush(); f.render({ active: "local" });
  assert.equal(f.pages()[0].props.identity, search);
  const app = readFileSync(new URL("../../App.js", import.meta.url), "utf8");
  assert.match(app, /retainNativeFeed \|\| \(Platform.OS === "ios" && !overlay\)/);
  assert.match(app, /loggedIn=\{!!session\} onAccount=\{\(\) => session \? openProfileManagement\(\) : openSignIn\(\)\}/);
});
for (const transition of ["account", "reauth"]) test(`actual page subtree unmounts and old callbacks retire on ${transition}`, t => {
  const f = fixture({ component: "tabs", page: true, pager: true, shell: true }); t.after(f.close);
  const old = dragPage(f); f.flush(); const stale = paneLayout(f, "local"); const originalIds = f.pages().map(page => page.props.identity);
  f.render(transition === "account" ? { accountId: "B" } : { authEpoch: 1 });
  f.act(stale); release(old); old.onFinalize(); f.react(); f.finish(); f.flush();
  assert.deepEqual(f.calls, []); assert.equal(f.pages().length, 1);
  assert.ok(originalIds.every(id => f.unmounted.includes(id)));
});
test("reserved edge touch cannot strand a canceled candidate", t => {
  const f = fixture({ component: "tabs", page: true, pager: true }); t.after(f.close);
  const g = dragPage(f); f.flush(); f.ready("local"); release(g, { x: 240 }); g.onFinalize();
  down(f.gesture, { x: 5 }); f.finishSpring(); f.flush();
  assert.equal(f.pages().length, 1); assert.deepEqual(f.calls, []);
});
for (const [active, destination, dx] of [["following", "local", -120], ["everyone", "local", 120]]) test(`promotion geometry stays continuous before and after delayed atomic UI rebase ${active} to ${destination}`, t => {
  const f = fixture({ component: "tabs", page: true, pager: true, active }); t.after(f.close);
  const g = dragPage(f, dx); f.flush(); f.ready(destination);
  release(g, { x: 260 + (dx < 0 ? -150 : 150) }); g.onFinalize();
  assert.equal(f.translation(destination), 0, "end of UI settlement");
  f.finish(); f.flush(); f.holdUI(true);
  f.render({ active: destination });
  assert.equal(f.translation(destination), 0, "React promotion before UI reset must not change the tab coordinate");
  f.flushUI(); assert.equal(f.translation(destination), 0, "one UI task rebases both origin and drag without an intermediate frame");
});
test("retired queued timer setup cannot overwrite current gesture timeout", t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture({ component: "tabs", page: true, pager: true }); t.after(f.close);
  f.render({ contentReady: false }); let g = dragPage(f); release(g); g.onFinalize();
  const oldTimerSetup = f.queue.pop(); f.flush();
  f.render({ swipeScope: {} }); g = dragPage(f); f.flush(); f.ready("local"); release(g); g.onFinalize(); f.flush();
  oldTimerSetup(); t.mock.timers.tick(2500); f.react();
  assert.equal(f.timings.length, 1); f.finish(); f.flush(); assert.deepEqual(f.calls, ["local"]);
});
test("queued superseded direction does not mount an abandoned adjacent page", t => {
  const f = fixture({ component: "tabs", page: true, pager: true, active: "local" }); t.after(f.close);
  const g = dragPage(f); g.onUpdate({ absoluteX: 380 });
  const oldPrepare = f.queue.shift(); f.act(oldPrepare);
  assert.deepEqual(f.pages().map(page => page.props.tab), ["local"]);
  f.flush(); assert.deepEqual(f.pages().map(page => page.props.tab), ["local", "following"]);
});

for (const component of ["tabs", "bar", "header"]) test(`${component}: main navigation is tap-only with no horizontal recognizer`, t => {
  const f = fixture({ component }); t.after(f.close);
  assert.equal(f.all().filter(node => node.type === "GestureDetector").length, 0);
  if (component === "bar") {
    for (const tab of f.all().filter(node => node.props?.accessibilityRole === "tab")) f.act(tab.props.onPress);
    assert.deepEqual(f.calls, ["feed", "search", "discover", "you"]);
    f.reader(true); f.reduced(true);
    assert.equal(f.all().filter(node => node.props?.accessibilityRole === "tab").length, 4);
  }
});
test("selected filter tap cancels queued preview and release without a selection write", t => {
  const f = fixture({ component: "tabs", page: true, pager: true }); t.after(f.close);
  const g = dragPage(f); f.flush(); f.ready("local"); release(g); g.onFinalize();
  f.render({ tapRevision: 1 }); f.finish(); f.flush();
  assert.deepEqual(f.calls, []); assert.deepEqual(f.pages().map(p => p.props.tab), ["following"]);
});

test("actual iOS Feed previews Local cached posts beneath one stable strip without writes", t => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const f = fixture({ feedScreen: true }); t.after(f.close);
  const source = f.lists()[0].props.instance;
  assert.deepEqual(f.all().find(n => n.props?.testID === "feed-fixed-navigation").props.style, { paddingHorizontal: 12, paddingTop: 4 });
  assert.equal(f.lists()[0].props.data[0].id, "global");
  const before = f.leaseWrites.length, g = dragPage(f, 120); f.flush(); f.ready("local");
  assert.equal(f.lists().length, 2);
  assert.equal(f.lists()[1].props.data[0].id, "nearby");
  assert.equal(f.all().filter(n => n.props?.accessibilityLabel === "Following feed").length, 1);
  assert.equal(f.translation("everyone"), 120);
  assert.deepEqual(f.reads, []); assert.deepEqual(f.writes, []); assert.equal(f.leaseWrites.length, before);
  f.act(() => t.mock.timers.tick(1500));
  assert.ok(f.impressions.every(args => args[2] === "everyone"));
  release(g, { x: 280 }); g.onFinalize(); f.finishSpring(); f.flush();
  assert.equal(f.lists().length, 1); assert.equal(f.lists()[0].props.instance, source); assert.deepEqual(f.writes, []);
});

test("actual Following GET starts mid-drag and survives promotion without restart or hidden impressions", async t => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const f = fixture({ feedScreen: true, selectedFilter: "local" }); t.after(f.close);
  const g = dragPage(f, 120); f.flush(); f.ready("following");
  assert.equal(f.reads.length, 1); assert.equal(f.reads[0].kind, "following");
  const destination = f.lists()[1].props.instance, request = f.reads[0];
  assert.equal(request.args.signal.aborted, false); assert.deepEqual(f.writes, []);
  release(g, { x: 400 }); g.onFinalize(); f.flush();
  f.act(() => t.mock.timers.tick(2500)); f.react(); f.finish(); f.flush();
  assert.equal(f.lists()[0].props.instance, destination);
  assert.equal(f.writes.length, 1); assert.equal(f.writes[0][1], "following");
  assert.equal(f.reads.length, 1); assert.equal(request.args.signal.aborted, false);
  request.resolve({ posts: [{ id: "followed", review: "A real followed post" }], nextCursor: "older" }); await f.settle();
  assert.equal(f.lists()[0].props.data[0].id, "followed");
  f.act(() => t.mock.timers.tick(999)); assert.ok(f.impressions.every(args => args[2] !== "following"));
  f.act(() => t.mock.timers.tick(1)); assert.equal(f.impressions.filter(args => args[2] === "following").length, 1);
});

test("actual News normal reads render stories mid-drag and canceled preview aborts without selection", async t => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const f = fixture({ feedScreen: true }); t.after(f.close);
  const g = dragPage(f); f.flush(); f.ready("news");
  assert.equal(f.reads.length, 2); assert.ok(f.reads.every(r => r.kind === "news"));
  for (const request of f.reads) request.resolve({ stories: [{ id: "story", title: "Actual destination story" }], nextCursor: "older" });
  await f.settle();
  assert.equal(f.lists()[1].props.data[0].title, "Actual destination story"); assert.equal(f.translation("news"), 260);
  assert.deepEqual(f.writes, []);
  release(g, { x: 240 }); g.onFinalize(); f.finishSpring(); f.flush();
  assert.equal(f.lists().length, 1); assert.deepEqual(f.writes, []);
  assert.ok(f.reads.every(r => r.args.signal.aborted));
});

test("loaded Following preview shows posts immediately but qualifies views only after promotion", async t => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const f = fixture({ feedScreen: true, selectedFilter: "local" }); t.after(f.close);
  const g = dragPage(f, 120); f.flush(); f.ready("following");
  f.reads[0].resolve({ posts: [{ id: "followed", review: "Destination before release" }], nextCursor: "older" }); await f.settle();
  assert.equal(f.lists()[1].props.data[0].review, "Destination before release");
  f.act(() => t.mock.timers.tick(3000));
  assert.ok(f.impressions.every(args => args[2] !== "following"));
  const previewRow = f.all().find(n => n.type === "TicketStub" && n.props.log.id === "followed");
  assert.equal(previewRow.props.mediaViewable, false); assert.equal(previewRow.props.swipeActions, false);
  release(g, { x: 400 }); g.onFinalize(); f.finish(); f.flush();
  assert.equal(f.reads.length, 1); assert.equal(f.writes[0][1], "following");
  assert.equal(f.all().find(n => n.type === "TicketStub" && n.props.log.id === "followed").props.mediaViewable, true);
  f.act(() => t.mock.timers.tick(999)); assert.ok(f.impressions.every(args => args[2] !== "following"));
  f.act(() => t.mock.timers.tick(1)); assert.equal(f.impressions.filter(args => args[2] === "following").length, 1);
});

for (const change of ["unmount", "suspense", "route", "account", "scope", "background"]) test(`actual Feed retires selected-strip callbacks and preview reads on ${change}`, t => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const f = fixture({ feedScreen: true, selectedFilter: "local", strict: true }); t.after(f.close);
  const stale = f.all().find(n => n.props?.accessibilityLabel === "News feed").props.onPress;
  const g = dragPage(f, 120); f.flush(); f.ready("following"); const request = f.reads.at(-1);
  if (change === "unmount") f.close();
  if (change === "suspense") { f.suspend(true); f.suspend(false); }
  if (change === "route") f.render({ routeCurrent: false, visible: false });
  if (change === "account") f.render({ accountId: "account-B" });
  if (change === "scope") f.render({ swipeScope: {} });
  if (change === "background") f.render({ appActive: false });
  f.act(stale); release(g, { x: 400 }); g.onFinalize(); f.finish(); f.flush();
  assert.deepEqual(f.writes, []); assert.equal(request.args.signal.aborted, true);
});

test("same-filter explicit tap cancels actual pending preview without saving the selected choice", t => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const f = fixture({ feedScreen: true, selectedFilter: "local" }); t.after(f.close);
  const g = dragPage(f, 120); f.flush(); f.ready("following"); release(g, { x: 400 }); g.onFinalize(); f.flush();
  f.press("Local feed"); f.finish(); f.flush();
  assert.deepEqual(f.writes, []); assert.equal(f.lists().length, 1); assert.equal(f.reads[0].args.signal.aborted, true);
});

test("disabled iOS social wrapper exposes explicit controls without mutation or page exclusion", t => {
  const f = fixture({ component: "social-ios" }); t.after(f.close); f.render({ enabled: false });
  assert.equal(f.all().filter(n => n.type === "GestureDetector").length, 0);
  assert.deepEqual(f.calls, []);
  f.act(f.all().find(n => n.type === "ExplicitButton").props.onPress);
  assert.deepEqual(f.calls, ["explicit"]);
});

for (const kind of ["vertical", "horizontal", "nested", "input"]) test(`local pager preserves native ${kind} arbitration`, t => {
  const f = fixture({ component: "tabs", page: true, pager: true, scrollChild: kind }); t.after(f.close);
  const detectors = f.all().filter(n => n.type === "GestureDetector");
  assert.equal(detectors.length, kind === "nested" ? 3 : 2);
  if (kind === "vertical") assert.ok(detectors[1].props.gesture.handlers.simultaneousWithExternalGesture);
  else {
    const composition = detectors.at(-1).props.gesture;
    const observer = Array.isArray(composition.simultaneous) ? composition.simultaneous.at(-1) : composition;
    const manager = { begin: noop, fail: noop, activate: () => assert.fail("exclusion never activates") };
    down(f.gesture); observer.handlers.onTouchesDown({}, manager);
    f.gesture.onTouchesMove({ allTouches: [{ absoluteX: 100, absoluteY: 200 }], numberOfTouches: 1 }, manager);
    observer.handlers.onTouchesUp({}, manager); release(f.gesture); f.gesture.onFinalize(); f.flush();
    assert.equal(f.pages().length, 1); assert.deepEqual(f.calls, []);
    assert.equal(observer.handlers.cancelsTouchesInView, false);
  }
});

test("fixed Feed navigation and body header contribute one original strip-to-card gap", t => {
  const f = fixture({ feedScreen: true }); t.after(f.close);
  const flatten = style => Array.isArray(style) ? Object.assign({}, ...style.filter(Boolean).map(flatten)) : style || {};
  const fixed = f.all().find(node => node.props?.testID === "feed-fixed-navigation");
  const navigation = flatten(fixed.children[0].props.style);
  const list = f.lists()[0];
  const bodyHeader = flatten(list.props.ListHeaderComponent.props.style);
  const content = flatten(list.props.contentContainerStyle);
  assert.equal(navigation.marginBottom, 0, "fixed chrome does not duplicate the body gap");
  assert.equal(navigation.marginBottom + bodyHeader.marginBottom + content.paddingTop, 26);
  assert.equal(bodyHeader.marginBottom, 22, "optional content retains its existing trailing gap");
  assert.equal(content.paddingTop, 4);
});


test("installed RN absolute fill gives every real local pane native viewport bounds", t => {
  assert.equal(installedStyleSheet.absoluteFillObject, undefined, "RN 0.86 removed the legacy property");
  assert.deepEqual(installedStyleSheet.absoluteFill, { position: "absolute", left: 0, right: 0, top: 0, bottom: 0 });
  const f = fixture({ component: "tabs", page: true, pager: true, active: "everyone" }); t.after(f.close);
  const check = key => {
    const style = f.surface(key).props.style[0];
    for (const [property, value] of Object.entries(installedStyleSheet.absoluteFill)) assert.equal(style[property], value, `${key} ${property}`);
  };
  check("everyone"); dragPage(f); f.flush(); check("news");
  const track = f.all().find(node => node.props?.testID === "feed-filter-swipe-rail");
  assert.equal(track.props.style.flex, 1); assert.equal(track.props.style.overflow, "hidden");
});
