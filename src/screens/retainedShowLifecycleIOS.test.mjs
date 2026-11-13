import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { spawnSync } from "node:child_process";

const root = fileURLToPath(new URL("../../", import.meta.url));
const require = createRequire(new URL("../../package.json", import.meta.url));
const React = require("react"), reconciler = require("react-reconciler");
const { transformSync } = require("@babel/core");
const noop = () => {};
const codes = new Map();
function execute(file, imports, timers = null) {
  const absolute = path.join(root, file);
  if (!codes.has(file)) codes.set(file, transformSync(readFileSync(absolute, "utf8"), {
    filename: absolute, babelrc: false, configFile: false,
    plugins: [[require("@babel/plugin-transform-react-jsx"), { runtime: "automatic" }], require("@babel/plugin-transform-modules-commonjs")],
  }).code);
  const module = { exports: {} };
  new Function("require", "module", "exports", "setTimeout", "clearTimeout", codes.get(file))(
    name => imports(name, createRequire(absolute)), module, module.exports,
    timers ? fn => { const key = {}; timers.set(key, fn); return key; } : setTimeout,
    timers ? key => timers.delete(key) : clearTimeout);
  return module.exports;
}
function nativeDimensionsFixture(initial) {
  // Exercise the installed RN subscription and hook instead of forcing an
  // owner render after mutating a fake useWindowDimensions return value.
  let holdChange = false;
  class Events {
    listeners = new Map();
    addListener(name, listener) {
      if (!this.listeners.has(name)) this.listeners.set(name, new Set());
      const listeners = this.listeners.get(name); listeners.add(listener);
      return { remove: () => listeners.delete(listener) };
    }
    emit(name, value) { if (holdChange && name === "change") return; for (const listener of [...(this.listeners.get(name) || [])]) listener(value); }
  }
  const device = new Events();
  const read = (name, dependencies) => {
    const filename = require.resolve(`react-native/Libraries/Utilities/${name}`);
    if (!codes.has(filename)) codes.set(filename, transformSync(readFileSync(filename, "utf8"), {
      filename, babelrc: false, configFile: false,
      plugins: [require("@babel/plugin-transform-flow-strip-types"), require("@babel/plugin-transform-modules-commonjs")],
    }).code);
    const module = { exports: {} };
    new Function("require", "module", "exports", codes.get(filename))(dependency => {
      assert.ok(Object.hasOwn(dependencies, dependency), `Unexpected RN dimension dependency: ${dependency}`);
      return dependencies[dependency];
    }, module, module.exports);
    return module.exports.default;
  };
  const Dimensions = read("Dimensions", {
    "../EventEmitter/RCTDeviceEventEmitter": device, "../vendor/emitter/EventEmitter": Events,
    "./NativeDeviceInfo": { getConstants: () => ({ Dimensions: { window: { ...initial, scale: 3 } } }) },
    invariant: require("invariant"),
  });
  return {
    useWindowDimensions: read("useWindowDimensions", { "./Dimensions": Dimensions, react: React }),
    PixelRatio: read("PixelRatio", { "./Dimensions": { default: Dimensions } }),
    update(next, { notify = true } = {}) {
      holdChange = !notify;
      try { device.emit("didUpdateDimensions", { window: { ...Dimensions.get("window"), ...next } }); }
      finally { holdChange = false; }
    },
    snapshot: () => Dimensions.get("window"),
  };
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
const nodes = node => [node, ...(node.children || []).flatMap(nodes)];
const text = node => node.text ?? (node.children || []).map(text).filter(value => value !== "").join(" ");
const flattenedStyle = node => Object.assign({}, ...[node.props.style].flat(Infinity).filter(Boolean));
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const privateReview = { id: "private-review", userId: "reviewer", user: { id: "reviewer", name: "Private reviewer" }, review: "Private concert receipt", overall: 5, date: "2026-01-01" };

// Production Show, attendance, public-event/memorial/archive hooks, composer,
// countdown, sourced context, maps and ticket actions. Only native hosts,
// transport and account Store are synthetic. No network or account is touched.
function fixture({ strict = false, publicEvent = false, deferredLinks = false, nativeTickets = false, nativeStack = false, logOverrides = {}, savedAttendance = null, width = 393, fontScale = 1, lounge = { messageCount: 3 } } = {}) {
  const renderer = createRenderer(), reads = [], writes = [], receipts = [], opens = [], speech = [], timers = new Map();
  const rsvpTimers = new Map();
  const dimensions = nativeDimensionsFixture({ width, height: 852, fontScale });
  const modules = new Map(), context = require("./src/components/iosDetailPresentationContext.mjs");
  const privacy = require("./src/domain/iosDetailPrivacyEpoch.mjs").createIOSDetailPrivacyEpoch();
  let active = true, authority = {}, account = "A", epoch = 1, suspended = false;
  const log = { id: "tm_fixture", artist: "Fixture artist", artistKey: "artist_fixture", venue: "Fixture hall", city: "Fixture city",
    date: "2099-01-01", startDateTime: "2099-01-01T20:00:00Z", source: "ticketmaster", ticketUrl: "https://concert-seller.com/ticket",
    inTourWindow: true, setlist: ["First song"], ...(publicEvent ? { artistIdentityPending: true } : { archiveShowKey: "show_archive" }), ...logOverrides };
  const document = { id: "show_" + "a".repeat(64), canonicalKey: "fixture-key", artist: log.artist, artistKey: log.artistKey,
    venue: log.venue, localDate: log.date, startsAt: Date.parse(log.startDateTime), lifecycle: "upcoming",
    provider: { name: "ticketmaster", eventId: log.id, backed: true } };
  let frames = [{}, { openLog: log }];
  const cityContext = { CityNavigationContext: React.createContext(null) };
  const postContext = { PostNavigationContext: React.createContext(null) };
  const pending = kind => options => { const request = { kind, options, ...deferred() }; (kind === "attendance" || kind === "post" ? writes : reads).push(request); return request.promise; };
  const store = {
    blockedIds: [], removedIds: [],
    venueCoord: () => ({ lat: 43, lng: -79 }), venuePhotos: () => [], venuePhotoState: () => ({ status: "ready" }),
    venuePhotoPrivacyRevision: 0, loadVenuePhotos: (venue, options) => pending("photos")(options), concertKey: () => "fixture-key",
    isGoing: () => false, isGoingBusy: () => false, toggleGoing: pending("legacyGoing"), loungeFor: () => [], artistSummary: () => null,
    remoteArtistMeta: () => ({ artistKey: log.artistKey, name: log.artist }), resolveArtist: () => assert.fail("No lookup needed"), addLog: pending("post"),
  };
  const animation = () => ({ start: noop, stop: noop });
  const Animated = {
    View: "AnimatedView",
    Value: class {
      constructor(value) { this.value = value; }
      setValue(value) { this.value = value; }
      interpolate(config) { return { value: this, ...config }; }
    },
    timing: animation, loop: animation, sequence: animation,
  };
  const native = { Animated, Easing: { linear: value => value }, AppState: { currentState: "active", addEventListener: () => ({ remove: noop }) }, Platform: { OS: "ios", select: choices => choices.ios || choices.default },
    View: "View", Text: "Text", TextInput: "TextInput", ScrollView: "ScrollView", Pressable: "Pressable", ActivityIndicator: "ActivityIndicator", RefreshControl: "RefreshControl",
    StyleSheet: { create: value => value, absoluteFill: {} }, useWindowDimensions: dimensions.useWindowDimensions, PixelRatio: dimensions.PixelRatio,
    Linking: { openURL: url => { const request = { kind: "link", url, ...deferred() }; opens.push(request);
      if (!deferredLinks) request.resolve(); return request.promise; } }, Alert: { alert: (...args) => opens.push({ kind: "alert", args }) },
    AccessibilityInfo: { announceForAccessibilityWithOptions: message => speech.push(message) } };
  const load = file => {
    if (!modules.has(file)) modules.set(file, execute(file, imports));
    return modules.get(file);
  };
  const imports = (name, local) => {
    if (name.endsWith("/DynamicTypeText")) return load("src/components/DynamicTypeText.ios.jsx");
    if (name.endsWith("/ShowSection")) return load("src/features/showDetails/ShowSection.jsx");
    if (name.endsWith("/lazyWithRetry")) return { lazyWithRetry: (_read, label) => {
      assert.equal(label, "AfterShowSection");
      return props => React.createElement(load("src/screens/AfterShowSection.jsx").default, props);
    } };
    if (name.endsWith("/usePublicVenueSnapshot")) return () => ({ resource: { status: "ready", data: { venue: { name: log.venue, place: log.city, coord: { lat: 43, lng: -79 } } } } });
    if (name.endsWith("/PageReturnContext")) return load("src/components/PageReturnContext.jsx");
    if (name.endsWith("/useNativeTabPreview")) return load("src/hooks/useNativeTabPreview.ios.js");
    if (name === "react" || name === "react/jsx-runtime") return require(name);
    if (name === "react-native") return native;
    if (name.endsWith("/NativeScrollChrome.ios")) return { NativeScrollChromeContext: React.createContext(null) };
    if (name.endsWith("/useIOSDetailPresentation")) return load("src/hooks/useIOSDetailPresentation.ios.js");
    if (name.endsWith("/useFeedPresentation")) return load("src/hooks/useFeedPresentation.ios.js");
    if (name.endsWith("/PostNavigationContext")) return postContext;
    if (name.endsWith("/CityNavigationContext")) return cityContext;
    if (name.endsWith("/useIOSDetailPresentation.js")) return require("./src/hooks/useIOSDetailPresentation.js");
    if (name.endsWith("/iosDetailPresentationContext.mjs")) return context;
    if (name.endsWith("/useIOSDetailBackBlock")) return () => {};
    if (name.endsWith("/useScreenReaderEnabled")) return () => true;
    if (name.endsWith("/useReducedMotion")) return () => false;
    if (name.endsWith("/useAppActive")) return () => true;
    if (name.endsWith("/theme")) return { colors: {}, radius: {}, shadow: {}, space: value => value * 4 };
    if (name.endsWith("/iosDetailPrivacy")) return { getIOSDetailPrivacySnapshot: privacy.getSnapshot, subscribeIOSDetailPrivacy: privacy.subscribe, invalidateIOSDetailPrivacy: privacy.invalidate };
    if (name.endsWith("/store")) return { useStore: () => {
      const owner = account, ownerEpoch = epoch;
      return { ...store, session: { id: account, name: "Fixture member" }, applyMyAttendanceMutation: (...args) => {
        if (owner === account && ownerEpoch === epoch) receipts.push(args);
      } };
    } };
    if (name === "./ShowRefreshRecovery") return load("src/screens/ShowRefreshRecovery.ios.jsx");
    if (name.endsWith("/showSocialService")) return {
      readShowDocument: pending("document"), readPublicEventSnapshot: pending("public"),
      readShowCrowdAttendance: pending("crowd"), readShowLoungeMeta: pending("lounge"), writeShowAttendance: pending("attendance"),
    };
    if (name.endsWith("/artistMemorialApi.mjs")) return { readArtistMemorial: pending("memorial") };
    if (name.endsWith("/artistEventApi.mjs")) return { readArtistEventReviews: pending("reviews") };
    if (name.endsWith("/catalogTextApi")) return { readCatalogPageText: pending("catalog") };
    if (name.endsWith("/PublicWebLinks")) return { PublicPressableLink: props => React.createElement("PublicPressableLink", { ...props, onPress: props.onNavigate }) };
    if (name.endsWith("/useArtistMemorial")) return load("src/features/artistMemorials/useArtistMemorial.ios.js");
    if (name.endsWith("/useArtistEventArchive")) return load("src/features/artistEvents/useArtistEventArchive.ios.js");
    if (name.endsWith("/useCanonicalArtistIdentity")) return load("src/hooks/useCanonicalArtistIdentity.ios.js");
    if (name.endsWith("/usePublicEventSnapshot")) return load("src/hooks/usePublicEventSnapshot.ios.js");
    if (name.endsWith("/useEventRsvp")) return execute("src/hooks/useEventRsvp.js", imports, rsvpTimers);
    if (name.endsWith("/useScopedRefresh")) return load("src/hooks/useScopedRefresh.ios.js");
    if (name.endsWith("/VinylRefreshBoundary")) return load("src/components/VinylRefreshBoundary.ios.jsx");
    if (name.endsWith("/ShowAttendanceControls")) return load("src/features/showSocial/ShowAttendanceControls.ios.jsx");
    if (name.endsWith("/GoingTicketComposer")) return load("src/components/GoingTicketComposer.ios.jsx");
    if (name.endsWith("/useIOSTicketAction")) return load("src/components/useIOSTicketAction.ios.js");
    if (name.endsWith("/NearbyAfterparty")) return load("src/components/NearbyAfterparty.ios.jsx");
    if (name.endsWith("/CatalogText")) return load("src/features/catalogEditor/CatalogText.ios.jsx");
    if (name.endsWith("/ticketLinks")) return nativeTickets ? load("src/lib/ticketLinks.ios.js") : { openTicketLink: (url, options) => {
      const request = { url, options, ...deferred() }; opens.push(request); return request.promise;
    } };
    if (name.endsWith("/Countdown")) {
      const file = "src/components/Countdown.ios.jsx", code = transformSync(readFileSync(path.join(root, file), "utf8"), {
        filename: file, babelrc: false, configFile: false,
        plugins: [[require("@babel/plugin-transform-react-jsx"), { runtime: "automatic" }], require("@babel/plugin-transform-modules-commonjs")],
      }).code;
      const module = { exports: {} };
      new Function("require", "module", "exports", "setInterval", "clearInterval", code)(
        n => imports(n, createRequire(path.join(root, file))), module, module.exports,
        fn => { const key = {}; timers.set(key, fn); return key; }, key => timers.delete(key));
      return module.exports;
    }
    if (name.endsWith("/SocialShareStudio")) return { SocialShareButton: "SocialShareButton" };
    if (name.endsWith("/showTime") || name.endsWith("/afterparty")) return local(name + ".js");
    if (name.endsWith(".mjs")) return local(name);
    if (name.startsWith("../components/") || name.startsWith("../../components/") || ["./Icon", "./Button", "./ConcertTicketCard"].includes(name)) return name.split("/").at(-1);
    return local(name);
  };
  const Screen = load("src/screens/ShowScreen.ios.jsx").default;
  const Stack = nativeStack ? load("src/components/NativeDetailStack.ios.jsx").default : null;
  const useAdmission = load("src/hooks/useFeedPresentation.ios.js").default;
  const forever = new Promise(noop);
  let source;
  const renew = () => {
    const token = authority = {};
    source = { current: () => authority === token && active };
  };
  renew();
  let latestPresentation;
  function Owner() {
    const { current } = useAdmission({ active, presentation: source, scope: account + ":" + epoch });
    const privacyScope = React.useSyncExternalStore(privacy.subscribe, privacy.getSnapshot, privacy.getSnapshot);
    const token = React.useMemo(() => Object.freeze({}), [current]);
    const commandToken = React.useMemo(() => Object.freeze({}), [token, privacyScope]);
    const privacyCurrent = React.useMemo(() => () => privacy.getSnapshot() === privacyScope, [privacyScope]);
    const canAct = React.useMemo(() => () => current() && privacyCurrent(), [current, privacyCurrent]);
    const value = React.useMemo(() => ({ managed: true, active, preview: !active, current, canAct, token, commandToken,
      privacyScope, privacyCurrent, scope: "show-occurrence", guard: callback => (...args) => canAct() ? callback?.(...args) : undefined }),
    [current, canAct, active, token, commandToken, privacyScope, privacyCurrent]);
    latestPresentation = value;
    return React.createElement(context.IOSDetailPresentationContext.Provider, { value }, React.createElement(Screen, {
      log, onClose: () => opens.push({ kind: "back" }), onOpenVenue: () => opens.push({ kind: "venue" }), onOpenProfile: id => opens.push({ kind: "profile", id }),
      onOpenLounge: show => opens.push({ kind: "lounge", show }), onReview: show => opens.push({ kind: "review", show }),
    }));
  }
  function Gate() {
    if (suspended) throw forever;
    if (!nativeStack) return React.createElement(Owner);
    return React.createElement(Stack, { frames, scope: account + ":" + epoch, enabled: true, admitted: active,
      isCurrentRoute: (frame, index) => frames[index] === frame && index === frames.length - 1,
      element: React.createElement(Screen, { log: frames.at(-1).openLog,
        onOpenLounge: show => opens.push({ kind: "lounge", show }), onReview: show => opens.push({ kind: "review", show }) }), wrap: ({ children }) => children });
  }
  const render = () => renderer.render(React.createElement(strict ? React.StrictMode : React.Fragment, null,
    React.createElement(React.Suspense, { fallback: null }, React.createElement(Gate))));
  // The retained-lifecycle scenarios exercise the expanded sections. Use their
  // real disclosure controls once per mounted section, preserving user state
  // on later cover/Back and leaving collapsed-state tests independent.
  const openedSections = new WeakSet();
  const expandSections = () => {
    if (!active) return;
    for (const node of all()) if (["Event details", "Crowd & Lounge", "Setlist", "After the show", "Around the venue"].includes(node.props?.accessibilityLabel)
      && node.props.accessibilityState?.expanded === false && !openedSections.has(node)) {
      openedSections.add(node); renderer.act(() => node.props.onPress());
    }
  };
  const flush = async () => { for (let i = 0; i < 6; i++) { await new Promise(setImmediate); renderer.act(noop); expandSections(); } };
  const layers = () => nodes(renderer.container).filter(node => node.props?.testID?.startsWith("ios-detail-occurrence-"));
  const activeTree = () => nativeStack ? layers().find(node => node.props.pointerEvents === "auto") || renderer.container : renderer.container;
  const all = () => nodes(activeTree()), label = value => all().find(node => node.props?.accessibilityLabel === value);
  const resolveReads = async () => {
    for (let round = 0; round < 6; round++) {
      for (const request of reads.filter(request => !request.done)) {
        request.done = true;
        const defaults = {
          document, public: { ...log, name: log.artist, artistIdentityPending: false }, memorial: null, photos: [],
          crowd: { viewerAttendance: savedAttendance, scope: request.options.scope, attendees: [{ id: "fan", name: "Fixture fan", state: "going" }], total: 1 },
          lounge, reviews: { reviews: [], total: 0 }, catalog: { text: { summary: "Verified context", sources: [{ label: "Event source", url: "https://fixture.test/source" }] } },
        };
        request.resolve(defaults[request.kind]);
      }
      await flush();
    }
  };
  const f = { reads, writes, receipts, opens, speech, timers, rsvpTimers, log, document, render, flush, all, label, layers, resolveReads,
    text: () => text(activeTree()), act: renderer.act,
    resize(next, options) { renderer.act(() => dimensions.update(next, options)); },
    windowDimensions: dimensions.snapshot,
    pushDuplicate() { frames = [...frames, { openLog: { ...log } }]; render(); },
    popDuplicate() { frames = frames.slice(0, -1); render(); },
    privacyRevision: privacy.getSnapshot,
    async reject(request, status) { request.done = true; request.reject(Object.assign(new Error("Access withdrawn"), { name: "AppError", code: "PIT-API-001", retryable: true, status })); await flush(); },
    async complete(request, result) { request.done = true; request.resolve(result); await flush(); },
    refreshControl: () => all().find(n => n.type === "ScrollView" && n.props.refreshControl)?.props.refreshControl.props,
    press(value) { const button = label(value); assert.ok(button, value); renderer.act(() => button.props.onPress()); },
    cover() { active = false; renew(); render(); }, back() { active = true; renew(); render(); },
    precommit() { authority = {}; },
    suspend(value) { suspended = value; render(); },
    account(value) { account = value; epoch++; renew(); render(); },
    presentation: () => latestPresentation,
    invalidatePrivacyBeforeRender() { privacy.invalidate(); },
    block(value) { store.blockedIds = [value]; renderer.act(privacy.invalidate); render(); },
    removeSource() { store.removedIds = [log.id]; renderer.act(privacy.invalidate); render(); },
    close() { authority = {}; renderer.render(null); },
    async ready() { render(); await resolveReads(); },
  };
  return f;
}

function yogaActionFrame(f, width, rtl = false) {
  const lounge = f.all().find(node => node.type === "Pressable" && node.props.accessibilityLabel?.startsWith("Open this show's"));
  const row = f.all().find(node => node.children?.includes(lounge));
  const review = row.children.find(node => node.type === "Pressable" && text(node).includes("Rate & review"));
  assert.ok(review);
  const scroll = f.all().find(node => node.type === "ScrollView" && nodes(node).includes(row));
  const content = Object.assign({}, ...[scroll.props.contentContainerStyle].flat(Infinity));
  const rowStyle = flattenedStyle(row);
  assert.equal(rowStyle.flexDirection, "row");
  return { width, padding: content.paddingHorizontal ?? content.padding ?? 0,
    gap: rowStyle.gap, wrap: rowStyle.flexWrap === "wrap", rtl,
    review: flattenedStyle(review), lounge: flattenedStyle(lounge) };
}
function nativeActionGeometry(frames) {
  const input = frames.map(frame => [frame.width, frame.padding, frame.gap, +frame.wrap, +frame.rtl,
    ...[frame.review, frame.lounge].flatMap(style => [style.flex, style.flexBasis, style.minWidth, style.minHeight])].join(" ")).join("\n") + "\n";
  const result = spawnSync(process.env.PIT_YOGA_LAYOUT_PROBE, [], { input, encoding: "utf8", timeout: 10000 });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  const flagged = spawnSync(process.env.PIT_YOGA_LAYOUT_PROBE, ["--fit-content"], { input, encoding: "utf8", timeout: 10000 });
  assert.ifError(flagged.error);
  assert.equal(flagged.status, 0, flagged.stderr);
  assert.equal(flagged.stdout, result.stdout, "RN's optional fit-content flag does not change this regression");
  const geometry = result.stdout.trim().split(/\r?\n/).map(line => {
    const [width, height, reviewX, reviewY, reviewWidth, reviewHeight, loungeX, loungeY, loungeWidth, loungeHeight] = line.split(" ").map(Number);
    return { width, height, reviewX, reviewY, reviewWidth, reviewHeight, loungeX, loungeY, loungeWidth, loungeHeight };
  });
  assert.equal(geometry.length, frames.length);
  return geometry;
}
const yogaGate = { skip: process.env.PIT_YOGA_LAYOUT_PROBE ? false : "Compile scripts/fixtures/show-action-yoga and set PIT_YOGA_LAYOUT_PROBE for the supplemental native-engine gate" };
test("mounted Show refreshes heading, venue/date, rating, section and count text without replacing page or controls", async t => {
  const f = fixture({ nativeStack: true, width: 402, lounge: { messageCount: 123456 },
    logOverrides: { date: "2020-01-01", startDateTime: "2020-01-01T20:00:00Z", overall: 4.7 } });
  f.document.lifecycle = "completed"; t.after(f.close); await f.ready();
  const scroll = f.all().find(node => node.type === "ScrollView" && text(node).includes("Lounge"));
  scroll.nativeOffset = 610;
  f.press("Setlist");
  const controls = [f.label("Setlist"), f.label("Open this show's Lounge, 123456 messages")];
  const paragraphs = f.all().filter(node => node.type === "Text" && node.children.some(child => child.type === "Text" && child.props.accessible === false && child.children.length === 0));
  const labels = paragraphs.map(text);
  for (const expected of ["Fixture artist", "Fixture hall", "4.7", "Setlist", "123456"]) assert.ok(labels.includes(expected), expected);
  assert.ok(labels.some(label => /2020/.test(label)), "date is included");
  const reads = f.reads.length;
  for (const fontScale of [1.4, 1.786, 3.1, 1, 1.786, 1]) {
    const previous = paragraphs.map(node => node.children.at(-1));
    f.resize({ fontScale });
    paragraphs.forEach((paragraph, index) => {
      assert.ok(f.all().includes(paragraph), "existing outer text remains mounted");
      assert.equal(text(paragraph), labels[index], "no invisible characters or modified content");
      assert.notEqual(paragraph.children.at(-1), previous[index], "text measurement gets a new empty inline child");
      assert.equal(paragraph.props.allowFontScaling, undefined);
      assert.equal(paragraph.props.maxFontSizeMultiplier, undefined);
    });
    assert.ok(f.all().includes(scroll)); assert.equal(scroll.nativeOffset, 610);
    controls.forEach(control => assert.ok(f.all().includes(control), "focused buttons are retained"));
    assert.equal(f.label("Setlist").props.accessibilityState.expanded, false);
    assert.equal(f.reads.length, reads); assert.equal(f.writes.length, 0); assert.equal(f.opens.length, 0);
  }
  f.press("Open this show's Lounge, 123456 messages"); assert.equal(f.opens.at(-1).kind, "lounge");
});
for (const width of [320, 402]) for (const closed of [false, true]) for (const rtl of [false, true]) {
  test(`native Yoga keeps the mounted Lounge full-width across text/viewport changes (${width}, closed ${closed}, RTL ${rtl})`, yogaGate, async t => {
    const f = fixture({ width, lounge: { messageCount: 123456, status: closed ? "closed" : "open" },
      logOverrides: { date: "2020-01-01", startDateTime: "2020-01-01T20:00:00Z" } });
    f.document.lifecycle = "completed"; t.after(f.close); await f.ready();
    const frames = [], expectedLarge = [];
    for (const [fontScale, nextWidth] of [[1, width], [1.4, width], [1.786, width], [3.1, width], [1, width], [1.786, 744], [1.786, 320], [1, width]]) {
      f.resize({ fontScale, width: nextWidth });
      frames.push(yogaActionFrame(f, nextWidth, rtl)); expectedLarge.push(fontScale >= 1.4);
    }
    const geometry = nativeActionGeometry(frames);
    const near = (actual, expected, message) => assert.ok(Math.abs(actual - expected) <= 0.34, `${message}: ${actual} vs ${expected}`);
    geometry.forEach((g, i) => {
      const available = frames[i].width - 2 * frames[i].padding;
      near(g.width, available, "row width");
      assert.ok(g.loungeX >= 0 && g.loungeX + g.loungeWidth <= available + 0.34, "Lounge stays inside the row");
      assert.ok(g.reviewX >= 0 && g.reviewX + g.reviewWidth <= available + 0.34, "review stays inside the row");
      if (expectedLarge[i] || available < 2 * 140 + frames[i].gap) {
        near(g.loungeWidth, available, `full width at commit ${i}`);
        near(g.reviewWidth, available, "review uses its own full row");
        assert.ok(g.loungeY >= g.reviewY + g.reviewHeight + frames[i].gap - 0.34, "actions do not overlap");
      } else {
        near(g.loungeWidth, (available - frames[i].gap) / 2, "compact width restored");
        near(g.loungeY, g.reviewY, "normal text returns to one row");
      }
      assert.ok(g.height >= g.loungeY + g.loungeHeight - 0.34, "parent contains both actions");
    });
    assert.equal(f.writes.length, 0); assert.equal(f.opens.length, 0);
  });
}
test("native Yoga negative control reproduces the former 176-point cached flex basis", yogaGate, async t => {
  const f = fixture({ width: 402, logOverrides: { date: "2020-01-01", startDateTime: "2020-01-01T20:00:00Z" } });
  f.document.lifecycle = "completed"; t.after(f.close); await f.ready();
  const normal = yogaActionFrame(f, 402);
  f.resize({ fontScale: 1.786 });
  const large = yogaActionFrame(f, 402);
  large.lounge = { ...large.lounge, minWidth: 140, flexBasis: "100%" };
  const geometry = nativeActionGeometry([normal, large]);
  assert.equal(geometry[0].loungeWidth, 176);
  assert.equal(geometry[1].loungeWidth, 176, "the old JS style commits but cached native basis does not expand");
  assert.equal(geometry[1].loungeY, 0);
});

for (const width of [320, 393]) for (const closed of [false, true]) test(`Lounge keeps accessibility text in a full-width action at ${width}px (closed ${closed})`, async t => {
  const f = fixture({ width, fontScale: 1.786, lounge: { messageCount: 123456, status: closed ? "closed" : "open" },
    logOverrides: { date: "2020-01-01", startDateTime: "2020-01-01T20:00:00Z" } });
  f.document.lifecycle = "completed";
  t.after(f.close); await f.ready();
  const label = closed ? "Open this show's closed Lounge details" : "Open this show's Lounge, 123456 messages";
  const button = f.label(label);
  assert.ok(button, label);
  assert.equal(flattenedStyle(button).minWidth, "100%", "scaled label is not squeezed beside Rate & review");
  assert.equal(flattenedStyle(button).flexWrap, "wrap", "a large message count can move without splitting the label");
  assert.equal(flattenedStyle(button).height, undefined, "wrapped content has no fixed-height clipping");
  const labelNode = nodes(button).find(node => node.type === "Text" && text(node) === (closed ? "Lounge closed" : "Lounge"));
  assert.equal(flattenedStyle(labelNode).flexShrink, 0);
  assert.equal(flattenedStyle(labelNode).maxWidth, "100%");
  assert.notEqual(labelNode.props.allowFontScaling, false);
  assert.equal(labelNode.props.maxFontSizeMultiplier, undefined);
  assert.equal(labelNode.props.numberOfLines, undefined);
  const row = f.all().find(node => node.children?.includes(button));
  assert.equal(flattenedStyle(row).flexWrap, "wrap");
  const review = row.children.find(node => node.type === "Pressable" && text(node).includes("Rate & review"));
  assert.ok(review, "review remains alongside Lounge in the same action group");
  assert.equal(flattenedStyle(review).flex, 1, "review fills the previous wrapped row");
  f.act(review.props.onPress); f.press(label);
  assert.deepEqual(f.opens.map(open => open.kind), ["review", "lounge"]);
  assert.equal(f.opens[1].show.artist, "Fixture artist");
  assert.equal(f.writes.length, 0);
});

test("Lounge responds to live Dynamic Type changes without reviving covered or account-switched actions", async t => {
  const f = fixture(); t.after(f.close); await f.ready();
  const label = "Open this show's Lounge, 3 messages";
  const original = f.label(label), oldPress = original.props.onPress;
  assert.equal(flattenedStyle(original).minWidth, 140);
  for (const fontScale of [1.4, 1.786, 3.1]) {
    f.resize({ fontScale });
    assert.equal(f.label(label), original, "font changes preserve the mounted action");
    assert.equal(flattenedStyle(original).minWidth, "100%");
  }
  f.cover(); f.act(oldPress); assert.equal(f.opens.length, 0);
  f.back(); await f.resolveReads(); f.act(oldPress); assert.equal(f.opens.length, 0);
  f.press(label); assert.equal(f.opens.length, 1);
  const beforeAccountSwitch = f.label(label).props.onPress;
  f.account("B"); f.act(beforeAccountSwitch); assert.equal(f.opens.length, 1);
  await f.resolveReads(); f.press(label); assert.equal(f.opens.length, 2);
  f.resize({ fontScale: 1 });
  assert.equal(flattenedStyle(f.label(label)).minWidth, 140, "normal text returns to the compact layout");
  assert.equal(f.writes.length, 0);
});

// Keep the earlier delayed-subscription recovery coverage as well as the
// independently reproduced Fabric/Yoga cache failure above. Deliver the native
// text-layout boundary separately, using RN's real PixelRatio getter.
for (const width of [320, 402]) for (const closed of [false, true]) test(`Lounge recovers from native text layout with a stale window subscription at ${width}px (closed ${closed})`, async t => {
  const f = fixture({ width, lounge: { messageCount: 123456, status: closed ? "closed" : "open" } });
  t.after(f.close); await f.ready();
  const label = closed ? "Open this show's closed Lounge details" : "Open this show's Lounge, 123456 messages";
  const button = f.label(label);
  const caption = () => nodes(f.label(label)).find(node => node.type === "Text" && text(node) === (closed ? "Lounge closed" : "Lounge"));
  const scroll = f.all().find(node => node.type === "ScrollView" && text(node).includes("Lounge"));
  scroll.nativeOffset = 615;
  f.press("Setlist");
  assert.equal(f.label("Setlist").props.accessibilityState.expanded, false);
  const reads = f.reads.length;
  assert.equal(flattenedStyle(button).minWidth, 140);
  for (const fontScale of [1.4, 1.786, 3.1, 1, 1.786, 1]) {
    f.resize({ fontScale }, { notify: false });
    assert.equal(f.windowDimensions().fontScale, fontScale);
    f.act(() => caption().props.onTextLayout?.({ nativeEvent: { lines: [] } }));
    assert.equal(flattenedStyle(f.label(label)).minWidth, fontScale >= 1.4 ? "100%" : 140);
    assert.equal(f.label(label), button, "the action is not remounted");
    assert.equal(f.all().find(node => node === scroll), scroll);
    assert.equal(scroll.nativeOffset, 615);
    assert.equal(f.label("Setlist").props.accessibilityState.expanded, false, "user disclosure state survives");
    assert.equal(caption().props.allowFontScaling, undefined);
    assert.equal(caption().props.maxFontSizeMultiplier, undefined);
    assert.equal(caption().props.numberOfLines, undefined);
    f.act(() => { for (let i = 0; i < 10; i++) caption().props.onTextLayout?.({ nativeEvent: { lines: [] } }); });
    assert.equal(f.reads.length, reads, "repeated layout cannot start reads");
    assert.equal(f.writes.length, 0); assert.equal(f.opens.length, 0);
  }
  f.act(() => f.label(label).props.onPress());
  assert.equal(f.opens.at(-1).kind, "lounge");
});

test("late native text callbacks read the current scale and preserve retained action authority", async t => {
  const f = fixture(); t.after(f.close); await f.ready();
  const label = "Open this show's Lounge, 3 messages";
  const button = () => f.label(label);
  const caption = () => nodes(button()).find(node => node.type === "Text" && text(node) === "Lounge");
  const nativeLayout = caption().props.onTextLayout;
  const stalePress = button().props.onPress;
  f.resize({ fontScale: 1.786 }, { notify: false });
  f.act(() => nativeLayout?.({ nativeEvent: { lines: [] } }));
  assert.equal(flattenedStyle(button()).minWidth, "100%");
  f.cover();
  f.resize({ fontScale: 1 }, { notify: false });
  f.act(() => { nativeLayout?.({ nativeEvent: { lines: [{ height: 99 }] } }); stalePress(); });
  assert.equal(f.opens.length, 0);
  f.back(); await f.resolveReads();
  assert.equal(flattenedStyle(button()).minWidth, 140, "old event dimensions cannot reapply an old scale");
  f.act(stalePress); assert.equal(f.opens.length, 0);
  f.account("B"); await f.resolveReads();
  f.resize({ fontScale: 1.786 }, { notify: false });
  f.act(() => { nativeLayout?.({ nativeEvent: { lines: [] } }); stalePress(); });
  assert.equal(flattenedStyle(button()).minWidth, "100%");
  assert.equal(f.opens.length, 0); assert.equal(f.writes.length, 0);
  f.act(() => button().props.onPress()); assert.equal(f.opens.at(-1).kind, "lounge");
  f.resize({ fontScale: 1.2 });
  assert.equal(flattenedStyle(button()).minWidth, 140, "normal subscription delivery still works after recovery");
});

test("a mounted past-show action row reflows without retiring review or Lounge navigation", async t => {
  const f = fixture({ width: 402, logOverrides: { date: "2020-01-01", startDateTime: "2020-01-01T20:00:00Z" } });
  f.document.lifecycle = "completed";
  t.after(f.close); await f.ready();
  const lounge = f.label("Open this show's Lounge, 3 messages");
  const row = f.all().find(node => node.children?.includes(lounge));
  const review = row.children.find(node => node.type === "Pressable" && text(node).includes("Rate & review"));
  const caption = nodes(lounge).find(node => node.type === "Text" && text(node) === "Lounge");
  assert.ok(review);
  f.resize({ fontScale: 1.786 }, { notify: false });
  f.act(() => caption.props.onTextLayout?.({ nativeEvent: { lines: [] } }));
  assert.equal(flattenedStyle(lounge).minWidth, "100%");
  assert.equal(flattenedStyle(row).flexWrap, "wrap");
  assert.equal(flattenedStyle(lounge).flexWrap, "wrap");
  assert.equal(flattenedStyle(lounge).height, undefined);
  assert.equal(flattenedStyle(caption).flexShrink, 0);
  assert.equal(flattenedStyle(review).flex, 1);
  f.act(() => { review.props.onPress(); lounge.props.onPress(); });
  assert.deepEqual(f.opens.map(open => open.kind), ["review", "lounge"]);
  assert.equal(f.writes.length, 0);
});

for (const strict of [false, true]) test(`real Show preserves scroll, crowd and disclosure through preview and Back (StrictMode ${strict})`, async t => {
  const f = fixture({ strict }); t.after(f.close); await f.ready();
  assert.match(f.text(), /Fixture fan/);
  const spoiler = f.all().find(n => n.type === "Pressable" && text(n).includes("Setlist hidden"));
  f.act(() => spoiler.props.onPress());
  assert.match(f.text(), /First song/);
  const scroll = f.all().find(n => n.type === "ScrollView" && text(n).includes("First song")); scroll.nativeOffset = 615;
  const oldCrowd = f.label("Show friends in this Crowd").props.onPress;
  const oldGoing = f.label("Going").props.onPress;
  const count = f.reads.length;
  assert.equal(f.timers.size, 1);
  f.cover(); await f.flush();
  assert.equal(f.timers.size, 0);
  assert.match(f.text(), /First song/); assert.match(f.text(), /Fixture fan/);
  f.act(() => { oldCrowd(); oldGoing(); }); await f.flush();
  assert.equal(f.reads.length, count); assert.equal(f.writes.length, 0);
  assert.ok(f.reads.every(r => r.done || r.options.signal?.aborted), "all unfinished foreground reads are cancelled");
  f.back(); await f.flush();
  assert.equal(f.all().find(n => n.type === "ScrollView" && text(n).includes("First song")), scroll);
  assert.equal(scroll.nativeOffset, 615); assert.equal(f.timers.size, 1);
  f.act(() => { oldCrowd(); oldGoing(); });
  assert.equal(f.writes.length, 0, "returning cannot revive old native mutations");
  f.press("Going"); assert.equal(f.writes.length, 1, "current Back controls remain usable");
});

test("accepted attendance settles once while covered without opening composer or reloading social", async t => {
  const f = fixture(); t.after(f.close); await f.ready();
  f.press("Members"); f.press("Going"); assert.equal(f.writes.length, 1);
  f.cover(); const count = f.reads.length;
  f.writes[0].resolve({ showId: f.document.id, attendance: { state: "going", visibility: "members" } }); await f.flush();
  assert.equal(f.receipts.length, 1); assert.equal(f.reads.length, count);
  assert.equal(f.label("Share your Going post"), undefined);
  assert.equal(f.opens.length, 0);
  f.back(); await f.flush(); assert.ok(f.label("Remove Going from this show"));
  assert.equal(f.label("Share your Going post"), undefined);
});

test("accepted attendance across account A-B-A cannot apply receipt or reopen prompt", async t => {
  const f = fixture(); t.after(f.close); await f.ready();
  f.press("Going"); f.account("B"); f.account("A");
  f.writes[0].resolve({ showId: f.document.id, attendance: { state: "going", visibility: "members" } }); await f.flush();
  assert.equal(f.receipts.length, 0); assert.equal(f.label("Share your Going post"), undefined);
});

test("ticket failures and queued native controls cannot speak or open after cover and Back", async t => {
  const f = fixture({ strict: true }); t.after(f.close); await f.ready();
  const old = f.label("View tickets at seller for Fixture artist at Fixture hall").props.onPress;
  f.act(old); assert.equal(f.opens.length, 1);
  f.cover(); f.opens[0].options.onFailure(); f.opens[0].resolve({ status: "failed" }); await f.flush();
  assert.deepEqual(f.speech, []); assert.doesNotMatch(f.text(), /ticket site could not/);
  f.back(); f.act(old); assert.equal(f.opens.length, 1);
  f.press("View tickets at seller for Fixture artist at Fixture hall"); assert.equal(f.opens.length, 2);
  f.opens[1].options.onFailure(); f.opens[1].resolve({ status: "failed" }); await f.flush();
  assert.equal(f.speech.length, 1); assert.match(f.text(), /ticket site could not/);
});

test("Show callback retirement precedes commit and survives actual Suspense reconnect", async t => {
  const f = fixture({ strict: true }); t.after(f.close); await f.ready();
  const old = f.label("Going").props.onPress;
  f.precommit(); f.act(old); assert.equal(f.writes.length, 0);
  f.back(); await f.resolveReads();
  const beforeSuspense = f.label("Going").props.onPress;
  f.suspend(true); f.act(beforeSuspense); assert.equal(f.writes.length, 0);
  assert.equal(f.timers.size, 0, "Suspense hides layout ownership and stops the clock");
  assert.ok(f.reads.filter(r => ["document", "crowd", "lounge", "photos", "catalog"].includes(r.kind))
    .every(r => r.options.signal.aborted), "Show foreground reads abort on layout disconnect");
  f.suspend(false); await f.flush(); f.act(beforeSuspense); assert.equal(f.writes.length, 0);
  f.press("Going"); assert.equal(f.writes.length, 1);
});

test("composer drafts survive cover and accepted publishing cannot dismiss a successor", async t => {
  const f = fixture(); t.after(f.close); await f.ready();
  f.press("Members"); f.press("Going");
  f.writes[0].resolve({ showId: f.document.id, attendance: { state: "going", visibility: "members" } }); await f.flush();
  assert.ok(f.label("Share your Going post"));
  f.act(() => f.label("Optional note for your Going post").props.onChangeText("Keep my draft"));
  const button = () => f.all().find(n => n.type === "Button" && n.props.title === "Share post");
  const oldPublish = button().props.onPress;
  f.cover(); f.act(oldPublish); assert.equal(f.writes.length, 1);
  f.back(); f.act(oldPublish); assert.equal(f.writes.length, 1);
  assert.equal(f.label("Optional note for your Going post").props.value, "Keep my draft");
  f.act(button().props.onPress); assert.equal(f.writes.length, 2);
  assert.equal(f.writes[1].options.review, "Keep my draft");
  f.cover(); f.writes[1].resolve({ ok: true }); await f.flush();
  assert.ok(f.label("Share your Going post")); assert.equal(f.opens.length, 0);
  f.back(); assert.equal(button().props.loading, false, "accepted receipt releases the old posting claim");
});

test("manual photo retry is aborted and cannot restart from old native callback", async t => {
  const f = fixture(); t.after(f.close); await f.ready();
  const retry = f.all().find(n => n.type === "VenuePhotoWidget").props.onRetry;
  f.act(retry); const request = f.reads.at(-1); assert.equal(request.kind, "photos");
  f.cover(); assert.equal(request.options.signal.aborted, true);
  const count = f.reads.length; f.act(retry); assert.equal(f.reads.length, count);
  f.back(); const resumed = f.reads.length; f.act(retry); assert.equal(f.reads.length, resumed);
});

test("Back preserves a resolved public artist identity instead of returning to the old pending fallback", async t => {
  const f = fixture({ publicEvent: true }); t.after(f.close); await f.ready();
  assert.ok(f.label("Going"));
  const scroll = f.all().find(n => n.type === "ScrollView" && text(n).includes("Setlist hidden"));
  assert.ok(scroll); const count = f.reads.filter(r => r.kind === "public").length;
  f.cover(); f.back(); await f.flush();
  assert.equal(f.reads.filter(r => r.kind === "public").length, count);
  assert.equal(f.all().find(n => n.type === "ScrollView" && text(n).includes("Setlist hidden")), scroll);
  assert.ok(f.label("Going"));
});

test("Maps and sourced-context controls reject stale starts and hidden failure alerts", async t => {
  const f = fixture({ deferredLinks: true }); t.after(f.close); await f.ready();
  const source = () => f.label("Source: Event source").props.onNavigate;
  const maps = () => f.all().find(n => n.props?.accessibilityLabel?.startsWith("Search Google Maps for")).props.onPress;
  const oldSource = source(), oldMaps = maps();
  f.act(() => { oldSource(); oldMaps(); }); assert.equal(f.opens.length, 2);
  f.cover(); f.opens[0].reject(new Error("offline")); f.opens[1].reject(new Error("offline")); await f.flush();
  assert.equal(f.opens.length, 2); assert.doesNotMatch(f.text(), /Google Maps could not/);
  f.act(() => { oldSource(); oldMaps(); }); assert.equal(f.opens.length, 2);
  f.back(); f.act(() => { oldSource(); oldMaps(); }); assert.equal(f.opens.length, 2);
  f.act(source()); assert.equal(f.opens.length, 3, "current source link remains usable");
  f.opens[2].resolve();
});

for (const strict of [false, true]) test(`real retained duplicate Show denial evicts old Crowd before Back without automatic retry (StrictMode ${strict})`, async t => {
  const f = fixture({ nativeStack: true, strict }); t.after(f.close); await f.ready();
  assert.match(f.text(), /Fixture fan/);
  f.pushDuplicate(); await f.flush();
  assert.equal(f.layers().length, 2, "real stack retains the previous same-Show occurrence");
  const denied = f.reads.filter(r => r.kind === "crowd" && !r.options.signal.aborted).at(-1);
  const proof = f.privacyRevision();
  await f.reject(denied, 403); await f.resolveReads();
  assert.equal(f.privacyRevision(), proof + 1);
  assert.equal(f.layers().length, 1, "authoritative denial removes the older retained private snapshot");
  assert.doesNotMatch(f.text(), /Fixture fan/); assert.ok(f.label("Retry loading the Crowd"));
  const count = f.reads.length;
  for (let i = 0; i < 3; i++) { f.render(); await f.flush(); }
  assert.equal(f.reads.length, count, "privacy notification never auto-retries the denied resource");
  f.popDuplicate(); await f.flush();
  assert.equal(f.layers().length, 1); assert.doesNotMatch(f.text(), /Fixture fan/, "Back cannot paint the evicted Crowd");
  await f.reject(f.reads.filter(r => r.kind === "crowd" && !r.done).at(-1), 403);
  await f.resolveReads(); assert.ok(f.label("Retry loading the Crowd"));
  const retryCount = f.reads.length; f.press("Retry loading the Crowd");
  assert.ok(f.reads.length > retryCount); await f.resolveReads();
  assert.match(f.text(), /Fixture fan/, "fresh explicit retry can adopt freshly authorized data");
});

for (const status of [403, 404, 410]) for (const kind of ["crowd", "lounge"]) test(`Show ${kind} authoritative ${status} clears private receipts once and leaves explicit retry`, async t => {
  const f = fixture(); t.after(f.close); f.render(); await f.flush();
  const request = f.reads.filter(r => r.kind === kind).at(-1), proof = f.privacyRevision();
  await f.reject(request, status); await f.resolveReads();
  assert.equal(f.privacyRevision(), proof + 1); assert.doesNotMatch(f.text(), /Fixture fan/);
  assert.ok(f.label("Retry loading the Crowd"));
  const count = f.reads.filter(r => r.kind === "crowd" || r.kind === "lounge").length; f.render(); await f.flush(); f.cover(); f.back(); await f.flush();
  assert.equal(f.reads.filter(r => r.kind === "crowd" || r.kind === "lounge").length, count); assert.equal(f.privacyRevision(), proof + 1);
  f.press("Retry loading the Crowd"); await f.resolveReads(); assert.match(f.text(), /Fixture fan/);
});

test("Show stale private success after privacy withdrawal stays empty until explicit retry", async t => {
  const f = fixture(); t.after(f.close); f.render(); await f.flush();
  const count = f.reads.filter(r => r.kind === "crowd" || r.kind === "lounge").length; f.invalidatePrivacyBeforeRender(); await f.resolveReads();
  assert.equal(f.reads.filter(r => r.kind === "crowd" || r.kind === "lounge").length, count); assert.doesNotMatch(f.text(), /Fixture fan/);
  assert.ok(f.label("Retry loading the Crowd")); f.press("Retry loading the Crowd"); await f.resolveReads();
  assert.match(f.text(), /Fixture fan/);
});

for (const status of [409, 503]) test(`Show non-authoritative ${status} does not revoke retained occurrences`, async t => {
  const f = fixture(); t.after(f.close); f.render(); await f.flush();
  await f.reject(f.reads.filter(r => r.kind === "crowd").at(-1), status); await f.resolveReads();
  assert.equal(f.privacyRevision(), 0); assert.ok(f.label("Retry loading the Crowd"));
});

test("Show matching Crowd refresh row withdrawal revokes older receipts without confusing a scope change", async t => {
  const f = fixture(); t.after(f.close); await f.ready();
  f.act(() => f.refreshControl().onRefresh()); await f.flush();
  const crowd = f.reads.filter(r => r.kind === "crowd" && !r.done).at(-1);
  await f.complete(crowd, { scope: crowd.options.scope, attendees: [], total: 0 });
  await f.resolveReads(); assert.equal(f.privacyRevision(), 1); assert.doesNotMatch(f.text(), /Fixture fan/);
  f.press("Show friends in this Crowd"); await f.resolveReads();
  assert.equal(f.privacyRevision(), 1, "scope changes alone are not proof that prior access was withdrawn");
});

test("real Show private review receipt withdraws before stale success and exposes usable retry", async t => {
  const f = fixture(); t.after(f.close); f.render(); await f.flush();
  await f.complete(f.reads.filter(r => r.kind === "memorial").at(-1), null);
  const review = f.reads.filter(r => r.kind === "reviews").at(-1);
  f.invalidatePrivacyBeforeRender(); await f.complete(review, { reviews: [privateReview], total: 1 });
  await f.resolveReads(); assert.doesNotMatch(f.text(), /Private concert receipt/);
  assert.ok(f.label("Retry loading show reviews"));
  const count = f.reads.length; f.render(); await f.flush(); assert.equal(f.reads.length, count);
  f.press("Retry loading show reviews");
  await f.complete(f.reads.filter(r => r.kind === "reviews" && !r.done).at(-1), { reviews: [privateReview], total: 1 });
  assert.match(f.text(), /Private concert receipt/);
});

test("queued countdown ticks do not borrow a later Back admission", async t => {
  const f = fixture(); t.after(f.close); await f.ready();
  const oldTick = [...f.timers.values()][0]; assert.equal(typeof oldTick, "function");
  f.cover(); f.back(); await f.flush();
  const before = f.text(), now = Date.now;
  try {
    Date.now = () => f.document.startsAt + 1;
    f.act(oldTick);
    assert.equal(f.text(), before);
  } finally { Date.now = now; }
});

test("an ignored transport abort cannot replace covered Crowd data after Back", async t => {
  const f = fixture(); t.after(f.close); await f.ready();
  f.press("Show friends in this Crowd");
  const old = f.reads.filter(r => r.kind === "crowd").at(-1);
  f.cover(); assert.equal(old.options.signal.aborted, true);
  f.back(); await f.flush();
  old.done = true; old.resolve({ scope: "friends", attendees: [{ id: "old", name: "Retired attendee" }], total: 1 });
  await f.flush(); assert.doesNotMatch(f.text(), /Retired attendee/);
  await f.resolveReads(); assert.match(f.text(), /Fixture fan/);
  assert.equal(f.label("Show friends in this Crowd").props.accessibilityState.selected, true);
});

test("native pull refresh aborts on cover and old native callbacks cannot refresh after Back", async t => {
  const f = fixture(); t.after(f.close); await f.ready();
  const oldRefresh = f.refreshControl().onRefresh;
  const before = f.reads.length;
  f.act(oldRefresh); await f.flush();
  const pending = f.reads.slice(before); assert.ok(pending.some(r => r.kind === "document"));
  f.cover(); assert.ok(pending.every(r => r.options.signal?.aborted));
  const count = f.reads.length; f.act(oldRefresh); assert.equal(f.reads.length, count);
  await f.resolveReads(); assert.equal(f.reads.length, count, "completion cannot start hidden work");
  f.back(); await f.resolveReads();
  const resumed = f.reads.length; f.act(oldRefresh); assert.equal(f.reads.length, resumed);
  f.act(f.refreshControl().onRefresh); assert.ok(f.reads.length > resumed, "current native refresh remains usable");
});

test("active Show immediately projects block revocation and retires captured person actions", async t => {
  const f = fixture(); t.after(f.close); await f.ready();
  const open = f.label("Open Fixture fan's profile").props.onPress;
  f.block("fan"); assert.equal(f.label("Open Fixture fan's profile"), undefined);
  f.act(open); assert.equal(f.opens.length, 0);
  await f.resolveReads();
  assert.equal(f.label("Open Fixture fan's profile"), undefined, "even a transport's older receipt cannot restore a blocked identity");
});

test("removed source post disappears immediately while an accepted attendance receipt still settles", async t => {
  const f = fixture(); t.after(f.close); await f.ready();
  f.press("Going"); f.removeSource();
  assert.match(f.text(), /This fan post is no longer available/); assert.doesNotMatch(f.text(), /Setlist hidden/);
  f.writes[0].resolve({ showId: f.document.id, attendance: { state: "going", visibility: "members" } }); await f.flush();
  assert.equal(f.receipts.length, 1); assert.equal(f.label("Share your Going post"), undefined);
});

test("privacy-only invalidation retires actual native seller confirmation before render without retiring read ownership", async t => {
  const f = fixture({ nativeTickets: true }); t.after(f.close); await f.ready();
  const ticket = "View tickets at seller for Fixture artist at Fixture hall";
  const oldPress = f.label(ticket).props.onPress, before = f.presentation();
  f.act(oldPress); assert.equal(f.opens.length, 1); assert.equal(f.opens[0].kind, "alert");
  const oldContinue = f.opens[0].args[2].find(button => button.text === "Continue").onPress;
  f.invalidatePrivacyBeforeRender();
  assert.equal(before.current(), true, "accepted reads and receipts keep their lifecycle owner");
  assert.equal(before.canAct(), false, "private command authority is synchronously revoked");
  oldContinue(); oldPress();
  assert.equal(f.opens.length, 1, "neither queued confirmation nor queued button can open anything");
  f.render(); await f.flush();
  assert.equal(f.presentation().token, before.token);
  assert.notEqual(f.presentation().commandToken, before.commandToken);
  assert.equal(Object.isFrozen(f.presentation().commandToken), true);
  assert.deepEqual(f.speech, []);
  oldPress(); assert.equal(f.opens.length, 1);
  f.press(ticket); assert.equal(f.opens.length, 2);
  f.opens[1].args[2].find(button => button.text === "Continue").onPress(); await f.flush();
  assert.equal(f.opens.length, 3); assert.equal(f.opens[2].kind, "link");
  assert.equal(f.opens[2].url, "https://concert-seller.com/ticket");
});

test("privacy-only invalidation prevents direct attendance starts but accepted receipt still settles", async t => {
  const f = fixture(); t.after(f.close); await f.ready();
  const oldGoing = f.label("Going").props.onPress;
  f.invalidatePrivacyBeforeRender(); oldGoing(); assert.equal(f.writes.length, 0);
  f.render(); oldGoing(); assert.equal(f.writes.length, 0);
  f.press("Going"); assert.equal(f.writes.length, 1);
  f.invalidatePrivacyBeforeRender();
  f.writes[0].resolve({ showId: f.document.id, attendance: { state: "going", visibility: "members" } }); await f.flush();
  assert.equal(f.receipts.length, 1); assert.ok(f.label("Remove Going from this show"));
  assert.equal(f.label("Share your Going post"), undefined);
});

test("privacy-only invalidation retires composer text, publish and dismissal commands without losing accepted publication", async t => {
  const f = fixture(); t.after(f.close); await f.ready();
  f.press("Members"); f.press("Going");
  f.writes[0].resolve({ showId: f.document.id, attendance: { state: "going", visibility: "members" } }); await f.flush();
  const note = () => f.label("Optional note for your Going post").props;
  f.act(() => note().onChangeText("Preserved draft"));
  const publish = () => f.all().find(n => n.type === "Button" && n.props.title === "Share post").props;
  const oldPublish = publish().onPress, oldNote = note().onChangeText;
  const oldDismiss = f.label("Do not share a Going post").props.onPress;
  f.invalidatePrivacyBeforeRender(); oldNote("Retired edit"); oldPublish(); oldDismiss();
  assert.equal(f.writes.length, 1);
  f.render(); assert.equal(note().value, "Preserved draft"); assert.ok(f.label("Share your Going post"));
  oldPublish(); assert.equal(f.writes.length, 1);
  f.act(publish().onPress); assert.equal(f.writes.length, 2);
  f.invalidatePrivacyBeforeRender(); f.writes[1].resolve({ ok: true }); await f.flush();
  assert.ok(f.label("Share your Going post")); assert.equal(publish().loading, false);
});

test("privacy-only invalidation suppresses ticket failure speech and preserves the new pending claim", async t => {
  const f = fixture(); t.after(f.close); await f.ready();
  const ticket = "View tickets at seller for Fixture artist at Fixture hall";
  f.press(ticket); const old = f.opens[0];
  f.invalidatePrivacyBeforeRender(); old.options.onFailure(); assert.equal(f.speech.length, 0);
  f.render(); f.press(ticket); assert.equal(f.opens.length, 2);
  old.resolve({ status: "failed" }); await f.flush(); f.press(ticket);
  assert.equal(f.opens.length, 2, "old settlement cannot release the new command's pending claim");
  f.opens[1].options.onFailure(); f.opens[1].resolve({ status: "failed" }); await f.flush();
  assert.equal(f.speech.length, 1);
});

test("privacy-only invalidation retires Maps, source alerts and queued countdown ticks", async t => {
  const f = fixture({ deferredLinks: true }); t.after(f.close); await f.ready();
  const source = f.label("Source: Event source").props.onNavigate;
  const maps = f.all().find(n => n.props?.accessibilityLabel?.startsWith("Search Google Maps for")).props.onPress;
  const oldTick = [...f.timers.values()][0];
  f.act(() => { source(); maps(); }); assert.equal(f.opens.length, 2);
  const before = f.text(), now = Date.now;
  f.invalidatePrivacyBeforeRender(); source(); maps();
  try { Date.now = () => f.document.startsAt + 1; oldTick(); assert.equal(f.text(), before); }
  finally { Date.now = now; }
  f.opens[0].reject(new Error("offline")); f.opens[1].reject(new Error("offline")); await f.flush();
  assert.equal(f.opens.length, 2); assert.doesNotMatch(f.text(), /Google Maps could not/);
  f.render(); source(); maps(); assert.equal(f.opens.length, 2);
  f.act(f.label("Source: Event source").props.onNavigate); assert.equal(f.opens.length, 3);
  f.opens[2].resolve();
});

for (const strict of [false, true]) test('past Top Rated native show has no planning actions (StrictMode ' + strict + ')', async t => {
  const f = fixture({ strict, logOverrides: { date: "2020-01-01", startDateTime: "2020-01-01T20:00:00Z", performanceEvent: true, overall: 4.7, ratingCount: 17 } });
  t.after(f.close); await f.ready();
  assert.equal(f.label("Interested"), undefined);
  assert.equal(f.label("Going"), undefined);
  assert.equal(f.label("Add this show to Going"), undefined);
  assert.ok(f.label("Attended"), "history recording remains available");
  assert.equal(f.writes.length, 0);
});

test("captured native RSVP cannot dispatch after exact end, including suspended timer delivery", async t => {
  let now = Date.parse("2026-11-12T22:59:59Z");
  t.mock.method(Date, "now", () => now);
  const f = fixture({ logOverrides: { date: "2026-11-12", startDateTime: "2026-11-12T21:00:00Z", endAt: "2026-11-12T23:00:00Z" } });
  t.after(f.close); await f.ready();
  const going = f.label("Going").props.onPress, interested = f.label("Interested").props.onPress;
  now += 1000;
  f.act(() => { going(); interested(); });
  assert.equal(f.writes.length, 0, "expiry checked at action time, before transport");
  f.act(() => { for (const tick of [...f.rsvpTimers.values()]) tick(); });
  await f.flush();
  assert.equal(f.label("Going"), undefined);
  assert.equal(f.label("Interested"), undefined);
  assert.ok(f.label("Attended"));
  f.cover(); await f.flush();
  assert.equal(f.rsvpTimers.size, 0, "covered native detail owns no expiry timers");
});

test("past native plans retain explicit removal and private visibility without granting new RSVP", async t => {
  const f = fixture({ logOverrides: { date: "2020-01-01", startDateTime: "2020-01-01T20:00:00Z" },
    savedAttendance: { state: "going", visibility: "members" } });
  t.after(f.close); await f.ready();
  assert.equal(f.label("Going"), undefined);
  assert.equal(f.label("Interested"), undefined);
  const remove = f.all().find(node => node.props?.accessibilityLabel?.startsWith("Remove ") && node.props.accessibilityLabel.endsWith(" from this show"));
  assert.ok(remove);
  f.act(() => remove.props.onPress());
  assert.equal(f.writes.length, 1);
  assert.equal(f.writes[0].options.state, null);
});

test("an ongoing native multi-day range permits planning despite stale completed opening-night lifecycle", async t => {
  t.mock.method(Date, "now", () => Date.parse("2026-11-14T12:00:00Z"));
  const f = fixture({ logOverrides: { date: "2026-11-10", startDateTime: "2026-11-10T20:00:00Z",
    eventEndDate: "2026-11-15", eventTimezone: "America/Toronto" } });
  f.document.lifecycle = "completed";
  t.after(f.close); await f.ready();
  assert.ok(f.label("Going"));
  f.press("Going");
  assert.equal(f.writes.length, 1);
});

for (const canonicalRange of [false, true]) test(`Crowd keeps ongoing ranged attendance aligned with planning (canonical range ${canonicalRange})`, async t => {
  let now = Date.parse("2026-11-14T12:00:00Z");
  t.mock.method(Date, "now", () => now);
  const savedAttendance = { state: "going", visibility: "members" };
  const f = fixture({ savedAttendance, logOverrides: { date: "2026-11-10", startDateTime: "2026-11-10T20:00:00Z",
    eventEndDate: canonicalRange ? "2026-11-11" : "2026-11-15", eventTimezone: "America/Toronto" } });
  if (canonicalRange) Object.assign(f.document, { eventEndDate: "2026-11-15", timezone: "America/Toronto" });
  f.document.lifecycle = "completed";
  t.after(f.close); await f.ready();
  const crowd = () => text(f.label("Open Fixture fan's profile"));
  assert.match(crowd(), /Fixture fan Going/);
  assert.ok(f.label("Going")); assert.ok(f.label("Remove Going from this show"));
  now = Date.parse("2026-11-16T04:59:59.999Z"); f.render(); await f.flush();
  assert.match(crowd(), /Fixture fan Going/); assert.ok(f.label("Going"));
  now += 1;
  f.act(() => { for (const tick of [...f.rsvpTimers.values()]) tick(); }); await f.flush();
  assert.equal(f.label("Going"), undefined);
  assert.match(crowd(), /Fixture fan Attended/);
  assert.ok(f.label("Remove Attended from this show"));
  assert.deepEqual(savedAttendance, { state: "going", visibility: "members" });
  assert.equal(f.writes.length, 0, "display transitions do not rewrite attendance");
});

for (const dateOnly of [false, true]) test(`Crowd preserves existing post-event display grace (date only ${dateOnly})`, async t => {
  const end = Date.parse(dateOnly ? "2026-11-13T05:00:00Z" : "2026-11-12T23:00:00Z");
  const cutoff = Date.parse(dateOnly ? "2026-11-13T23:59:59.999Z" : "2026-11-13T23:00:00Z");
  let now = end - 1;
  t.mock.method(Date, "now", () => now);
  const savedAttendance = { state: "going", visibility: "members" };
  const f = fixture({ savedAttendance, logOverrides: { date: "2026-11-12", eventTimezone: "America/Toronto",
    startDateTime: dateOnly ? null : "2026-11-12T21:00:00Z", ...(dateOnly ? {} : { endAt: "2026-11-12T23:00:00Z" }) } });
  t.after(f.close); await f.ready();
  const crowd = () => text(f.label("Open Fixture fan's profile"));
  assert.match(crowd(), /Fixture fan Going/); assert.ok(f.label("Going"));
  now = end; f.act(() => { for (const tick of [...f.rsvpTimers.values()]) tick(); }); await f.flush();
  assert.equal(f.label("Going"), undefined); assert.match(crowd(), /Fixture fan Going/);
  for (const [at, expected] of [[cutoff - 1, "Going"], [cutoff, "Attended"]]) {
    now = at; f.render(); await f.flush();
    assert.match(crowd(), new RegExp(`Fixture fan ${expected}`));
    assert.ok(f.label(`Remove ${expected} from this show`));
    assert.equal(f.label("Going"), undefined);
  }
  assert.deepEqual(savedAttendance, { state: "going", visibility: "members" }); assert.equal(f.writes.length, 0);
});
