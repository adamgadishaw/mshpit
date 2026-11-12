import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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
const flattenFile = require.resolve("react-native/Libraries/StyleSheet/flattenStyle");
const flattenCode = transformSync(readFileSync(flattenFile, "utf8"), { filename: flattenFile, babelrc: false, configFile: false,
  presets: [[require("babel-preset-expo"), { platform: "ios" }]], caller: { name: "metro", platform: "ios", supportsStaticESM: false } }).code;
const flattenModule = { exports: {} };
new Function("require", "module", "exports", flattenCode)(require, flattenModule, flattenModule.exports);
const styleModule = { exports: {} };
new Function("require", "module", "exports", "__DEV__", styleCode)(name => name.startsWith("@babel/") ? require(name) : name === "./flattenStyle" ? flattenModule.exports : name.includes("PixelRatio")
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
    createInstance: (type, props) => ({ type, props, children: [], focus() {}, scrollToEnd() {}, scrollTo(options) { this.scrollTarget = options; } }), createTextInstance: text => ({ text }),
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
function fixture({ component = "rail", strict = false, reader = false, reduced = false, onCommit, onChange, nativeReader = false, retained = false, page = false, excludedChild = false, active = "following", entryDirection = 0, scrollChild = null, pager = false, shell = false, scrollRef = null, scrollProps = {}, feedScreen = false, discoverScreen = false, selectedFilter = "everyone" } = {}) {
  const dimensions = { width: 412, fontScale: 1 };
  const scrolls = [], titleOffsets = [];
  const renderer = createRenderer(), gestures = [], queue = [], calls = [], shared = [], reactions = [], springs = [], timings = [], animatedStyles = [], appListeners = new Set(), appHistory = [], springCompletions = [], canceledAnimations = [];
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
    "react-native": { AppState: { currentState: "active", addEventListener: (_event, callback) => { appListeners.add(callback); appHistory.push(callback); return { remove: () => appListeners.delete(callback) }; } }, AccessibilityInfo: { announceForAccessibility: noop }, View: "View", Text: "Text", ScrollView: "ScrollView", FlatList: "FlatList", TextInput: "TextInput", Pressable: "Pressable", StyleSheet: installedStyleSheet, useWindowDimensions: () => dimensions },
    "react-native-reanimated": { __esModule: true, default: { View: "AnimatedView", Text: "AnimatedText", createAnimatedComponent: Component => Component }, ReduceMotion: { System: "system" }, useSharedValue, cancelAnimation: value => canceledAnimations.push(value),
      useAnimatedProps: f => ({ ...f(), __animate: f }), useAnimatedStyle: f => { animatedStyles.push(f); return { ...f(), __animate: f }; }, useAnimatedReaction: (prepare, react) => {
        const ref = React.useRef(null); if (!ref.current) { ref.current = {}; reactions.push(ref.current); }
        Object.assign(ref.current, { prepare, react });
        React.useLayoutEffect(() => { ref.current.active = true; return () => { ref.current.active = false; }; }, []);
      }, useDerivedValue: callback => { const current = React.useRef(callback); current.current = callback; return React.useMemo(() => ({ get: () => current.current() }), []); },
      useScrollOffset: ref => { const offset = useSharedValue(0); React.useEffect(() => { titleOffsets.push({ ref, offset }); }, [ref, offset]); return offset; },
      useAnimatedRef: () => { const ref = React.useRef(null); if (!ref.current) { const bind = node => { bind.current = node; }; ref.current = bind; } return ref.current; }, useAnimatedScrollHandler: handlers => handlers,
      scrollTo: (ref, x, y, animated) => { scrolls.push({ target: ref.current, x, y, animated }); }, withSpring: (value, config, done) => { springs.push(config); springCompletions.push(done); return value; }, withTiming: (value, config, done) => { timings.push({ value, config, done }); return value; } },
    "react-native-worklets": { scheduleOnRN: (fn, ...args) => { queue.push(() => fn(...args)); }, scheduleOnUI: (fn, ...args) => { if (holdUI) uiQueue.push(() => fn(...args)); else fn(...args); } },
    "../theme": { colors: { bg: "bg", surface: "surface" }, font: "System" }, "./Icon": "Icon", "./BrandMark": "BrandMark",
    "../hooks/useReducedMotion": () => reduced, "../hooks/useScreenReaderEnabled": { __esModule: true, default: () => reader,
      getConfirmedScreenReaderEnabled: () => confirmed,
      subscribeConfirmedScreenReaderEnabled: callback => { const entry = { callback, active: true }; confirmedSubscriptions.push(entry); return () => { entry.active = false; }; } },
    "react-native-gesture-handler": { GestureDetector: p => React.createElement("GestureDetector", p, React.cloneElement(React.Children.only(p.children), { collapsable: false })), Gesture: { Pan() {
      const handlers = {};
      const builder = new Proxy({ handlers }, { get: (target, name) => name === "handlers" ? handlers : (...values) => { handlers[name] = values.length > 1 ? values : values[0]; return builder; } });
      gestures.push(handlers); return builder;
    } } },
  };
  modules["react-native-gesture-handler"].Gesture.Manual = modules["react-native-gesture-handler"].Gesture.Pan;
  modules["react-native-gesture-handler"].Gesture.Native = modules["react-native-gesture-handler"].Gesture.Pan;
  modules["react-native-gesture-handler"].Gesture.Simultaneous = (...gestures) => ({ simultaneous: gestures });
  modules["../components/PageReturnContext"] = modules["./PageReturnContext"] = { usePageReturn: () => null, PageTitle: p => p.children };
  modules["../hooks/useIOSDetailPresentation"] = () => ({ current: () => true });
  function execute(path) {
    const url = new URL(path, import.meta.url);
    if (!codes.has(path)) codes.set(path, transformSync(readFileSync(url, "utf8"), { filename: fileURLToPath(url), babelrc: false, configFile: false,
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
  modules["../lib/useAppActive"] = () => props.appActive !== false;
  modules["./NativeScrollChrome.ios"] = execute("./NativeScrollChrome.ios.jsx");
  modules["./NativeSwipeRail"] = execute("./NativeSwipeRail.ios.jsx");
  modules["./NativeTabPages.ios"] = execute("./NativeTabPages.ios.jsx");
  modules["./NativeFeedFilterPager.ios"] = execute("./NativeFeedFilterPager.ios.jsx");
  modules["./NativeTabRail"] = execute("./NativeTabRail.ios.jsx");
  let Component = component === "rail" ? modules["./NativeSwipeRail"].default : component === "tabs" ? (pager ? modules["./NativeFeedFilterPager.ios"].default : modules["./NativeTabRail"].default)
    : component === "social" ? execute("./RetainedPostSwipeActions.ios.jsx").default : component === "bar" ? execute("./IosTabBar.ios.jsx").default : execute("./NativeAppHeader.ios.jsx").default;
  const exclusionModule = execute("./NativeTabSwipeExclusion.ios.jsx");
  const Exclusion = exclusionModule.default;
  modules["./NativeTabSwipeExclusion"] = exclusionModule;
  if (component === "social-ios") { modules["./RetainedPostSwipeActions.ios.jsx"] = execute("./RetainedPostSwipeActions.ios.jsx"); Component = execute("./PostSwipeActions.ios.jsx").default; }
  modules["../hooks/useNativeTabPreview"] = execute("../hooks/useNativeTabPreview.ios.js");
  modules["./NativeLargeTitle.ios"] = execute("./NativeLargeTitle.ios.jsx");
  modules["../NativeLargeTitle.ios"] = modules["./NativeLargeTitle.ios"];
  modules["../components/NativeLargeTitle.ios"] = modules["./NativeLargeTitle.ios"];
  const Scroll = execute("./NativeTabScroll.ios.jsx");
  const Child = () => scrollChild === "nested" ? React.createElement(Scroll.ScrollView, { testID: "vertical" }, React.createElement(Scroll.ScrollView, { ...scrollProps, ref: scrollRef, horizontal: true, testID: "horizontal", snapToInterval: 180 }, React.createElement("Pressable", { onPress: () => calls.push("card") }))) : scrollChild ? React.createElement(scrollChild === "input" ? Scroll.TextInput : Scroll.ScrollView, { ...scrollProps, ref: scrollRef, horizontal: scrollChild === "horizontal" }, React.createElement("ExplicitButton")) : excludedChild ? React.createElement(Exclusion, null, React.createElement("ExplicitButton")) : React.createElement("ExplicitButton", { onPress: () => calls.push("explicit") });
  const useContentReady = execute("../hooks/useNativeTabContentReady.ios.js").default;
  const usePreview = execute("../hooks/useNativeTabPreview.ios.js").default;
  let mounted = 0, currentChrome = null, currentSelection = null;
  const unmounted = [], { NativeTabPreviewContext: previewContext, NativeTabReadinessContext: readinessContext } = require("./nativeTabPreviewContext.mjs");
  function ActualPage({ tab }) {
    const identity = React.useRef(++mounted).current;
    const preview = usePreview();
    useContentReady(props.contentReady !== false);
    React.useEffect(() => () => unmounted.push(identity), []);
    return React.createElement("ActualPage", { tab, identity, preview }, React.createElement(Child));
  }
  if (pager) { props.renderPage = tab => React.createElement(ActualPage, { tab }); props.member = true; }
  const reads = [], writes = [], impressions = [], dwell = [], leaseWrites = [], introductions = [], browseRenders = [];
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
    modules["../components/NativeTabScroll"] = execute("./NativeTabScroll.ios.jsx");
    modules["../hooks/useNativeTabPreview"] = execute("../hooks/useNativeTabPreview.ios.js");
    modules["../hooks/useNativeTabContentReady"] = execute("../hooks/useNativeTabContentReady.ios.js");
    modules["../hooks/useIOSFeedReturn"] = execute("../hooks/useIOSFeedReturn.ios.js");
    modules["../hooks/feedHeadStatus"] = { useFeedHeadStatus: () => ({ status: "ready", verified: true }) };
    modules["../hooks/feedImageRetry"] = { FeedImageRetryProvider: p => p.children, useFeedImageRetry: () => ({ value: null, isCurrent: () => true, accept: noop }) };
    modules["../lib/useAppActive"] = () => props.appActive !== false;
    modules["../lib/persist"] = { load: (key, fallback) => persisted.get(key) ?? fallback, save: (key, value) => { writes.push([key, value]); persisted.set(key, value); } };
    modules["../hooks/useIOSFeedSelection"] = execute("../hooks/useIOSFeedSelection.ios.js");
    modules["../lib/lazyWithRetry"] = { lazyWithRetry: () => "OptionalPanel" };
    modules["../theme"] = { colors: {}, radius: {}, shadow: {}, mono: "mono" };
    const interactions = { useNewsInteractions: () => ({ session: { id: props.accountId }, authReady: true, blockedIds: props.blockedIds || [], mutedIds: [], removedIds: [], followedArtists: [] }) };
    modules["./NewsInteractionContext"] = interactions;
    modules["../components/news/NewsInteractionContext"] = interactions;
    const read = (kind, args) => new Promise(resolve => reads.push({ kind, args, resolve }));
    modules["../../lib/diagnostics"] = { toAppError: error => error };
    modules["./useIOSDetailPresentation.js"] = execute("../hooks/useIOSDetailPresentation.js");
    modules["../../hooks/useIOSDetailPresentation"] = execute("../hooks/useIOSDetailPresentation.ios.js");
    modules["./socialReactionsApi"] = { readFollowingFeed: args => read("following", args), readLocalFeed: async () => ({posts:[{id:"nearby",review:"Local post"}],nextCursor:null}), subscribeSocialReactionChanges: () => noop };
    modules["../features/socialReactions/useFollowingFeed"] = execute("../features/socialReactions/useFollowingFeed.ios.js");
    modules["../../lib/newsDeskApi"] = { fetchNewsDeskStories: args => read("news", args) };
    modules["../components/news/useNewsDeskStories"] = execute("./news/useNewsDeskStories.ios.js");
    modules["../components/news/useNewsIntroduction"] = enabled => { introductions.push(enabled); return { post: null, dismiss: noop }; };
    for (const name of ["TicketStub", "Icon", "SuggestedPittersRail", "news/NewsStoryCard"]) modules["../components/" + name] = name;
    modules["../components/VinylRefreshBoundary"] = p => p.children;
    modules["./FeedScreen.jsx"] = execute("../screens/FeedScreen.jsx");
    modules["../components/NativeFeedFilterPager.ios"] = modules["./NativeFeedFilterPager.ios"];
    const Feed = execute("../screens/FeedScreen.ios.jsx").default;
    const Header = execute("./NativeAppHeader.ios.jsx").default;
    const { NativeScrollChromeProvider, NativeScrollChromeContent, NativeScrollChromeContext } = modules["./NativeScrollChrome.ios"];
    const useSelection = modules["../hooks/useIOSFeedSelection"].default;
    function ObserveChrome() { currentChrome = React.useContext(NativeScrollChromeContext); return null; }
    Component = p => {
      const owned = useSelection(p.accountId), selection = p.feedSelection || owned;
      currentSelection = selection;
      return React.createElement(NativeScrollChromeProvider, { scope: p.swipeScope, page: "feed", enabled: p.swipeEnabled && p.visible && p.appActive !== false },
        React.createElement(ObserveChrome),
        React.createElement(Header, { active: "feed", loggedIn: p.loggedIn, feedSelection: selection, swipeEnabled: p.swipeEnabled && p.visible && p.appActive !== false, isCurrentSwipeRoute: p.isCurrentSwipeRoute }),
        React.createElement(NativeScrollChromeContent, null, React.createElement(Feed, { ...p, feedSelection: selection })));
    };
    props = { ...props, feed: [{ id: "global", review: "Global post" }], localFeed: [{ id: "nearby", review: "Local post" }], loggedIn: true, visible: true,
      swipeEnabled: true, swipeScope: {}, feedPresentation: { current: () => props.routeCurrent !== false }, isCurrentSwipeRoute: () => props.routeCurrent !== false,
      feedReturn: { key: "lease-A", current: () => props.routeCurrent !== false, read: () => null, save: value => leaseWrites.push(value), clear: () => leaseWrites.push("clear") },
      onImpression: (...args) => impressions.push(args), onDwell: (...args) => dwell.push(args), onLoadMore: () => assert.fail("Preview must not paginate"),
    };
  }
  if (discoverScreen) {
    Object.assign(modules["react-native"], { ActivityIndicator: "ActivityIndicator", Platform: { OS: "ios" } });
    modules["../hooks/useNativeTabPreview"] = execute("../hooks/useNativeTabPreview.ios.js");
    modules["../../hooks/useNativeTabPreview"] = modules["../hooks/useNativeTabPreview"];
    modules["../../hooks/useNativeTabContentReady"] = execute("../hooks/useNativeTabContentReady.ios.js");
    modules["../NativeDiscoverSectionPager.ios"] = execute("./NativeDiscoverSectionPager.ios.jsx");
    modules["../../lib/useAppActive"] = () => props.appActive !== false;
    modules["../../theme"] = { colors: {}, radius: {}, shadow: {}, space: n => n * 4 };
    modules["../Icon"] = "Icon"; modules["../../components/Icon"] = "Icon";
    modules["../NativeTabScroll"] = Scroll; modules["../../components/NativeTabScroll"] = Scroll;
    modules["expo-image"] = { Image: "Image" };
    modules["../VinylRefreshBoundary"] = p => React.createElement("RefreshBoundary", p, p.children);
    modules["./DiscoverEventList"] = "EventList";
    modules["../LiveDiscoveryCards"] = { PopularLoungeCard: "Lounge" };
    modules["../../lib/img"] = { isHttp: uri => /^http/.test(uri), proxied: uri => uri };
    modules["../../hooks/useReducedMotion"] = () => reduced;
    modules["./DiscoverSectionTabs.ios"] = execute("./discover/DiscoverSectionTabs.ios.jsx");
    modules["./DiscoverBrowse.ios"] = execute("./discover/DiscoverBrowse.ios.jsx");
    const Browse = modules["./DiscoverBrowse.ios"].default;
    modules["./DiscoverBrowse.ios"].default = p => { browseRenders.push(p.programme); return React.createElement(Browse, p); };
    class AppError extends Error { constructor(message) { super(message); this.name = "AppError"; this.code = "PIT-NET-001"; this.retryable = true; } }
    modules["../../lib/diagnostics"] = { AppError };
    modules["./useFestivalResource"] = execute("../features/festivals/useFestivalResource.js");
    modules["./useFestivalDay"] = () => "2026-11-09";
    modules["./FestivalCard"] = "FestivalCard";
    modules["../../components/Button"] = "Button";
    modules["./festivalApi.mjs"] = { readFestivals: options => new Promise((resolve, reject) => reads.push({ options, resolve, reject })) };
    const FestivalPanel = execute("../features/festivals/FestivalsPanel.ios.jsx").default;
    const productionScreen = readFileSync(new URL("../screens/DiscoverScreen.jsx", import.meta.url), "utf8");
    const tree = parse(productionScreen, { sourceType: "module", plugins: ["jsx"] });
    const findPanel = node => {
      if (!node || typeof node !== "object") return null;
      if (node.type === "JSXAttribute" && node.name?.name === "renderPanel") return node.value.expression;
      for (const value of Object.values(node)) {
        const result = Array.isArray(value) ? value.map(findPanel).find(Boolean) : findPanel(value);
        if (result) return result;
      }
      return null;
    };
    const panel = findPanel(tree);
    const panelCode = transformSync(`export default (${productionScreen.slice(panel.start, panel.end)});`, { babelrc: false, configFile: false,
      plugins: [[require("@babel/plugin-transform-react-jsx"), { runtime: "automatic" }], require("@babel/plugin-transform-modules-commonjs")] }).code;
    const DeferredFestival = p => { if (props.festivalSuspended) throw sleepForever; return React.createElement(FestivalPanel, p); };
    modules["./useCityResource"] = execute("../features/cities/useCityResource.js");
    modules["./cityApi.mjs"] = { readCityDirectory: options => new Promise((resolve, reject) => reads.push({ options, resolve, reject, kind: "cities" })) };
    modules["../../components/cities/CityDirectoryTiles"] = "CityTiles";
    modules["../../components/cities/CityDirectoryRail"] = "CityRail";
    const Cities = execute("../features/cities/CityDiscoveryTiles.jsx").default;
    modules["./discoverPhotosClientApi"] = { loadDiscoverPhotos: options => new Promise((resolve, reject) => reads.push({ options, resolve, reject, kind: "photos" })) };
    modules["./useDiscoverPhotos"] = execute("../features/discoverPhotos/useDiscoverPhotos.js");
    modules["../../components/discover/DiscoverCommunity"] = { DiscoverPhotos: "PhotoGallery" };
    modules["./DiscoverPhotoPanel.jsx"] = execute("../features/discoverPhotos/DiscoverPhotoPanel.jsx");
    modules["../../components/NativeTabSwipeExclusion"] = exclusionModule;
    const Photos = execute("../features/discoverPhotos/DiscoverPhotoPanel.ios.jsx").default;
    const Browser = execute("./discover/DiscoverSectionBrowser.ios.jsx").default;
    const venueViewStateRef = { current: null };
    Component = p => React.createElement(previewContext.Provider, { value: !!p.outerPreview }, React.createElement(Browser, p));
    props = { ...props, programme: "shows", region: "Worldwide", countries: [{ country: "Worldwide" }],
      chart: { rows: [{ name: "Actual cached artist", genre: "rock" }] }, overviewStatus: "ready", genres: [],
      selectedGenre: null, genreRows: [], genreStatus: "idle", query: "", slides: [], events: [], rangeEvents: [],
      eventRecovery: { kind: "empty", message: "No shows listed" }, eventStatus: "ready", selectedRangeDays: 30,
      eventView: "cards", listView: false, loungeRows: [], swipeScope: {}, swipeEnabled: true,
      isCurrentSwipeRoute: () => props.routeCurrent !== false,
      browseReturn: { key: "discover-A", save: patch => leaseWrites.push(patch) },
      onProgramme: programme => { calls.push(programme); f.render({ programme }); },
      onRegion: region => f.render({ region }),
      renderPanel: (section, preview) => {
        const panelModule = { exports: {} };
        const bindings = { FestivalsPanel: DeferredFestival, CityDiscoveryTiles: Cities, DiscoverPhotoPanel: Photos,
          DiscoverVenues: p => React.createElement("SectionPanel", { ...p, section: "venues" }),
          Suspense: React.Suspense, ActivityIndicator: "ActivityIndicator", colors: {}, region: props.region,
          onOpenFestival: noop, registerFestivalRefresh: fn => introductions.push(fn), registerCityRefresh: fn => introductions.push(fn), registerPhotoRefresh: fn => introductions.push(fn),
          openCity: noop, homeCity: null, session: { id: props.accountId }, venueViewStateRef, venueDirectoryIndex: [], tourDates: [],
          onOpenVenue: noop, onOpen: noop, onOpenVenues: noop, compact: true, width: 412, openPhotos: noop,
          removedIds: [], blockedIds: [],
        };
        new Function("require", "module", "exports", ...Object.keys(bindings), panelCode)(require, panelModule, panelModule.exports, ...Object.values(bindings));
        return panelModule.exports.default(section, preview);
      },
    };
  }
  const Layer = execute("./NativeFeedMediaLayer.jsx").default;
  function Gate() { if (suspended) throw sleepForever; return null; }
  const componentKey = () => pager ? `${props.accountId}:${props.authEpoch || 0}` : component === "social" ? `${props.accountId || "guest"}:${props.post.id}` : "component";
  const f = {
    get chrome() { return currentChrome; }, get selection() { return currentSelection; },
    calls, queue, gestures, shared, reactions, scrolls, titleOffsets, dimensions, springs, timings, animatedStyles, unmounted, reads, writes, impressions, dwell, leaseWrites, introductions, persisted, browseRenders, canceledAnimations,
    springFrame(value) { shared[3].set(value); },
    preferences(next) { reduced = !!next.reduced; reader = !!next.reader; f.render(); },
    holdUI(value) { holdUI = value; }, flushUI() { while (uiQueue.length) uiQueue.shift()(); },
    pages: () => f.all().filter(node => node.type === "ActualPage"),
    lists: () => f.all().filter(node => node.type === "FlatList"),
    press(label) { const button = f.all().find(node => node.props?.accessibilityLabel === label); assert.ok(button, label); f.act(button.props.onPress); },
    surface: tab => f.all().find(node => node.props?.testID === `main-tab-page-${tab}`),
    translation: tab => f.surface(tab).props.style[1].__animate().transform[0].translateX,
    ready(tab) { const surface = f.surface(tab); f.act(() => nodes(surface).find(node => node.props?.onLayout)?.props.onLayout()); f.react(); },
    react() { for (const reaction of reactions.filter(item => item.active)) {
      const next = reaction.prepare(); reaction.react(next, reaction.previous ?? null); reaction.previous = next;
    } },
    appHistory,
    finishSpring(success = true) { springCompletions.at(-1)?.(success); },
    appState(value) { modules["react-native"].AppState.currentState = value; f.act(() => { for (const callback of [...appListeners]) callback(value); }); },
    finish(index = timings.findLastIndex(item => typeof item.done === "function"), success = true) { timings[index]?.done?.(success); }, confirmedSubscriptions, nativeReaderListeners, nativeReaderHistory,
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
    async untilRendered(predicate, message) {
      // An async endpoint and a concurrent React commit can occupy different
      // scheduler turns. Observe the committed result without advancing app timers.
      for (let turn = 0; turn < 20; turn++) {
        await f.settle();
        if (predicate()) return;
      }
      assert.ok(predicate(), message);
    },
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
  const result = transformSync(readFileSync(file, "utf8"), { filename: fileURLToPath(file), babelrc: false, configFile: false,
    presets: [[require("babel-preset-expo"), { platform: "ios" }]], caller: { name: "metro", platform: "ios", supportsStaticESM: true } });
  assert.equal(result.options.filename, fileURLToPath(file));
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
  assert.equal((app.match(/<NativeAppHeader active=\{activeTab\} onChange=\{switchTab\} swipeScope=/g) || []).length, 1);
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
test("primary data loads during drag without delaying release settlement", t => {
  const f = fixture({ component: "tabs", page: true, pager: true }); t.after(f.close);
  f.render({ contentReady: false }); const g = dragPage(f); f.flush(); f.ready("local");
  assert.equal(f.translation("following"), -120, "real screen is visible during loading");
  release(g); g.onFinalize(); f.flush(); assert.equal(f.timings.length, 1);
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
test("real pager reconnect admits a foreground return missed while suspended", t => {
  const f = fixture({ component: "tabs", page: true, pager: true }); t.after(f.close);
  const retired = dragPage(f); f.flush(); f.ready("local");
  release(retired); retired.onFinalize();
  f.appState("background"); f.suspend(true);
  f.appState("active"); f.suspend(false);
  assert.equal(f.gesture.enabled, true, "reconnect reads current OS state without another AppState event");
  f.finish(); f.flush(); assert.deepEqual(f.calls, [], "retired settlement cannot navigate after reconnect");
  const current = dragPage(f); f.flush(); f.ready("local");
  release(current); current.onFinalize(); f.finish(); f.flush();
  assert.deepEqual(f.calls, ["local"], "a fresh swipe works immediately after foreground reconnect");
});
for (const state of ["inactive", "background"]) test(`real pager reconnect denies a missed ${state} transition`, t => {
  const f = fixture({ component: "tabs", page: true, pager: true }); t.after(f.close);
  const retired = dragPage(f); f.flush(); f.ready("local");
  release(retired); retired.onFinalize();
  f.suspend(true); f.appState(state); f.suspend(false);
  assert.equal(f.gesture.enabled, false, "reconnect cannot reuse foreground permission from before suspension");
  const denied = down(f.gesture); assert.equal(denied.failed, 1);
  f.finish(); f.flush(); assert.deepEqual(f.calls, []);
  f.appState("active");
  const current = dragPage(f); f.flush(); f.ready("local");
  release(current); current.onFinalize(); f.finish(); f.flush();
  assert.deepEqual(f.calls, ["local"], "normal foreground notification restores a fresh swipe");
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


test("slow primary GET settles immediately to the real loading UI", t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture({ component: "tabs", page: true, pager: true }); t.after(f.close);
  f.render({ contentReady: false }); const g = dragPage(f); f.flush(); f.ready("local");
  release(g); g.onFinalize(); f.flush(); assert.equal(f.timings.length, 1);
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
  f.render({ swipeScope: {} }); g = dragPage(f); f.flush(); release(g); g.onFinalize(); f.flush();
  oldTimerSetup(); f.act(() => t.mock.timers.tick(2500)); f.react();
  assert.equal(f.timings.length, 0); assert.deepEqual(f.calls, []); assert.equal(f.pages().length, 1);
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

test("actual Feed menu selection changes only the selected retained native pane", async t => {
  const f = fixture({ feedScreen: true }); t.after(f.close);
  f.render({ feedSelection: { filter: "everyone", select: noop } });
  const source = f.lists()[0];
  f.render({ feedSelection: { filter: "local", select: noop } });
  await f.untilRendered(() => f.lists().some(node => node.props.data?.[0]?.id === "nearby"), "Local endpoint result must render");
  const local = nodes(f.surface("local")).find(node => node.type === "FlatList");
  assert.equal(local.props.data[0].id, "nearby");
  assert.equal(nodes(f.surface("everyone")).find(node => node.type === "FlatList"), source);
  assert.equal(f.surface("everyone").props.pointerEvents, "none");
  assert.equal(f.surface("everyone").props.accessibilityElementsHidden, true);
  assert.equal(f.surface("everyone").props.style[2].opacity, 0);
  f.render({ feedSelection: { filter: "everyone", select: noop } });
  assert.equal(nodes(f.surface("everyone")).find(node => node.type === "FlatList"), source);
  assert.equal(f.surface("everyone").props.pointerEvents, "auto");
  assert.deepEqual(f.reads, []);
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

test("Feed title and selected label occupy the ordinary list header rather than fixed chrome", t => {
  const f = fixture({ feedScreen: true }); t.after(f.close);
  const list = f.lists()[0];
  assert.ok(list.props.ListHeaderComponent);
  assert.ok(f.all().some(node => node.props?.accessibilityLabel === "Current feed: For You"));
  assert.equal(f.all().find(node => node.props?.testID === "feed-fixed-navigation"), undefined);
  assert.equal(list.props.ListHeaderComponent.props.style.marginBottom, 22);
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

test("Discover scrolling navigation previews actual Festival read and promotes the same resource instance", async t => {
  const f = fixture({ discoverScreen: true }); t.after(f.close);
  const heading = f.all().find(n => n.props?.testID === "discover-scroll-navigation");
  assert.ok(nodes(f.surface("shows")).includes(heading));
  const before = f.leaseWrites.length;
  const g = dragPage(f); f.flush();
  assert.equal(f.reads.length, 1); assert.equal(f.introductions.length, 0, "preview cannot register refresh");
  assert.equal(f.leaseWrites.length, before, "preview cannot persist scroll or genre");
  assert.equal(f.surface("festivals").props.pointerEvents, "none");
  assert.equal(f.surface("festivals").props.accessibilityElementsHidden, true);
  const loading = f.all().find(n => n.type === "Text" && n.props.children === "Loading festivals…");
  assert.ok(loading, "actual pending state is visible, not backing artwork");
  f.ready("festivals"); release(g); g.onFinalize(); f.flush();
  assert.equal(f.timings.length, 1, "the real loading screen settles without waiting on its GET");
  f.reads[0].resolve({ upcoming: [] }); await f.settle(); f.react();
  assert.equal(f.timings.length, 1); f.finish(); f.flush();
  assert.deepEqual(f.calls, ["festivals"]); assert.equal(f.reads.length, 1, "promotion retains loader instance");
  assert.ok(f.introductions.some(x => typeof x === "function"));
  assert.ok(nodes(f.surface("festivals")).some(n => n.props?.testID === "discover-scroll-navigation"));
  assert.ok(!f.all().includes(heading), "source navigation leaves with its source page");
  assert.ok(f.leaseWrites.some(p => p.scrollY === 0));
});

test("Discover canceled real Festival read aborts without selection or preference writes", t => {
  const f = fixture({ discoverScreen: true }); t.after(f.close);
  const before = f.leaseWrites.length, g = dragPage(f); f.flush(); f.ready("festivals");
  const signal = f.reads[0].options.signal;
  release(g, { x: 245 }); g.onFinalize(); f.finishSpring(); f.flush();
  assert.equal(signal.aborted, true); assert.deepEqual(f.calls, []);
  assert.equal(f.leaseWrites.length, before); assert.equal(f.surface("festivals"), undefined);
});

for (const kind of ["empty", "error", "cached", "refreshing"]) test(`Discover Artists ${kind} is ready without an unselected genre request`, t => {
  const f = fixture({ discoverScreen: true }); t.after(f.close);
  f.render({ programme: "venues", chart: { rows: ["cached", "refreshing"].includes(kind) ? [{ name: "Actual cached artist" }] : [] }, overviewStatus: kind === "error" ? "error" : kind === "refreshing" ? "refreshing" : "ready" });
  const g = dragPage(f, 120); f.flush(); f.ready("artists");
  release(g, { x: 410 }); g.onFinalize(); f.finish(); f.flush();
  assert.deepEqual(f.calls, ["artists"]); assert.equal(f.reads.length, 0);
});

for (const change of ["account", "route", "filter", "tap", "background"]) test(`Discover queued section commit retires across ${change}`, async t => {
  const f = fixture({ discoverScreen: true }); t.after(f.close);
  const g = dragPage(f); f.flush(); f.ready("festivals");
  f.reads[0].resolve({ upcoming: [] }); await f.settle(); f.react();
  release(g); g.onFinalize();
  if (change === "account") f.render({ accountId: "B" });
  if (change === "route") f.render({ swipeScope: {}, routeCurrent: false });
  if (change === "filter") f.render({ selectedRangeDays: 60 });
  if (change === "tap") f.press("Shows");
  if (change === "background") f.appState("background");
  f.finish(); f.flush(); assert.deepEqual(f.calls, []);
});

test("Discover return snapshot is consumed once and a new selection resets source offset", t => {
  const f = fixture({ discoverScreen: true }); t.after(f.close);
  f.render({ accountId: "restored", initialBrowse: { programme: "shows", scrollY: 900 }, programme: "shows" });
  f.press("Artists"); f.press("Shows");
  assert.ok(f.leaseWrites.some(p => p.scrollY === 0));
  const activeScroll = nodes(f.surface("shows")).find(n => n.type === "ScrollView" && !n.props.horizontal);
  f.act(() => activeScroll.props.onLayout({ nativeEvent: { layout: { width: 412, height: 500 } } }));
  f.act(() => activeScroll.props.onContentSizeChange(412, 1800));
  f.render();
  assert.deepEqual(activeScroll.scrollTarget, { y: 0, animated: false }, "returning to a previously visited section must not replay 900px");
  f.act(() => activeScroll.props.onScroll({ nativeEvent: { contentOffset: { y: 31 } } }));
  assert.equal(f.leaseWrites.at(-1).scrollY, 31);
});

for (const section of ["cities", "photos"]) test(`Discover ${section} normal read starts during intent and survives promotion`, async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture({ discoverScreen: true }); t.after(f.close);
  f.render({ programme: section === "cities" ? "venues" : "cities" });
  f.act(() => t.mock.timers.tick(1));
  const before = f.reads.length, g = dragPage(f); f.flush();
  f.act(() => t.mock.timers.tick(1)); f.ready(section);
  assert.equal(f.reads.length, before + 1);
  const request = f.reads.at(-1); assert.equal(request.kind, section);
  const surface = f.surface(section);
  release(g); g.onFinalize(); f.flush(); assert.equal(f.timings.length, 1);
  request.resolve(section === "cities" ? { cities: [] } : []); await f.settle(); f.react();
  f.finish(); f.flush();
  assert.deepEqual(f.calls, [section]); assert.equal(f.surface(section), surface);
  assert.equal(f.reads.length, before + 1);
});

test("Discover failed Festival read settles to truthful error instead of blank content", async t => {
  const f = fixture({ discoverScreen: true }); t.after(f.close);
  const g = dragPage(f); f.flush(); f.ready("festivals");
  release(g); g.onFinalize(); f.flush();
  f.reads[0].reject(new Error("fixture offline")); await f.settle(); f.react(); f.finish(); f.flush();
  assert.deepEqual(f.calls, ["festivals"]);
  assert.ok(f.all().some(n => n.type === "Text" && /Festivals could not load/.test(n.props.children)));
});

test("Discover local pager preserves an inherited preview and cannot write or navigate", t => {
  const f = fixture({ discoverScreen: true }); t.after(f.close);
  const before = f.leaseWrites.length;
  f.render({ outerPreview: true });
  swipe(f.gesture); f.flush(); f.press("Artists");
  assert.deepEqual(f.calls, []); assert.equal(f.leaseWrites.length, before);
  assert.ok(f.all().filter(n => n.type === "Image").every(n => n.props.autoplay === false));
});

test("Discover artist carousels keep their own horizontal gesture ahead of section paging", t => {
  const f = fixture({ discoverScreen: true }); t.after(f.close);
  const observers = f.all().filter(n => n.type === "GestureDetector").map(n => n.props.gesture)
    .filter(g => Array.isArray(g.simultaneous)).map(g => g.simultaneous.at(-1));
  assert.ok(observers.length > 0);
  const manager = { begin: noop, fail: noop, activate: () => assert.fail("exclusion must remain passive") };
  down(f.gesture); observers[0].handlers.onTouchesDown({}, manager);
  f.gesture.onTouchesMove({ allTouches: [{ absoluteX: 100, absoluteY: 200 }], numberOfTouches: 1 }, manager);
  observers[0].handlers.onTouchesUp({}, manager); release(f.gesture); f.gesture.onFinalize(); f.flush();
  assert.deepEqual(f.calls, []); assert.equal(f.reads.length, 0);
});

test("Discover same-section tap cancels a pending detail return restore", t => {
  const f = fixture({ discoverScreen: true }); t.after(f.close);
  f.render({ accountId: "restored", initialBrowse: { programme: "shows", scrollY: 900 } });
  const scroll = nodes(f.surface("shows")).find(n => n.type === "ScrollView" && !n.props.horizontal);
  f.press("Shows");
  f.act(() => scroll.props.onLayout({ nativeEvent: { layout: { width: 412, height: 500 } } }));
  f.act(() => scroll.props.onContentSizeChange(412, 1800)); f.render();
  assert.deepEqual(scroll.scrollTarget, { y: 0, animated: false });
  assert.deepEqual(f.calls, []);
});

test("Discover slow Festival GET commits its real loading state without a readiness pause", t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture({ discoverScreen: true }); t.after(f.close);
  const g = dragPage(f); f.flush();
  assert.equal(f.translation("shows"), 0, "source is not uncovered before incoming native layout");
  f.ready("festivals"); release(g); g.onFinalize(); f.flush();
  assert.equal(f.timings.length, 1);
  f.finish(); f.flush();
  assert.deepEqual(f.calls, ["festivals"]);
  assert.ok(f.all().some(n => n.type === "Text" && n.props.children === "Loading festivals…"));
  assert.equal(f.reads.length, 1);
});

test("Discover tab tap interrupts waiting release and stale load completion cannot navigate", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture({ discoverScreen: true }); t.after(f.close);
  const g = dragPage(f); f.flush(); f.ready("festivals"); release(g); g.onFinalize(); f.flush();
  f.press("Artists");
  assert.equal(f.reads[0].options.signal.aborted, true);
  f.reads[0].resolve({ upcoming: [] }); await f.settle();
  f.act(() => t.mock.timers.tick(2500)); f.react(); f.finish(); f.flush();
  assert.deepEqual(f.calls, ["artists"]); assert.equal(f.surface("festivals"), undefined);
});

test("Discover reversal replaces only intended neighbor and aborts abandoned Festival reads", t => {
  const f = fixture({ discoverScreen: true }); t.after(f.close); f.render({ programme: "artists" });
  const source = f.surface("artists"), g = dragPage(f); f.flush(); f.ready("venues");
  g.onUpdate({ absoluteX: 380 }); f.flush(); f.ready("festivals");
  assert.equal(f.surface("venues"), undefined); assert.equal(f.reads.length, 1);
  g.onUpdate({ absoluteX: 140 }); f.flush(); f.ready("venues");
  assert.equal(f.surface("festivals"), undefined); assert.equal(f.reads[0].options.signal.aborted, true);
  assert.equal(f.surface("artists"), source);
  assert.equal(f.all().filter(n => /^main-tab-page-/.test(n.props?.testID || "")).length, 2);
  release(g, { x: 245 }); g.onFinalize(); f.finishSpring(); f.flush();
  assert.deepEqual(f.calls, []); assert.equal(f.surface("artists"), source);
});


test("Discover release starts settlement before its primary network read resolves", t => {
  const f = fixture({ discoverScreen: true }); t.after(f.close);
  const g = dragPage(f); f.flush(); f.ready("festivals");
  assert.equal(f.reads.length, 1);
  release(g); g.onFinalize(); f.flush();
  assert.equal(f.timings.length, 1, "real Festival loading UI must not wait on the GET");
  f.finish(); f.flush();
  assert.deepEqual(f.calls, ["festivals"]);
  assert.equal(f.reads.length, 1, "promotion must retain the in-flight request");
});

test("Discover intent and readiness do not rerender the unchanged outgoing pane", t => {
  const f = fixture({ discoverScreen: true }); t.after(f.close);
  const before = f.browseRenders.filter(section => section === "shows").length;
  dragPage(f); f.flush(); f.ready("festivals");
  assert.equal(f.browseRenders.filter(section => section === "shows").length, before);
  f.render({ eventStatus: "loading" });
  assert.ok(f.browseRenders.filter(section => section === "shows").length > before, "real parent data still reaches source");
});


test("regrabbing a returning page follows its residual offset and retires the old spring", t => {
  const f = fixture({ component: "tabs", page: true, pager: true }); t.after(f.close);
  let g = dragPage(f); f.flush(); f.ready("local");
  release(g, { x: 240 }); g.onFinalize();
  // Synthetic in-flight animation frame, not a device timing measurement.
  f.springFrame(-60);
  const before = f.canceledAnimations.length;
  g = dragPage(f, -20);
  assert.equal(f.canceledAnimations.length, before + 1);
  assert.equal(f.translation("following"), -80, "20px movement continues from the -60px spring offset");
  assert.equal(f.translation("local"), 300);
  f.flush(); f.react(); f.finishSpring(); f.flush();
  assert.equal(f.pages().length, 2, "old cancellation cannot remove the regrabbed neighbor");
  assert.equal(f.translation("following"), -80);
  release(g, { x: 245 }); g.onFinalize(); f.finishSpring(); f.flush();
  assert.deepEqual(f.calls, []);
});


test("accepted delayed parent promotion cannot trigger premature source recovery", t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let f;
  f = fixture({ component: "tabs", page: true, pager: true, onChange: target => {
    setTimeout(() => f.render({ active: target }), 30); return true;
  } }); t.after(f.close);
  const g = dragPage(f); f.flush(); f.ready("local");
  release(g); g.onFinalize(); f.finish(); f.flush();
  assert.equal(f.translation("local"), 0);
  const before = f.springs.length;
  f.act(() => t.mock.timers.tick(5));
  assert.equal(f.translation("local"), 0);
  assert.equal(f.springs.length, before, "accepted navigation cannot spring backward while React is pending");
  f.act(() => t.mock.timers.tick(25));
  assert.deepEqual(f.pages().map(p => p.props.tab), ["local"]);
  assert.equal(f.translation("local"), 0);
});

test("explicitly declined local selection recovers and permits another gesture", t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture({ component: "tabs", page: true, pager: true, onChange: () => false }); t.after(f.close);
  let g = dragPage(f); f.flush(); f.ready("local");
  release(g); g.onFinalize(); f.finish(); f.flush();
  f.act(() => t.mock.timers.tick(0));
  assert.equal(f.translation("following"), 0);
  assert.equal(f.springs.length, 1);
  f.finishSpring(); f.flush();
  g = dragPage(f); f.flush(); f.ready("local");
  assert.equal(f.translation("following"), -120);
});

test("actual Discover renderPanel cannot advertise a lazy Festival fallback as a ready screen", t => {
  const f = fixture({ discoverScreen: true }); t.after(f.close);
  f.render({ festivalSuspended: true });
  const g = dragPage(f); f.flush();
  assert.equal(f.reads.length, 0, "suspended module has not mounted its resource");
  assert.equal(nodes(f.surface("festivals")).filter(n => n.props?.onLayout).length, 0);
  release(g); g.onFinalize(); f.flush();
  assert.equal(f.timings.length, 0);
  assert.equal(f.translation("shows"), 0);
  f.render({ festivalSuspended: false }); f.ready("festivals");
  assert.equal(f.reads.length, 1);
  assert.equal(f.timings.length, 1, "actual module layout, not GET completion, releases the gesture");
  f.finish(); f.flush();
  assert.deepEqual(f.calls, ["festivals"]);
  assert.equal(f.reads.length, 1);
});


test("completed cancellation cannot lend stale layout to a new gesture before its UI clear", t => {
  const f = fixture({ component: "tabs", page: true, pager: true }); t.after(f.close);
  let g = dragPage(f); f.flush(); f.ready("local");
  const ready = f.shared.find(value => value.get()?.direction === "negative" && value.get()?.gesture);
  const setReady = ready.set;
  const delayedClears = [];
  ready.set = value => value === null ? delayedClears.push(value) : setReady(value);
  release(g, { x: 240 }); g.onFinalize(); f.finishSpring(); f.flush();
  assert.equal(f.pages().length, 1);
  assert.ok(delayedClears.length > 0, "simulate React native unmount before shared readiness clear");
  g = dragPage(f, -60);
  assert.equal(f.translation("following"), 0, "old measured page has already unmounted");
  ready.set = setReady; setReady(null);
  f.flush(); f.ready("local");
  assert.equal(f.translation("following"), -60);
});

test("vertical and reserved-edge retouches do not grab a returning page animation", t => {
  const f = fixture({ component: "tabs", page: true, pager: true }); t.after(f.close);
  const g = dragPage(f); f.flush(); f.ready("local");
  release(g, { x: 240 }); g.onFinalize(); f.springFrame(-60);
  const before = f.canceledAnimations.length;
  down(g, { x: 5 });
  assert.equal(f.canceledAnimations.length, before);
  const manager = down(g);
  g.onTouchesMove({ allTouches: [{ absoluteX: 262, absoluteY: 240 }], numberOfTouches: 1 }, manager);
  assert.equal(manager.failed, 1);
  assert.equal(f.canceledAnimations.length, before);
});


test("return after a reversed unlaid-out candidate cannot reuse the old neighbor measurement", t => {
  const f = fixture({ component: "tabs", page: true, pager: true, active: "local" }); t.after(f.close);
  let g = dragPage(f); f.flush(); f.ready("everyone");
  const ready = f.shared.find(value => value.get()?.direction === "negative" && value.get()?.gesture);
  const setReady = ready.set;
  ready.set = value => { if (value !== null) setReady(value); };
  g.onUpdate({ absoluteX: 380 }); f.flush();
  assert.equal(f.surface("everyone"), undefined); assert.ok(f.surface("following"));
  release(g, { success: false, x: 380 }); g.onFinalize();
  g = dragPage(f, -20);
  assert.equal(f.translation("local"), 0, "the old opposite neighbor has been removed");
  ready.set = setReady; setReady(null);
});

test("same-direction Discover finger updates stay on the UI path without React or RN dispatch", t => {
  const f = fixture({ discoverScreen: true }); t.after(f.close);
  const g = dragPage(f); f.flush(); f.ready("festivals");
  const renders = f.browseRenders.length, queued = f.queue.length;
  for (let i = 0; i < 100; i++) g.onUpdate({ absoluteX: 140 - i / 10 });
  assert.equal(f.queue.length, queued);
  assert.equal(f.browseRenders.length, renders);
  assert.equal(f.translation("shows"), -129.9);
});

test("direction reversal cannot reuse an unmounted same-gesture candidate before its UI clear", t => {
  const f = fixture({ component: "tabs", page: true, pager: true, active: "local" }); t.after(f.close);
  const g = dragPage(f); f.flush(); f.ready("everyone");
  const ready = f.shared.find(value => value.get()?.direction === "negative" && value.get()?.gesture);
  const setReady = ready.set;
  ready.set = value => { if (value !== null) setReady(value); };
  g.onUpdate({ absoluteX: 380 }); f.flush();
  assert.equal(f.surface("everyone"), undefined); assert.ok(f.surface("following"));
  g.onUpdate({ absoluteX: 140 });
  assert.equal(f.translation("local"), 0, "the returning direction needs its new actual candidate layout");
  ready.set = setReady; setReady(null);
  f.flush(); f.ready("everyone");
  assert.equal(f.translation("local"), -120);
});


test("retained swipe controller is iOS-only and the Android native implementation remains byte-identical", () => {
  const native = readFileSync(new URL("./PostSwipeActions.native.jsx", import.meta.url));
  assert.equal(createHash("sha256").update(native).digest("hex"), "a17d0593e0e58a340d3436b40d2b955cb26a6fe49a9544e137417aed05bf9c90",
    "retained Feed ownership must not alter Android's original native swipe behavior");
  const wrapper = readFileSync(new URL("./PostSwipeActions.ios.jsx", import.meta.url), "utf8");
  assert.match(wrapper, /import Component from "\.\/RetainedPostSwipeActions\.ios\.jsx"/);
  assert.doesNotMatch(wrapper, /PostSwipeActions\.native/);
  const { resolve } = require("metro-resolver");
  const context = { originModulePath: fileURLToPath(new URL("../../App.js", import.meta.url)), assetExts: new Set(), sourceExts: ["js", "jsx", "json", "ts", "tsx"],
    mainFields: ["react-native", "browser", "main"], getPackageForModule: () => null,
    fileSystemLookup(path) { try { const stat = statSync(path); return { exists: true, type: stat.isDirectory() ? "d" : "f", realPath: realpathSync(path) }; } catch { return { exists: false }; } },
  };
  for (const [platform, suffix] of [["ios", ".ios"], ["android", ".native"], ["web", ""]]) {
    const resolved = resolve({ ...context, preferNativePlatform: platform !== "web" }, "./src/components/PostSwipeActions", platform);
    assert.equal(resolved.filePath, fileURLToPath(new URL(`./PostSwipeActions${suffix}.jsx`, import.meta.url)));
  }
});

// Production DiscoverOwner -> section pager -> rail -> measured tab strip.
// Native glyph measurements and the UI scheduler are synthetic, not device QA.
const sectionKeys = ["shows", "festivals", "artists", "venues", "cities", "photos"];
const sectionNodes = f => nodes(f.all().find(n => n.props?.testID?.startsWith("main-tab-page-") && n.props.pointerEvents === "auto") || f.all().find(n => n.props?.testID?.startsWith("main-tab-page-")));
const tabStrip = f => sectionNodes(f).find(node => node.props?.testID === "discover-section-tabs");
const tabIndicator = f => sectionNodes(f).find(node => node.props?.testID === "discover-section-indicator").props.style[1].__animate();
const tabButtons = f => sectionNodes(f).filter(node => node.props?.accessibilityRole === "tab");
function measureSectionTabs(f, widths = [76, 110, 90, 95, 80, 100], viewport = 300) {
  const strip = tabStrip(f);
  let x = 3;
  f.act(() => {
    strip.props.onLayout({ nativeEvent: { layout: { width: viewport } } });
    for (const [index, key] of sectionKeys.entries()) {
      tabButtons(f).find(node => node.props.nativeID === `discover-tab-${key}`).props.onLayout({ nativeEvent: { layout: { x, width: widths[index] } } });
      x += widths[index];
    }
    strip.props.onContentSizeChange(x + 3, 50);
    f.all().find(node => node.props?.testID === "discover-section-swipe-rail").props.onLayout({ nativeEvent: { layout: { width: 400 } } });
  });
  f.react();
}
const closeTo = (actual, expected) => assert.ok(Math.abs(actual - expected) < .0001, `${actual} != ${expected}`);

test("Discover's Feed-style strip follows actual held page motion before selection commits", t => {
  const f = fixture({ discoverScreen: true }); t.after(f.close); measureSectionTabs(f);
  const fixed = f.all().find(node => node.props?.testID === "discover-scroll-navigation");
  assert.equal(tabButtons(f).length, 6);
  assert.equal(tabStrip(f).props.horizontal, true);
  assert.equal(tabStrip(f).props.style.borderRadius, 13);
  assert.equal(f.all().find(node => node.props?.testID === "discover-section-indicator").props.style[0].borderRadius, 10);
  assert.ok(tabButtons(f).every(node => node.props.style({ pressed: false })[0].minHeight === 44));
  assert.ok(nodes(fixed).includes(tabStrip(f)));
  const g = dragPage(f, -100); f.flush();
  assert.equal(tabIndicator(f).transform[0].translateX, 3, "readiness pins the label with the covered source");
  f.ready("festivals");
  closeTo(tabIndicator(f).transform[0].translateX, 22); closeTo(tabIndicator(f).width, 84.5);
  assert.equal(f.translation("shows"), -100);
  assert.deepEqual(f.calls, []);
  assert.equal(tabButtons(f).find(n => n.props.accessibilityState.selected).props.accessibilityLabel, "Shows");
  const queued = f.queue.length, renders = f.browseRenders.length;
  for (const dx of [-180, -40, -120]) { g.onUpdate({ absoluteX: 260 + dx }); f.react(); closeTo(tabIndicator(f).transform[0].translateX, 3 - dx / 400 * 76); }
  assert.equal(f.queue.length, queued); assert.equal(f.browseRenders.length, renders, "finger frames never rerender pages");
});

test("Discover strip cancellation and reversal follow source geometry without selecting a preview", t => {
  const f = fixture({ discoverScreen: true }); t.after(f.close); f.render({ programme: "artists" }); measureSectionTabs(f);
  const g = dragPage(f, 100); f.flush(); f.ready("festivals");
  closeTo(tabIndicator(f).transform[0].translateX, 161.5);
  g.onUpdate({ absoluteX: 160 }); f.flush();
  assert.equal(tabIndicator(f).transform[0].translateX, 189, "unready reversed page stays pinned");
  f.ready("venues"); closeTo(tabIndicator(f).transform[0].translateX, 211.5);
  release(g, { x: 240, success: false }); g.onFinalize();
  f.springFrame(-40); f.react(); closeTo(tabIndicator(f).transform[0].translateX, 198);
  f.springFrame(0); f.finishSpring(); f.flush(); f.react();
  assert.equal(tabIndicator(f).transform[0].translateX, 189); assert.deepEqual(f.calls, []);
});

test("Discover strip and page share continuous geometry through a delayed atomic promotion", t => {
  const f = fixture({ discoverScreen: true }); t.after(f.close); measureSectionTabs(f);
  const strip = tabStrip(f), g = dragPage(f); f.flush(); f.ready("festivals"); release(g); g.onFinalize();
  assert.equal(tabIndicator(f).transform[0].translateX, 79);
  const candidateStrip = nodes(f.surface("festivals")).find(n => n.props?.testID === "discover-section-tabs");
  f.holdUI(true); f.finish(); f.flush(); measureSectionTabs(f);
  assert.deepEqual(f.calls, ["festivals"]); assert.equal(tabIndicator(f).transform[0].translateX, 79);
  assert.equal(tabButtons(f).find(n => n.props.accessibilityState.selected).props.accessibilityLabel, "Festivals");
  f.flushUI(); f.react(); assert.equal(tabIndicator(f).transform[0].translateX, 79);
  assert.notEqual(tabStrip(f), strip, "navigation scrolls with each page");
  assert.equal(tabStrip(f), candidateStrip, "promotion retains the preview navigation instance");
});

test("Discover scroll visibility follows unequal-width interpolation and far section taps", t => {
  const f = fixture({ discoverScreen: true }); t.after(f.close); f.render({ programme: "artists" }); measureSectionTabs(f);
  assert.equal(f.scrolls.at(-1).x, 84);
  const g = dragPage(f, -100); f.flush(); f.ready("venues");
  closeTo(f.scrolls.at(-1).x, 107.125);
  f.press("Photos"); measureSectionTabs(f); f.react();
  assert.equal(f.scrolls.at(-1).x, 257); assert.equal(f.scrolls.at(-1).animated, false);
  assert.equal(tabIndicator(f).transform[0].translateX, 454);
  assert.deepEqual(f.calls, ["photos"]); g.onFinalize(); f.finish(); f.flush(); assert.deepEqual(f.calls, ["photos"]);
});

test("idle manual strip browsing stays free and retires pending page settlement", t => {
  const f = fixture({ discoverScreen: true }); t.after(f.close); measureSectionTabs(f);
  const g = dragPage(f); f.flush(); f.ready("festivals"); release(g); g.onFinalize();
  const scroll = tabStrip(f).props.onScroll;
  scroll.onBeginDrag({}); const count = f.scrolls.length; f.flush(); f.react();
  assert.equal(f.scrolls.length, count, "cancel/rebase cannot fight the finger scrolling the header");
  scroll.onEndDrag({}); scroll.onMomentumEnd({});
  f.react(); f.react(); f.finish(); f.flush(); f.react();
  assert.equal(f.scrolls.length, count, "idle selection never recenters a manually browsed strip");
  assert.deepEqual(f.calls, []);
  f.press("Cities"); measureSectionTabs(f); f.react(); assert.equal(f.scrolls.at(-1).x, 257);
});

for (const changed of ["font", "width"]) test(`Discover ${changed} change replaces measurements without remounting the page`, t => {
  const f = fixture({ discoverScreen: true }); t.after(f.close); f.render({ programme: "artists" }); measureSectionTabs(f);
  const page = f.surface("artists"), strip = tabStrip(f);
  f.dimensions[changed === "font" ? "fontScale" : "width"] = changed === "font" ? 3.2 : 760; f.render();
  assert.equal(f.surface("artists"), page); assert.notEqual(tabStrip(f), strip);
  assert.equal(tabIndicator(f).opacity, 0, "old widths are never reused for the new layout");
  measureSectionTabs(f, [180, 240, 200, 220, 170, 210], 350);
  assert.equal(tabIndicator(f).width, 200); assert.equal(tabIndicator(f).transform[0].translateX, 423);
  assert.equal(f.scrolls.at(-1).x, 348);
});

for (const change of ["disabled", "route", "preview", "background"]) test(`Discover strip disables selection and scrolling when ${change}`, t => {
  const f = fixture({ discoverScreen: true }); t.after(f.close); measureSectionTabs(f);
  const stale = tabButtons(f)[2].props.onPress;
  f.render(change === "disabled" ? { swipeEnabled: false } : change === "route" ? { routeCurrent: false }
    : change === "preview" ? { outerPreview: true } : { appActive: false });
  assert.equal(tabStrip(f).props.scrollEnabled, false);
  assert.ok(tabButtons(f).every(n => n.props.disabled && n.props.accessibilityState.disabled));
  f.act(stale); f.flush(); assert.deepEqual(f.calls, []);
});

test("Discover Reduce Motion live change cancels displacement and keeps accessible tab actions", t => {
  const f = fixture({ discoverScreen: true }); t.after(f.close); measureSectionTabs(f);
  const g = dragPage(f); f.flush(); f.ready("festivals"); assert.ok(tabIndicator(f).transform[0].translateX > 3);
  f.reduced(true); f.react(); assert.equal(tabIndicator(f).transform[0].translateX, 3);
  release(g); g.onFinalize(); f.finish(); f.flush(); assert.deepEqual(f.calls, []);
  f.press("Artists"); measureSectionTabs(f); f.react(); assert.equal(tabIndicator(f).transform[0].translateX, 189);
  f.reader(true); f.press("Shows"); measureSectionTabs(f); f.react(); assert.equal(tabIndicator(f).transform[0].translateX, 3);
  assert.deepEqual(f.calls, ["artists", "shows"]);
});

test("Discover header scrolls inside the page with native horizontal arbitration and physical LTR coordinates", t => {
  const f = fixture({ discoverScreen: true }); t.after(f.close); measureSectionTabs(f);
  const detector = f.all().find(n => n.type === "GestureDetector" && n.props.gesture.handlers === f.gesture);
  assert.ok(nodes(detector).includes(tabStrip(f)));
  assert.ok(nodes(f.surface("shows")).some(n => n.type === "ScrollView" && !n.props.horizontal && nodes(n).includes(tabStrip(f))));
  assert.equal(tabStrip(f).props.style.direction, "ltr");
  assert.equal(tabStrip(f).props.contentContainerStyle.direction, "ltr");
  assert.equal(tabIndicator(f).transform[0].translateX, 3);
  assert.equal(tabButtons(f).some(n => n.children[0].props.numberOfLines != null), false);
});

test("installed Expo preset compiles Discover indicator, scroll, and geometry worklets", () => {
  for (const [relative, minimum] of [["./discover/DiscoverSectionTabs.ios.jsx", 6], ["../domain/iosDiscoverTabGeometry.mjs", 3]]) {
    const file = new URL(relative, import.meta.url);
    const result = transformSync(readFileSync(file, "utf8"), { filename: fileURLToPath(file), babelrc: false, configFile: false,
      presets: [[require("babel-preset-expo"), { platform: "ios" }]], caller: { name: "metro", platform: "ios", supportsStaticESM: true } });
    assert.equal(result.options.filename, fileURLToPath(file));
    assert.ok((result.code.match(/__workletHash/g) || []).length >= minimum, relative);
    if (relative.includes("SectionTabs")) {
      assert.match(result.code, /discoverTabPosition/); assert.match(result.code, /discoverTabFrame/);
      assert.match(result.code, /scrollTo/); assert.match(result.code, /scheduleOnRN/);
    }
  }
});


test("Discover re-admission reveals selection measured while disabled and clears interrupted manual scroll", t => {
  const f = fixture({ discoverScreen: true }); t.after(f.close);
  f.render({ programme: "photos", swipeEnabled: false }); measureSectionTabs(f);
  assert.equal(f.scrolls.length, 0);
  f.render({ swipeEnabled: true }); f.react(); assert.equal(f.scrolls.at(-1).x, 257);
  tabStrip(f).props.onScroll.onBeginDrag({}); f.flush();
  f.render({ swipeEnabled: false }); f.react();
  const count = f.scrolls.length;
  f.render({ swipeEnabled: true }); f.react();
  assert.equal(f.scrolls.length, count + 1); assert.equal(f.scrolls.at(-1).x, 257);
});

test("compiled Discover UI worklet closures execute geometry and synchronous scrolling", () => {
  const compiledBodies = relative => {
    const file = new URL(relative, import.meta.url);
    const result = transformSync(readFileSync(file, "utf8"), { filename: fileURLToPath(file), babelrc: false, configFile: false,
      presets: [[require("babel-preset-expo"), { platform: "ios" }]], caller: { name: "metro", platform: "ios", supportsStaticESM: true } });
    assert.equal(result.options.filename, fileURLToPath(file));
    const ast = parse(result.code, { sourceType: "module" });
    return ast.program.body.filter(node => node.type === "VariableDeclaration").flatMap(node => node.declarations)
      .filter(node => /_worklet_.*_init_data/.test(node.id.name)).map(node => node.init.properties.find(property => property.key.name === "code").value.value);
  };
  const geometryBodies = compiledBodies("../domain/iosDiscoverTabGeometry.mjs");
  const make = body => new Function(`return (${body});`)();
  const geometry = Object.fromEntries(["discoverTabFrame", "discoverTabPosition", "discoverTabScroll"].map(name => {
    const fn = make(geometryBodies.find(body => body.startsWith(`function ${name}_`)));
    return [name, (...args) => fn.call({ __closure: {} }, ...args)];
  }));
  const bodies = compiledBodies("./discover/DiscoverSectionTabs.ios.jsx");
  const style = make(bodies.find(body => body.includes("transform:")));
  const prepare = make(bodies.find(body => body.includes("contentWidth:contentWidth.get()")));
  const react = make(bodies.find(body => body.includes("scrollTo(scroll,")));
  const shared = value => ({ get: () => value, set: next => { value = next; } });
  const calls = [];
  const closure = { ...geometry, enabled: true, reduced: false, index: 2, x: shared(-100), width: shared(400), origin: shared(2),
    sections: sectionKeys, frames: shared([{ x: 3, width: 76 }, { x: 79, width: 110 }, { x: 189, width: 90 }, { x: 279, width: 95 }]),
    viewport: shared(300), contentWidth: shared(557), manual: shared(false), scroll: {}, scrollTo: (...args) => calls.push(args) };
  const receiver = { __closure: closure };
  closeTo(style.call(receiver).transform[0].translateX, 211.5);
  const state = prepare.call(receiver); react.call(receiver, state, null);
  assert.deepEqual(calls, [[closure.scroll, 107.125, 0, false]]);
  closure.manual.set(true); closure.x.set(-160); react.call(receiver, prepare.call(receiver), state);
  assert.equal(calls.length, 1);
  closure.reduced = true; assert.equal(style.call(receiver).transform[0].translateX, 189);
});


test("menu-controlled Feed retains no more than four full-size panes and resets them on account changes", t => {
  const f = fixture({ feedScreen: true }); t.after(f.close);
  const select = filter => f.render({ feedSelection: { filter, select: noop } });
  select("everyone");
  const original = nodes(f.surface("everyone")).find(node => node.type === "FlatList");
  for (const filter of ["local", "following", "news", "everyone"]) select(filter);
  assert.equal(f.lists().length, 4);
  const instances = new Set(f.lists().map(list => list.props.instance));
  for (const filter of ["news", "following", "everyone", "local"]) select(filter);
  assert.equal(f.lists().length, 4); assert.deepEqual(new Set(f.lists().map(list => list.props.instance)), instances);
  for (const filter of ["following", "everyone", "news", "local"]) {
    const style = f.surface(filter).props.style[0];
    for (const [key, value] of Object.entries(installedStyleSheet.absoluteFill)) assert.equal(style[key], value);
    assert.notEqual(f.surface(filter).props.style[1]?.display, "none");
  }
  assert.equal(nodes(f.surface("everyone")).find(node => node.type === "FlatList"), original);
  f.render({ accountId: "account-B", feedSelection: { filter: "everyone", select: noop } });
  assert.equal(f.lists().length, 1); assert.ok(!instances.has(f.lists()[0].props.instance));
});

test("installed Expo 57 preset compiles native chrome observers and animated styles as UI worklets", () => {
  for (const name of ["NativeAppHeader", "NativeTabScroll"]) {
    const file = new URL(`./${name}.ios.jsx`, import.meta.url);
    const result = transformSync(readFileSync(file, "utf8"), { filename: fileURLToPath(file), babelrc: false, configFile: false,
      presets: [[require("babel-preset-expo"), { platform: "ios" }]], caller: { name: "metro", platform: "ios", supportsStaticESM: true } });
    assert.ok((result.code.match(/__workletHash/g) || []).length >= 2, name);
  }
});

test("Metro retains platform-specific static title compatibility", () => {
  const { resolve } = require("metro-resolver");
  const context = { originModulePath: fileURLToPath(new URL("../../App.js", import.meta.url)), assetExts: new Set(), sourceExts: ["js", "jsx", "json", "ts", "tsx"],
    preferNativePlatform: true, mainFields: ["react-native", "browser", "main"], getPackageForModule: () => null,
    fileSystemLookup(path) { try { const stat = statSync(path); return { exists: true, type: stat.isDirectory() ? "d" : "f", realPath: realpathSync(path) }; } catch { return { exists: false }; } },
  };
  for (const platform of ["ios", "android", "web"]) {
    const result = resolve({ ...context, preferNativePlatform: platform !== "web" }, "./src/components/NativeLargeTitle", platform);
    assert.equal(result.filePath, fileURLToPath(new URL(`./NativeLargeTitle${platform === "ios" ? ".ios" : ""}.jsx`, import.meta.url)));
  }
});

test("actual iOS Feed previews Local endpoint posts beneath the shared activity-bar tabs without writes", async t => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const f = fixture({ feedScreen: true }); t.after(f.close);
  assert.ok(f.all().some(node => node.props?.testID === "feed-filter-swipe-rail"), "Feed body must mount its real native swipe rail");
  const source = f.lists()[0].props.instance;
  const bar = f.all().find(n => n.props?.testID === "native-activity-bar");
  assert.ok(bar); assert.equal(f.chrome.sources, 1);
  assert.equal(f.lists()[0].props.data[0].id, "global");
  const before = f.leaseWrites.length, g = dragPage(f, 120); f.flush(); f.ready("local");
  await f.untilRendered(() => f.lists()[1]?.props.data?.[0]?.id === "nearby", "Local endpoint preview must render beneath the shared tabs");
  assert.equal(f.lists().length, 2);
  assert.equal(f.lists()[1].props.data[0].id, "nearby");
  assert.equal(f.all().filter(n => n.props?.accessibilityLabel === "Following").length, 1);
  assert.equal(f.translation("everyone"), 120);
  assert.equal(f.chrome.sources, 1, "the preview cannot register a second chrome scroll owner");
  assert.equal(f.all().find(n => n.props?.testID === "native-activity-bar"), bar);
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
  f.react(); f.finish(); f.flush();
  const followingList = () => nodes(f.surface("following")).find(node => node.type === "FlatList");
  assert.equal(followingList().props.instance, destination);
  assert.equal(f.surface("local").props.pointerEvents, "none");
  assert.equal(f.surface("local").props.accessibilityElementsHidden, true);
  assert.equal(f.surface("local").props.style[2].opacity, 0);
  assert.equal(f.writes.length, 1); assert.equal(f.writes[0][1], "following");
  assert.equal(f.all().find(n => n.props?.accessibilityLabel === "Following").props.accessibilityState.selected, true);
  assert.equal(f.chrome.sources, 1);
  assert.equal(f.reads.length, 1); assert.equal(request.args.signal.aborted, false);
  request.resolve({ posts: [{ id: "followed", review: "A real followed post" }], nextCursor: "older" }); await f.settle();
  assert.equal(followingList().props.data[0].id, "followed");
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

for (const change of ["unmount", "suspense", "route", "account", "scope", "background"]) test(`actual Feed retires shared header callbacks and preview reads on ${change}`, t => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const f = fixture({ feedScreen: true, selectedFilter: "local", strict: true }); t.after(f.close);
  const stale = f.all().find(n => n.props?.accessibilityLabel === "News").props.onPress;
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
  f.press("Local"); f.finish(); f.flush();
  assert.deepEqual(f.writes, []); assert.equal(f.lists().length, 1); assert.equal(f.reads[0].args.signal.aborted, true);
});

test("actual Feed accepts rapid header taps immediately after a swipe and rejects its late completion", t => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const f = fixture({ feedScreen: true, selectedFilter: "local" }); t.after(f.close);
  const g = dragPage(f, 120); f.flush(); f.ready("following");
  release(g, { x: 400 }); g.onFinalize();
  const settlement = f.timings.findLastIndex(item => typeof item.done === "function");
  f.finish(settlement); f.flush();
  assert.equal(f.selection.filter, "following");
  for (const [label, filter] of [["For You", "everyone"], ["Following", "following"], ["Local", "local"], ["For You", "everyone"]]) {
    f.press(label);
    assert.equal(f.selection.filter, filter);
    assert.equal(f.surface(filter).props.pointerEvents, "auto");
    f.finish(settlement); f.flush();
    assert.equal(f.selection.filter, filter, "an old release cannot overwrite the newer explicit tap");
  }
  const fresh = dragPage(f, 120); f.flush(); f.ready("local");
  release(fresh, { x: 400 }); fresh.onFinalize(); f.finish(); f.flush();
  assert.equal(f.selection.filter, "local", "rapid taps leave a fresh horizontal swipe usable");
});

test("actual Feed Reduce Motion commits a body swipe without a sliding preview and keeps shared tabs selected", t => {
  const f = fixture({ feedScreen: true, reduced: true }); t.after(f.close);
  const source = f.lists()[0], g = dragPage(f, 120); f.flush();
  assert.equal(f.surface("local"), undefined); assert.equal(f.translation("everyone"), 0);
  release(g, { x: 400 }); g.onFinalize(); f.flush();
  assert.equal(f.selection.filter, "local"); assert.equal(f.translation("local"), 0);
  assert.equal(f.all().find(n => n.props?.accessibilityLabel === "Local").props.accessibilityState.selected, true);
  assert.equal(nodes(f.surface("everyone")).find(n => n.type === "FlatList"), source);
});

test("actual Feed VoiceOver retires an in-flight body swipe while header tabs remain usable", t => {
  const f = fixture({ feedScreen: true }); t.after(f.close);
  const g = dragPage(f, 120); f.flush(); f.ready("local"); f.reader(true);
  release(g, { x: 400 }); g.onFinalize(); f.finish(); f.flush();
  assert.equal(f.selection.filter, "everyone"); assert.equal(f.gesture.enabled, false);
  f.press("Local"); assert.equal(f.selection.filter, "local");
  assert.equal(f.all().find(n => n.props?.accessibilityLabel === "Local").props.accessibilityState.selected, true);
  assert.equal(f.chrome.shown.get(), true);
});
