import assert from "node:assert/strict";
import { readFileSync, statSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import test from "node:test";
import { parse } from "@babel/parser";
import { createIOSCommentDrafts } from "../domain/iosCommentDrafts.mjs";
import { createIOSLinkedNavigation } from "../domain/iosLinkedNavigation.mjs";
import { iosDetailCanRetain } from "../domain/iosDetailRetention.mjs";
const require = createRequire(import.meta.url);
const React = require("react"), reconciler = require("react-reconciler");
const { transformSync } = require("@babel/core");
const codes = new Map(), noop = () => {};
const FeedBackContext = React.createContext(false);
function execute(path, imports) {
  const file = new URL(path, import.meta.url);
  if (!codes.has(path)) codes.set(path, transformSync(readFileSync(file, "utf8"), {
    filename: fileURLToPath(file), babelrc: false, configFile: false,
    plugins: [[require("@babel/plugin-transform-react-jsx"), { runtime: "automatic" }], require("@babel/plugin-transform-modules-commonjs")],
  }).code);
  const module = { exports: {} };
  new Function("require", "module", "exports", codes.get(path))(
    name => imports(name, createRequire(file)), module, module.exports);
  return module.exports;
}
function createRenderer() {
  const context = {}, container = { children: [] };
  let priority = 0;
  const append = (parent, child) => parent.children.push(child);
  const remove = (parent, child) => { const index = parent.children.indexOf(child); if (index >= 0) parent.children.splice(index, 1); };
  const insert = (parent, child, before) => parent.children.splice(parent.children.indexOf(before), 0, child);
  const renderer = reconciler({
    supportsMutation: true, hideInstance: n => { n.hidden = true; }, unhideInstance: n => { n.hidden = false; }, hideTextInstance: n => { n.hidden = true; }, unhideTextInstance: n => { n.hidden = false; }, isPrimaryRenderer: true, supportsPersistence: false, supportsHydration: false,
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
  return { container, renderLayout(element) { renderer.updateContainerSync(element, root, null, null); renderer.flushSyncWork(); }, flush, render(element) { renderer.updateContainerSync(element, root, null, null); flush(); },
    act(callback) { renderer.flushSyncFromReconciler(callback); flush(); } };
}

function rootNavigationFixture(platform = "ios", frames) {
  const source = readFileSync(new URL("../../App.js", import.meta.url), "utf8");
  const ast = parse(source, { sourceType: "module", plugins: ["jsx"] });
  const names = ["cancelNewsStory", "cancelPublicRoute", "applyNavigation", "runAfterComposerClose", "popStack", "requestComposerPop", "back"];
  const declarations = new Map(); let retainedPredicate; const edgeCallbacks = [], predicates = [];
  function walk(node) {
    if (!node || typeof node !== "object") return;
    if (node.type === "VariableDeclarator" && names.includes(node.id?.name)) declarations.set(node.id.name,
      `const ${node.id.name} = ${source.slice(node.init.start, node.init.end)};`);
    if (node.type === "JSXOpeningElement" && node.name?.name === "IosDetailNavigation") {
      const value = node.attributes.find(attribute => attribute.name?.name === "isCurrentRoute").value.expression;
      predicates.push(source.slice(value.start, value.end));
    }
    if (node.type === "JSXOpeningElement" && node.name?.name === "NativeDetailStack") {
      const value = node.attributes.find(attribute => attribute.name?.name === "isCurrentRoute").value.expression;
      assert.equal(retainedPredicate, undefined, "Only one Root retained-stack route predicate is expected");
      retainedPredicate = source.slice(value.start, value.end);
    }
    if (node.type === "JSXOpeningElement" && node.name?.name === "IosDetailNavigation") {
      edgeCallbacks.push(node.attributes.find(attribute => attribute.name?.name === "onBack").value.expression.name);
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(walk);
      else if (value && typeof value === "object") walk(value);
    }
  }
  walk(ast); assert.equal(predicates.length, 2); assert.equal(predicates.filter(value => value === "current").length, 1);
  const standalonePredicate = predicates.find(value => value !== "current");
  assert.ok(standalonePredicate); assert.ok(retainedPredicate); assert.ok(edgeCallbacks.length); assert.ok(edgeCallbacks.every(name => name === "back"));
  for (const name of names) assert.ok(declarations.has(name), `Missing Root callback ${name}`);
  const owner = createIOSLinkedNavigation(); const scope = owner.account("A", 1); owner.mount();
  const nav = frames?.at(-1) || { venueName: "fixture" }, stack = frames || [{}, { profileId: "fixture" }, nav], queued = [];
  // The retained wrapper receives an occurrence-owned `current`; its Root part
  // is the exact NativeDetailStack predicate. The full immutable host admission
  // is covered by retainedDetailStackIOS.test.mjs. Unretained routes still use
  // the exact singleNativeOverlay predicate, including Android's undefined one.
  const predicate = platform === "ios" && iosDetailCanRetain(nav)
    ? `() => (${retainedPredicate})(nav, stack.length - 1)` : standalonePredicate;
  let aborts = 0;
  const stackRef = { current: stack }, navigationRef = { current: { stack, tab: "feed", landing: false } };
  const bindings = {
    cancelPushNavigation: noop,
    Platform: { OS: platform }, web: false, nav, stack, linkedNavigationScope: scope, nativeAccountLinkActiveRef: { current: false },
    linkedNavigationRef: { current: owner }, navigationRef, stackRef,
    newsLinkedClaimRef: { current: null }, newsOpenRef: { current: 0 }, setNewsStoryNotice: noop,
    publicLookup: {}, publicNavigationPendingRef: { current: null }, publicRouteRequestRef: { current: null }, setPublicNavigationNotice: noop,
    authNavigationAbortRef: { current: () => { aborts++; } }, composerCloseGuardRef: { current: null },
    setStack: value => queued.push(value), setTab: noop, setLanding: noop,
  };
  const factory = new Function(...Object.keys(bindings), `${names.map(name => declarations.get(name)).join("\n")} return { back, applyNavigation, isCurrentRoute: ${predicate} };`);
  const root = factory(...Object.values(bindings));
  return { ...root, owner, queued, bindings, get aborts() { return aborts; },
    restoreFrame() { root.applyNavigation({ ...navigationRef.current, stack }); },
    freshRoute() { return factory(...Object.values({ ...bindings, linkedNavigationScope: owner.account("A", 1) })).isCurrentRoute; },
  };
}

function fixture(frames) {
  const renderer = createRenderer(), root = rootNavigationFixture("ios", frames), queue = [], pans = [], listeners = new Set(), shared = [], confirmedListeners = [];
  let hidden = false, enabled = true, reduced = false, backdrop = false, callback = root.back, presentationKey, width = 412, blocked = false, secondBlocked = false;
  const never = new Promise(() => {});
  const appListeners = new Set(), animations = [];
  const native = { AppState: { currentState: "active", addEventListener: (_event, callback) => { appListeners.add(callback); return { remove: () => appListeners.delete(callback) }; } }, View: 'View', StyleSheet: { create: x => x }, useWindowDimensions: () => ({ width }), AccessibilityInfo: {
    isScreenReaderEnabled: () => never, addEventListener: (_name, cb) => { listeners.add(cb); return { remove: () => listeners.delete(cb) }; },
  } };
  const useSharedValue = initial => {
    const value = React.useRef(null);
    if (!value.current) { value.current = { value: initial, get() { return this.value; }, set(v) { this.value = v; } }; shared.push(value.current); }
    return value.current;
  };
  const Gesture = { Pan() { const handlers = {}; pans.push(handlers); const proxy = new Proxy(handlers, { get: (o, k) => value => { o[k] = value; return proxy; } }); return proxy; } };
  let preference, blockModule;
  const imports = (name, local) => {
    if (name === 'react') return React;
    if (name === 'react/jsx-runtime') return require(name);
    if (name === 'react-native') return native;
    if (name === 'react-native-gesture-handler') return { Gesture, GestureDetector: 'GestureDetector' };
    if (name === 'react-native-reanimated') return { __esModule: true, default: { View: 'AnimatedView' }, ReduceMotion: { System: 'system' }, useSharedValue, useAnimatedStyle: cb => cb(), cancelAnimation: noop, withSpring: v => v, withTiming: (v, config, done) => { animations.push({ v, config, done }); return v; } };
    if (name === 'react-native-worklets') return { scheduleOnRN: (cb, ...args) => queue.push(() => cb(...args)) };
    if (name === './nativeFeedBackContext.mjs') return { NativeFeedBackContext: FeedBackContext };
    if (name === '../hooks/useIOSDetailBackBlock') return blockModule;
    if (name === '../hooks/useScreenReaderEnabled') return preference;
    if (name === '../hooks/useReducedMotion') return () => reduced;
    if (name === '../theme') return { colors: {} };
    assert.ok(name.startsWith('../domain/') || name === './iosAccessibilityPreference.mjs');
    return local(name);
  };
  preference = execute('../hooks/useScreenReaderEnabled.ios.js', imports);
  const subscribe = preference.subscribeConfirmedScreenReaderEnabled;
  preference.subscribeConfirmedScreenReaderEnabled = listener => { confirmedListeners.push(listener); return subscribe(listener); };
  blockModule = execute('../hooks/useIOSDetailBackBlock.ios.js', imports);
  const Detail = execute('./IosDetailNavigation.ios.jsx', imports).default;
  function Editor({ active }) { blockModule.default(active); return React.createElement('Editor'); }
  function Gate() { if (hidden) throw never; return null; }
  const f = { root, queue, pans, shared, renderer, confirmedListeners, animations,
    backdrop() { backdrop = true; f.render(); },
    app(state) { native.AppState.currentState = state; renderer.act(() => { for (const callback of appListeners) callback(state); }); },
    render() { renderer.render(React.createElement(FeedBackContext.Provider, { value: backdrop }, React.createElement(React.Suspense, { fallback: React.createElement('Fallback') }, React.createElement(Detail, { enabled, onBack: callback, isCurrentRoute: root.isCurrentRoute, presentationKey }, React.createElement('Venue'), React.createElement(Editor, { active: blocked }), React.createElement(Editor, { active: secondBlocked })), React.createElement(Gate)))); },
    reader(value) { for (const cb of [...listeners]) cb(value); },
    queueBack(pan = pans.at(-1), success = true) {
      pan.onTouchesDown({ allTouches: [{ absoluteX: 10, absoluteY: 100 }], numberOfTouches: 1 }, { fail: noop });
      pan.onEnd({ absoluteX: 150, absoluteY: 101 }, success);
    },
    hide() { hidden = true; f.render(); }, show() { hidden = false; f.render(); },
    block(value) { blocked = value; f.render(); },
    secondBlock(value) { secondBlocked = value; f.render(); },
    enable(value) { enabled = value; f.render(); },
    resize(value) { width = value; f.render(); },
    keepPresentation() { presentationKey = root.bindings.nav; f.render(); },
    replaceCallback(value) { callback = value; f.render(); },
    reduce() { reduced = true; f.render(); },
    close() { renderer.render(null); },
  };
  f.render(); renderer.act(() => f.reader(false)); return f;
}

for (const boundary of ['Root Back before cleanup', 'layout unmount', 'Suspense reconnect', 'batched reader roundtrip', 'disabled roundtrip', 'new callback', 'account']) {
  test(`queued edge Back is retired by ${boundary}`, () => {
    const f = fixture(); f.queueBack(); assert.equal(f.queue.length, 1);
    if (boundary === 'Root Back before cleanup') f.root.back();
    if (boundary === 'layout unmount') f.close();
    if (boundary === 'Suspense reconnect') { f.hide(); f.show(); }
    if (boundary === 'batched reader roundtrip') f.renderer.act(() => { f.reader(true); f.reader(false); });
    if (boundary === 'disabled roundtrip') { f.enable(false); f.enable(true); }
    if (boundary === 'new callback') f.replaceCallback(() => assert.fail('Retired callback invoked replacement'));
    if (boundary === 'account') f.root.owner.account('B', 2);
    const before = f.root.queued.length;
    f.queue.shift()(); assert.equal(f.root.queued.length, before); f.close();
  });
}
for (const boundary of ['Suspense', 'reader', 'enabled']) {
  test(`fresh edge works after ${boundary} interruption while stale worklet stays inert`, () => {
    const f = fixture(), oldPan = f.pans.at(-1);
    if (boundary === 'Suspense') { f.hide(); f.show(); }
    if (boundary === 'reader') f.renderer.act(() => { f.reader(true); f.reader(false); });
    if (boundary === 'enabled') { f.enable(false); f.enable(true); }
    // Model an old worklet reading shared values that already reflect new work.
    f.queueBack(oldPan); f.queue.shift()?.();
    assert.equal(f.root.queued.length, 0);
    f.queueBack(); f.queue.shift()(); assert.equal(f.root.queued.at(-1).length, 2); f.close();
  });
}
for (const boundary of ['route', 'account', 'reader', 'unmount']) {
  test(`delayed close guard cannot abort or pop after ${boundary}`, () => {
    const f = fixture(); let proceed;
    f.root.bindings.composerCloseGuardRef.current = guard => { proceed = guard.proceed; };
    f.queueBack(); f.queue.shift()(); assert.equal(typeof proceed, 'function');
    if (boundary === 'route') f.root.applyNavigation({ stack: [{}, { profileId: 'new' }], tab: 'feed', landing: false });
    if (boundary === 'account') f.root.owner.account('B', 2);
    if (boundary === 'reader') f.renderer.act(() => { f.reader(true); f.reader(false); });
    if (boundary === 'unmount') f.close();
    const count = f.root.queued.length, aborts = f.root.aborts;
    proceed(); assert.equal(f.root.queued.length, count); assert.equal(f.root.aborts, aborts); f.close();
  });
}
test('fresh reduced-motion edge works, canceled edge does not', () => {
  const f = fixture(); f.reduce(); f.queueBack(undefined, false); assert.equal(f.queue.length, 0);
  f.queueBack(); f.queue.shift()(); assert.equal(f.root.queued.at(-1).length, 2); f.close();
});
test('default Android/web component remains import-free passthrough', () => {
  const source = readFileSync(new URL('./IosDetailNavigation.jsx', import.meta.url), 'utf8');
  assert.equal(source, 'export default function IosDetailNavigation({ children }) { return children; }\n');
});
test('Worklets transform accepts real iOS gesture component', () => {
  const file = new URL('./IosDetailNavigation.ios.jsx', import.meta.url);
  const result = transformSync(readFileSync(file, 'utf8'), { filename: fileURLToPath(file), babelrc: false, configFile: false,
    plugins: [[require('@babel/plugin-transform-react-jsx'), { runtime: 'automatic' }], require('react-native-worklets/plugin')] });
  assert.equal(result.options.filename, fileURLToPath(file));
  assert.match(result.code, /__workletHash/);
});

test('installed Metro resolves only iOS to edge navigation and confirmed reader hook', () => {
  const { resolve } = require('metro-resolver');
  const context = {
    originModulePath: fileURLToPath(new URL('../../App.js', import.meta.url)),
    assetExts: new Set(), sourceExts: ['js', 'jsx', 'json', 'ts', 'tsx'], preferNativePlatform: true,
    mainFields: ['react-native', 'browser', 'main'], getPackageForModule: () => null,
    fileSystemLookup(path) {
      try { const stat = statSync(path); return { exists: true, type: stat.isDirectory() ? 'd' : 'f', realPath: realpathSync(path) }; }
      catch { return { exists: false }; }
    },
  };
  for (const platform of ['ios', 'android', 'web']) {
    const suffix = platform === 'ios' ? '.ios' : '';
    const component = resolve(context, './src/components/IosDetailNavigation', platform);
    assert.equal(component.filePath, fileURLToPath(new URL(`./IosDetailNavigation${suffix}.jsx`, import.meta.url)));
    const hook = resolve({ ...context, originModulePath: component.filePath }, '../hooks/useScreenReaderEnabled', platform);
    assert.equal(hook.filePath, fileURLToPath(new URL(`../hooks/useScreenReaderEnabled${suffix}.js`, import.meta.url)));
    const blocker = resolve({ ...context, originModulePath: component.filePath }, '../hooks/useIOSDetailBackBlock', platform);
    assert.equal(blocker.filePath, fileURLToPath(new URL(`../hooks/useIOSDetailBackBlock${suffix}.js`, import.meta.url)));
    if (platform !== 'ios') assert.equal(readFileSync(blocker.filePath, 'utf8'), 'export default function useIOSDetailBackBlock() {}\n');
  }
});
test('explicit iOS and Android Back retain existing close guard behavior', () => {
  for (const platform of ['ios', 'android']) {
    const root = rootNavigationFixture(platform); let proceed;
    root.bindings.composerCloseGuardRef.current = guard => { proceed = guard.proceed; };
    root.back({ nativeEvent: {} }); assert.equal(root.queued.length, 0);
    proceed(); assert.equal(root.queued.at(-1).length, 2);
  }
});
test('edge geometry, one-pointer limits and system spring remain unchanged', () => {
  const f = fixture(), pan = f.pans.at(-1);
  assert.equal(pan.maxPointers, 1); assert.equal(pan.activeOffsetX, 12); assert.deepEqual(pan.failOffsetY, [-12, 12]);
  let failures = 0; pan.onTouchesDown({ allTouches: [], numberOfTouches: 2 }, { fail() { failures++; } }); assert.equal(failures, 1);
  const nodes = node => [node, ...(node.children || []).flatMap(nodes)];
  const edge = nodes(f.renderer.container).find(node => node.props?.testID === 'ios-detail-back-edge');
  assert.deepEqual(edge.props.style, { position: 'absolute', left: 0, top: 52, bottom: 0, width: 20 });
  pan.onUpdate({ absoluteX: 150 }); pan.onFinalize(); assert.equal(f.shared[2].get(), 0); f.close();
});

test('retired UI callbacks cannot mutate a successor origin or reset its drag', () => {
  const f = fixture(), old = f.pans.at(-1); f.hide(); f.show();
  const current = f.pans.at(-1), manager = { fail: noop };
  current.onTouchesDown({ allTouches: [{ absoluteX: 19, absoluteY: 100 }], numberOfTouches: 1 }, manager);
  current.onUpdate({ absoluteX: 119 }); const before = f.shared.map(value => value.get());
  old.onFinalize(); old.onUpdate({ absoluteX: 200 });
  old.onTouchesDown({ allTouches: [{ absoluteX: 1, absoluteY: 100 }], numberOfTouches: 1 }, manager);
  old.onEnd({ absoluteX: 200, absoluteY: 100 }, true);
  assert.deepEqual(f.shared.map(value => value.get()), before);
  current.onEnd({ absoluteX: 119, absoluteY: 101 }, true); assert.equal(f.queue.length, 0);
  f.queueBack(); assert.equal(f.queue.length, 1); f.queue.shift()(); assert.equal(f.root.queued.at(-1).length, 2); f.close();
});

test('same Root presentation rerender preserves an in-progress edge', () => {
  const f = fixture(); f.keepPresentation(); const pan = f.pans.at(-1);
  pan.onTouchesDown({ allTouches: [{ absoluteX: 10, absoluteY: 100 }], numberOfTouches: 1 }, { fail: noop });
  f.replaceCallback((...args) => f.root.back(...args));
  pan.onEnd({ absoluteX: 150, absoluteY: 101 }, true); assert.equal(f.queue.length, 1);
  f.queue.shift()(); assert.equal(f.root.queued.at(-1).length, 2); f.close();
});

test('retired confirmed-reader listener cannot revoke its successor presentation', () => {
  const f = fixture(), retired = f.confirmedListeners.at(-1); f.hide(); f.show();
  const current = f.pans.at(-1), before = f.shared.map(value => value.get());
  f.renderer.act(retired); assert.deepEqual(f.shared.map(value => value.get()), before);
  f.queueBack(current); f.queue.shift()(); assert.equal(f.root.queued.at(-1).length, 2); f.close();
  f.renderer.act(retired);
});

test('geometry changes retire old handlers and queued Back without poisoning the fresh gesture', () => {
  const f = fixture(), old = f.pans.at(-1); f.queueBack(old); f.resize(600);
  f.queue.shift()(); assert.equal(f.root.queued.length, 0);
  const current = f.pans.at(-1); current.onTouchesDown({ allTouches: [{ absoluteX: 19, absoluteY: 100 }], numberOfTouches: 1 }, { fail: noop });
  const before = f.shared.map(value => value.get()); f.queueBack(old); old.onFinalize();
  assert.deepEqual(f.shared.map(value => value.get()), before); assert.equal(f.queue.length, 0);
  current.onEnd({ absoluteX: 170, absoluteY: 101 }, true); f.queue.shift()(); assert.equal(f.root.queued.at(-1).length, 2); f.close();
});

test('second pointer cancellation returns the current drag home without navigating', () => {
  const f = fixture(), pan = f.pans.at(-1); let failures = 0;
  pan.onTouchesDown({ allTouches: [{ absoluteX: 10, absoluteY: 100 }], numberOfTouches: 1 }, { fail: noop });
  pan.onUpdate({ absoluteX: 110 }); assert.equal(f.shared[2].get(), 100);
  pan.onTouchesDown({ allTouches: [{ absoluteX: 10, absoluteY: 100 }], numberOfTouches: 2 }, { fail() { failures++; } });
  pan.onEnd({ absoluteX: 150, absoluteY: 101 }, false); pan.onFinalize();
  assert.equal(failures, 1); assert.equal(f.shared[2].get(), 0); assert.equal(f.queue.length, 0); f.close();
});

for (const key of ['profileId', 'artistName', 'venueName', 'openLog', 'post', 'followList']) {
  test(`edge Back on ${key} pops exactly the real previous frame`, () => {
    const previous = { cityGuide: 'London', retainedContext: 'fixture' };
    const frames = [{}, previous, { [key]: 'detail' }];
    const f = fixture(frames); f.queueBack(); f.queue.shift()();
    assert.deepEqual(f.root.queued.at(-1), frames.slice(0, -1));
    assert.equal(f.root.queued.at(-1).at(-1), previous);
    f.close();
  });
}
test('inline editor immediately retires queued Back; closing enables a fresh gesture only', () => {
  const f = fixture(), old = f.pans.at(-1); f.queueBack(old);
  f.block(true); assert.equal(f.pans.at(-1).enabled, false);
  f.queue.shift()(); assert.equal(f.root.queued.length, 0);
  f.block(false); f.queueBack(old); assert.equal(f.queue.length, 0);
  f.queueBack(); f.queue.shift()(); assert.equal(f.root.queued.at(-1).length, 2); f.close();
});
test('two nested editor blockers must both close before Back is renewed', () => {
  const f = fixture(); f.block(true); f.secondBlock(true); f.block(false);
  assert.equal(f.pans.at(-1).enabled, false);
  f.secondBlock(false); assert.equal(f.pans.at(-1).enabled, true);
  f.queueBack(); f.queue.shift()(); assert.equal(f.root.queued.at(-1).length, 2); f.close();
});
test('inline editor opening revokes delayed Root close guard', () => {
  const f = fixture(); let proceed;
  f.root.bindings.composerCloseGuardRef.current = guard => { proceed = guard.proceed; };
  f.queueBack(); f.queue.shift()(); f.block(true); f.block(false);
  const aborts = f.root.aborts; proceed();
  assert.equal(f.root.queued.length, 0); assert.equal(f.root.aborts, aborts); f.close();
});
test('Post edge Back preserves Root-owned comment text, reply and pending delivery', () => {
  const drafts = createIOSCommentDrafts(); drafts.account('A', 1);
  const lease = drafts.lease('post'); lease.edit('A retained comment'); lease.reply('parent');
  const claim = lease.claim(true);
  const f = fixture([{}, { openLog: 'show' }, { post: { id: 'post' } }]);
  f.queueBack(); f.queue.shift()(); assert.equal(f.root.queued.at(-1).at(-1).openLog, 'show');
  assert.equal(drafts.lease('post'), lease); assert.equal(lease.read().text, 'A retained comment');
  assert.equal(lease.read().parentId, 'parent'); assert.equal(lease.read().sending, true);
  lease.settle(claim, { ok: false }); assert.equal(lease.read().retry, true); f.close();
});

test('inline editor remains blocked through Suspense reconnect and reader interruption', () => {
  const f = fixture(); f.block(true); f.hide(); f.show();
  f.renderer.act(() => { f.reader(true); f.reader(false); });
  assert.equal(f.pans.at(-1).enabled, false);
  f.block(false); f.queueBack(); f.queue.shift()(); assert.equal(f.root.queued.at(-1).length, 2); f.close();
});
for (const [file, keys, context] of [
  ['ArtistScreen.ios.jsx', ['reportingSong', 'reportingBusy'], {}],
  ['ShowScreen.ios.jsx', ['goingTicketPrompt', 'goingBusy'], { sourceRevoked: false }],
]) {
  test(`actual ${file} inline draft/busy expressions revoke queued Back`, () => {
    const source = readFileSync(new URL(`../screens/${file}`, import.meta.url), 'utf8');
    const ast = parse(source, { sourceType: 'module', plugins: ['jsx'] });
    const calls = [];
    function walk(node) {
      if (!node || typeof node !== 'object') return;
      if (node.type === 'CallExpression' && node.callee.name === 'useIOSDetailBackBlock') calls.push(node.arguments[0]);
      for (const value of Object.values(node)) {
        if (Array.isArray(value)) value.forEach(walk);
        else if (value && typeof value === 'object') walk(value);
      }
    }
    walk(ast); assert.equal(calls.length, 1);
    const expression = new Function(...Object.keys(context), ...keys, `return ${source.slice(calls[0].start, calls[0].end)};`);
    const predicate = (...values) => expression(...Object.values(context), ...values);
    assert.equal(predicate(...keys.map(() => false)), false);
    for (const key of keys) {
      const f = fixture(); f.queueBack(); f.block(predicate(...keys.map(candidate => candidate === key)));
      f.queue.shift()(); assert.equal(f.root.queued.length, 0, key); f.close();
    }
  });
}

test('Artist report Cancel restores edge even when the canceled local input remains', () => {
  const source = readFileSync(new URL('../screens/ArtistScreen.ios.jsx', import.meta.url), 'utf8');
  const ast = parse(source, { sourceType: 'module', plugins: ['jsx'] });
  let cancelSource, predicateSource;
  function walk(node) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'CallExpression' && node.callee.name === 'useIOSDetailBackBlock') predicateSource = source.slice(node.arguments[0].start, node.arguments[0].end);
    if (node.type === 'JSXElement' && node.openingElement.name.name === 'Pressable' && source.slice(node.start, node.end).includes('Cancel</Text>')) {
      const onPress = node.openingElement.attributes.find(a => a.name?.name === 'onPress');
      if (onPress && source.slice(onPress.start, onPress.end).includes('setReportingSong(null)')) cancelSource = source.slice(onPress.value.expression.start, onPress.value.expression.end);
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(walk);
      else if (value && typeof value === 'object') walk(value);
    }
  }
  walk(ast); assert.ok(cancelSource); assert.ok(predicateSource);
  let song = { key: 'song' };
  const ordinary = require('../hooks/useIOSDetailPresentation.js').default();
  const cancel = new Function('setReportingSong', 'guard', `return ${cancelSource};`)(value => { song = value; }, ordinary.guard);
  const blocked = new Function('reportingSong', 'reportingBusy', 'reportUrl', 'reportNote', `return ${predicateSource};`);
  const f = fixture(); f.block(blocked(song, false, 'typed URL', 'typed note'));
  assert.equal(f.pans.at(-1).enabled, false);
  cancel(); f.block(blocked(song, false, 'typed URL', 'typed note'));
  assert.equal(f.pans.at(-1).enabled, true); f.queueBack(); f.queue.shift()();
  assert.equal(f.root.queued.at(-1).length, 2); f.close();
});


test('real retained backdrop enables full-width motion and settles before Root Back', () => {
  const f = fixture(); f.backdrop(); const pan = f.pans.at(-1);
  pan.onTouchesDown({ allTouches: [{ absoluteX: 10, absoluteY: 100 }], numberOfTouches: 1 }, { fail: noop });
  pan.onUpdate({ absoluteX: 330 }); assert.equal(f.shared[2].get(), 320);
  pan.onEnd({ absoluteX: 330, absoluteY: 101, velocityX: 200 }, true);
  pan.onFinalize();
  assert.equal(f.animations.length, 1); assert.equal(f.animations[0].v, 412);
  assert.equal(f.shared[2].get(), 412); assert.equal(f.queue.length, 0);
  f.animations[0].done(true); assert.equal(f.queue.length, 1);
  f.queue.shift()(); assert.equal(f.root.queued.at(-1).length, 2); f.close();
});

for (const release of [{ canceled: true }, { velocityX: -100 }, { absoluteX: 60 }]) {
  test(`retained backdrop cancels without navigating: ${JSON.stringify(release)}`, () => {
    const f = fixture(); f.backdrop(); const pan = f.pans.at(-1);
    pan.onTouchesDown({ allTouches: [{ absoluteX: 10, absoluteY: 100 }], numberOfTouches: 1 }, { fail: noop });
    pan.onUpdate({ absoluteX: 250 });
    pan.onEnd({ absoluteX: 250, absoluteY: 101, velocityX: 0, ...release }, !release.canceled);
    pan.onFinalize(); assert.equal(f.shared[2].get(), 0);
    assert.equal(f.animations.length, 0); assert.equal(f.queue.length, 0); f.close();
  });
}
for (const boundary of ['background', 'reader', 'resize', 'inline editor', 'unmount']) {
  test(`retained settle cannot pop after ${boundary}`, () => {
    const f = fixture(); f.backdrop(); f.queueBack(); assert.equal(f.animations.length, 1);
    if (boundary === 'background') { f.app('inactive'); f.app('active'); }
    else if (boundary === 'reader') f.renderer.act(() => { f.reader(true); f.reader(false); });
    else if (boundary === 'resize') f.resize(600);
    else if (boundary === 'inline editor') f.block(true);
    else f.close();
    f.animations[0].done(true); f.queue.splice(0).forEach(callback => callback());
    assert.equal(f.root.queued.length, 0); f.close();
  });
}
test('background interrupts queued non-reveal Back before RN dispatch', () => {
  const f = fixture(); f.queueBack(); f.app('background'); f.app('active');
  f.queue.shift()(); assert.equal(f.root.queued.length, 0);
  f.queueBack(); f.queue.shift()(); assert.equal(f.root.queued.at(-1).length, 2); f.close();
});
test('retained reduced-motion Back does not translate or wait for settlement', () => {
  const f = fixture(); f.backdrop(); f.reduce(); f.queueBack();
  assert.equal(f.animations.length, 0); assert.equal(f.queue.length, 1);
  f.queue.shift()(); assert.equal(f.root.queued.at(-1).length, 2); f.close();
});
test('a new deliberate Back retires an older deferred close guard', () => {
  const f = fixture(); const guards = [];
  f.root.bindings.composerCloseGuardRef.current = guard => guards.push(guard);
  f.queueBack(); f.queue.shift()(); assert.equal(guards.length, 1);
  f.queueBack(); f.queue.shift()(); assert.equal(guards.length, 2);
  guards[0].proceed(); assert.equal(f.root.queued.length, 0);
  guards[1].proceed(); assert.equal(f.root.queued.at(-1).length, 2); f.close();
});

test('Suspense reconnect reads current OS state instead of a missed AppState event', () => {
  const f = fixture(); f.hide(); f.app('inactive'); f.show();
  assert.equal(f.pans.at(-1).enabled, false);
  f.app('active'); f.queueBack(); f.queue.shift()(); assert.equal(f.root.queued.at(-1).length, 2); f.close();
});
