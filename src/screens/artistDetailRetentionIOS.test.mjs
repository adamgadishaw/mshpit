import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL("../../", import.meta.url));
const require = createRequire(new URL("../../package.json", import.meta.url));
const React = require("react"), reconciler = require("react-reconciler");
const { transformSync } = require("@babel/core");
const codes = new Map(), noop = () => {};
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const walk = node => [node, ...(node.children || []).flatMap(walk)];
const tick = () => new Promise(resolve => setImmediate(resolve));

function createRenderer(calls) {
  const context = {}, container = { children: [] };
  let priority = 0, serial = 0;
  const append = (parent, child) => parent.children.push(child);
  const remove = (parent, child) => { const i = parent.children.indexOf(child); if (i >= 0) parent.children.splice(i, 1); };
  const insert = (parent, child, before) => parent.children.splice(parent.children.indexOf(before), 0, child);
  const renderer = reconciler({
    supportsMutation: true, isPrimaryRenderer: true, supportsPersistence: false, supportsHydration: false,
    getRootHostContext: () => context, getChildHostContext: () => context, getPublicInstance: node => node,
    prepareForCommit: () => null, resetAfterCommit: noop,
    createInstance(type, props) { return { type, props, instance: ++serial, children: [], offset: 0,
      focus() { calls.focus.push(type); calls.focused = this; }, blur() { calls.blur.push(this.instance); if (calls.focused === this) calls.focused = null; }, scrollTo(value) { this.offset = value.y; calls.scroll.push(value); },
      startAnimating() { calls.media.push("play"); return Promise.resolve(); }, stopAnimating() { calls.media.push("stop"); return Promise.resolve(); } }; },
    createTextInstance: text => ({ text }), appendInitialChild: append, appendChild: append, appendChildToContainer: append,
    removeChild: remove, removeChildFromContainer: remove, insertBefore: insert, insertInContainerBefore: insert,
    finalizeInitialChildren: () => false, shouldSetTextContent: () => false,
    commitUpdate: (node, type, oldProps, newProps) => { node.props = newProps; }, commitTextUpdate: (node, oldText, text) => { node.text = text; },
    hideInstance: node => { node.hidden = true; }, unhideInstance: node => { node.hidden = false; }, hideTextInstance: noop, unhideTextInstance: noop,
    clearContainer: node => { node.children = []; }, resetTextContent: noop, commitMount: noop,
    scheduleTimeout: setTimeout, cancelTimeout: clearTimeout, noTimeout: -1, supportsMicrotasks: true, scheduleMicrotask: queueMicrotask,
    getCurrentUpdatePriority: () => priority, setCurrentUpdatePriority: value => { priority = value; }, resolveUpdatePriority: () => priority || 32,
    shouldAttemptEagerTransition: () => false, detachDeletedInstance: noop, maySuspendCommit: () => false, preloadInstance: () => true,
    startSuspendingCommit: noop, suspendInstance: noop, waitForCommitToBeReady: () => null, NotPendingTransition: null,
    HostTransitionContext: React.createContext(null), resetFormInstance: noop, bindToConsole: (method, args) => console[method].bind(console, ...args),
  });
  const fail = error => { throw error; };
  const owner = renderer.createContainer(container, 1, null, false, null, "", fail, fail, fail, null);
  const flush = () => { for (let i = 0; i < 15; i++) { renderer.flushSyncWork(); if (!renderer.flushPassiveEffects()) break; } };
  return { container, flush, render(element) { renderer.updateContainerSync(element, owner, null, null); flush(); },
    renderLayout(element) { renderer.updateContainerSync(element, owner, null, null); renderer.flushSyncWork(); },
    act(callback) { renderer.flushSyncFromReconciler(callback); flush(); } };
}

const review = { id: "review-one", userId: "fan-one", user: { name: "Fixture Fan", handle: "fixturefan" },
  artist: "Fixture Artist", venue: "Fixture Venue", date: "2026-10-01", overall: 4, likes: 5,
  archiveShowKey: "fixture-show", photosPublic: true, review: "A memorable concert with exceptional songs. ".repeat(20) };
const albums = Array.from({ length: 8 }, (_, i) => ({ id: `album-${i}`, title: `Album ${i}`, year: String(2026 - i),
  tracks: [{ id: `track-${i}`, title: `Album track ${i}`, duration: 120 }] }));
const discography = { status: "ready", stale: false, artist: { id: 123, name: "Fixture Artist" }, albums,
  topTracks: Array.from({ length: 15 }, (_, i) => ({ id: `song-${i}`, title: `Song ${i}`, duration: 120 })) };
const overview = (ids = ["event-one"], hasMore = true) => ({ artist: { name: "Fixture Artist" },
  reputation: { average: 4, ratingCount: 5, showCount: 2 }, schedule: { total: 2, hasMore, nextCursor: hasMore ? "next-one" : null,
    items: ids.map(id => ({ id, artist: "Fixture Artist", venue: "Fixture Venue", date: "2027-06-01", ticketUrl: "https://www.ticketmaster.com/event/fixture" })) } });

// Production ArtistScreen, resources, native-selected children and domain code
// reconcile together. Only native hosts, Store data/commands, assets and API IO
// are mocked. A synthetic immutable owner drives real context/hook lifecycle
// edges. This proves retained instances/closures, not Root wiring or frame rate.
function fixture({ strict = false, managed = true, initialSection, returnState = {}, resourceOnly = false, foreignEditor = false } = {}) {
  const calls = { reads: [], mutations: [], receipts: [], actions: [], speech: [], privacyInvalidations: [], focus: [], blur: [], scroll: [], media: [], saves: [], animations: [] };
  const renderer = createRenderer(calls), modules = new Map(), timers = new Map(), listeners = new Map(), blocks = new Set();
  let account = "account-A", epoch = 0, commandEpoch = 0, admitted = true, visible = true, suspended = false, latestResources;
  let privacyScope = {};
  const frameScope = {}, pendingReveal = new Promise(() => {});
  const timer = { set(fn, delay) { const id = {}; timers.set(id, { fn, delay }); return id; }, clear(id) { timers.delete(id); } };
  const read = (kind, args) => { const call = { kind, args, ...deferred() }; calls.reads.push(call); return call.promise; };
  const command = kind => (...args) => { const owner = account, call = { kind, args, ...deferred() }; calls.mutations.push(call);
    return call.promise.then(result => { calls.receipts.push([kind, result]); if (kind === "follow" && owner === account && result?.user) session = { ...session, ...result.user }; return result; }); };
  const meta = { name: "Fixture Artist", bio: "An independently documented artist.", photo: "https://images.example/artist.jpg", albums: [], topTracks: [] };
  let session = { id: account, favoriteArtists: [], role: "user" };
  const store = {
    blockedIds: [], removedIds: [], isPhotoRemoved: () => false,
    artistSummary: () => ({ name: "Fixture Artist", profileKey: "fixture-artist", genre: "Rock", nights: [], bio: meta.bio, photo: meta.photo }),
    albumRating: () => ({ mine: 0, avg: 0, count: 0 }), songRating: () => ({ mine: 0, avg: 0, count: 0 }),
    rateAlbum: command("rateAlbum"), rateSong: command("rateSong"), loadRating: (...args) => read("rating", args),
    isArtistOwner: () => false, artistPostsFor: () => [], artistPageCacheEpoch: 1,
    loadArtistPage: (...args) => read("page", args), loadArtistPhotos: (...args) => read("photos", args),
    artistGallery: () => [{ uri: "https://images.example/second.jpg", source: "fan", by: "Fixture Fan", ownerId: "fan-one" }],
    removePhoto: command("removePhoto"), artistBadges: () => [], remoteArtistMeta: () => meta,
    artistDiscography: (...args) => read("discography", args), artistSeenCount: (...args) => read("seen", args),
    reportTrack: command("report"), setArtistFollowing: command("follow"), isFanClubMember: () => false, joinFanClub: command("join"),
  };
  class NativeValue { constructor(value) { this.value = value; } setValue(value) { this.value = value; } stopAnimation() {} interpolate() { return this.value; } }
  const animation = () => ({ start() { calls.animations.push("start"); }, stop() { calls.animations.push("stop"); } });
  const ScrollView = props => React.createElement("ScrollView", props, props.refreshControl, props.children);
  const native = { View: "View", Text: "Text", Pressable: "Pressable", ScrollView, Modal: "Modal", Image: "Image", TextInput: "TextInput",
    RefreshControl: "RefreshControl", ActivityIndicator: "ActivityIndicator", KeyboardAvoidingView: "KeyboardAvoidingView",
    Platform: { OS: "ios", select: value => value.ios ?? value.native ?? value.default }, PixelRatio: { get: () => 2 },
    StyleSheet: { create: value => value, flatten: value => value, absoluteFill: {}, absoluteFillObject: {}, hairlineWidth: 1 },
    Dimensions: { get: () => ({ width: 393, height: 852 }) }, useWindowDimensions: () => ({ width: 393, height: 852, fontScale: 1 }),
    Animated: { Value: NativeValue, View: "AnimatedView", timing: animation, spring: animation, sequence: animation, parallel: animation, loop: animation, createAnimatedComponent: component => component },
    Easing: { linear: noop, out: value => value, quad: noop, cubic: noop },
    Alert: { alert: (...args) => calls.actions.push(["alert", ...args]) }, Linking: { openURL: (...args) => { calls.actions.push(["link", ...args]); return Promise.resolve(); } },
    AppState: { currentState: "active", addEventListener: (kind, listener) => { listeners.set(listener, kind); return { remove: () => listeners.delete(listener) }; } },
    AccessibilityInfo: { isScreenReaderEnabled: () => Promise.resolve(true), isReduceMotionEnabled: () => Promise.resolve(true),
      announceForAccessibility: (...args) => calls.speech.push(args), announceForAccessibilityWithOptions: (...args) => calls.speech.push(args),
      addEventListener: (kind, listener) => { listeners.set(listener, kind); return { remove: () => listeners.delete(listener) }; } },
  };
  const io = {
    readArtistMemorial: args => read("memorial", args), readArtistTopReviews: args => read("reviews", args),
    readArtistEventArchive: args => read("archive", args), readArtistEventReviews: args => read("eventReviews", args),
    readArtistOverview: args => read("overview", args), fetchArtistSets: args => read("sets", args),
    fetchArtistWebProfile: (...args) => read("webProfile", args), fetchVenueWebProfile: (...args) => read("venueProfile", args),
    fetchArtistResearch: (...args) => read("research", args), fetchVenueResearch: (...args) => read("venueResearch", args),
    readCatalogPageText: args => read("catalogText", args), fetchArtistNews: (...args) => read("artistNews", args),
    fetchNewsDeskStories: (...args) => read("newsDesk", args), fetchNews: (...args) => read("news", args),
    fetchLiveCoverage: (...args) => read("liveCoverage", args), fetchLiveEvent: (...args) => read("liveEvent", args),
    fetchNewsRegion: (...args) => read("region", args), subscribeSocialReactionChanges: () => noop,
    loadSelectedArtistDiscography: (...args) => read("selectedDiscography", args),
  };
  const resolveFile = (name, from) => {
    const absolute = path.resolve(path.dirname(from), name);
    const options = path.extname(absolute) ? [absolute] : [`${absolute}.ios.jsx`, `${absolute}.ios.js`, `${absolute}.native.jsx`, `${absolute}.native.js`, `${absolute}.jsx`, `${absolute}.js`, `${absolute}.mjs`];
    const found = options.find(existsSync); assert.ok(found, `Module ${name} from ${from}`); return found;
  };
  const load = file => {
    file = path.isAbsolute(file) ? file : path.join(root, file);
    if (modules.has(file)) return modules.get(file).exports;
    const module = { exports: {} }; modules.set(file, module);
    if (!codes.has(file)) codes.set(file, transformSync(readFileSync(file, "utf8"), { filename: file, babelrc: false, configFile: false,
      plugins: [[require("@babel/plugin-transform-react-jsx"), { runtime: "automatic" }], require("@babel/plugin-transform-modules-commonjs")] }).code);
    new Function("require", "module", "exports", "setTimeout", "clearTimeout", "setInterval", "clearInterval", codes.get(file))(
      name => imports(name, file), module, module.exports, timer.set, timer.clear, timer.set, timer.clear);
    return module.exports;
  };
  class AppError extends Error { constructor(message, options) { super(message || "Request failed"); this.name = "AppError"; this.code = "PIT-API-001"; this.retryable = true; Object.assign(this, options); } }
  const imports = (name, from) => {
    if (name === "react" || name.startsWith("react/")) return require(name);
    if (name === "react-native") return native;
    if (name.endsWith("/NativeScrollChrome.ios")) return { NativeScrollChromeContext: React.createContext(null) };
    if (name === "react-native-svg") return new Proxy({ __esModule: true, default: "Svg" }, { get: (value, key) => value[key] ?? String(key) });
    if (name === "expo-image") return { Image: "ExpoImage" };
    if (name === "expo-file-system") return { File: class {}, Paths: { cache: "/synthetic-cache" } };
    if (name === "expo-video") return { createVideoPlayer: () => { throw new Error("Unexpected video player"); } };
    if (name === "expo-image-manipulator") return { ImageManipulator: {}, SaveFormat: {} };
    if (name === "@shopify/react-native-skia") return { Skia: {} };
    if (name === "expo-constants") return { __esModule: true, default: { expoConfig: {} } };
    if (name === "react-native-safe-area-context") return { useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) };
    if (/\.(png|jpg|webp)$/.test(name)) return name;
    if (/\/lib\/iosDetailPrivacy(?:\.ios\.js)?$/.test(name)) return {
      getIOSDetailPrivacySnapshot: () => privacyScope,
      invalidateIOSDetailPrivacy: () => { calls.privacyInvalidations.push("invalidate"); privacyScope = {}; presentation = commandPresentation(presentation.current, presentation.token); return privacyScope; },
      subscribeIOSDetailPrivacy: () => noop,
    };
    if (/\/store$/.test(name)) return { useStore: () => ({ ...store, session }), isStaff: () => false };
    if (/\/seed\/ingested$/.test(name)) return { artistMeta: () => meta };
    if (/\/seed\/songs$/.test(name)) return { SONGS: [] };
    if (/\/config\/runtime\.mjs$/.test(name)) return { ENABLE_MUSIC_PLAYER: true };
    if (/\/api$/.test(name)) return { AppError, api: (...args) => read("api", args), apiUrl: value => value };
    if (/\/diagnostics$/.test(name)) return { AppError, toAppError: error => error instanceof AppError ? error : new AppError("Request failed", { cause: error }), captureException: noop };
    if (/Api(?:\.mjs)?$/.test(name)) return io;
    if (/\/themeRuntime$/.test(name)) return { nativeThemeRuntime: true, readThemeSelection: () => "stage", persistThemeSelection: noop, clearThemeSelection: noop, reloadTheme: noop };
    if (/\/persist$/.test(name)) return { load: (_key, fallback) => fallback, save: noop };
    if (/\/lazyWithRetry$/.test(name)) return { lazyWithRetry: (_read, label) => {
      assert.equal(label, "ArtistNewsSection");
      return props => React.createElement(load("src/components/news/NewsViews.ios.jsx").ArtistNewsSection, props);
    } };
    if (name.startsWith(".")) return load(resolveFile(name, from));
    throw new Error(`Unmocked native/IO module ${name} from ${from}`);
  };
  const { IOSDetailPresentationContext: Presentation } = load("src/components/iosDetailPresentationContext.mjs");
  const { IOSDetailBackContext: BackBlock } = load("src/hooks/useIOSDetailBackBlock.ios.js");
  const { NativeTabPreviewContext: Preview } = load("src/components/nativeTabPreviewContext.mjs");
  const { NewsInteractionContext: News } = load("src/components/news/NewsInteractionContext.js");
  const { PostNavigationContext: Posts } = load("src/components/PostNavigationContext.js");
  const backBlock = { add: value => blocks.add(value), remove: value => blocks.delete(value) };
  const commandPresentation = (current, token) => { const generation = ++commandEpoch, privacyOwner = privacyScope;
    const privacyCurrent = () => privacyOwner === privacyScope;
    const canAct = () => current() && generation === commandEpoch && privacyCurrent();
    return { managed: true, active: visible, preview: !visible, current, token, canAct, commandToken: canAct, scope: frameScope, privacyScope, privacyCurrent,
      guard: callback => typeof callback === "function" ? (...args) => canAct() ? callback(...args) : undefined : callback }; };
  // Tokens are opaque. Function objects deliberately catch accidental JSON
  // serialization and React setter/initializer invocation of a token.
  const newPresentation = () => { const generation = ++epoch; const current = () => admitted && visible && generation === epoch;
    return commandPresentation(current, current); };
  let presentation = newPresentation();
  const Screen = load("src/screens/ArtistScreen.ios.jsx").default;
  const ResourceProbe = () => {
    const options = { accountId: account, artistKey: "fixture-artist", name: "Fixture Artist" };
    if (resourceOnly === "eventReviews") {
      latestResources = { events: load("src/features/artistEvents/useArtistEventArchive.ios.js").useArtistEventReviews({ ...options, showKey: "fixture-show" }) };
      return React.createElement("Resources", latestResources);
    }
    latestResources = {
      memorial: load("src/features/artistMemorials/useArtistMemorial.ios.js").useArtistMemorial(options),
      reviews: load("src/features/artistReviews/useArtistTopReviews.ios.js").useArtistTopReviews(options),
      archive: load("src/features/artistEvents/useArtistEventArchive.ios.js").useArtistEventArchive(options),
      overview: load("src/features/artistOverview/useArtistOverview.ios.js").useArtistOverview(options),
    };
    return React.createElement("Resources", latestResources);
  };
  const Reconnect = ({ children }) => { if (suspended) throw pendingReveal; return children; };
  const action = kind => (...args) => calls.actions.push([kind, ...args]);
  const props = { artistName: "Fixture Artist", initialSection, artistReturn: { read: () => returnState, save: value => calls.saves.push(value) },
    ...Object.fromEntries(["onClose", "onOpenArtist", "onOpenPost", "onOpenShow", "onOpenArchive", "onOpenPhotos", "onOpenGallery", "onOpenProfile", "onOpenFanClub", "onOpenNewsStory", "onPlay", "onAddToPlaylist", "onReport", "onRequireAuth"].map(key => [key, action(key)])) };
  const element = () => React.createElement(strict ? React.StrictMode : React.Fragment, null,
    React.createElement(Posts.Provider, { value: action("openPostById") },
    React.createElement(News.Provider, { value: { session, authReady: true, followedArtists: session.favoriteArtists, blockedIds: [], removedIds: [], mutedIds: [] } },
    React.createElement(Presentation.Provider, { value: managed ? presentation : null },
      React.createElement(Preview.Provider, { value: managed && !visible },
        React.createElement(BackBlock.Provider, { value: backBlock },
          React.createElement(React.Suspense, { fallback: React.createElement("Loading") },
            React.createElement(Reconnect, null, React.createElement(resourceOnly ? ResourceProbe : Screen, props)))))))));
  const tree = () => React.createElement(React.Fragment, null, element(), foreignEditor ? React.createElement("TextInput", { accessibilityLabel: "Other page editor" }) : null);
  const render = () => renderer.render(tree());
  const all = () => walk(renderer.container);
  const find = label => all().find(node => node.props?.accessibilityLabel === label && typeof node.props.onPress === "function");
  const event = label => { const node = find(label); assert.ok(node, `${label}; available: ${all().filter(n => n.props?.onPress).map(n => n.props.accessibilityLabel).join(" | ")}`); return node.props.onPress; };
  const defaults = { memorial: null, reviews: [review], archive: { topShows: [], shows: [], tours: [] }, overview: overview(),
    eventReviews: { reviews: [review], nextCursor: "reviews-next", total: 3 },
    page: { ok: true, value: { legacyProfile: false, profile: {}, posts: [], loadedAt: 1 } }, photos: { ok: true }, seen: { count: 0 }, sets: { summary: {}, sets: [] }, discography,
    webProfile: null, research: null, catalogText: { text: null }, artistNews: [], newsDesk: { stories: [], items: [], hasMore: false }, rating: null };
  render();
  return { calls, timers, blocks, all, event, find, render, store, defaults, act: renderer.act, get resources() { return latestResources; },
    get reads() { return calls.reads; }, get presentation() { return presentation; },
    press(label) { renderer.act(() => event(label)()); },
    text() { return all().filter(n => n.text).map(n => n.text).join(" "); },
    precommit() { admitted = false; },
    cover() { admitted = false; visible = false; presentation = newPresentation(); render(); },
    coverLayout() { admitted = false; visible = false; presentation = newPresentation(); renderer.renderLayout(tree()); },
    uncover() { admitted = true; visible = true; presentation = newPresentation(); render(); },
    preview() { render(); },
    suspend(value) { suspended = value; if (value) admitted = false; else { admitted = true; presentation = newPresentation(); } render(); },
    account(value) { account = value; session = { ...session, id: value }; presentation = newPresentation(); render(); },
    precommitPrivacy() { privacyScope = {}; commandEpoch += 1; },
    privacy() { privacyScope = {}; presentation = commandPresentation(presentation.current, presentation.token); render(); },
    async reject(call, options) { call.done = true; call.reject(new AppError("Access withdrawn", options)); await tick(); render(); await tick(); renderer.flush(); },
    async complete(call, value) { call.done = true; call.resolve(value); await tick(); render(); await tick(); renderer.flush(); },
    async settle() { for (let count = 0; count < 10; count++) { const pending = calls.reads.filter(call => !call.done && Object.hasOwn(defaults, call.kind));
      if (!pending.length) break; for (const call of pending) { call.done = true; call.resolve(defaults[call.kind]); } await tick(); renderer.flush(); } },
    flushTimers() { for (const [id, entry] of [...timers]) { timers.delete(id); renderer.act(entry.fn); } },
    close() { renderer.render(null); },
  };
}

test("actual Artist retains About, album, expanded songs and scroll while old actions stay retired", async () => {
  const f = fixture();
  try {
    await f.settle(); f.press("About artist page section"); await f.settle();
    f.press("Expand Album 0 tracklist"); f.press("Show all 15 songs"); f.press("Show all 8 releases");
    const scroll = f.all().find(n => n.type === "ScrollView" && n.props.onScroll);
    f.act(() => { scroll.props.onScrollBeginDrag(); scroll.offset = 720; scroll.props.onScroll({ nativeEvent: { contentOffset: { y: 720 } } }); });
    const instance = scroll.instance;
    const old = [f.event("Overview artist page section"), f.event("Collapse Album 0 tracklist"), f.event("Show fewer songs"), f.event("Show fewer releases"), f.event("Follow Fixture Artist"), f.event("Play top song Song 0")];
    const before = { reads: f.reads.length, actions: f.calls.actions.length, saves: f.calls.saves.length, mutations: f.calls.mutations.length };
    f.precommit(); f.act(() => old.forEach(callback => callback()));
    assert.equal(f.reads.length, before.reads); assert.equal(f.calls.mutations.length, before.mutations); assert.equal(f.calls.actions.length, before.actions);
    f.cover(); f.act(() => old.forEach(callback => callback()));
    assert.ok(f.find("Collapse Album 0 tracklist")); assert.ok(f.find("Show fewer songs")); assert.ok(f.find("Show fewer releases"));
    assert.equal(f.reads.length, before.reads, "covered screen starts no reads");
    assert.equal(f.calls.saves.length, before.saves, "covered callbacks do not change return state");
    const covered = f.all().find(n => n.type === "ScrollView" && n.props.onScroll);
    assert.equal(covered.instance, instance); assert.equal(covered.offset, 720);
    f.preview(); assert.equal(f.reads.length, before.reads, "cancelling a visual reveal leaves reads unchanged");
    f.uncover(); await f.settle();
    assert.ok(f.find("Collapse Album 0 tracklist")); assert.ok(f.find("Show fewer songs")); assert.ok(f.find("Show fewer releases"));
    assert.equal(f.all().find(n => n.type === "ScrollView" && n.props.onScroll).instance, instance);
    assert.equal(f.all().find(n => n.type === "ScrollView" && n.props.onScroll).offset, 720);
    f.act(() => old.forEach(callback => callback()));
    assert.equal(f.calls.mutations.length, before.mutations); assert.equal(f.calls.actions.length, before.actions);
    assert.ok(f.find("Collapse Album 0 tracklist")); assert.ok(f.find("Show fewer songs"));
    f.press("Play top song Song 0"); assert.equal(f.calls.actions.at(-1)[0], "onPlay");
    f.press("Collapse Album 0 tracklist"); assert.ok(f.find("Expand Album 0 tracklist"));
  } finally { f.close(); }
});

for (const strict of [false, true]) {
  test(`Artist resources preserve settled identities and paginated schedules through cover and Back (StrictMode ${strict})`, async () => {
    const f = fixture({ resourceOnly: true, strict });
    try {
      await f.settle();
      f.act(() => { void f.resources.overview.loadMore(); });
      const more = f.reads.filter(r => r.kind === "overview").at(-1);
      assert.equal(more.args.after, "next-one");
      await f.complete(more, overview(["event-two"], false));
      const previous = Object.fromEntries(Object.entries(f.resources).map(([key, value]) => [key, value.resource.data]));
      assert.deepEqual(previous.overview.schedule.items.map(row => row.id), ["event-one", "event-two"]);
      const old = [f.resources.memorial.reload, f.resources.reviews.reload, f.resources.archive.reload, f.resources.overview.reload,
        f.resources.overview.loadMore, () => f.resources.overview.setLocation({ city: "Toronto", countryCode: "CA" })];
      // Capture the controller closure too, rather than consulting the newest hook output.
      const oldLocation = f.resources.overview.setLocation;
      old[5] = () => oldLocation({ city: "Toronto", countryCode: "CA" });
      const count = f.reads.length;
      f.precommit(); f.act(() => old.forEach(callback => { void callback(); }));
      assert.equal(f.reads.length, count);
      f.cover(); f.act(() => old.forEach(callback => { void callback(); }));
      for (const [key, data] of Object.entries(previous)) assert.equal(f.resources[key].resource.data, data, `${key} same-identity data retained`);
      assert.equal(f.resources.memorial.availability, "living");
      f.uncover(); f.act(() => old.forEach(callback => { void callback(); }));
      assert.equal(f.reads.length, count, "settled Back neither restarts reads nor revives old callbacks");
      for (const [key, data] of Object.entries(previous)) assert.equal(f.resources[key].resource.data, data);
      f.act(() => { void f.resources.overview.setLocation({ city: "Toronto", countryCode: "CA" }); });
      assert.equal(f.reads.at(-1).args.city, "Toronto", "fresh Back action works");
    } finally { f.close(); }
  });
}

test("Artist resources cancel covered reads, restart only active work, and project a new account empty", async () => {
  const f = fixture({ resourceOnly: true });
  try {
    const pending = [...f.reads], old = Object.values(f.resources).map(resource => resource.reload);
    f.cover();
    for (const read of pending) assert.equal(read.args.signal.aborted, true, read.kind);
    for (const read of pending) await f.complete(read, read.kind === "memorial" ? null : read.kind === "reviews" ? [review] : read.kind === "overview" ? overview() : { shows: [], topShows: [], tours: [] });
    assert.equal(f.resources.reviews.resource.updatedAt, null);
    assert.equal(f.resources.overview.resource.updatedAt, null);
    const count = f.reads.length;
    f.act(() => old.forEach(reload => { void reload(); })); assert.equal(f.reads.length, count);
    f.uncover(); assert.equal(f.reads.length, count + 4); await f.settle();
    assert.equal(f.resources.reviews.resource.data[0].id, review.id);
    f.cover(); f.account("account-B");
    assert.equal(f.resources.reviews.resource.data.length, 0); assert.equal(f.resources.overview.resource.data, null);
    assert.equal(f.resources.memorial.availability, "checking");
    const changedCount = f.reads.length; f.act(() => old.forEach(reload => { void reload(); }));
    assert.equal(f.reads.length, changedCount, "account change cannot let captured callbacks read");
  } finally { f.close(); }
});

test("actual Artist review expansion and section focus cannot be changed by a covered or retired callback", async () => {
  const f = fixture();
  try {
    await f.settle(); f.press("Read the full review from Fixture Fan");
    const oldCollapse = f.event("Show a shorter review from Fixture Fan");
    const oldTab = f.find("Overview artist page section").props.onKeyDown;
    const post = f.event("Read Fixture Fan's original fan post about Fixture Artist");
    const nextPhoto = f.all().find(n => n.props?.onPress && /Next.*photo/i.test(n.props.accessibilityLabel || ""))?.props.onPress;
    f.precommit(); f.act(() => { oldCollapse(); oldTab({ key: "ArrowRight" }); post(); nextPhoto?.(); });
    assert.ok(f.find("Show a shorter review from Fixture Fan")); assert.equal(f.calls.focus.length, 0); assert.equal(f.calls.actions.length, 0); assert.equal(f.calls.speech.length, 0);
    f.cover(); f.act(() => { oldCollapse(); oldTab({ key: "ArrowRight" }); post(); nextPhoto?.(); });
    assert.ok(f.find("Show a shorter review from Fixture Fan"));
    f.uncover(); await f.settle();
    f.act(() => { oldCollapse(); oldTab({ key: "ArrowRight" }); post(); nextPhoto?.(); });
    assert.ok(f.find("Show a shorter review from Fixture Fan")); assert.equal(f.calls.focus.length, 0); assert.equal(f.calls.actions.length, 0); assert.equal(f.calls.speech.length, 0);
    f.press("Show a shorter review from Fixture Fan"); assert.ok(f.find("Read the full review from Fixture Fan"));
    f.press("Read Fixture Fan's original fan post about Fixture Artist"); assert.equal(f.calls.actions.at(-1)[0], "onOpenPost");
  } finally { f.close(); }
});

test("accepted Artist follow settles its receipt without stale invite, speech or navigation after Back", async () => {
  const f = fixture();
  try {
    await f.settle(); const oldFollow = f.event("Follow Fixture Artist"); f.press("Follow Fixture Artist");
    const follow = f.calls.mutations.at(-1); assert.equal(follow.kind, "follow");
    f.cover(); f.uncover();
    await f.complete(follow, { ok: true, user: { favoriteArtists: ["Fixture Artist"] } }); f.render();
    assert.equal(f.calls.receipts.length, 1); assert.ok(f.find("Unfollow Fixture Artist"));
    assert.equal(f.find("Join the Fixture Artist Fan Club"), undefined); f.flushTimers(); assert.equal(f.calls.speech.length, 0);
    f.act(oldFollow); assert.equal(f.calls.mutations.length, 1);
    f.press("Unfollow Fixture Artist"); assert.equal(f.calls.mutations.length, 2);
    await f.complete(f.calls.mutations.at(-1), { ok: true, user: { favoriteArtists: [] } });
    f.flushTimers(); assert.equal(f.calls.speech.length, 1, "fresh action can announce"); assert.equal(f.calls.actions.length, 0);
  } finally { f.close(); }
});

test("Artist follow speech already queued before push cannot speak after Back", async () => {
  const f = fixture();
  try {
    await f.settle(); f.press("Follow Fixture Artist");
    await f.complete(f.calls.mutations.at(-1), { ok: true, user: { favoriteArtists: ["Fixture Artist"] } });
    assert.ok(f.find("Join the Fixture Artist Fan Club"));
    const queued = [...f.timers.values()].filter(timer => timer.delay === 450).map(timer => timer.fn);
    assert.equal(queued.length, 1, "positive control: a real follow completion scheduled speech");
    const oldJoin = f.event("Join the Fixture Artist Fan Club");
    f.precommit(); f.act(() => { queued.forEach(fn => fn()); oldJoin(); }); assert.equal(f.calls.speech.length, 0);
    f.cover(); f.uncover(); f.act(() => { queued.forEach(fn => fn()); oldJoin(); });
    assert.equal(f.calls.speech.length, 0); assert.equal(f.calls.mutations.length, 1);
  } finally { f.close(); }
});

test("Artist accepted report cannot clear a retained draft or revive queued rating/report callbacks", async () => {
  const f = fixture();
  try {
    await f.settle(); f.press("About artist page section"); await f.settle();
    const oldRating = f.find("Your rating for song Song 0 by Fixture Artist").props.onAccessibilityAction;
    f.press("Report the wrong video playing for Song 0");
    const note = () => f.all().find(n => n.type === "TextInput" && n.props.placeholder === "What happened? (optional)");
    f.act(() => note().props.onChangeText("Keep my exact report draft"));
    const submit = () => f.all().find(n => n.type === "Pressable" && walk(n).some(child => child.text === "Send report"))?.props.onPress;
    const oldSubmit = submit(); assert.equal(typeof oldSubmit, "function"); f.act(oldSubmit);
    const report = f.calls.mutations.at(-1); assert.equal(report.kind, "report"); assert.equal(f.blocks.size, 1);
    f.cover(); f.uncover();
    assert.equal(note().props.value, "Keep my exact report draft", "departure alone does not lose a draft");
    f.press("Report the wrong video playing for Song 1");
    f.act(() => note().props.onChangeText("A newer report draft"));
    await f.complete(report, { ok: true });
    assert.equal(f.calls.receipts.length, 1); assert.equal(note().props.value, "A newer report draft", "older receipt cannot clear a different current draft");
    f.act(() => { oldSubmit(); oldRating({ nativeEvent: { actionName: "increment" } }); });
    assert.equal(f.calls.mutations.length, 1); assert.equal(f.calls.speech.length, 0);
    assert.equal(typeof submit(), "function", "Back has a usable report control");
    f.act(() => submit()()); assert.equal(f.calls.mutations.length, 2);
  } finally { f.close(); }
});

test("actual Artist preserves controls through StrictMode and Suspense reconnect without reviving old actions", async () => {
  const f = fixture({ strict: true });
  try {
    await f.settle(); f.press("About artist page section"); await f.settle();
    f.press("Expand Album 0 tracklist"); f.press("Show all 15 songs");
    const old = [f.event("Collapse Album 0 tracklist"), f.event("Show fewer songs"), f.event("Follow Fixture Artist")];
    const scroll = f.all().find(n => n.type === "ScrollView" && n.props.onScroll);
    const reads = f.reads.length;
    f.suspend(true); f.act(() => old.forEach(fn => fn()));
    assert.equal(f.reads.length, reads); assert.equal(f.calls.mutations.length, 0);
    f.suspend(false); await f.settle(); f.act(() => old.forEach(fn => fn()));
    assert.equal(f.calls.mutations.length, 0); assert.ok(f.find("Collapse Album 0 tracklist")); assert.ok(f.find("Show fewer songs"));
    assert.equal(f.all().find(n => n.type === "ScrollView" && n.props.onScroll).instance, scroll.instance);
    f.press("Show fewer songs"); assert.ok(f.find("Show all 15 songs"));
  } finally { f.close(); }
});

test("actual Artist refresh cancels on cover and an older refresh cannot update a later admission", async () => {
  const f = fixture();
  try {
    await f.settle();
    const refresh = () => f.all().find(n => n.type === "RefreshControl").props;
    const old = refresh().onRefresh; const count = f.reads.length;
    f.act(old); assert.equal(refresh().refreshing, true);
    const started = f.reads.slice(count);
    assert.ok(started.some(r => r.kind === "page")); assert.ok(started.some(r => r.kind === "photos"));
    f.cover();
    for (const call of started) assert.equal((Array.isArray(call.args) ? call.args.at(-1) : call.args).signal.aborted, true, call.kind);
    f.uncover(); await f.settle();
    f.act(old); assert.equal(refresh().refreshing, false);
    const before = f.reads.length; f.act(refresh().onRefresh);
    assert.ok(f.reads.length > before); assert.equal(refresh().refreshing, true);
  } finally { f.close(); }
});

test("actual Artist source links and pending reads are fenced while covered and old links remain retired", async () => {
  const f = fixture();
  try {
    await f.settle(); f.press("About artist page section");
    const web = f.reads.filter(r => r.kind === "webProfile").at(-1);
    assert.ok(web); await f.complete(web, { links: [{ kind: "official", label: "Official site", url: "https://artist.example" }], source: { name: "Provider", url: "https://provider.example" } });
    const catalog = f.reads.filter(r => r.kind === "catalogText").at(-1);
    assert.ok(catalog); await f.complete(catalog, { text: { summary: "Verified fixture context", sources: [{ label: "Archive", url: "https://archive.example" }] } });
    assert.ok(f.text().includes("Verified fixture context"));
    const old = [f.event("Official site (opens a new page)"), f.event("Source: Provider"), f.event("Source: Archive")];
    const pending = f.reads.filter(r => !r.done);
    const count = f.reads.length; f.precommit(); f.act(() => old.forEach(fn => fn())); f.cover();
    for (const call of pending) { const args = Array.isArray(call.args) ? call.args.at(-1) : call.args; if (args?.signal) assert.equal(args.signal.aborted, true, call.kind); }
    assert.equal(f.reads.length, count); assert.equal(f.calls.actions.length, 0);
    f.uncover(); f.act(() => old.forEach(fn => fn())); assert.equal(f.calls.actions.length, 0);
    assert.ok(f.text().includes("Verified fixture context"));
    f.press("Official site (opens a new page)"); assert.equal(f.calls.actions.at(-1)[0], "link");
  } finally { f.close(); }
});

test("actual Artist candidate read and selection cannot overwrite retained catalogue after departure", async () => {
  const f = fixture();
  try {
    await f.settle(); f.press("About artist page section"); await f.settle(); f.press("Expand Album 0 tracklist");
    const oldOpen = f.event("Choose a different music catalog for Fixture Artist");
    f.act(oldOpen);
    const candidates = f.reads.find(r => r.kind === "api");
    assert.ok(candidates); await f.complete(candidates, { candidates: [{ id: 456, name: "Other Fixture", fans: 25, albums: 3 }] });
    f.press("Other Fixture, 25 fans, 3 releases");
    const pending = f.reads.find(r => r.kind === "selectedDiscography"); assert.ok(pending);
    f.cover(); assert.equal(pending.args.at(-1).signal.aborted, true); f.uncover();
    await f.complete(pending, { ...discography, albums: [{ id: "wrong", title: "Stale replacement", tracks: [] }] });
    assert.ok(f.find("Collapse Album 0 tracklist")); assert.equal(f.text().includes("Stale replacement"), false);
    const before = f.reads.length; f.act(oldOpen); assert.equal(f.reads.length, before);
  } finally { f.close(); }
});

test("actual Artist tribute modal cannot reopen on Back or respond to old portal callbacks", async () => {
  const f = fixture();
  try {
    const memorial = f.reads.find(r => r.kind === "memorial");
    await f.complete(memorial, { deceased: true, deathDate: "2020-01-01", summary: "A fixture artist remembered for a lifetime of music.",
      thankYou: "Thank you for the music and memories.", accomplishments: ["Recorded a celebrated album."],
      citation: { url: "https://archive.example/memorial", title: "Memorial Archive" } });
    await f.settle();
    const opener = f.all().find(n => n.props?.onPress && /tribute/i.test(n.props.accessibilityLabel || ""));
    assert.ok(opener); f.act(opener.props.onPress);
    const modal = () => f.all().find(n => n.type === "Modal"); assert.equal(modal().props.visible, true); assert.equal(f.blocks.size, 1);
    const oldSource = f.event("Open memorial source: Memorial Archive"), oldClose = modal().props.onRequestClose;
    f.cover(); assert.equal(modal().props.visible, false); f.uncover();
    assert.equal(modal().props.visible, false); f.act(() => { oldSource(); oldClose(); }); assert.equal(f.calls.actions.length, 0);
    const fresh = f.all().find(n => n.props?.onPress && /tribute/i.test(n.props.accessibilityLabel || "")); f.act(fresh.props.onPress);
    assert.equal(modal().props.visible, true); f.press("Open memorial source: Memorial Archive"); assert.equal(f.calls.actions.at(-1)[0], "link");
  } finally { f.close(); }
});

test("unmanaged Artist keeps ordinary initial controls and async completion behavior", async () => {
  const f = fixture({ managed: false });
  try {
    await f.settle(); f.press("About artist page section"); await f.settle(); f.press("Expand Album 0 tracklist");
    assert.ok(f.find("Collapse Album 0 tracklist")); f.press("Follow Fixture Artist");
    await f.complete(f.calls.mutations.at(-1), { ok: true, user: { favoriteArtists: ["Fixture Artist"] } });
    assert.ok(f.find("Join the Fixture Artist Fan Club"));
  } finally { f.close(); }
});

test("Artist compact news uses real guarded story and release cards while covered", async () => {
  const f = fixture();
  try {
    await f.complete(f.reads.find(r => r.kind === "memorial"), null);
    const news = f.reads.find(r => r.kind === "newsDesk" && !r.done), releases = f.reads.find(r => r.kind === "artistNews" && !r.done);
    assert.ok(news); assert.ok(releases);
    await f.complete(news, { stories: [{ id: "story-one", postId: "news-post", headline: "Fixture artist announces new album", category: "music", publishedAt: Date.now(),
      sourceNames: ["Fixture News"], photo: "https://images.example/news.gif" }], nextCursor: null });
    await f.complete(releases, { items: [{ id: "release-one", artist: { name: "Fixture Artist" },
      release: { title: "New Fixture Album", type: "album", releaseDate: "2026-10-01", url: "https://www.deezer.com/album/123" } }] });
    await f.settle();
    const story = () => f.all().find(n => n.props?.onPress && /^Fixture artist announces new album\./.test(n.props.accessibilityLabel || ""));
    assert.ok(story()); const oldStory = story().props.onPress, oldListen = f.event("Listen to New Fixture Album on Deezer");
    const count = f.reads.length;
    f.precommit(); f.act(() => { oldStory(); oldListen(); }); f.cover();
    assert.ok(story()); assert.ok(f.find("Listen to New Fixture Album on Deezer"));
    f.act(() => { oldStory(); oldListen(); });
    assert.equal(f.calls.actions.length, 0); assert.equal(f.reads.length, count);
    for (const node of f.all().filter(n => n.type === "ExpoImage" && Object.hasOwn(n.props, "autoplay"))) assert.equal(node.props.autoplay, false);
    f.uncover(); f.act(() => { oldStory(); oldListen(); }); assert.equal(f.calls.actions.length, 0);
    f.act(story().props.onPress); assert.equal(f.calls.actions.at(-1)[0], "onOpenNewsStory");
    f.press("Listen to New Fixture Album on Deezer"); assert.equal(f.calls.actions.at(-1)[0], "link");
  } finally { f.close(); }
});

test("fresh Artist refresh starts before an abandoned refresh resolves and old settlement cannot unlock it", async () => {
  const f = fixture();
  try {
    await f.settle();
    const refresh = () => f.all().find(n => n.type === "RefreshControl").props;
    const count = f.reads.length; f.act(refresh().onRefresh); const abandoned = f.reads.slice(count);
    f.cover(); f.uncover();
    const before = f.reads.length; f.act(refresh().onRefresh); const latest = f.reads.slice(before);
    assert.ok(latest.some(call => call.kind === "page"), "Back refresh is usable even if an API ignores cancellation");
    assert.equal(refresh().refreshing, true);
    for (const call of abandoned) await f.complete(call, call.kind === "page" ? { ok: true, value: { legacyProfile: false, profile: {}, posts: [], loadedAt: 1 } } : call.kind === "overview" ? overview() : { ok: true });
    assert.equal(refresh().refreshing, true, "old settlement cannot stop the new indicator");
    const ongoing = f.reads.length; f.act(refresh().onRefresh); assert.equal(f.reads.length, ongoing, "new running refresh remains deduplicated");
  } finally { f.close(); }
});

test("accepted Artist Fan Club join settles without stale notices or speaking after cover", async () => {
  const f = fixture();
  try {
    await f.settle(); f.press("Follow Fixture Artist");
    await f.complete(f.calls.mutations.at(-1), { ok: true, user: { favoriteArtists: ["Fixture Artist"] } });
    f.flushTimers(); const speech = f.calls.speech.length;
    f.press("Join the Fixture Artist Fan Club"); const join = f.calls.mutations.at(-1); assert.equal(join.kind, "join");
    f.cover(); f.uncover(); await f.complete(join, { ok: true, joined: true }); f.flushTimers();
    assert.equal(f.calls.receipts.length, 2); assert.equal(f.calls.speech.length, speech);
    assert.equal(f.text().includes("You joined the Fixture Artist Fan Club."), false); assert.equal(f.calls.actions.length, 0);
  } finally { f.close(); }
});

test("actual Artist native image errors defer fallback until Back without reviving retired callbacks", async () => {
  const f = fixture();
  try {
    await f.settle();
    const photo = () => f.all().find(n => n.type === "ExpoImage" && n.props.accessibilityLabel === "Open featured Fixture Artist photo");
    assert.ok(photo()); const initial = photo().props.source.uri, oldError = photo().props.onError;
    f.precommit(); f.act(oldError); assert.equal(photo().props.source.uri, initial, "precommit image callback must not start fallback fetch");
    f.cover(); f.act(oldError); assert.equal(photo().props.source.uri, initial); assert.equal(photo().props.autoplay, false);
    f.uncover();
    const resumed = photo()?.props.source.uri;
    assert.ok(resumed); assert.notEqual(resumed, initial, "fresh admission consumes the same-attempt terminal error once");
    f.act(oldError); assert.equal(photo()?.props.source.uri, resumed, "retired callbacks delivered after Back cannot advance again");
    f.act(photo().props.onError); assert.notEqual(photo()?.props.source.uri, resumed, "fresh image fallback remains usable");
  } finally { f.close(); }
});

test("actual Artist live-set review links cannot use a global navigation context after departure", async () => {
  const f = fixture();
  try {
    await f.complete(f.reads.find(r => r.kind === "sets"), { summary: { opener: { sets: 1, rated: 1, average: 4 } },
      sets: [{ postId: "live-set-post", role: "opener", rating: 4, headliner: { name: "Headliner" }, review: "A memorable opener", user: { id: "fan", name: "Set Fan" } }],
      openedFor: [{ name: "Headliner", shows: 1 }] });
    await f.settle();
    const label = f.all().find(n => n.props?.onPress && /^Open the review:/.test(n.props.accessibilityLabel || ""))?.props.accessibilityLabel;
    assert.ok(label); const old = f.event(label), oldHeadliner = f.event("Open Headliner");
    f.precommit(); f.act(() => { old(); oldHeadliner(); }); assert.equal(f.calls.actions.length, 0);
    f.cover(); f.uncover(); f.act(old); assert.equal(f.calls.actions.length, 0);
    f.press(label); assert.deepEqual(f.calls.actions.at(-1), ["openPostById", "live-set-post"]);
  } finally { f.close(); }
});

test("Artist image callbacks first delivered after Back cannot borrow an unchanged image generation", async () => {
  const f = fixture();
  try {
    await f.settle();
    const photo = () => f.all().find(n => n.type === "ExpoImage" && n.props.accessibilityLabel === "Open featured Fixture Artist photo");
    const initial = photo().props.source.uri, oldError = photo().props.onError, oldDisplay = photo().props.onDisplay;
    f.cover(); f.uncover(); f.act(() => { oldDisplay(); oldError(); });
    assert.equal(photo().props.source.uri, initial, "no earlier terminal receipt exists to continue");
    f.act(photo().props.onError); assert.notEqual(photo()?.props.source.uri, initial);
  } finally { f.close(); }
});

test("Artist privacy-only revocation keeps read ownership but retires actual commands and native refresh", async () => {
  const f = fixture();
  try {
    await f.settle();
    const previous = f.presentation, follow = f.event("Follow Fixture Artist"), section = f.event("About artist page section");
    const refresh = f.all().find(n => n.type === "RefreshControl").props.onRefresh;
    const reads = f.reads.length; f.precommitPrivacy();
    f.act(() => { follow(); section(); refresh(); }); assert.equal(f.calls.mutations.length, 0); assert.equal(f.reads.length, reads);
    f.privacy();
    assert.equal(previous.current(), true, "privacy revision deliberately retains the data lifetime");
    assert.equal(previous.canAct(), false, "command admission is independently revoked");
    f.act(() => { follow(); section(); refresh(); });
    assert.equal(f.calls.mutations.length, 0); assert.equal(f.reads.length, reads);
    assert.equal(f.find("Overview artist page section").props.accessibilityState.selected, true);
    f.press("Follow Fixture Artist"); assert.equal(f.calls.mutations.length, 1);
  } finally { f.close(); }
});

test("Artist accepted follow across privacy-only revision settles receipt without stale UI or speech", async () => {
  const f = fixture();
  try {
    await f.settle(); f.press("Follow Fixture Artist"); const pending = f.calls.mutations.at(-1), previous = f.presentation;
    f.privacy(); assert.equal(previous.current(), true); assert.equal(previous.canAct(), false);
    await f.complete(pending, { ok: true, user: { favoriteArtists: ["Fixture Artist"] } }); f.flushTimers();
    assert.equal(f.calls.receipts.length, 1); assert.ok(f.find("Unfollow Fixture Artist"));
    assert.equal(f.find("Join the Fixture Artist Fan Club"), undefined); assert.equal(f.calls.speech.length, 0);
    f.press("Unfollow Fixture Artist"); assert.equal(f.calls.mutations.length, 2);
  } finally { f.close(); }
});

test("Artist privacy-only revision preserves public read receipts but rejects obsolete private reviews without replacement reads", async () => {
  const f = fixture({ resourceOnly: true });
  try {
    const pending = [...f.reads], previous = f.presentation; f.privacy();
    assert.equal(previous.current(), true); assert.equal(previous.canAct(), false); assert.equal(f.reads.length, pending.length);
    for (const call of pending) assert.equal(call.args.signal.aborted, false, `${call.kind} still belongs to same read admission`);
    await f.settle();
    assert.equal(f.resources.memorial.availability, "living");
    assert.deepEqual(f.resources.reviews.resource.data, [], "successful private reviews require the captured privacy revision");
    assert.equal(f.resources.overview.resource.data.schedule.items[0].id, "event-one");
    assert.equal(f.reads.length, pending.length, "read completions do not trigger a privacy rerender loop");
  } finally { f.close(); }
});

test("Artist queued speech loses command ownership even when privacy keeps current reads valid", async () => {
  const f = fixture();
  try {
    await f.settle(); f.press("Follow Fixture Artist");
    await f.complete(f.calls.mutations.at(-1), { ok: true, user: { favoriteArtists: ["Fixture Artist"] } });
    const queued = [...f.timers.values()].filter(timer => timer.delay === 450).map(timer => timer.fn);
    assert.equal(queued.length, 1); const previous = f.presentation; f.privacy(); assert.equal(previous.current(), true);
    f.act(() => queued.forEach(fn => fn())); assert.equal(f.calls.speech.length, 0);
  } finally { f.close(); }
});

test("Artist image callbacks and deferred fallbacks cannot cross a privacy-only command revision", async () => {
  const f = fixture();
  try {
    await f.settle();
    const photo = () => f.all().find(n => n.type === "ExpoImage" && n.props.accessibilityLabel === "Open featured Fixture Artist photo");
    const initial = photo().props.source.uri, oldError = photo().props.onError, previous = f.presentation;
    f.precommitPrivacy(); assert.equal(previous.current(), true); assert.equal(previous.privacyCurrent(), false); f.act(oldError);
    assert.equal(photo()?.props.source.uri, initial, "privacy revocation precedes React commit");
    f.privacy(); assert.equal(previous.current(), true); f.act(oldError);
    assert.equal(photo()?.props.source.uri, initial, "an old native callback cannot initiate a fallback read under new privacy");
    const coveredError = photo().props.onError;
    f.cover(); f.act(coveredError); assert.equal(photo()?.props.source.uri, initial);
    f.privacy(); f.uncover(); assert.equal(photo()?.props.source.uri, initial, "a deferred receipt from prior privacy is discarded");
    f.act(photo().props.onError); assert.notEqual(photo()?.props.source.uri, initial, "fresh privacy admission still handles image failures");
  } finally { f.close(); }
});

for (const strict of [false, true]) {
  test(`actual Artist event-review hook paginates, pauses and restores a cancelled append (StrictMode ${strict})`, async () => {
    const f = fixture({ resourceOnly: "eventReviews", strict });
    try {
      await f.settle(); const oldMore = f.resources.events.loadMore, oldReload = f.resources.events.reload;
      assert.equal(f.resources.events.resource.status, "ready");
      assert.equal(f.resources.events.resource.data.reviews[0]?.id, "review-one");
      let result, error;
      f.act(() => { result = f.resources.events.loadMore().catch(value => { error = value; }); });
      await tick(); assert.equal(error, undefined, "active loadMore must not shadow its current predicate");
      const more = f.reads.at(-1); assert.equal(more.args.cursor, "reviews-next");
      await f.complete(more, { reviews: [{ ...review, id: "review-two" }], nextCursor: "reviews-third", total: 3 }); await result;
      assert.deepEqual(f.resources.events.resource.data.reviews.map(row => row.id), ["review-one", "review-two"]);
      f.act(() => { result = f.resources.events.loadMore().catch(value => { error = value; }); }); await tick();
      assert.equal(error, undefined); const interrupted = f.reads.at(-1); assert.equal(interrupted.args.cursor, "reviews-third");
      const before = f.resources.events.resource.data.reviews;
      f.cover(); assert.equal(interrupted.args.signal.aborted, true); await tick(); f.render();
      assert.equal(f.resources.events.resource.data.loadingMore, false, "cover restores settled append state");
      assert.deepEqual(f.resources.events.resource.data.reviews, before);
      f.uncover(); const count = f.reads.length;
      f.act(() => { void oldMore(); oldReload(); }); await tick(); assert.equal(f.reads.length, count);
      await f.complete(interrupted, { reviews: [{ ...review, id: "stale-review" }], nextCursor: null, total: 3 }); await result;
      assert.deepEqual(f.resources.events.resource.data.reviews, before);
      f.act(() => { void f.resources.events.loadMore(); });
      assert.equal(f.reads.length, count + 1, "fresh Back pagination can retry the interrupted append");
    } finally { f.close(); }
  });
}

test("actual Artist event-review refresh stays usable and old completion cannot mutate a new account", async () => {
  const f = fixture({ resourceOnly: "eventReviews" });
  try {
    await f.settle(); let result, error;
    assert.equal(f.resources.events.resource.status, "ready");
    assert.equal(f.resources.events.resource.data.reviews[0]?.id, "review-one");
    f.act(() => { result = f.resources.events.refresh().catch(value => { error = value; }); });
    await tick(); assert.equal(error, undefined, "active refresh must not shadow its current predicate");
    const refresh = f.reads.at(-1);
    await f.complete(refresh, { reviews: [{ ...review, id: "fresh-review" }], nextCursor: null, total: 1 }); await result;
    assert.equal(f.resources.events.resource.data.reviews[0].id, "fresh-review");
    const oldRefresh = f.resources.events.refresh;
    f.act(() => { result = f.resources.events.refresh().catch(value => { error = value; }); });
    const pending = f.reads.at(-1); f.cover(); f.account("account-B");
    assert.equal(pending.args.signal.aborted, true); assert.equal(f.resources.events.resource.data.reviews.length, 0);
    await f.complete(pending, { reviews: [review], nextCursor: null, total: 1 }); await result;
    assert.equal(f.resources.events.resource.data.reviews.length, 0); assert.equal(error?.name, "AbortError");
    const count = f.reads.length;
    await Promise.resolve(oldRefresh()).catch(value => { assert.equal(value.name, "AbortError"); });
    assert.equal(f.reads.length, count);
  } finally { f.close(); }
});

test("real Artist upcoming-show filters retain draft and deny old focus, location and ticket actions", async () => {
  const f = fixture();
  try {
    await f.settle(); f.press("Shows artist page section"); await f.settle(); f.press("All locations");
    const city = () => f.all().find(n => n.type === "TextInput" && n.props.accessibilityLabel === "City");
    assert.ok(city()); f.act(() => city().props.onChangeText("Toronto"));
    const oldSubmit = city().props.onSubmitEditing;
    const oldTicket = f.event("Tickets: Fixture Artist");
    const count = f.reads.length;
    f.precommit(); f.act(() => { oldSubmit(); oldTicket(); });
    f.cover(); f.act(() => { oldSubmit(); oldTicket(); });
    assert.equal(city().props.value, "Toronto"); assert.equal(f.calls.focus.length, 0); assert.equal(f.calls.actions.length, 0); assert.equal(f.reads.length, count);
    f.uncover(); await f.settle(); f.act(() => { oldSubmit(); oldTicket(); });
    assert.equal(city().props.value, "Toronto"); assert.equal(f.calls.focus.length, 0); assert.equal(f.calls.actions.length, 0);
    f.act(() => city().props.onSubmitEditing());
    assert.equal(f.calls.focus.length, 1); assert.equal(f.reads.at(-1).args.city, "Toronto");
  } finally { f.close(); }
});


test("Artist settled authoritative and hydrated review rows project live blocked and removed identities", async () => {
  for (const source of ["authoritative", "hydrated"]) {
    for (const reason of ["blocked", "removed"]) {
      const f = fixture();
      try {
        if (source === "hydrated") {
          const summary = f.store.artistSummary;
          f.store.artistSummary = () => ({ ...summary(), nights: [review] });
          const pending = f.reads.find(call => call.kind === "reviews"); pending.done = true;
        }
        await f.settle(); f.render();
        assert.match(f.text(), /Fixture Fan/);
        if (reason === "blocked") f.store.blockedIds = [review.userId]; else f.store.removedIds = [review.id];
        f.render();
        assert.equal(f.all().some(node => node.props?.accessibilityLabel === "Read the full review from Fixture Fan"), false);
        assert.equal(f.text().includes(review.review.slice(0, 60)), false, `${source} ${reason} hides review before effect cleanup`);
      } finally { f.close(); }
    }
  }
});

test("Artist retained review media and server-gallery items project removed URIs, posters, posts and owners", async () => {
  const f = fixture();
  try {
    const uri = "https://images.example/review.jpg", poster = "https://images.example/poster.jpg";
    f.defaults.reviews = [{ ...review, photos: [uri], media: [{ uri, posterUrl: poster, kind: "image" }] }];
    f.store.artistGallery = () => [{ uri, posterUrl: poster, source: "fan", ownerId: review.userId, postId: review.id, by: "Fixture Fan" }];
    await f.settle();
    const media = () => f.all().find(node => node.props?.accessibilityLabel === "Open media from Fixture Fan's review of Fixture Artist");
    assert.ok(media());
    f.store.isPhotoRemoved = value => value === poster; f.render();
    assert.equal(media(), undefined, "a withdrawn poster cannot survive through the original media descriptor");
    assert.equal(f.all().some(node => node.type === "ExpoImage" && [uri, poster].some(value => String(node.props.source?.uri).includes(encodeURIComponent(value)))), false);
    f.store.isPhotoRemoved = () => false; f.store.removedIds = [review.id]; f.render();
    assert.equal(f.text().includes("Photos by"), false);
    f.store.removedIds = []; f.store.blockedIds = [review.userId]; f.render();
    assert.equal(media(), undefined); assert.equal(f.text().includes("Photos by"), false);
  } finally { f.close(); }
});

test("Artist settled private review snapshot is withdrawn synchronously on privacy revision and fresh reload works", async () => {
  const f = fixture({ resourceOnly: true });
  try {
    await f.settle(); assert.equal(f.resources.reviews.resource.data[0].id, review.id);
    const count = f.reads.length; f.privacy();
    assert.deepEqual(f.resources.reviews.resource.data, []); assert.equal(f.reads.length, count);
    f.cover(); f.uncover(); assert.deepEqual(f.resources.reviews.resource.data, []);
    f.act(() => f.resources.reviews.reload());
    await f.complete(f.reads.at(-1), [{ ...review, id: "current-private-review" }]);
    assert.equal(f.resources.reviews.resource.data[0].id, "current-private-review");
  } finally { f.close(); }
});

test("Artist obsolete private success is rejected before privacy render and authoritative denial still settles", async () => {
  for (const result of ["success", "denial"]) {
    const f = fixture({ resourceOnly: true });
    try {
      const pending = f.reads.find(call => call.kind === "reviews"), count = f.reads.length, previous = f.presentation;
      f.precommitPrivacy(); assert.equal(previous.current(), true); assert.equal(previous.privacyCurrent(), false);
      if (result === "success") await f.complete(pending, [review]);
      else await f.reject(pending, { status: 403, serverCode: "FORBIDDEN" });
      assert.deepEqual(f.resources.reviews.resource.data, []);
      if (result === "denial") assert.equal(f.resources.reviews.resource.error.status, 403);
      f.privacy(); assert.equal(f.reads.length, count, "privacy does not restart the same admitted request");
      assert.deepEqual(f.resources.reviews.resource.data, []);
    } finally { f.close(); }
  }
});

test("Artist report and location inputs blur their own native instances at cover layout without clearing drafts or another editor", async () => {
  for (const form of ["report", "location"]) {
    const f = fixture({ foreignEditor: true });
    try {
      await f.settle();
      if (form === "report") {
        f.press("About artist page section"); await f.settle();
        const report = f.all().find(node => node.props?.accessibilityLabel === "Report the wrong video playing for Song 0");
        assert.ok(report); f.act(() => report.props.onPress());
      } else { f.press("Shows artist page section"); await f.settle(); f.press("All locations"); }
      const inputs = f.all().filter(node => node.type === "TextInput" && node.props.accessibilityLabel !== "Other page editor");
      assert.equal(inputs.length, 2); const input = inputs.at(-1);
      f.act(() => input.props.onChangeText("Preserved draft")); input.focus();
      const other = f.all().find(node => node.props?.accessibilityLabel === "Other page editor"); other.focus();
      f.coverLayout();
      assert.ok(inputs.every(node => f.calls.blur.includes(node.instance)), "layout departure blurs each owned input before passive cleanup");
      assert.equal(f.calls.focused, other, "own-instance blur never dismisses another page's responder");
      f.uncover(); assert.equal(f.all().find(node => node.instance === input.instance).props.value, "Preserved draft");
    } finally { f.close(); }
  }
});


test("Artist privacy-withdrawn reviews have a truthful native retry affordance that restores fresh results", async () => {
  const f = fixture();
  try {
    await f.settle(); const count = f.reads.length; f.privacy();
    assert.match(f.text(), /Review access changed/); assert.equal(f.reads.length, count);
    assert.equal(f.text().includes("last verified ranking is still showing"), false);
    f.press("Retry loading live artist reviews"); const pending = f.reads.at(-1);
    assert.equal(pending.kind, "reviews");
    await f.complete(pending, [{ ...review, review: "Fresh permitted review" }]);
    assert.match(f.text(), /Fresh permitted review/); assert.equal(f.text().includes("Review access changed"), false);
  } finally { f.close(); }
});


test("Artist private review authoritative denials revoke older occurrences exactly once without restarting the read", async () => {
  for (const status of [403, 404, 410]) {
    const f = fixture({ resourceOnly: true });
    try {
      const count = f.reads.length, old = f.presentation;
      const pending = f.reads.find(call => call.kind === "reviews");
      await f.reject(pending, { status });
      assert.equal(f.calls.privacyInvalidations.length, 1); assert.equal(old.privacyCurrent(), false);
      assert.equal(old.current(), true, "authoritative denial retains read ownership");
      assert.equal(f.resources.reviews.resource.error.status, status);
      assert.equal(f.resources.reviews.resource.privacyWithdrawn, true); assert.deepEqual(f.resources.reviews.resource.data, []);
      f.render(); f.privacy(); assert.equal(f.reads.length, count, "denial cannot trigger a privacy re-read loop");
      f.cover(); f.uncover();
      assert.equal(f.reads.filter(call => call.kind === "reviews").length, 1, "Back does not silently retry a denial");
    } finally { f.close(); }
  }
});


test("Artist removed identity artwork and avatar gallery URI cannot reappear outside the fan gallery", async () => {
  const f = fixture();
  try {
    await f.settle();
    const uri = "https://images.example/artist.jpg";
    assert.ok(f.all().some(node => node.type === "ExpoImage" && String(node.props.source?.uri).includes(encodeURIComponent(uri))));
    f.store.isPhotoRemoved = value => value === uri; f.render();
    assert.equal(f.all().some(node => ["ExpoImage", "Image"].includes(node.type) && [uri, encodeURIComponent(uri)].some(value => String(node.props.source?.uri).includes(value))), false);
  } finally { f.close(); }
});


test("Artist review authentication401 does not publish private-denial invalidation or restart authentication", async () => {
  const f = fixture({ resourceOnly: true });
  try {
    const previous = f.presentation, count = f.reads.length;
    await f.reject(f.reads.find(call => call.kind === "reviews"), { status: 401 });
    assert.equal(f.calls.privacyInvalidations.length, 0); assert.equal(previous.privacyCurrent(), true);
    assert.equal(f.resources.reviews.resource.error.status, 401); assert.deepEqual(f.resources.reviews.resource.data, []);
    f.render(); assert.equal(f.reads.length, count);
  } finally { f.close(); }
});


test("Artist superseded, aborted and identity-changed review errors cannot publish a privacy denial", async () => {
  for (const mode of ["superseded", "aborted", "identity", "transport"]) {
    const f = fixture({ resourceOnly: true });
    try {
      const pending = f.reads.find(call => call.kind === "reviews");
      if (mode === "superseded") f.act(() => f.resources.reviews.reload());
      if (mode === "aborted") f.cover();
      await f.reject(pending, mode === "identity" ? { status: 409, serverCode: "IDENTITY_CHANGED", code: "PIT-AUTH-004" }
        : mode === "transport" ? { status: 500 } : { status: 403 });
      assert.equal(f.calls.privacyInvalidations.length, 0, mode);
    } finally { f.close(); }
  }
});

for (const mode of ["initial", "refresh", "append"]) for (const status of [403, 404, 410]) {
  test(`actual event-review ${mode} ${status} clears all pages and revokes once without automatic retry`, async () => {
    const f = fixture({ resourceOnly: "eventReviews" });
    try {
      let pending;
      if (mode !== "initial") {
        await f.settle();
        assert.equal(f.resources.events.resource.data.reviews[0].id, "review-one");
        f.act(() => { pending = (mode === "append" ? f.resources.events.loadMore() : f.resources.events.refresh()).catch(error => error); });
      }
      await f.reject(f.reads.filter(call => call.kind === "eventReviews").at(-1), { status }); await pending;
      assert.equal(f.calls.privacyInvalidations.length, 1);
      assert.equal(f.resources.events.resource.status, "error");
      assert.equal(f.resources.events.resource.privacyWithdrawn, true);
      assert.deepEqual(f.resources.events.resource.data.reviews, []);
      assert.equal(f.resources.events.resource.data.nextCursor, null);
      assert.equal(f.resources.events.resource.data.loadingMore, false);
      const count = f.reads.length; f.render(); f.cover(); f.uncover(); await tick();
      assert.equal(f.reads.length, count, "denial is settled until an explicit user retry");
      assert.equal(f.calls.privacyInvalidations.length, 1);
      f.act(() => f.resources.events.reload()); await f.settle(); f.render();
      assert.equal(f.resources.events.resource.status, "ready");
      assert.equal(f.resources.events.resource.data.reviews[0].id, "review-one");
      assert.equal(f.resources.events.resource.privacyWithdrawn, undefined);
    } finally { f.close(); }
  });
}

for (const mode of ["initial", "refresh", "append"]) test(`actual event-review ${mode} success under retired privacy proof stays withdrawn until fresh retry`, async () => {
  const f = fixture({ resourceOnly: "eventReviews" });
  try {
    let pending;
    if (mode !== "initial") {
      await f.settle();
      f.act(() => { pending = (mode === "append" ? f.resources.events.loadMore() : f.resources.events.refresh()).catch(error => error); });
    }
    const request = f.reads.filter(call => call.kind === "eventReviews").at(-1), count = f.reads.length;
    f.precommitPrivacy();
    await f.complete(request, { reviews: [{ ...review, id: "obsolete-private" }], nextCursor: "obsolete-next", total: 10 }); await pending;
    assert.deepEqual(f.resources.events.resource.data.reviews, []);
    assert.equal(f.resources.events.resource.data.nextCursor, null);
    assert.equal(f.resources.events.resource.privacyWithdrawn, true);
    assert.equal(f.calls.privacyInvalidations.length, 0);
    assert.equal(f.reads.length, count);
    f.privacy(); f.act(() => f.resources.events.reload()); await f.settle();
    assert.equal(f.resources.events.resource.data.reviews[0].id, "review-one");
  } finally { f.close(); }
});

test("actual event-review denial already superseded by a sibling privacy publication settles without publishing twice", async () => {
  const f = fixture({ resourceOnly: "eventReviews" });
  try {
    const request = f.reads.filter(call => call.kind === "eventReviews").at(-1);
    f.privacy(); const count = f.reads.length;
    await f.reject(request, { status: 403 });
    assert.equal(f.calls.privacyInvalidations.length, 0);
    assert.equal(f.resources.events.resource.status, "error");
    assert.deepEqual(f.resources.events.resource.data.reviews, []);
    assert.equal(f.reads.length, count);
    f.act(() => f.resources.events.reload()); await f.settle(); f.render();
    assert.equal(f.resources.events.resource.data.reviews[0].id, "review-one");
  } finally { f.close(); }
});

test("actual event-review transient errors preserve allowed pages and cancelled or obsolete denials cannot revoke", async () => {
  for (const mode of ["superseded", "covered", "identity", "transport", "authentication"]) {
    const f = fixture({ resourceOnly: "eventReviews" });
    try {
      await f.settle(); let result;
      f.act(() => { result = f.resources.events.loadMore(); });
      const request = f.reads.filter(call => call.kind === "eventReviews").at(-1);
      if (mode === "superseded") f.act(() => f.resources.events.reload());
      if (mode === "covered") f.cover();
      await f.reject(request, { status: mode === "identity" ? 409 : mode === "transport" ? 503 : mode === "authentication" ? 401 : 403 }); await result;
      assert.equal(f.calls.privacyInvalidations.length, 0, mode);
      assert.equal(f.resources.events.resource.data.reviews[0].id, "review-one", mode);
      assert.equal(f.resources.events.resource.data.loadingMore, false);
    } finally { f.close(); }
  }
});
