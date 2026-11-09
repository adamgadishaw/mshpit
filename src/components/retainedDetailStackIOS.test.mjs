import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { parse } from "@babel/parser";

const root = fileURLToPath(new URL("../../", import.meta.url));
const require = createRequire(new URL("../../package.json", import.meta.url));
const React = require("react"), reconciler = require("react-reconciler");
const { transformSync } = require("@babel/core");
const noop = () => {}, never = new Promise(noop), codes = new Map();
const compile = (source, filename) => transformSync(source, { filename, babelrc: false, configFile: false,
  plugins: [[require("@babel/plugin-transform-react-jsx"), { runtime: "automatic" }], require("@babel/plugin-transform-modules-commonjs")],
}).code;
const walk = node => [node, ...(node.children || []).flatMap(walk)];
const text = node => node.text ?? (node.children || []).map(text).join(" ");
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

function createRenderer() {
  const context = {}, container = { children: [] }; let priority = 0, focusedInput = null;
  const remove = (parent, child) => { const index = parent.children.indexOf(child); if (index >= 0) parent.children.splice(index, 1); };
  const append = (parent, child) => { remove(parent, child); parent.children.push(child); };
  const insert = (parent, child, before) => { remove(parent, child); parent.children.splice(parent.children.indexOf(before), 0, child); };
  const renderer = reconciler({
    supportsMutation: true, isPrimaryRenderer: true, supportsPersistence: false, supportsHydration: false,
    getRootHostContext: () => context, getChildHostContext: () => context, getPublicInstance: node => node,
    prepareForCommit: () => null, resetAfterCommit: noop,
    createInstance: (type, props) => ({ type, props, children: [], offset: 0,
      focus() { if (focusedInput) focusedInput.focused = false; focusedInput = this; this.focused = true; },
      blur() { this.focused = false; if (focusedInput === this) focusedInput = null; }, scrollToEnd: noop,
      measureInWindow: callback => callback(0, 0, 393, 852), startAnimating: async () => {}, stopAnimating: async () => {} }),
    createTextInstance: text => ({ text }),
    appendInitialChild: append, appendChild: append, appendChildToContainer: append,
    removeChild: remove, removeChildFromContainer: remove, insertBefore: insert, insertInContainerBefore: insert,
    finalizeInitialChildren: () => false, shouldSetTextContent: () => false,
    commitUpdate: (node, type, oldProps, props) => { node.props = props; }, commitTextUpdate: (node, oldText, text) => { node.text = text; },
    hideInstance: node => { node.hidden = true; }, unhideInstance: node => { node.hidden = false; },
    hideTextInstance: node => { node.hidden = true; }, unhideTextInstance: node => { node.hidden = false; },
    clearContainer: node => { node.children = []; }, resetTextContent: noop, commitMount: noop,
    scheduleTimeout: setTimeout, cancelTimeout: clearTimeout, noTimeout: -1, supportsMicrotasks: true, scheduleMicrotask: queueMicrotask,
    getCurrentUpdatePriority: () => priority, setCurrentUpdatePriority: value => { priority = value; }, resolveUpdatePriority: () => priority || 32,
    shouldAttemptEagerTransition: () => false, detachDeletedInstance: noop, maySuspendCommit: () => false, preloadInstance: () => true,
    startSuspendingCommit: noop, suspendInstance: noop, waitForCommitToBeReady: () => null, NotPendingTransition: null,
    HostTransitionContext: React.createContext(null), resetFormInstance: noop, bindToConsole: (method, args) => console[method].bind(console, ...args),
  });
  const fail = error => { throw error; };
  const owner = renderer.createContainer(container, 1, null, false, null, "", fail, fail, fail, null);
  const flush = () => { for (let i = 0; i < 20; i++) { renderer.flushSyncWork(); if (!renderer.flushPassiveEffects()) break; } };
  return { container, flush, focusedInput: () => focusedInput, render(element) { renderer.updateContainerSync(element, owner, null, null); flush(); },
    transition(element) { React.startTransition(() => renderer.updateContainer(element, owner, null, null)); },
    act(callback) { renderer.flushSyncFromReconciler(callback); flush(); } };
}

// Evaluate the checked-in Root JSX and callbacks, rather than a second handwritten
// implementation of its prop plumbing. Only the surrounding shell/Store is fake.
const appSource = readFileSync(path.join(root, "App.js"), "utf8");
const appAST = parse(appSource, { sourceType: "module", plugins: ["jsx"] });
const declarations = new Map(), overlays = new Map();
const callbackNames = ["cancelNewsStory", "cancelPublicRoute", "applyNavigation", "runAfterComposerClose", "popStack", "requestComposerPop", "back"];
function inspect(node) {
  if (!node || typeof node !== "object") return;
  if (node.type === "VariableDeclarator" && [...callbackNames, "singleNativeOverlay", "nativeDetailOverlay"].includes(node.id?.name)) {
    declarations.set(node.id.name, `const ${node.id.name} = ${appSource.slice(node.init.start, node.init.end)};`);
  }
  if (node.type === "IfStatement" && node.test?.type === "MemberExpression" && node.test.object.name === "nav"
      && ["artistName", "profileId", "openLog", "post"].includes(node.test.property.name)) {
    const expression = node.consequent.expression;
    if (expression?.left?.name === "overlay") overlays.set(node.test.property.name, appSource.slice(expression.right.start, expression.right.end));
  }
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach(inspect);
    else if (value && typeof value === "object") inspect(value);
  }
}
inspect(appAST);
assert.equal(overlays.size, 4, "Root must still supply all four exact production detail elements");
for (const name of [...callbackNames, "singleNativeOverlay", "nativeDetailOverlay"]) assert.ok(declarations.has(name), name);
const rootSliceSource = `module.exports = function RootDetailSlice(bindings) {
    ${callbackNames.map(name => declarations.get(name)).join("\n")}
    const overlay = ${[...overlays].map(([key, jsx]) => `nav.${key} ? (${jsx}) : `).join("")} <Protected />;
    ${declarations.get("singleNativeOverlay")}
    ${declarations.get("nativeDetailOverlay")}
    return nativeDetailOverlay;
};`;
const rootSliceAST = parse(rootSliceSource, { sourceType: "module", plugins: ["jsx"] });
let bindingNames;
require("@babel/traverse").default(rootSliceAST, { Program: { exit(node) { bindingNames = Object.keys(node.scope.globals).filter(name => name !== "module" && name !== "JSON"); } } });
const rootCode = compile(rootSliceSource.replace("function RootDetailSlice(bindings) {", `function RootDetailSlice({ ${bindingNames.join(", ")} }) {`), "root-detail-slice.cjs");

const review = { id: "fixture-post", userId: "author", user: { id: "author", name: "Author", handle: "author" }, kind: "review",
  artist: "Fixture Artist", venue: "Fixture Hall", date: "2026-11-01", review: "Original review", overall: 4, likes: 3, photos: [] };

function fixture({ strict = false, frames: initialFrames, realPost = false, lazyArtist = false } = {}) {
  const renderer = createRenderer(), modules = new Map(), actions = [], reads = [], writes = [], queue = [], animations = [], mounts = [], renders = [];
  const privacy = require("./src/domain/iosDetailPrivacyEpoch.mjs").createIOSDetailPrivacyEpoch();
  const linked = require("./src/domain/iosLinkedNavigation.mjs").createIOSLinkedNavigation(); linked.mount();
  const detailContext = { IOSDetailPresentationContext: React.createContext(null) };
  const Preview = React.createContext(false), FeedBack = React.createContext(false), City = React.createContext(null), Post = React.createContext(null), Store = React.createContext(null);
  const appListeners = new Set(), readerListeners = new Set(), keyboard = new Map();
  let width = 393, reader = false, reduced = false, serial = 0, revision = 0, hidden = false, account = "A", epoch = 1;
  let frames = initialFrames || [{}, { artistName: "A" }], flags = {}, storeVersion = 0, suspension = null;
  const pendingArtist = deferred();
  const store = { session: { id: "A" }, chatAuthEpoch: 1, feed: [], commentsFor: () => [], userById: () => null, userBadges: () => [],
    likeInfo: () => ({ count: 3, liked: false }), toggleLike: (...args) => { actions.push(["like", ...args]); return Promise.resolve({ ok: true }); },
    setPostRepost: async () => ({ ok: true }), refreshFeed: noop,
    loadComments: (...args) => { const request = { args, ...deferred() }; reads.push(request); return request.promise; },
    addComment: (...args) => { const request = { args, ...deferred() }; writes.push(request); return request.promise; },
    deleteOwnPost: (...args) => { const request = { args, ...deferred() }; writes.push(request); return request.promise; },
    deleteOwnComment: async () => ({ ok: true }), setCommentLike: async () => ({ ok: true }) };
  const native = { Platform: { OS: "ios", select: value => value.ios || value.default }, View: "View", Text: "Text", TextInput: "TextInput",
    ScrollView: "ScrollView", Pressable: "Pressable", Modal: "Modal", ActivityIndicator: "ActivityIndicator", RefreshControl: "RefreshControl",
    StyleSheet: { create: value => value, absoluteFill: { position: "absolute" }, absoluteFillObject: {}, hairlineWidth: .5 },
    useWindowDimensions: () => ({ width, height: 852, fontScale: 1 }), Dimensions: { get: () => ({ width, height: 852 }) },
    AppState: { currentState: "active", addEventListener: (_event, callback) => { appListeners.add(callback); return { remove: () => appListeners.delete(callback) }; } },
    Keyboard: { metrics: () => null, scheduleLayoutAnimation: noop, dismiss: () => { actions.push(["globalDismiss"]); renderer.focusedInput()?.blur(); }, addListener: (event, callback) => {
      if (!keyboard.has(event)) keyboard.set(event, new Set()); keyboard.get(event).add(callback);
      return { remove: () => keyboard.get(event).delete(callback) };
    } }, AccessibilityInfo: { announceForAccessibilityWithOptions: noop, announceForAccessibility: noop },
    Alert: { alert: (...args) => actions.push(["alert", ...args]) }, Linking: { openURL: url => actions.push(["external", url]) } };
  const useSharedValue = initial => { const ref = React.useRef(null);
    if (!ref.current) ref.current = { value: initial, get() { return this.value; }, set(value) { this.value = value; } }; return ref.current; };
  const Gesture = { Pan() { const values = {}; const proxy = new Proxy(values, { get: (target, key) => key === "recording" ? values : value => { target[key] = value; return proxy; } }); return proxy; } };
  // GestureDetector exposes the recorded fake recognizer, with actual callbacks.
  function GestureDetector({ gesture, children }) { return React.createElement("GestureDetector", { gesture: gesture.recording }, children); }
  const preference = { __esModule: true, default: () => React.useSyncExternalStore(listener => { readerListeners.add(listener); return () => readerListeners.delete(listener); }, () => reader),
    getConfirmedScreenReaderEnabled: () => reader, subscribeConfirmedScreenReaderEnabled: listener => { readerListeners.add(listener); return () => readerListeners.delete(listener); } };
  const real = {
    NativeDetailStack: "src/components/NativeDetailStack.ios.jsx", IosDetailNavigation: "src/components/IosDetailNavigation.ios.jsx",
    useFeedPresentation: "src/hooks/useFeedPresentation.ios.js", useIOSDetailPresentation: "src/hooks/useIOSDetailPresentation.ios.js",
    useIOSDetailBackBlock: "src/hooks/useIOSDetailBackBlock.ios.js", useIOSTicketAction: "src/components/useIOSTicketAction.ios.js",
    IOSPostKeyboardView: "src/components/IOSPostKeyboardView.ios.jsx", TicketStub: "src/components/TicketStub.jsx",
    useTicketPresentation: "src/hooks/useTicketPresentation.ios.js", SocialReactionButtons: "src/components/SocialReactionButtons.ios.jsx",
    useScopedRefresh: "src/hooks/useScopedRefresh.ios.js", VinylRefreshBoundary: "src/components/VinylRefreshBoundary.ios.jsx",
    useIOSCommentAnnouncement: "src/hooks/useIOSCommentAnnouncement.ios.js", PostScreen: "src/screens/PostScreen.ios.jsx",
    ExpandableText: "src/components/ExpandableText.jsx",
  };
  const load = file => {
    if (modules.has(file)) return modules.get(file);
    if (!codes.has(file)) codes.set(file, compile(readFileSync(path.join(root, file), "utf8"), file));
    const module = { exports: {} }; modules.set(file, module.exports);
    new Function("require", "module", "exports", codes.get(file))(name => imports(name, file), module, module.exports);
    modules.set(file, module.exports); return module.exports;
  };
  function imports(name, file) {
    const base = name.split("/").at(-1);
    if (name === "react" || name === "react/jsx-runtime") return require(name);
    if (name === "react-native") return native;
    if (name === "expo-image") return { Image: "ExpoImage" };
    if (name === "react-native-gesture-handler") return { Gesture, GestureDetector };
    if (name === "react-native-reanimated") return { __esModule: true, default: { View: "AnimatedView" }, ReduceMotion: { System: "system" }, useSharedValue,
      useAnimatedStyle: callback => callback(), cancelAnimation: noop, withSpring: value => value,
      withTiming: (value, config, done) => { animations.push({ value, config, done }); return value; } };
    if (name === "react-native-worklets") return { scheduleOnRN: (callback, ...args) => queue.push(() => callback(...args)) };
    if (base === "iosDetailPresentationContext.mjs") return detailContext;
    if (base === "nativeTabPreviewContext.mjs") return { NativeTabPreviewContext: Preview };
    if (base === "nativeFeedBackContext.mjs") return { NativeFeedBackContext: FeedBack };
    if (base === "CityNavigationContext") return { CityNavigationContext: City };
    if (base === "PostNavigationContext") return { PostNavigationContext: Post };
    if (base === "iosDetailPrivacy") return { getIOSDetailPrivacySnapshot: privacy.getSnapshot, subscribeIOSDetailPrivacy: privacy.subscribe };
    if (base === "useIOSDetailPresentation.js") return require("./src/hooks/useIOSDetailPresentation.js");
    if (base === "useScreenReaderEnabled") return preference;
    if (base === "useReducedMotion") return () => reduced;
    if (base === "useAppActive") return () => native.AppState.currentState === "active";
    if (base === "useNativeTabPreview") return () => React.useContext(Preview);
    if (base === "theme") return { colors: {}, radius: {}, glow: {}, shadow: {}, space: value => value, roleColor: () => null };
    if (base === "store") return { useStore: () => React.useContext(Store).store };
    if (base === "ticketLinks") return { openTicketLink: async (url, options) => { actions.push(["ticket", url, options]); return true; } };
    if (base === "PublicWebLinks") return { PublicPressableLink: "PublicPressableLink", PublicTextLink: "PublicTextLink" };
    if (base === "Badge") return { BadgeRow: "BadgeRow" };
    if (base === "SocialShareStudio") return { SocialShareButton: "SocialShareButton" };
    if (base === "showIOSPostActions") return (options, callback) => actions.push(["sheet", options, callback]);
    if (base === "cityIdentity.js") return { cityIdentityForLocation: () => null };
    if (real[base]) return load(real[base]);
    if (name.endsWith(".mjs")) return createRequire(path.join(root, file))(name);
    if (name.startsWith(".")) {
      const resolved = path.resolve(root, path.dirname(file), name);
      if (name.includes("/domain/") && existsSync(resolved + ".js")) return require(resolved + ".js");
      return base;
    }
    return require(name);
  }
  const usePresentation = load(real.useIOSDetailPresentation).default;
  const useTicket = load(real.useIOSTicketAction).default, KeyboardView = load(real.IOSPostKeyboardView).default;
  function Probe(props) {
    const presentation = usePresentation(), liveStore = React.useContext(Store);
    const [id] = React.useState(() => ++serial), [draft, setDraft] = React.useState(""), [section, setSection] = React.useState(props.initialSection || "overview");
    const ticket = useTicket(id), name = props.artistName || props.userId || props.log?.id;
    renders.push({ name, revision: props.artistReturn?.revision });
    React.useLayoutEffect(() => { mounts.push(name); }, []);
    if (suspension?.name === name) throw suspension.promise;
    return React.createElement("Probe", { id, name, presentation, raw: props, liveStore: liveStore.version,
      reveal: React.useContext(FeedBack), city: React.useContext(City), post: React.useContext(Post) },
    React.createElement(KeyboardView, { testID: "keyboard-probe" },
      React.createElement("ScrollView", { testID: "probe-scroll" },
        React.createElement("TextInput", { value: draft, onChangeText: presentation.guard(setDraft) }),
        React.createElement("Section", { value: section, onPress: presentation.guard(() => setSection("shows")) }),
        React.createElement("Ticket", { onPress: () => ticket.open("https://ticket.example/show") }))));
  }
  const Artist = lazyArtist ? React.lazy(() => pendingArtist.promise) : Probe;
  const rootModule = { exports: {} }; new Function("require", "module", "exports", rootCode)(require, rootModule, rootModule.exports);
  const RootDetailSlice = rootModule.exports;
  const navigationRef = { current: { stack: frames, tab: "feed", landing: false } }, stackRef = { current: frames };
  const bindings = { Platform: native.Platform, web: false, linkedNavigationRef: { current: linked }, navigationRef, stackRef,
    authNavigationAbortRef: { current: noop }, composerCloseGuardRef: { current: null }, newsLinkedClaimRef: { current: null }, newsOpenRef: { current: 0 }, setNewsStoryNotice: noop,
    publicLookup: {}, publicNavigationPendingRef: { current: null }, publicRouteRequestRef: { current: null }, setPublicNavigationNotice: noop,
    setStack: next => { frames = next; }, setTab: noop, setLanding: noop,
    NativeDetailStack: load(real.NativeDetailStack).default, IosDetailNavigation: load(real.IosDetailNavigation).default,
    Suspense: React.Suspense, ScreenLoading: () => React.createElement("ScreenLoading"), ScreenTransition: ({ children }) => children,
    ArtistScreen: Artist, ProfileScreen: Probe, ShowScreen: Probe, PostScreen: realPost ? load(real.PostScreen).default : Probe, Protected: () => React.createElement("Protected"),
    iosBackGestureAllowed: require("./src/domain/iosNavigationPolicy.mjs").iosBackGestureAllowed,
    screenTransitionKey: frame => JSON.stringify(frame), activeTab: "feed", screenKey: "detail", screenDirection: "forward",
    authReady: true, landing: false, status: "ok", nativeAccountLinkActive: false, nativeAccountLinkActiveRef: { current: false }, resetToken: null, ownerApprovalToken: null,
    appActive: true, iosMenuOpen: false, acctOpen: false, welcome: null, unsubToken: null, verifyToken: null, publicNavigationNotice: null, newsStoryNotice: null,
    commentDraftsRef: { current: require("./src/domain/iosCommentDrafts.mjs").createIOSCommentDrafts() },
    requireVerifiedMutation: (_intent, callback) => callback(),
  };
  // Root's callback values are deliberately recreated every render, as in App.
  const callbackBindings = ["openShow", "openPost", "openProfile", "openArtist", "openArtistArchive", "openVenue", "openProfileManagement", "musicPreviewAction", "openThread",
    "openReport", "openPostEditor", "openPhotos", "musicPlayerAction", "removePostTag", "openFollowList", "openBadges", "openSignIn", "openNewsStory", "openFanClub", "openArtistGallery", "musicPlaylistAction", "go", "reviewShow"];
  function Gate() { if (hidden) throw never; return null; }
  function tree() {
    const capturedRevision = ++revision;
    bindings.commentDraftsRef.current.account(account, epoch);
    Object.assign(bindings, { stack: frames, nav: frames.at(-1), session: { id: account }, chatAuthEpoch: epoch, linkedNavigationScope: linked.account(account, epoch),
      artistReturn: { key: "artist", revision: capturedRevision }, ...flags });
    for (const name of callbackBindings) bindings[name] = (...args) => actions.push([name, capturedRevision, ...args]);
    // Each function gets its own immutable render binding object, like Root.
    const snapshot = { ...bindings };
    return React.createElement(strict ? React.StrictMode : React.Fragment, null,
      React.createElement(Store.Provider, { value: { store, version: storeVersion } },
        React.createElement(City.Provider, { value: () => actions.push(["city"]) }, React.createElement(Post.Provider, { value: () => actions.push(["postContext"]) },
          React.createElement(React.Suspense, { fallback: React.createElement("OuterLoading") }, RootDetailSlice(snapshot), React.createElement(Gate))))));
  }
  const render = () => { navigationRef.current = { ...navigationRef.current, stack: frames }; stackRef.current = frames; renderer.render(tree()); };
  const all = () => walk(renderer.container);
  const occurrences = () => all().filter(node => node.props?.testID?.startsWith("ios-detail-occurrence-"));
  const probes = () => all().filter(node => node.type === "Probe");
  const f = { renderer, actions, reads, writes, mounts, renders, animations, queue, privacy, bindings, store, native, keyboard, all, occurrences, probes, render,
    get frames() { return frames; }, get revision() { return revision; },
    active: () => probes().find(node => node.props.presentation.active),
    act: callback => renderer.act(callback),
    push(frame) { frames = [...frames, frame]; render(); }, back() { frames = frames.slice(0, -1); render(); },
    precommit(frame) { navigationRef.current = { ...navigationRef.current, stack: [...frames, frame] }; },
    changeAccount(id) { account = id; epoch++; store.session = { id }; store.chatAuthEpoch = epoch; render(); },
    updateStore() { storeVersion++; render(); }, privacyChange() { renderer.act(privacy.invalidate); },
    flags(update) { flags = { ...flags, ...update }; render(); },
    conceal(value) { hidden = value; render(); }, suspend(name, promise = never) { suspension = name ? { name, promise } : null; render(); },
    resize(value) { width = value; render(); }, reader(value) { renderer.act(() => { reader = value; for (const callback of [...readerListeners]) callback(); }); },
    reduced() { reduced = true; render(); },
    pan: () => all().filter(node => node.type === "GestureDetector").at(-1)?.props.gesture,
    swipe(pan = f.pan(), velocityX = 100) {
      assert.ok(pan); pan.onTouchesDown({ allTouches: [{ absoluteX: 10, absoluteY: 100 }], numberOfTouches: 1 }, { fail: noop });
      pan.onUpdate({ absoluteX: 200, absoluteY: 100 }); pan.onEnd({ absoluteX: 200, absoluteY: 100, velocityX }, true); pan.onFinalize();
    },
    finishAnimation() { animations.splice(0).forEach(animation => animation.done(true)); },
    drain() { renderer.act(() => queue.splice(0).forEach(callback => callback())); render(); },
    async settle(callback = noop) { renderer.act(callback); for (let i = 0; i < 6; i++) { await new Promise(setImmediate); renderer.act(noop); } },
    async resolveArtist() { pendingArtist.resolve({ default: Probe }); await f.settle(); },
    async abandonRender() { hidden = true; renderer.transition(tree()); await f.settle(); hidden = false; },
    close: () => renderer.render(null),
  };
  render(); return f;
}

for (const strict of [false, true]) test(`real Root/host preserves native occurrence, state and fresh admission on Back (StrictMode ${strict})`, async t => {
  const f = fixture({ strict }); t.after(f.close);
  const first = f.active(); assert.ok(first, "initial layout publishes usable detail admission");
  const originalHost = f.occurrences()[0], old = first.props.presentation, raw = first.props.raw;
  assert.ok(Object.isFrozen(old.token)); assert.ok(Object.isFrozen(old.commandToken));
  assert.deepEqual(Object.keys(old.token), []); assert.deepEqual(Object.keys(old.commandToken), []);
  const input = walk(first).find(node => node.type === "TextInput"), scroll = walk(first).find(node => node.type === "ScrollView");
  scroll.offset = 380; f.act(() => { input.props.onChangeText("Unsent draft"); walk(first).find(node => node.type === "Section").props.onPress(); });
  f.act(() => walk(first).find(node => node.type === "Ticket").props.onPress()); assert.equal(f.actions.at(-1)[0], "ticket");
  assert.ok(f.keyboard.get("keyboardWillShow")?.size, "real keyboard consumer is admitted on initial mount");
  f.push({ profileId: "B", profileSection: "reviews" });
  assert.equal(f.occurrences()[0], originalHost); assert.equal(first.props.presentation.active, false); assert.equal(f.active().props.reveal, true);
  assert.equal(originalHost.props.pointerEvents, "none"); assert.equal(originalHost.props.accessibilityElementsHidden, true);
  const before = f.actions.length; f.act(() => { raw.onOpenArtist("stale"); first.props.city(); first.props.post(); }); assert.equal(f.actions.length, before);
  const coveredRevision = first.props.raw.artistReturn.revision; f.updateStore();
  assert.equal(first.props.liveStore, 1, "covered component still receives live Store/context changes");
  assert.equal(first.props.raw.artistReturn.revision, coveredRevision, "covered JSX uses its last committed Root props");
  f.back(); assert.equal(f.active(), first); assert.equal(f.occurrences()[0], originalHost); assert.equal(scroll.offset, 380);
  assert.equal(input.props.value, "Unsent draft"); assert.equal(walk(first).find(node => node.type === "Section").props.value, "shows");
  assert.notEqual(first.props.presentation.token, old.token); assert.equal(old.current(), false); assert.equal(old.canAct(), false);
  assert.equal(first.props.raw.artistReturn.revision, f.revision, "Back receives this Root render's unguarded raw props");
  f.act(() => raw.onOpenArtist("retired")); assert.equal(f.actions.length, before);
  f.act(() => first.props.raw.onOpenArtist("fresh")); assert.deepEqual(f.actions.at(-1), ["openArtist", f.revision, "fresh"]);
  f.act(() => walk(first).find(node => node.type === "Ticket").props.onPress()); assert.equal(f.actions.at(-1)[0], "ticket");
  assert.ok(f.keyboard.get("keyboardWillShow")?.size, "keyboard consumer reconnects on Back");
});

test("same entity has distinct retained native occurrences and old callbacks never revive", t => {
  const f = fixture(); t.after(f.close); const first = f.active(), old = first.props.raw.onOpenArtist;
  f.push(f.frames.at(-1)); const second = f.active(); assert.notEqual(second, first); assert.notEqual(second.props.id, first.props.id);
  assert.equal(f.probes().length, 2); f.back(); assert.equal(f.active(), first);
  f.act(() => old("stale")); assert.equal(f.actions.length, 0); f.act(() => first.props.raw.onOpenArtist("new")); assert.equal(f.actions.length, 1);
});

test("a never-presented lazy artist is not first mounted invisibly after a successor covers it", async t => {
  const f = fixture({ lazyArtist: true }); t.after(f.close); assert.equal(f.probes().length, 0);
  f.push({ profileId: "B" }); assert.equal(f.probes().length, 1); await f.resolveArtist();
  assert.deepEqual(f.mounts, ["B"]); assert.equal(f.occurrences().length, 1); assert.equal(f.active().props.reveal, false);
  f.back(); await f.settle(); assert.deepEqual(f.mounts, ["B", "A"]); assert.equal(f.active().props.name, "A");
});

test("a formerly presented top whose layout disconnected cannot finish mounting behind its successor", async t => {
  const f = fixture(); t.after(f.close); const old = f.active(), initialMounts = f.mounts.length;
  const pending = deferred(); f.suspend("A", pending.promise);
  assert.ok(f.all().some(node => node.hidden && walk(node).includes(old)), "actual per-occurrence Suspense has hidden the previously committed native subtree");
  assert.equal(old.props.presentation.current(), false, "Suspense immediately retires the departed layout admission");
  f.push({ profileId: "B" }); assert.equal(f.occurrences().length, 1); assert.equal(f.active().props.reveal, false);
  f.suspend(null); await f.settle(() => pending.resolve());
  assert.equal(f.occurrences().length, 1); assert.equal(f.mounts.length, initialMounts + 1);
  f.back(); assert.notEqual(f.active(), old, "Back mounts a fresh presented occurrence instead of manufacturing a hidden ready pane");
});

for (const blocker of ["nativeAccountLinkActive", "resetToken", "ownerApprovalToken", "authReady", "landing", "status"]) {
  test(`Root disabled retained route cannot fall through to unmanaged detail during ${blocker}`, t => {
    const f = fixture(); t.after(f.close); const old = f.active().props.presentation, mounts = f.mounts.length, restored = f.bindings[blocker];
    const disabled = { nativeAccountLinkActive: true, resetToken: "reset", ownerApprovalToken: "owner", authReady: false, landing: true, status: "loading" };
    f.flags({ [blocker]: disabled[blocker] });
    assert.equal(f.probes().length, 0); assert.equal(f.mounts.length, mounts, "disabled detail must never remount outside managed context");
    assert.equal(old.current(), false); assert.equal(f.frames.length, 2);
    f.flags({ [blocker]: restored }); assert.ok(f.active()); assert.equal(f.active().props.presentation.managed, true);
  });
}

test("native account-link ref fences Root callbacks and queued edge before the state commit", t => {
  const f = fixture(); t.after(f.close); f.push({ profileId: "B" });
  const old = f.active().props.presentation, callback = f.active().props.raw.onOpenArtist;
  f.swipe(); f.finishAnimation(); assert.equal(f.queue.length, 1);
  f.bindings.nativeAccountLinkActiveRef.current = true;
  assert.equal(old.current(), false); callback("blocked"); f.queue.shift()(); assert.equal(f.actions.length, 0); assert.equal(f.frames.length, 3);
});

test("a newer Root route intent retires commands before the retained host rerenders", t => {
  const f = fixture(); t.after(f.close); const first = f.active(), old = first.props.presentation, raw = first.props.raw;
  const input = walk(first).find(node => node.type === "TextInput"), ticket = walk(first).find(node => node.type === "Ticket");
  f.precommit({ profileId: "newer-intent" }); assert.equal(old.current(), false);
  f.act(() => { raw.onOpenArtist("old"); raw.onClose(); input.props.onChangeText("old"); ticket.props.onPress(); first.props.city(); first.props.post(); });
  assert.equal(f.actions.length, 0); assert.equal(input.props.value, ""); assert.equal(f.frames.length, 2);
});

test("privacy revokes commands and queued edge before commit while retaining current/read admission", t => {
  const f = fixture(); t.after(f.close); f.push({ profileId: "B" });
  const active = f.active(), old = active.props.presentation, staleCommand = active.props.raw.onOpenArtist;
  f.swipe(); assert.equal(f.animations.length, 1); f.finishAnimation(); assert.equal(f.queue.length, 1);
  // External-store invalidation synchronously fences commands before React commits.
  f.privacy.invalidate(); assert.equal(old.current(), true); assert.equal(old.canAct(), false); assert.equal(old.privacyCurrent(), false);
  staleCommand("blocked"); f.queue.shift()(); assert.equal(f.frames.length, 3); assert.equal(f.actions.length, 0);
  f.renderer.act(noop); assert.equal(f.occurrences().length, 1, "covered private pane is purged");
  assert.equal(f.active(), active); assert.equal(active.props.presentation.current, old.current); assert.equal(active.props.presentation.token, old.token);
  assert.notEqual(active.props.presentation.commandToken, old.commandToken); assert.equal(active.props.presentation.current(), true);
  f.act(() => active.props.raw.onOpenArtist("fresh")); assert.equal(f.actions.length, 1);
  f.push({ post: review }); assert.equal(f.occurrences().length, 1, "active old-privacy proof is never re-stamped and retained later");
  assert.equal(f.active().props.reveal, false);
});

test("account A-B-A and protected gaps discard native predecessors without rewriting logical history", t => {
  const f = fixture(); t.after(f.close); const first = f.active(), old = first.props.raw.onOpenArtist;
  f.push({ profileId: "B" }); const frames = f.frames; f.changeAccount("B"); f.changeAccount("A");
  assert.equal(f.frames, frames); assert.equal(f.occurrences().length, 1); f.act(() => old("stale")); assert.equal(f.actions.length, 0);
  f.back(); assert.notEqual(f.active(), first); const revived = f.active();
  f.push({ auth: true }); assert.equal(f.occurrences().length, 0); assert.ok(f.all().find(node => node.type === "Protected"));
  f.push({ artistName: "C" }); assert.equal(f.occurrences().length, 1); assert.equal(f.active().props.reveal, false);
  f.back(); f.back(); assert.notEqual(f.active(), revived); assert.equal(f.frames.length, 2);
});

test("six-host capacity evicts native state only and never manufactures a reveal on Back", t => {
  const f = fixture(); t.after(f.close); const initial = f.active();
  for (let i = 1; i <= 7; i++) f.push({ artistName: `Artist ${i}` });
  assert.equal(f.frames.length, 9); assert.equal(f.occurrences().length, 6); assert.ok(!f.probes().includes(initial));
  for (let i = 0; i < 5; i++) f.back();
  assert.equal(f.frames.at(-1).artistName, "Artist 2"); assert.equal(f.active().props.reveal, false, "evicted Artist 1 is not manufactured under current screen");
  f.back(); assert.equal(f.active().props.name, "Artist 1"); assert.equal(f.active().props.reveal, false); f.back(); assert.notEqual(f.active(), initial);
});

test("an abandoned concurrent Root render cannot poison the last committed raw element cache", async t => {
  const f = fixture(); t.after(f.close); const first = f.active(), committedRevision = first.props.raw.artistReturn.revision;
  await f.abandonRender();
  assert.ok(f.renders.some(render => render.revision > committedRevision), "the interrupted render really evaluated detail children");
  assert.equal(first.props.raw.artistReturn.revision, committedRevision, "Suspense transition did not commit the attempted raw props");
  f.push({ profileId: "B" });
  assert.equal(f.probes()[0], first); assert.equal(first.props.raw.artistReturn.revision, committedRevision, "covered cache contains only the committed Root element");
  f.back(); assert.equal(f.active(), first); assert.equal(first.props.raw.artistReturn.revision, f.revision);
});

test("real Post read adopts same-occurrence denial after privacy change without replacement-load loop", async t => {
  const f = fixture({ realPost: true, frames: [{}, { post: review }] }); t.after(f.close);
  const request = f.reads.at(-1); assert.ok(request); const count = f.reads.length;
  f.privacyChange(); assert.equal(request.args[1].signal.aborted, false);
  await f.settle(() => request.resolve({ ok: false, error: { userMessage: "Access removed" } }));
  assert.ok(text(f.renderer.container).includes("Access removed")); assert.equal(f.reads.length, count);
  f.updateStore(); await f.settle(); assert.equal(f.reads.length, count, "denial remains adopted instead of endlessly reloading under new privacy");
});

for (const successor of [false, true]) test(`real Post confirmed deletion closes only its earned occurrence (successor ${successor})`, async t => {
  const f = fixture({ realPost: true, frames: [{}, { post: { ...review, userId: "A" } }] }); t.after(f.close);
  await f.settle(() => f.reads.forEach(request => request.resolve({ ok: true })));
  const menu = f.all().find(node => typeof node.props?.onLongPress === "function"); assert.ok(menu);
  f.act(menu.props.onLongPress); const sheet = f.actions.find(action => action[0] === "sheet"); assert.ok(sheet);
  f.act(() => sheet[2](sheet[1].options.indexOf("Delete post")));
  const alert = f.actions.find(action => action[0] === "alert"); assert.ok(alert);
  f.act(() => alert[3].find(button => button.style === "destructive").onPress()); assert.equal(f.writes.length, 1);
  if (successor) f.push({ artistName: "Successor" });
  f.privacyChange(); await f.settle(() => f.writes[0].resolve({ ok: true })); f.render();
  assert.equal(f.frames.length, successor ? 3 : 1, "privacy may retire commands, but must not erase earned same-occurrence deletion completion");
  if (successor) assert.equal(f.active().props.name, "Successor");
});

for (const boundary of ["menu", "account sheet", "welcome", "Suspense", "width", "reader", "reverse"]) test(`actual host edge/command ownership survives ${boundary} interruption`, t => {
  const f = fixture(); t.after(f.close); f.push({ profileId: "B" });
  const current = f.active(), old = current.props.presentation, pan = f.pan();
  if (boundary === "reverse") { f.swipe(pan, -100); assert.equal(f.queue.length, 0); assert.equal(f.animations.length, 0); }
  else {
    f.swipe(pan); f.finishAnimation(); assert.equal(f.queue.length, 1);
    if (boundary === "menu") { f.flags({ iosMenuOpen: true }); assert.equal(f.active(), undefined); f.flags({ iosMenuOpen: false }); }
    if (boundary === "account sheet") { f.flags({ acctOpen: true }); f.flags({ acctOpen: false }); }
    if (boundary === "welcome") { f.flags({ welcome: {} }); f.flags({ welcome: null }); }
    if (boundary === "Suspense") { f.conceal(true); f.conceal(false); }
    if (boundary === "width") f.resize(430);
    if (boundary === "reader") { f.reader(true); f.reader(false); }
    f.drain(); assert.equal(f.frames.length, 3, "old queued edge cannot pop after re-admission");
    if (!["width", "reader"].includes(boundary)) assert.equal(old.current(), false);
  }
  f.swipe(); f.finishAnimation(); f.drain(); assert.equal(f.frames.length, 2, "fresh edge invokes actual Root Back");
});

test("real PostScreen, TicketStub and keyboard retain input and scroll with usable fresh callbacks", async t => {
  const f = fixture({ realPost: true, frames: [{}, { post: review }] }); t.after(f.close);
  const host = f.occurrences()[0];
  await f.settle(() => f.reads.forEach(request => request.resolve({ ok: true })));
  const input = f.all().find(node => node.type === "TextInput" && node.props.accessibilityLabel === "Comment on post");
  const scroll = f.all().find(node => node.type === "ScrollView"); assert.ok(input); scroll.offset = 245;
  const like = () => f.all().find(node => node.props?.accessibilityLabel === "Like, 3 likes"); assert.ok(like());
  const oldLike = like().props.onPress, oldInput = input.props.onChangeText;
  f.act(() => { oldInput("Retained comment"); oldLike(); }); assert.equal(input.props.value, "Retained comment"); assert.equal(f.actions.at(-1)[0], "like");
  const keyboardView = f.all().find(node => node.props?.collapsable === false);
  f.act(() => [...f.keyboard.get("keyboardWillShow")].forEach(callback => callback({ endCoordinates: { screenX: 0, screenY: 550, width: 393, height: 302 } })));
  assert.equal(keyboardView.props.style.at(-1).paddingBottom, 302);
  f.push({ artistName: "Artist" }); const count = f.actions.length; f.act(() => { oldLike(); oldInput("Stale overwrite"); });
  assert.equal(f.actions.length, count); assert.equal(input.props.value, "Retained comment");
  f.store.feed = [{ ...review, review: "Live edited review" }]; f.updateStore(); assert.ok(text(host).includes("Live edited review"));
  f.back(); assert.equal(f.occurrences()[0], host); assert.equal(f.all().find(node => node.type === "ScrollView"), scroll); assert.equal(scroll.offset, 245);
  assert.equal(f.all().find(node => node.type === "TextInput"), input); f.act(() => { oldLike(); oldInput("Still stale"); });
  assert.equal(f.actions.length, count); assert.equal(input.props.value, "Retained comment");
  f.act(() => { input.props.onChangeText("Fresh comment"); like().props.onPress(); }); assert.equal(input.props.value, "Fresh comment"); assert.equal(f.actions.length, count + 1);
});

for (const strict of [false, true]) test(`inner Root Suspense reconnect never revives native callbacks (StrictMode ${strict})`, async t => {
  const f = fixture({ strict }); t.after(f.close); const first = f.active(), presentation = first.props.presentation;
  const keyboard = walk(first).find(node => node.props?.testID === "keyboard-probe"), oldLayout = keyboard.props.onLayout;
  const oldInput = walk(first).find(node => node.type === "TextInput").props.onChangeText;
  const oldTicket = walk(first).find(node => node.type === "Ticket").props.onPress;
  let measured = 0; keyboard.measureInWindow = callback => { measured++; callback(0, 0, 393, 852); };
  const pending = deferred(); f.suspend("A", pending.promise);
  assert.equal(presentation.current(), false); f.act(() => { oldInput("hidden"); oldTicket(); oldLayout(); }); assert.equal(f.actions.length, 0);
  f.suspend(null); await f.settle(() => pending.resolve());
  assert.ok(f.active() === first, "the reconnected retained native host must regain active controls"); assert.notEqual(first.props.presentation.token, presentation.token); assert.equal(presentation.current(), false);
  const before = measured; f.act(() => { oldInput("stale"); oldTicket(); oldLayout(); }); assert.equal(f.actions.length, 0); assert.equal(measured, before);
  const input = walk(first).find(node => node.type === "TextInput"); assert.equal(input.props.value, "");
  f.act(() => { input.props.onChangeText("fresh"); walk(first).find(node => node.type === "Ticket").props.onPress(); });
  assert.equal(input.props.value, "fresh"); assert.equal(f.actions.at(-1)[0], "ticket");
  assert.ok(f.keyboard.get("keyboardWillShow")?.size, "real keyboard reconnects under its new lifecycle admission");
});

test("covering real Post blurs only its retained input and never dismisses its successor's first responder", async t => {
  const f = fixture({ realPost: true, frames: [{}, { post: review }] }); t.after(f.close);
  await f.settle(() => f.reads.forEach(request => request.resolve({ ok: true })));
  const input = f.all().find(node => node.type === "TextInput"); input.focus(); assert.equal(f.renderer.focusedInput(), input);
  f.push({ artistName: "Successor" });
  assert.equal(input.focused, false, "covered retained Post must relinquish its own native first responder");
  const successor = walk(f.active()).find(node => node.type === "TextInput"); successor.focus(); f.updateStore();
  assert.ok(f.renderer.focusedInput() === successor, "later covered renders must not globally dismiss successor input");
  assert.equal(f.actions.some(action => action[0] === "globalDismiss"), false, "retained cleanup must use the specific input ref, not global keyboard dismissal");
});
