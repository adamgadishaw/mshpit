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
function fixture({ component = "rail", strict = false, reader = false, reduced = false, onCommit, onChange, nativeReader = false, retained = false, page = false, excludedChild = false, active = "feed", entryDirection = 0, scrollChild = null } = {}) {
  const renderer = createRenderer(), gestures = [], queue = [], calls = [], shared = [], reactions = [], springs = [], timings = [], animatedStyles = [], appListeners = new Set(), appHistory = [], springCompletions = [];
  let props = { page, entryDirection, enabled: true, active, onCommit: onCommit || (direction => calls.push(direction)), onChange: onChange || (tab => calls.push(tab)), hint: "Swipe for an action",
    post: { id: "post-A", likes: 0 }, accountId: "account-A", likeInfo: () => ({ liked: false }),
    toggleLike: (...args) => { calls.push(["like", ...args]); return Promise.resolve({ ok: true }); },
    setPostRepost: (...args) => { calls.push(["repost", ...args]); return Promise.resolve({ ok: true }); } };
  let suspended = false, confirmed = reader;
  const confirmedSubscriptions = [], nativeReaderListeners = new Set(), nativeReaderHistory = [];
  const useSharedValue = initial => {
    const ref = React.useRef(null);
    if (!ref.current) { let value = initial; ref.current = { get: () => value, set: next => { value = next; } }; shared.push(ref.current); }
    return ref.current;
  };
  const modules = {
    react: React, "react/jsx-runtime": require("react/jsx-runtime"),
    "react-native": { AppState: { currentState: "active", addEventListener: (_event, callback) => { appListeners.add(callback); appHistory.push(callback); return { remove: () => appListeners.delete(callback) }; } }, AccessibilityInfo: { announceForAccessibility: noop }, View: "View", Text: "Text", ScrollView: "ScrollView", FlatList: "FlatList", TextInput: "TextInput", Pressable: "Pressable", StyleSheet: { create: x => x, hairlineWidth: 1 }, useWindowDimensions: () => ({ width: 412, fontScale: 1 }) },
    "react-native-reanimated": { __esModule: true, default: { View: "AnimatedView", Text: "AnimatedText" }, ReduceMotion: { System: "system" }, useSharedValue,
      useAnimatedStyle: f => { animatedStyles.push(f); return f(); }, useAnimatedReaction: (prepare, react) => { reactions.push({ prepare, react }); }, withSpring: (value, config, done) => { springs.push(config); springCompletions.push(done); return value; }, withTiming: (value, config, done) => { timings.push({ value, config, done }); return value; } },
    "react-native-worklets": { scheduleOnRN: (fn, ...args) => { queue.push(() => fn(...args)); } },
    "../theme": { colors: { bg: "bg", surface: "surface" }, font: "System" }, "./Icon": "Icon", "./BrandMark": "BrandMark",
    "../hooks/useReducedMotion": () => reduced, "../hooks/useScreenReaderEnabled": { __esModule: true, default: () => reader,
      getConfirmedScreenReaderEnabled: () => confirmed,
      subscribeConfirmedScreenReaderEnabled: callback => { const entry = { callback, active: true }; confirmedSubscriptions.push(entry); return () => { entry.active = false; }; } },
    "react-native-gesture-handler": { GestureDetector: "GestureDetector", Gesture: { Pan() {
      const handlers = {};
      const builder = new Proxy({ handlers }, { get: (target, name) => name === "handlers" ? handlers : value => { handlers[name] = value; return builder; } });
      gestures.push(handlers); return builder;
    } } },
  };
  modules["react-native-gesture-handler"].Gesture.Manual = modules["react-native-gesture-handler"].Gesture.Pan;
  modules["react-native-gesture-handler"].Gesture.Native = modules["react-native-gesture-handler"].Gesture.Pan;
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
  modules["./NativeTabRail"] = execute("./NativeTabRail.ios.jsx");
  const Component = component === "rail" ? modules["./NativeSwipeRail"].default : component === "tabs" ? modules["./NativeTabRail"].default
    : component === "social" ? execute("./PostSwipeActions.native.jsx").default : component === "bar" ? execute("./IosTabBar.ios.jsx").default : execute("./NativeAppHeader.ios.jsx").default;
  const Exclusion = execute("./NativeTabSwipeExclusion.ios.jsx").default;
  modules["./NativeTabSwipeExclusion"] = { default: Exclusion, __esModule: true };
  const Scroll = execute("./NativeTabScroll.ios.jsx");
  const Child = () => scrollChild ? React.createElement(scrollChild === "input" ? Scroll.TextInput : Scroll.ScrollView, { horizontal: scrollChild === "horizontal" }, React.createElement("ExplicitButton")) : excludedChild ? React.createElement(Exclusion, null, React.createElement("ExplicitButton")) : React.createElement("ExplicitButton");
  const Layer = execute("./NativeFeedMediaLayer.jsx").default;
  function Gate() { if (suspended) throw sleepForever; return null; }
  const f = {
    calls, queue, gestures, shared, reactions, springs, timings, animatedStyles,
    appHistory,
    finishSpring(success = true) { springCompletions.at(-1)?.(success); },
    appState(value) { f.act(() => { for (const callback of [...appListeners]) callback(value); }); },
    finish(index = timings.length - 1, success = true) { timings[index]?.done(success); }, confirmedSubscriptions, nativeReaderListeners, nativeReaderHistory,
    all: () => nodes(renderer.container).filter(node => !node.hidden),
    get gesture() { return f.all().find(node => node.type === "GestureDetector").props.gesture.handlers; },
    render(next = {}, passive = true) { props = { ...props, ...next }; renderer.render(React.createElement(strict ? React.StrictMode : React.Fragment, null,
      React.createElement(React.Suspense, { fallback: React.createElement("Fallback") }, (retained ? React.createElement(Layer, { obscured: !!props.obscured, tabBar: React.createElement(Component, { ...props, key: component === "social" ? `${props.accountId || "guest"}:${props.post.id}` : "component" }, React.createElement(Child)), media: React.createElement("Gallery") }, React.createElement("FixtureFeed")) : React.createElement(Component, { ...props, key: component === "social" ? `${props.accountId || "guest"}:${props.post.id}` : "component" }, React.createElement(Child))), React.createElement(Gate))), passive); },
    reader(value) { reader = value; confirmed = value; f.render(); }, reduced(value) { reduced = value; f.render(); },
    suspend(value) { suspended = value; f.render(); },
    act(callback) { renderer.act(callback); },
    flush() { f.act(() => { while (queue.length) queue.shift()(); }); },
    confirmed(value, entry) { confirmed = value; f.act(() => { if (entry) entry.callback(); else for (const current of confirmedSubscriptions.filter(item => item.active)) current.callback(); }); },
    nativeEvents(...values) { f.act(() => { for (const value of values) for (const callback of [...nativeReaderListeners]) callback(value); }); },
    async settle() { for (let i = 0; i < 8; i++) await Promise.resolve(); f.act(noop); },
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

for (const component of ["rail", "tabs", "bar", "header"]) {
  for (const interruption of ["unmount", "reader", "reader round trip"]) test(`${component}: queued swipe is revoked by ${interruption}`, t => {
    const f = fixture({ component }); t.after(f.close); const old = f.gesture; swipe(old); assert.equal(f.queue.length, 1);
    if (interruption === "unmount") f.close(false); else f.reader(true);
    if (interruption.endsWith("round trip")) f.reader(false);
    f.flush(); assert.deepEqual(f.calls, []);
    swipe(old); f.flush(); assert.deepEqual(f.calls, []);
    if (interruption.endsWith("round trip")) { swipe(f.gesture); f.flush(); assert.deepEqual(f.calls, [component === "rail" ? "negative" : "search"]); }
  });
}
for (const interruption of ["disabled", "disabled round trip", "replaced callback", "callback round trip"]) test(`rail: queued action is revoked by ${interruption}`, t => {
  const original = [], replacement = [], callback = value => original.push(value);
  const f = fixture({ onCommit: callback }); t.after(f.close); const old = f.gesture; swipe(old);
  if (interruption.startsWith("disabled")) f.render({ enabled: false }); else f.render({ onCommit: value => replacement.push(value) });
  if (interruption.endsWith("round trip")) f.render({ enabled: true, onCommit: callback });
  f.flush(); assert.deepEqual(original, []); assert.deepEqual(replacement, []);
  swipe(old); f.flush(); assert.deepEqual(original, []); assert.deepEqual(replacement, []);
  if (interruption !== "disabled") { swipe(f.gesture); f.flush(); assert.deepEqual(interruption === "replaced callback" ? replacement : original, ["negative"]); }
});
for (const component of ["tabs", "bar", "header"]) {
  test(`${component}: same-tab rerenders preserve valid gesture and committed callback`, t => {
    const oldCalls = [], nextCalls = [], f = fixture({ component, onChange: tab => oldCalls.push(tab) }); t.after(f.close);
    const gesture = f.gesture; down(gesture);
    f.render({ onChange: tab => nextCalls.push(tab) }); assert.equal(f.gesture, gesture);
    release(gesture); f.flush(); assert.deepEqual(oldCalls, []); assert.deepEqual(nextCalls, ["search"]);
    swipe(gesture); f.render({ onChange: tab => oldCalls.push(tab) }); f.flush(); assert.deepEqual(oldCalls, ["search"]);
  });
  test(`${component}: active-tab A to B to A cannot reinterpret queued or old worklets`, t => {
    const f = fixture({ component }); t.after(f.close); const old = f.gesture; swipe(old);
    f.render({ active: "search" }); f.render({ active: "feed" });
    f.flush(); swipe(old); f.flush(); assert.deepEqual(f.calls, []);
    swipe(f.gesture); f.flush(); assert.deepEqual(f.calls, ["search"]);
    f.render({ active: "search" }); swipe(f.gesture); f.flush(); assert.deepEqual(f.calls, ["search", "discover"]);
  });
}
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
test("Reduce Motion and screen readers retain all explicit tab destinations and targets", t => {
  const f = fixture({ component: "bar", reader: true, reduced: true }); t.after(f.close);
  assert.equal(f.gesture.enabled, false);
  const tabs = f.all().filter(node => node.props?.accessibilityRole === "tab");
  for (const tab of tabs) { assert.ok(tab.props.style({ pressed: false })[0].minHeight >= 44); f.act(tab.props.onPress); }
  assert.deepEqual(f.calls, ["feed", "search", "discover", "you"]);
  f.reader(false); const g = f.gesture; down(g); g.onUpdate({ absoluteX: 110 }); f.render();
  const content = f.all().find(node => node.type === "AnimatedView");
  assert.equal(content.props.style.at(-1).transform[0].translateX, 0);
  assert.ok(f.all().some(node => node.props?.accessibilityElementsHidden && node.props.importantForAccessibility === "no-hide-descendants"));
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
for (const component of ["tabs", "bar", "header"]) for (const committed of [false, true]) test(`${component}: actual Root gallery protects retained rail, rendered=${committed}`, t => {
  const root = rootNavigationFixture(), f = fixture({ component, retained: true }); t.after(f.close); f.render(root.props());
  const old = f.gesture; swipe(old); root.gallery();
  if (committed) { f.render(root.props()); assert.ok(f.all().some(node => node.props?.pointerEvents === "none")); }
  const writes = root.queued.length; f.flush(); assert.equal(root.queued.length, writes); assert.ok(root.navigationRef.current.stack.at(-1).photos);
  root.restore(); f.render(root.props()); swipe(old); f.flush(); assert.equal(root.navigationRef.current.tab, "feed");
  swipe(f.gesture); f.flush(); assert.equal(root.navigationRef.current.tab, "search");
});
for (const transition of ["drawer before render", "drawer round trip", "route round trip", "account round trip", "reauth", "guard proceed"]) test(`actual Root fences ${transition}`, t => {
  const root = rootNavigationFixture(), f = fixture({ component: "bar", retained: true }); t.after(f.close); f.render(root.props()); const old = f.gesture; swipe(old);
  if (transition.startsWith("drawer")) { root.app.openMainMenu(); if (transition.endsWith("round trip")) root.app.setIosMenuOpen(false); }
  else if (transition === "route round trip") { root.gallery(); root.restore(); }
  else if (transition === "account round trip") { root.account("B", 2); root.account("A", 3); }
  else if (transition === "reauth") root.account("A", 2);
  else { root.defer(); f.flush(); assert.equal(root.guards.length, 1); root.gallery(); root.guards[0].proceed(); }
  const writes = root.queued.length; f.flush(); assert.equal(root.queued.length, writes); assert.equal(root.navigationRef.current.tab, "feed");
  if (transition === "drawer before render") root.app.setIosMenuOpen(false);
  if (transition !== "guard proceed") { f.render(root.props()); swipe(old); f.flush(); assert.equal(root.navigationRef.current.tab, "feed"); swipe(f.gesture); f.flush(); assert.equal(root.navigationRef.current.tab, "search"); }
});
test("actual Root benign rerender keeps the same scope and valid tab gesture", t => {
  const root = rootNavigationFixture(), f = fixture({ component: "bar", retained: true }); t.after(f.close); f.render(root.props()); const gesture = f.gesture; swipe(gesture);
  f.render(root.props()); assert.equal(f.gesture, gesture); f.flush(); assert.equal(root.navigationRef.current.tab, "search");
});
for (const strict of [false, true]) test(`real confirmed preference batched round trip revokes then rearms, strict=${strict}`, async t => {
  const f = fixture({ component: "bar", nativeReader: true, strict }); t.after(f.close); await f.settle();
  const old = f.gesture; assert.equal(old.enabled, true); swipe(old); f.nativeEvents(true, false); f.flush(); assert.deepEqual(f.calls, []);
  const current = f.gesture; assert.notEqual(current, old); down(current); current.onUpdate({ absoluteX: 110 }); const before = f.shared.map(value => value.get());
  old.onFinalize(); swipe(old); f.flush(); assert.deepEqual(f.shared.map(value => value.get()), before);
  release(current); f.flush(); assert.deepEqual(f.calls, ["search"]);
});
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
  assert.match(app, /<NativeFeedMediaLayer key=\{session.id\} obscured=\{!!overlay\}/);
  for (const name of ["NativeTabRail.native.jsx", "NativeAppHeader.native.jsx", "NativeSwipeRail.native.jsx"]) assert.doesNotMatch(readFileSync(new URL(`./${name}`, import.meta.url), "utf8"), /swipeScope|isCurrentSwipeRoute|subscribeConfirmedScreenReaderEnabled/);
});

for (const platform of ["android", "web"]) test(`${platform} Root tab callbacks ignore the optional iOS-only predicate`, () => {
  const root = rootNavigationFixture({ platform });
  root.app.switchTab("search", () => false);
  assert.equal(root.navigationRef.current.tab, "search");
});

// Page-motion tests exercise production callbacks but not native recognizer arbitration.
test("page follows finger with restrained 3D motion, exits then dispatches once", t => {
  const f = fixture({ component: "tabs", page: true }); t.after(f.close);
  const g = f.gesture; down(g); g.onUpdate({ absoluteX: 140 });
  const transform = f.animatedStyles.at(-3)().transform;
  assert.ok(transform.some(item => item.perspective === 1200));
  assert.ok(transform.some(item => item.translateX === -120));
  release(g); assert.equal(f.timings.length, 1); assert.deepEqual(f.calls, []);
  const manager = down(g); assert.equal(manager.failed, 1, "settling rejects a second gesture");
  g.onFinalize(); f.finish(); f.flush(); assert.deepEqual(f.calls, ["search"]);
});
for (const interruption of ["route", "reader", "background", "reduced", "suspend", "unmount"]) test(`page animation completion is retired by ${interruption}`, t => {
  const f = fixture({ component: "tabs", page: true }); t.after(f.close); const old = f.gesture;
  swipe(old); assert.equal(f.timings.length, 1);
  if (interruption === "route") f.render({ swipeScope: {} });
  if (interruption === "reader") f.reader(true);
  if (interruption === "background") { f.appState("background"); f.appState("active"); }
  if (interruption === "reduced") f.reduced(true);
  if (interruption === "suspend") { f.suspend(true); f.suspend(false); }
  if (interruption === "unmount") f.close(false);
  f.finish(0); f.flush(); assert.deepEqual(f.calls, []);
});
test("page cancels unsuccessful motion, reversals and boundary drags", t => {
  const f = fixture({ component: "tabs", page: true }); t.after(f.close);
  for (const args of [{ x: 240 }, { x: 110, success: false }, { x: 400 }]) { const g=f.gesture; down(g); release(g,args); g.onFinalize(); }
  assert.equal(f.timings.length, 0); assert.deepEqual(f.calls, []);
});
test("page incoming direction and reduced motion transforms", t => {
  const f = fixture({ component: "tabs", page: true }); t.after(f.close);
  f.render({ active: "search", entryDirection: 1 }); assert.ok(f.springs.some(config => config.stiffness === 230));
  f.reduced(true); const style = f.animatedStyles.at(-3)();
  assert.ok(style.transform.some(item => item.translateX === 0));
  assert.ok(style.transform.some(item => item.rotateY === "0deg"));
  swipe(f.gesture); f.flush(); assert.equal(f.timings.length, 0);
});
for (const childFirst of [true, false]) test(`page exclusions preserve child ownership, down child-first=${childFirst}`, t => {
  const f = fixture({ component: "tabs", page: true, excludedChild: true }); t.after(f.close);
  const parent = f.gesture, child = f.all().filter(n=>n.type==="GestureDetector")[1].props.gesture.handlers;
  const manager = { begin() {}, fail() {}, activate() { throw Error("exclusion must never activate"); } };
  if(childFirst) child.onTouchesDown({},manager);
  down(parent);
  if(!childFirst) child.onTouchesDown({},manager);
  parent.onTouchesMove({ allTouches: [{absoluteX:100,absoluteY:200}],numberOfTouches:1 },manager);
  child.onTouchesUp({},manager); release(parent); parent.onFinalize();
  assert.equal(f.timings.length,0); assert.deepEqual(f.calls,[]);
  // Parent rejects edge first, then child begins; release must clear exclusion.
  down(parent,{x:5}); parent.onFinalize(); child.onTouchesDown({},manager); child.onTouchesUp({},manager);
  swipe(parent); f.finish(); f.flush(); assert.deepEqual(f.calls,["search"]);
});

test("old page move and removed app listener cannot retire a newer drag", t => {
 const f=fixture({component:"tabs",page:true}); t.after(f.close);
 const old=f.gesture, removed=f.appHistory.at(-1);
 f.render({swipeScope:{}}); const current=f.gesture; down(current);
 old.onTouchesMove({allTouches:[{absoluteX:100,absoluteY:200}],numberOfTouches:1},{fail(){},activate(){}});
 f.act(()=>removed("background")); release(current); f.finish(); f.flush(); assert.deepEqual(f.calls,["search"]);
 f.finish(); f.flush(); assert.deepEqual(f.calls,["search"],"completion is consumed once");
});
test("passive exclusion is stable across benign same-page renders and cancellation clears it", t=>{
 const f=fixture({component:"tabs",page:true,excludedChild:true});t.after(f.close);
 const observer=()=>f.all().filter(n=>n.type==="GestureDetector")[1].props.gesture.handlers;
 const g=f.gesture, child=observer(); f.render({hint:"new content"}); assert.equal(observer(),child); assert.equal(f.gesture,g);
 const manager={begin(){},fail(){}};child.onTouchesDown({},manager);down(g);child.onTouchesCancelled({},manager);release(g);g.onFinalize();assert.equal(f.timings.length,0);
 swipe(g); f.finish();f.flush();assert.deepEqual(f.calls,["search"]);
});

test("fresh page mount accepts Root direction across the retained Feed host boundary",t=>{
 const f=fixture({component:"tabs",page:true,active:"search",entryDirection:1});t.after(f.close);
 assert.ok(f.springs.some(config=>config.stiffness===230));
});
test("declined navigation recovery keeps input fenced until its spring rearms",t=>{
 const f=fixture({component:"tabs",page:true,onChange:()=>{}});t.after(f.close);
 const old=f.gesture;swipe(old);f.finish();f.flush();
 assert.equal(down(old).failed,1);f.finishSpring();f.flush();
 const fresh=f.gesture;assert.notEqual(fresh,old);assert.equal(down(fresh).failed,0);
 release(fresh);assert.equal(f.timings.length,2);
});
for (const kind of ["vertical","horizontal","input"]) test(`native ${kind} adapter retains child layout and owns arbitration`,t=>{
 const f=fixture({component:"tabs",page:true,scrollChild:kind});t.after(f.close);
 const detectors=f.all().filter(n=>n.type==="GestureDetector");assert.equal(detectors.length,2);
 const child=detectors[1].props.gesture.handlers;
 assert.ok(child.simultaneousWithExternalGesture);
 assert.equal(detectors[1].children[0].type,kind==="input"?"TextInput":"ScrollView","detector attaches directly, without layout wrapper");
 if(kind==="vertical") assert.equal(child.onTouchesDown,undefined);
 else assert.equal(typeof child.onTouchesDown,"function");
});

test("fresh-mount entry direction is consumed and cannot replay on permission changes",t=>{
 const f=fixture({component:"tabs",page:true,active:"search",entryDirection:1});t.after(f.close);
 const count=f.springs.length;f.reader(true);assert.equal(f.springs.length,count);assert.equal(f.shared[3].get(),0);
 f.reader(false);assert.equal(f.springs.length,count);assert.equal(f.shared[3].get(),0);
});

test("a later excluded-child touch cannot strand an accepted outgoing transition",t=>{
 const f=fixture({component:"tabs",page:true,excludedChild:true});t.after(f.close);
 swipe(f.gesture);const child=f.all().filter(n=>n.type==="GestureDetector")[1].props.gesture.handlers;
 child.onTouchesDown({},{begin(){},fail(){}});f.finish();f.flush();assert.deepEqual(f.calls,["search"]);
});
