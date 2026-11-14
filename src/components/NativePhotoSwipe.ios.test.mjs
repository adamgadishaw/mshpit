import assert from "node:assert/strict";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import test from "node:test";
import { parse } from "@babel/parser";
import { createIOSLinkedNavigation } from "../domain/iosLinkedNavigation.mjs";
import { replaceNavigationFrame } from "../domain/navigationStack.mjs";
import { navigationFrameForAccount } from "../domain/memberAccess.mjs";
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
const sleepForever = new Promise(noop);
const rootSource = readFileSync(new URL("../../App.js", import.meta.url), "utf8");
const rootAST = parse(rootSource, { sourceType: "module", plugins: ["jsx"] });
const callbackNames = ["cancelNewsStory", "cancelPublicRoute", "applyNavigation", "writeNavigation", "runAfterComposerClose", "popStack", "requestComposerPop", "back", "commitReplace", "rememberPhotoIndex"];
const callbacks = new Map(); let galleryJSX;
function walk(node) {
  if (!node || typeof node !== "object") return;
  if (node.type === "VariableDeclarator" && callbackNames.includes(node.id?.name)) callbacks.set(node.id.name,
    `const ${node.id.name} = ${rootSource.slice(node.init.start, node.init.end)};`);
  if (node.type === "JSXElement" && node.openingElement.name?.name === "PhotoViewer") galleryJSX = rootSource.slice(node.start, node.end);
  Object.values(node).forEach(value => Array.isArray(value) ? value.forEach(walk) : value && typeof value === "object" && walk(value));
}
walk(rootAST);
assert.ok(galleryJSX);
const rootCode = transformSync(`export default function root(bindings) {
  const { Platform, web, nav, linkedNavigationScope, linkedNavigationRef, navigationRef, stackRef, newsLinkedClaimRef, newsOpenRef,
    setNewsStoryNotice, publicLookup, publicNavigationPendingRef, publicRouteRequestRef, setPublicNavigationNotice, authNavigationAbortRef, cancelPushNavigation,
    composerCloseGuardRef, setStack, setTab, setLanding, session, navigationFrameForAccount, prepareAvailableNavigationFrame,
    replaceNavigationFrame, pathForFrame, PhotoViewer, mediaViewerOpenerRef, mediaReactions, loadMediaReactions, toggleMediaReaction,
    track, openReport, openSignIn } = bindings;
  ${callbackNames.map(name => callbacks.get(name)).join("\n")}
  return { back, applyNavigation, rememberPhotoIndex, element: ${galleryJSX} };
}`, { babelrc: false, configFile: false, plugins: [[require("@babel/plugin-transform-react-jsx"), { runtime: "automatic" }], require("@babel/plugin-transform-modules-commonjs")] }).code;
const rootModule = { exports: {} };
new Function("require", "module", "exports", rootCode)(require, rootModule, rootModule.exports);

// Real Root back/pop/replace and PhotoViewer + iOS detector. Only native host,
// worklet scheduling, and read/reaction/report boundaries are synthetic.
function fixture({ strict = false, platform = "ios", reader = false, reduced = false, count = 3, realReader = false } = {}) {
  const renderer = createRenderer(), queue = [], pans = [], springs = [], shared = [], reports = [], loads = [], mutations = [];
  let suspended = false, account = "A", epoch = 1, shown = true;
  const confirmedListeners = new Set(), nativeReaderListeners = [], capturedReaderListeners = [];
  const owner = createIOSLinkedNavigation(); owner.account(account, epoch); owner.mount();
  const profile = { profileId: "fixture-profile" }, initialGallery = { photos: { images: Array.from({ length: count }, (_, i) => `https://example.test/photo-${i}.jpg`), index: 0, postId: "fixture-post" } };
  const stackRef = { current: [{}, profile, initialGallery] };
  const navigationRef = { current: { stack: stackRef.current, tab: "feed", landing: false } };
  const useSharedValue = initial => {
    const ref = React.useRef(null);
    if (!ref.current) { let value = initial; ref.current = { get: () => value, set: next => { value = next; } }; shared.push(ref.current); }
    return ref.current;
  };
  const modules = {
    react: React, "react/jsx-runtime": require("react/jsx-runtime"),
    "react-native": { AccessibilityInfo: {
      isScreenReaderEnabled: () => sleepForever,
      addEventListener: (name, callback) => { const listener = { callback, active: true }; nativeReaderListeners.push(listener); return { remove: () => { listener.active = false; } }; },
    }, View: "View", Text: "Text", Pressable: "Pressable", Modal: "Modal", Platform: { OS: platform }, Linking: {},
      StyleSheet: { create: value => value }, useWindowDimensions: () => ({ width: 412 }),
      Animated: { View: "Animated.View", ValueXY: class { setValue() {} getTranslateTransform() { return []; } }, spring: () => ({ start: noop }) },
      PanResponder: { create: () => ({ panHandlers: {} }) } },
    "react-native-safe-area-context": { useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) },
    "react-native-reanimated": { __esModule: true, default: { View: "AnimatedView" }, ReduceMotion: { System: "system" }, useSharedValue,
      useAnimatedStyle: f => f(), withSpring: (value, config) => { springs.push(config); return value; } },
    "react-native-worklets": { scheduleOnRN: (fn, ...args) => { queue.push(() => fn(...args)); } },
    "../theme": { colors: {}, radius: {} }, "./Icon": "Icon", "./SmartImage": "SmartImage", "./NativeGestureRoot": "NativeGestureRoot", "./media-player/MshpitVideoPlayer": "MshpitVideoPlayer",
    "../hooks/useReducedMotion": () => reduced, "../hooks/useScreenReaderEnabled": { __esModule: true, default: () => reader,
      getConfirmedScreenReaderEnabled: () => reader,
      subscribeConfirmedScreenReaderEnabled: callback => { confirmedListeners.add(callback); capturedReaderListeners.push(callback); return () => confirmedListeners.delete(callback); },
    },
    "react-native-gesture-handler": { GestureDetector: "GestureDetector", Gesture: { Pan() {
      const handlers = {};
      const builder = new Proxy({ handlers }, { get: (target, name) => name === "handlers" ? handlers : value => { handlers[name] = value; return builder; } });
      pans.push(handlers); return builder;
    } } },
  };
  function execute(path) {
    const url = new URL(path, import.meta.url);
    if (!codes.has(path)) codes.set(path, transformSync(readFileSync(url, "utf8"), { filename: fileURLToPath(url), babelrc: false, configFile: false,
      plugins: [[require("@babel/plugin-transform-react-jsx"), { runtime: "automatic" }], require("@babel/plugin-transform-modules-commonjs")],
    }).code);
    const module = { exports: {} }, local = createRequire(url);
    new Function("require", "module", "exports", codes.get(path))(name => {
      if (name in modules) return modules[name];
      assert.ok(name.startsWith("../domain/") || name === "./iosAccessibilityPreference.mjs", `Unexpected real dependency: ${name}`);
      return local(name);
    }, module, module.exports);
    return module.exports;
  }
  if (realReader) {
    const readerModule = execute("../hooks/useScreenReaderEnabled.ios.js");
    const subscribe = readerModule.subscribeConfirmedScreenReaderEnabled;
    readerModule.subscribeConfirmedScreenReaderEnabled = callback => { capturedReaderListeners.push(callback); return subscribe(callback); };
    modules["../hooks/useScreenReaderEnabled"] = readerModule;
  }
  modules["./NativePhotoSwipe"] = execute(`./NativePhotoSwipe${platform === "ios" ? ".ios" : platform === "android" ? ".native" : ""}.jsx`);
  const Viewer = execute("./PhotoViewer.jsx").default;
  let binding = {
    Platform: { OS: platform }, web: platform === "web", linkedNavigationRef: { current: owner }, navigationRef, stackRef,
    newsLinkedClaimRef: { current: null }, newsOpenRef: { current: 0 }, setNewsStoryNotice: noop,
    publicLookup: {}, publicNavigationPendingRef: { current: null }, publicRouteRequestRef: { current: null }, setPublicNavigationNotice: noop,
    authNavigationAbortRef: { current: noop }, composerCloseGuardRef: { current: null },
    setStack: noop, setTab: noop, setLanding: noop, navigationFrameForAccount, prepareAvailableNavigationFrame: value => value, replaceNavigationFrame,
    pathForFrame: () => "/", PhotoViewer: Viewer, mediaViewerOpenerRef: { current: null }, mediaReactions: {},
    loadMediaReactions: items => loads.push(items), toggleMediaReaction: (...args) => mutations.push(args), track: () => assert.fail("No real analytics"),
    openReport: value => { reports.push(value); owner.invalidate(); f.root.applyNavigation({ ...navigationRef.current, stack: [...stackRef.current, { reporting: value }] }); }, openSignIn: noop,
  };
  let root;
  function Gate() { if (suspended) throw sleepForever; return null; }
  const f = {
    queue, pans, shared, springs, reports, loads, mutations, owner, initialGallery, profile, nativeReaderListeners, capturedReaderListeners,
    get root() { return root; }, get stack() { return stackRef.current; },
    all: () => nodes(renderer.container).filter(node => !node.hidden),
    find: predicate => { const value = f.all().find(predicate); assert.ok(value, "Expected node"); return value; },
    button: label => f.find(node => node.type === "Pressable" && node.props.accessibilityLabel === label).props.onPress,
    get gesture() { return f.find(node => node.type === "GestureDetector").props.gesture.handlers; },
    get uri() { return f.all().find(node => node.type === "SmartImage")?.props.uri; },
    render() {
      const nav = stackRef.current.at(-1);
      if (nav.photos) root = rootModule.exports.default({ ...binding, nav, session: account ? { id: account } : null, linkedNavigationScope: owner.account(account, epoch) });
      renderer.render(React.createElement(strict ? React.StrictMode : React.Fragment, null,
        React.createElement(React.Suspense, { fallback: React.createElement("Fallback") }, shown && nav.photos && root.element, React.createElement(Gate))));
    },
    emitReader(value) { for (const listener of nativeReaderListeners) if (listener.active) listener.callback(value); },
    reader(value) { reader = value; for (const callback of [...confirmedListeners]) callback(); f.render(); }, reduced(value) { reduced = value; f.render(); },
    scope(id, nextEpoch) { account = id; epoch = nextEpoch; owner.account(account, epoch); },
    suspend(value) { suspended = value; f.render(); },
    act(callback) { renderer.act(callback); },
    flush() { while (queue.length) f.act(queue.shift()); },
    close(passive = true) { shown = false; renderer.render(null, passive); },
    restore(frame = initialGallery) { root.applyNavigation({ ...navigationRef.current, stack: [{}, profile, frame] }); f.render(); },
  };
  f.render(); return f;
}
function drag(gesture, { x = 200, y = 200, dx = 1, dy = 150, touches = 1, success = true, finalize = true } = {}) {
  const manager = { failed: 0, activated: 0, fail() { this.failed++; }, activate() { this.activated++; } };
  gesture.onTouchesDown({ allTouches: [{ absoluteX: x, absoluteY: y }], numberOfTouches: touches }, manager);
  gesture.onTouchesMove({ allTouches: [{ absoluteX: x + dx, absoluteY: y + dy }], numberOfTouches: touches }, manager);
  gesture.onUpdate({ absoluteX: x + dx, absoluteY: y + dy });
  gesture.onEnd({ absoluteX: x + dx, absoluteY: y + dy }, success);
  if (finalize) gesture.onFinalize();
  return manager;
}

for (const close of ["explicit", "request", "root", "layout-unmount"]) test(`queued close cannot pop Profile after ${close}, before passive cleanup`, t => {
  const f = fixture(); t.after(f.close); const old = f.gesture, retainedClose = f.button("Close");
  drag(old); assert.equal(f.queue.length, 1);
  if (close === "explicit") retainedClose();
  else if (close === "request") f.find(n => n.type === "Modal").props.onRequestClose();
  else f.root.back();
  assert.equal(f.stack.length, 2);
  if (close === "layout-unmount") f.close(false);
  f.flush(); retainedClose(); assert.equal(f.stack.length, 2); assert.equal(f.stack.at(-1), f.profile);
});
for (const boundary of ["same frame", "new frame", "account", "epoch", "account round trip"]) test(`queued and captured gallery close stays retired after ${boundary}`, t => {
  const f = fixture(); t.after(f.close); const old = f.gesture, close = f.button("Close"); drag(old);
  if (boundary.endsWith("frame")) { f.root.back(); f.restore(boundary === "same frame" ? f.initialGallery : { photos: { ...f.initialGallery.photos } }); }
  if (boundary === "account") { f.scope("B", 1); f.render(); }
  if (boundary === "epoch") { f.scope("A", 2); f.render(); }
  if (boundary === "account round trip") { f.scope("B", 1); f.scope("A", 1); f.render(); }
  f.flush(); close(); assert.equal(f.stack.length, 3);
  drag(old); f.flush(); assert.equal(f.stack.length, 3);
  drag(f.gesture); f.flush(); assert.equal(f.stack.length, 2);
});
for (const boundary of ["reader", "reader round trip", "unmount"]) test(`queued gallery close revoked by ${boundary}`, t => {
  const f = fixture(); t.after(f.close); const old = f.gesture; drag(old);
  if (boundary === "unmount") f.close(false); else f.reader(true);
  if (boundary.endsWith("round trip")) f.reader(false);
  f.flush(); drag(old); f.flush(); assert.equal(f.stack.length, 3);
  if (boundary.endsWith("round trip")) { drag(f.gesture); f.flush(); assert.equal(f.stack.length, 2); }
  if (boundary === "reader") { f.button("Close")(); assert.equal(f.stack.length, 2); }
});
for (const strict of [false, true]) test(`gallery Suspense reconnect preserves new owner, strict=${strict}`, t => {
  const f = fixture({ strict }); t.after(f.close); const old = f.gesture; drag(old);
  f.suspend(true); f.suspend(false); const fresh = f.gesture; assert.notEqual(old, fresh);
  f.flush(); assert.equal(f.stack.length, 3);
  const before = f.shared.map(value => value.get()); drag(old); old.onFinalize(); f.flush();
  assert.deepEqual(f.shared.map(value => value.get()), before);
  drag(fresh); f.flush(); assert.equal(f.stack.length, 2);
});
for (const direction of ["next", "prev"]) test(`queued ${direction} cannot retarget after explicit item change and return`, t => {
  const f = fixture(); t.after(f.close); const old = f.gesture;
  drag(old, { dx: direction === "next" ? -160 : 160, dy: 0 });
  f.act(f.button("Next media")); const second = f.uri;
  f.flush(); assert.equal(f.uri, second);
  f.act(f.button("Previous media")); assert.match(f.uri, /photo-0/);
  drag(old, { dx: -160, dy: 0 }); f.flush(); assert.match(f.uri, /photo-0/);
  drag(f.gesture, { dx: -160, dy: 0 }); f.flush(); assert.match(f.uri, /photo-1/);
});
test("ordinary rerenders retain the current gesture and its one completion", t => {
  const f = fixture(); t.after(f.close); const old = f.gesture; f.render(); assert.equal(f.gesture, old);
  drag(old); old.onEnd({ absoluteX: 201, absoluteY: 350 }, true); assert.equal(f.queue.length, 1);
  f.flush(); assert.equal(f.stack.length, 2);
});
for (const [name, options] of [
  ["cancel", { success: false }], ["too short", { dy: 20 }], ["upward", { dy: -150 }],
  ["left edge", { x: 5 }], ["right edge", { x: 409 }], ["multitouch", { touches: 2 }],
]) test(`gallery ${name} does not navigate`, t => {
  const f = fixture(); t.after(f.close); drag(f.gesture, options); f.flush(); assert.equal(f.stack.length, 3); assert.match(f.uri, /photo-0/);
});
test("single-photo horizontal fails; downward close still works", t => {
  const f = fixture({ count: 1 }); t.after(f.close); assert.equal(f.gesture.maxPointers, 1); assert.equal(f.gesture.manualActivation, true);
  const manager = drag(f.gesture, { dx: 160, dy: 0 }); assert.ok(manager.failed); f.flush(); assert.equal(f.stack.length, 3);
  drag(f.gesture); f.flush(); assert.equal(f.stack.length, 2);
});
test("Reduce Motion keeps geometry and system-aware settle policy", t => {
  const f = fixture({ reduced: true }); t.after(f.close); drag(f.gesture, { dy: 20 }); f.flush();
  assert.deepEqual(f.find(n => n.type === "AnimatedView").props.style.transform, [{ translateX: 0 }, { translateY: 0 }]);
  assert.ok(f.springs.every(value => value.reduceMotion === "system" && value.duration === 400));
});
test("Report remembers displayed index; Back restores it and old gesture cannot close the restored visit", t => {
  const f = fixture(); t.after(f.close); f.act(f.button("Next media")); const old = f.gesture; drag(old);
  f.button("Report this photo")(); assert.equal(f.reports.length, 1); assert.match(f.reports[0].mediaUri, /photo-1/);
  assert.equal(f.stack.at(-2).photos.index, 1); f.render(); f.root.back(); f.render();
  assert.match(f.uri, /photo-1/); f.flush(); assert.ok(f.stack.at(-1).photos);
  assert.equal(f.mutations.length, 0); f.button("Close")(); assert.equal(f.stack.at(-1), f.profile);
});
test("video remains outside image detector, accessible arrows and close remain", t => {
  const f = fixture(); t.after(f.close);
  f.root.back(); f.restore({ photos: { images: [{ uri: "https://example.test/clip.mp4", type: "video" }], index: 0, postId: "fixture-post" } });
  assert.ok(f.all().some(n => n.type === "MshpitVideoPlayer")); assert.ok(!f.all().some(n => n.type === "GestureDetector"));
  f.button("Close")(); assert.equal(f.stack.length, 2);
});
for (const platform of ["android", "web"]) test(`${platform} preserves unguarded Root close and platform detector`, t => {
  const f = fixture({ platform }); t.after(f.close);
  assert.equal(f.root.element.props.onClose, f.root.back);
  assert.equal(f.root.element.props.iosGestureScope, undefined);
  assert.equal(f.root.element.props.isCurrentIOSRoute, undefined);
  assert.equal(f.all().filter(n => n.type === "GestureDetector").length, platform === "android" ? 1 : 0);
});

test("Root account retirement fences close before viewer receives another render", t => {
  const f = fixture(); t.after(f.close); const close = f.button("Close"); drag(f.gesture);
  f.scope("A", 2); f.flush(); close(); assert.equal(f.stack.length, 3);
  f.render(); drag(f.gesture); f.flush(); assert.equal(f.stack.length, 2);
});
test("valid horizontal directions advance once; a return below threshold does not advance", t => {
  const f = fixture(); t.after(f.close);
  drag(f.gesture, { dx: -160, dy: 0 }); f.flush(); assert.match(f.uri, /photo-1/);
  drag(f.gesture, { dx: 160, dy: 0 }); f.flush(); assert.match(f.uri, /photo-0/);
  drag(f.gesture, { dx: -30, dy: 0 }); f.flush(); assert.match(f.uri, /photo-0/);
});
test("a second pointer after touch down cancels an otherwise valid close", t => {
  const f = fixture(); t.after(f.close); const p = f.gesture, manager = { fail: noop, activate: noop };
  p.onTouchesDown({ allTouches: [{ absoluteX: 200, absoluteY: 200 }], numberOfTouches: 1 }, manager);
  p.onTouchesMove({ allTouches: [{ absoluteX: 201, absoluteY: 350 }], numberOfTouches: 2 }, manager);
  p.onEnd({ absoluteX: 201, absoluteY: 350 }, true); f.flush(); assert.equal(f.stack.length, 3);
});
test("unrelated renders and item swipes do not change reaction read identity or mutate media", t => {
  const f = fixture(); t.after(f.close); assert.equal(f.loads.length, 1);
  f.render(); drag(f.gesture, { dx: -160, dy: 0 }); f.flush();
  assert.equal(f.loads.length, 1); assert.deepEqual(f.mutations, []);
  f.button("Like this photo, 0 likes")({ stopPropagation: noop });
  assert.deepEqual(f.mutations, [["https://example.test/photo-1.jpg", "fixture-post"]]);
});

for (const strict of [false, true]) test(`real native reader batched on/off revokes queued gallery close, strict=${strict}`, t => {
  const f = fixture({ realReader: true, strict }); t.after(f.close);
  assert.equal(f.gesture.enabled, false, "unknown permission remains conservative");
  f.act(() => f.emitReader(false)); const old = f.gesture; assert.equal(old.enabled, true); drag(old);
  f.act(() => { f.emitReader(true); f.emitReader(false); });
  assert.notEqual(f.gesture, old, "a fresh owner is required although the boolean returned to false");
  f.flush(); drag(old); f.flush(); assert.equal(f.stack.length, 3);
  drag(f.gesture); f.flush(); assert.equal(f.stack.length, 2);
});
test("real native reader known-on revokes before rendering, and retired listeners cannot revoke a fresh owner", t => {
  const f = fixture({ realReader: true }); t.after(f.close); f.act(() => f.emitReader(false));
  const listener = f.capturedReaderListeners.at(-1); drag(f.gesture);
  f.act(() => { f.emitReader(true); while (f.queue.length) f.queue.shift()(); f.emitReader(false); });
  assert.equal(f.stack.length, 3);
  const fresh = f.gesture, before = f.shared.map(value => value.get()); listener();
  assert.equal(f.gesture, fresh); assert.deepEqual(f.shared.map(value => value.get()), before);
  drag(fresh); f.flush(); assert.equal(f.stack.length, 2);
});
test("real reader native listener is removed on unmount and stale callback cannot revive gallery", t => {
  const f = fixture({ realReader: true }); f.act(() => f.emitReader(false)); const old = f.gesture; drag(old);
  const listener = f.nativeReaderListeners.at(-1); f.close(); assert.equal(listener.active, false);
  listener.callback(true); listener.callback(false); f.flush(); drag(old); f.flush(); assert.equal(f.stack.length, 3);
});

test("installed Metro resolves only iOS gallery to its owned detector", () => {
  const { resolve } = require("metro-resolver");
  const context = { originModulePath: fileURLToPath(new URL("./PhotoViewer.jsx", import.meta.url)), assetExts: new Set(), sourceExts: ["js", "jsx", "json", "ts", "tsx"],
    preferNativePlatform: true, mainFields: ["react-native", "browser", "main"], getPackageForModule: () => null,
    fileSystemLookup(path) { try { const stat = statSync(path); return { exists: true, type: stat.isDirectory() ? "d" : "f", realPath: realpathSync(path) }; } catch { return { exists: false }; } },
  };
  for (const platform of ["ios", "android", "web"]) {
    const suffix = platform === "ios" ? ".ios" : platform === "android" ? ".native" : "";
    const result = resolve({ ...context, preferNativePlatform: platform !== "web" }, "./NativePhotoSwipe", platform);
    assert.equal(result.filePath, fileURLToPath(new URL(`./NativePhotoSwipe${suffix}.jsx`, import.meta.url)));
  }
});
test("installed Expo/worklets Babel preset compiles the owned gallery worklets", () => {
  const file = new URL("./NativePhotoSwipe.ios.jsx", import.meta.url);
  const result = transformSync(readFileSync(file, "utf8"), { filename: fileURLToPath(file), babelrc: false, configFile: false,
    presets: [[require("babel-preset-expo"), { platform: "ios" }]], caller: { name: "metro", platform: "ios", supportsStaticESM: true } });
  assert.equal(result.options.filename, fileURLToPath(file));
  assert.ok((result.code.match(/__workletHash/g) || []).length >= 6);
  assert.match(result.code, /scheduleOnRN/);
});
test("retired confirmed reader subscriber is inert even while the replacement is known-on", t => {
  const f = fixture({ realReader: true }); t.after(f.close); f.act(() => f.emitReader(false));
  const old = f.capturedReaderListeners.at(-1); f.act(() => f.emitReader(true));
  const before = f.shared.map(value => value.get()), panCount = f.pans.length;
  f.act(old); assert.deepEqual(f.shared.map(value => value.get()), before); assert.equal(f.pans.length, panCount);
  f.act(() => f.emitReader(false)); drag(f.gesture); f.flush(); assert.equal(f.stack.length, 2);
});
