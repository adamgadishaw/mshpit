import assert from "node:assert/strict";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import test from "node:test";
import { createIOSAccessibilityPreference } from "../hooks/iosAccessibilityPreference.mjs";

const require = createRequire(import.meta.url);
const React = require("react");
const reconciler = require("react-reconciler");
const { transformSync } = require("@babel/core");
const { parse } = require("@babel/parser");
const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
const app = read("../../App.js");
const hostSource = read("./FeedbackHost.ios.jsx");
function compile(source) {
  return transformSync(source, { babelrc: false, configFile: false, plugins: [
    [require("@babel/plugin-transform-react-jsx"), { runtime: "automatic" }],
    require("@babel/plugin-transform-modules-commonjs"),
  ] }).code;
}
function execute(source, dependencies, timers = {}) {
  const module = { exports: {} };
  new Function("require", "module", "exports", "setTimeout", "clearTimeout", compile(source))(
    name => Object.hasOwn(dependencies, name) ? dependencies[name] : require(name),
    module, module.exports, timers.setTimeout || setTimeout, timers.clearTimeout || clearTimeout,
  );
  return module.exports;
}
function visit(node, callback) {
  if (!node || typeof node !== "object") return;
  callback(node);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach(child => visit(child, callback));
    else if (value && typeof value === "object") visit(value, callback);
  }
}
const ast = parse(app, { sourceType: "module", plugins: ["jsx"] });
let feedbackNode;
visit(ast, node => { if (node.type === "JSXElement" && node.openingElement.name.name === "FeedbackHost") feedbackNode = node; });
assert.ok(feedbackNode, "test the actual FeedbackHost element from Root, not copied ownership logic");
const rootSource = `export default function RootFeedback({ Platform, session, chatAuthEpoch, canViewDiagnostics, go, FeedbackHost }) {
  return (${app.slice(feedbackNode.start, feedbackNode.end)});
}`;
const RootFeedback = execute(rootSource, {}).default;
const noop = () => {};
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
    commitUpdate: (node, type, oldProps, newProps) => { node.props = newProps; },
    commitTextUpdate: (node, oldText, text) => { node.text = text; },
    clearContainer: node => { node.children = []; }, resetTextContent: noop, commitMount: noop,
    scheduleTimeout: setTimeout, cancelTimeout: clearTimeout, noTimeout: -1,
    supportsMicrotasks: true, scheduleMicrotask: queueMicrotask,
    getCurrentUpdatePriority: () => priority, setCurrentUpdatePriority: value => { priority = value; },
    resolveUpdatePriority: () => priority || 32, shouldAttemptEagerTransition: () => false,
    hideInstance: node => { node.hidden = true; }, unhideInstance: node => { node.hidden = false; },
    hideTextInstance: node => { node.hidden = true; }, unhideTextInstance: node => { node.hidden = false; },
    detachDeletedInstance: noop, maySuspendCommit: () => false, preloadInstance: () => true,
    startSuspendingCommit: noop, suspendInstance: noop, waitForCommitToBeReady: () => null,
    NotPendingTransition: null, HostTransitionContext: React.createContext(null), resetFormInstance: noop,
    bindToConsole: (method, args) => console[method].bind(console, ...args),
  });
  const fail = error => { throw error; };
  const root = renderer.createContainer(container, 1, null, false, null, "", fail, fail, fail, null);
  const flush = () => { for (let i = 0; i < 5; i++) { renderer.flushSyncWork(); if (!renderer.flushPassiveEffects()) break; } };
  return {
    container,
    render(element) { renderer.updateContainerSync(element, root, null, null); flush(); },
    act(callback) { renderer.flushSyncFromReconciler(callback); flush(); },
  };
}
const nodes = node => node.hidden ? [] : [node, ...(node.children || []).flatMap(nodes)];
const flatten = value => Array.isArray(value) ? Object.assign({}, ...value.map(flatten)) : value || {};
const entry = (id = "one") => ({ id, severity: "error", title: `Safe title ${id}`, message: `Safe message ${id}`, code: "PIT-NET-001", meta: { requestId: `request-${id}` } });

// Real React, production host/hook, production diagnostics bus with memory-only
// persistence, and actual Root FeedbackHost JSX. Native events/layout are seams;
// this is not a claim about VoiceOver speech or physical-device Yoga geometry.
function fixture({ platform = "ios", strict = false, staff = false } = {}) {
  const renderer = createRenderer(), timers = [], feedbackSubscriptions = [], nativeSubscriptions = [], queries = [], speech = [], visits = [];
  const diagnostics = execute(read("../lib/diagnostics.js"), {
    "./persist": { load: (_key, initial) => initial, remove: noop, save: noop, setPersistErrorHandler: noop },
    "./errorCatalog.mjs": require("../lib/errorCatalog.mjs"),
    "../domain/accountLocalPrivacy.mjs": require("../domain/accountLocalPrivacy.mjs"),
    "../domain/deviceStoragePolicy.mjs": require("../domain/deviceStoragePolicy.mjs"),
  });
  const subscribeFeedback = callback => {
    const record = { callback, active: true }; feedbackSubscriptions.push(record);
    const unsubscribe = diagnostics.subscribeFeedback(callback);
    return () => { record.active = false; unsubscribe(); };
  };
  const native = {
    Platform: { OS: platform }, View: "View", Text: "Text", Pressable: "Pressable", StyleSheet: { create: value => value },
    AccessibilityInfo: {
      isScreenReaderEnabled: () => new Promise((resolve, reject) => queries.push({ resolve, reject })),
      addEventListener(name, callback) {
        assert.equal(name, "screenReaderChanged"); const record = { callback, active: true }; nativeSubscriptions.push(record);
        return { remove: () => { record.active = false; } };
      },
      announceForAccessibility: value => speech.push(value), announceForAccessibilityWithOptions: value => speech.push(value),
    },
  };
  const Hook = execute(read("../hooks/useScreenReaderEnabled.ios.js"), {
    react: React, "react-native": native, "./iosAccessibilityPreference.mjs": { createIOSAccessibilityPreference },
  }).default;
  const Host = execute(platform === "ios" ? hostSource : read("./FeedbackHost.jsx"), {
    react: React, "react-native": native, "../theme": { colors: {}, radius: {}, mono: "mono", focusRing: { outline: "focus" } },
    "../lib/diagnostics": { ...diagnostics, subscribeFeedback }, "./Icon": "Icon", "../hooks/useScreenReaderEnabled": Hook,
  }, {
    setTimeout(callback, delay) { const timer = { callback, delay, active: true }; timers.push(timer); return timer; },
    clearTimeout(timer) { timer.active = false; },
  }).default;
  const suspended = new Promise(noop);
  function Gate(props) {
    if (props.suspended) throw suspended;
    return React.createElement(RootFeedback, props);
  }
  let props = { Platform: native.Platform, session: { id: "A" }, chatAuthEpoch: 1, canViewDiagnostics: staff, go: route => visits.push(route), FeedbackHost: Host };
  const f = {
    timers, feedbackSubscriptions, nativeSubscriptions, queries, speech, visits, diagnostics,
    nodes: () => nodes(renderer.container),
    texts: () => f.nodes().filter(node => node.type === "Text").map(node => node.props.children),
    button: label => f.nodes().find(node => node.type === "Pressable" && node.props.accessibilityLabel === label)?.props,
    visible: () => f.nodes().some(node => node.type === "View" && node.props.accessibilityRole === "alert"),
    act: callback => renderer.act(callback),
    render(update = {}) { props = { ...props, ...update }; renderer.render(React.createElement(strict ? React.StrictMode : React.Fragment, null, React.createElement(React.Suspense, { fallback: null }, React.createElement(Gate, props)))); },
    emit(value) { f.act(() => { for (const item of feedbackSubscriptions.filter(item => item.active)) item.callback(value); }); },
    reader(value) { f.act(() => { for (const item of nativeSubscriptions.filter(item => item.active)) item.callback(value); }); },
    async settle() { for (let i = 0; i < 5; i++) await Promise.resolve(); f.act(noop); },
    close: () => renderer.render(null),
  };
  f.render(); return f;
}

test("iOS replaces entries and fences captured canceled timers and stale controls", async t => {
  const f = fixture({ staff: true }); t.after(f.close); f.reader(false); f.emit(entry("one"));
  const timer = f.timers.at(-1), dismiss = f.button("Dismiss message").onPress, details = f.button("View diagnostics for PIT-NET-001").onPress;
  f.emit(entry("two")); assert.equal(timer.active, false);
  f.act(() => { timer.callback(); dismiss(); details(); });
  assert.ok(f.texts().includes("Safe title two")); assert.equal(f.visits.length, 0);
  assert.equal(f.timers.at(-1).delay, 7000); f.act(f.timers.at(-1).callback); assert.equal(f.visible(), false);
});

test("same-tick replacement fences old callbacks before React commits the replacement", t => {
  const f = fixture({ staff: true }); t.after(f.close); f.reader(false); f.emit(entry("old"));
  const oldTimer = f.timers.at(-1), dismiss = f.button("Dismiss message").onPress, details = f.button("View diagnostics for PIT-NET-001").onPress;
  f.act(() => { f.feedbackSubscriptions.at(-1).callback(entry("new")); oldTimer.callback(); dismiss(); details(); });
  assert.ok(f.texts().includes("Safe title new")); assert.equal(f.visits.length, 0);
});

test("retained current controls execute only once and Details uses the latest committed callback", t => {
  const f = fixture({ staff: true }); t.after(f.close); f.emit(entry());
  const open = f.button("View diagnostics for PIT-NET-001").onPress, calls = [];
  f.render({ go: route => calls.push(route) }); f.act(() => { open(); open(); });
  assert.equal(f.visits.length, 0); assert.deepEqual(calls, [{ diagnostics: true }]); assert.equal(f.visible(), false);
  f.emit(entry("next")); const dismiss = f.button("Dismiss message").onPress; f.act(() => { dismiss(); dismiss(); }); assert.equal(f.visible(), false);
});

test("role revocation removes diagnostic details and blocks a captured privileged callback", t => {
  const f = fixture({ staff: true }); t.after(f.close); f.emit(entry());
  const open = f.button("View diagnostics for PIT-NET-001").onPress;
  f.render({ canViewDiagnostics: false }); f.act(open);
  assert.equal(f.visits.length, 0); assert.equal(f.visible(), true); assert.equal(f.button("View diagnostics for PIT-NET-001"), undefined);
  assert.ok(!f.texts().includes("PIT-NET-001")); assert.ok(f.nodes().some(node => node.props?.accessibilityLabel === "Support reference request-one"));
});

for (const transitions of [
  [{ session: { id: "B" } }, { session: { id: "A" } }],
  [{ chatAuthEpoch: 2 }, { chatAuthEpoch: 3 }],
  [{ session: null, chatAuthEpoch: 2 }, { session: { id: "A" }, chatAuthEpoch: 3 }],
]) test(`Root lifetime fences account/reauth sequence ${JSON.stringify(transitions)}`, t => {
  const f = fixture({ staff: true }); t.after(f.close); f.reader(false); f.emit(entry("old"));
  const oldSubscriber = f.feedbackSubscriptions.at(-1), oldTimer = f.timers.at(-1), oldDismiss = f.button("Dismiss message").onPress, oldDetails = f.button("View diagnostics for PIT-NET-001").onPress;
  for (const update of transitions) { f.render(update); assert.equal(f.visible(), false); f.emit(entry("intermediate")); }
  f.emit(entry("latest"));
  f.act(() => { oldSubscriber.callback(entry("leak")); oldTimer.callback(); oldDismiss(); oldDetails(); });
  assert.equal(oldSubscriber.active, false); assert.equal(oldTimer.active, false); assert.equal(f.visits.length, 0);
  assert.ok(f.texts().includes("Safe title latest")); assert.equal(f.feedbackSubscriptions.filter(item => item.active).length, 1);
});

test("StrictMode replays subscriptions safely and unmount rejects retained listeners, controls and timers", async t => {
  const f = fixture({ strict: true, staff: true }); t.after(f.close); await f.settle();
  assert.ok(f.feedbackSubscriptions.length >= 2); assert.equal(f.feedbackSubscriptions.filter(item => item.active).length, 1);
  assert.equal(f.nativeSubscriptions.filter(item => item.active).length, 1);
  f.reader(false); f.emit(entry("current"));
  f.act(() => f.feedbackSubscriptions[0].callback(entry("strict-stale"))); assert.ok(f.texts().includes("Safe title current"));
  const dismiss = f.button("Dismiss message").onPress, details = f.button("View diagnostics for PIT-NET-001").onPress;
  f.close(); f.act(() => { for (const timer of f.timers) timer.callback(); for (const item of f.feedbackSubscriptions) item.callback(entry("late")); dismiss(); details(); });
  assert.equal(f.feedbackSubscriptions.filter(item => item.active).length, 0); assert.equal(f.nativeSubscriptions.filter(item => item.active).length, 0);
  assert.equal(f.visible(), false); assert.equal(f.visits.length, 0);
});

test("VoiceOver keeps feedback readable; disable starts a fresh timer and canceled old timers remain inert", t => {
  const f = fixture(); t.after(f.close); f.emit(entry()); assert.equal(f.timers.length, 0, "unknown preference is conservative");
  f.reader(false); const first = f.timers.at(-1); f.reader(true); assert.equal(first.active, false);
  f.act(first.callback); assert.equal(f.visible(), true);
  f.reader(false); const second = f.timers.at(-1); assert.notEqual(second, first); assert.equal(second.delay, 7000);
  f.act(first.callback); assert.equal(f.visible(), true); f.reader(true); f.emit(entry("replacement"));
  f.act(second.callback); assert.ok(f.texts().includes("Safe title replacement"));
  f.reader(false); f.act(f.timers.at(-1).callback); assert.equal(f.visible(), false); assert.deepEqual(f.speech, []);
});

for (const reject of [false, true]) test(`initial reader query cannot override a newer same-value true event (${reject ? "rejection" : "stale false"})`, async t => {
  const f = fixture(); t.after(f.close); await f.settle(); f.emit(entry()); f.reader(true);
  if (reject) f.queries[0].reject(new Error("unavailable")); else f.queries[0].resolve(false);
  await f.settle(); assert.equal(f.timers.length, 0); assert.equal(f.visible(), true); assert.deepEqual(f.speech, []);
});

test("initial false query enables expiry, and retired query/events cannot change a remounted host", async t => {
  const f = fixture(); t.after(f.close); await f.settle(); f.emit(entry());
  f.queries[0].resolve(false); await f.settle(); assert.equal(f.timers.length, 1);
  const staleNative = f.nativeSubscriptions[0]; f.render({ chatAuthEpoch: 2 }); await f.settle(); f.emit(entry("new"));
  f.act(() => staleNative.callback(false)); assert.equal(f.timers.filter(timer => timer.active).length, 0);
  f.queries.at(-1).resolve(true); await f.settle(); assert.ok(f.texts().includes("Safe title new"));
});

test("actual diagnostics delivers safe catalog copy and sanitized support references without global speech", t => {
  const f = fixture(); t.after(f.close);
  f.act(() => f.diagnostics.captureAppError(new Error("RAW PRIVATE BACKEND MESSAGE"), { code: "PIT-NET-001", toast: true, source: "feedback-fixture", requestId: "ref <unsafe>" }));
  assert.equal(f.visible(), true); assert.ok(!f.texts().includes("RAW PRIVATE BACKEND MESSAGE"));
  assert.ok(f.nodes().some(node => node.props?.accessibilityLabel === "Support reference refunsafe"));
  assert.equal(f.button("View diagnostics for PIT-NET-001"), undefined); assert.deepEqual(f.speech, []);
});

test("title and details can wrap with separate accessible 44-point controls", t => {
  const f = fixture({ staff: true }); t.after(f.close); const long = entry("long"); long.title = "A long title with enough words to wrap at larger text sizes"; f.emit(long);
  const title = f.nodes().find(node => node.type === "Text" && node.props.children === long.title);
  assert.equal(title.props.numberOfLines, undefined); assert.equal(title.props.allowFontScaling, undefined); assert.equal(title.props.maxFontSizeMultiplier, undefined);
  assert.equal(flatten(title.props.style).alignSelf, "stretch");
  const card = f.nodes().find(node => node.props?.accessibilityRole === "alert"); assert.notEqual(card.props.accessible, true);
  assert.equal(card.props.accessibilityElementsHidden, undefined); assert.equal(card.props.accessibilityLiveRegion, "assertive");
  for (const label of ["Dismiss message", "View diagnostics for PIT-NET-001"]) {
    const button = f.button(label), style = flatten(button.style({ focused: false, pressed: false }));
    assert.equal(button.accessibilityRole, "button"); assert.ok((style.minHeight || style.height) >= 44); assert.ok((style.minWidth || style.width) >= 44);
  }
  const details = f.button("View diagnostics for PIT-NET-001"); assert.equal(flatten(details.style({})).maxWidth, "100%");
  f.emit({ ...long, severity: "info" }); assert.equal(f.nodes().find(node => node.props?.accessibilityRole === "alert").props.accessibilityLiveRegion, "polite");
});

for (const platform of ["android", "web"]) test(`${platform} keeps the default host, Root identity, timeout and title behavior`, t => {
  const f = fixture({ platform }); t.after(f.close); f.emit(entry());
  const subscription = f.feedbackSubscriptions.at(-1), timer = f.timers.at(-1);
  f.render({ session: { id: "B" }, chatAuthEpoch: 2 }); assert.equal(f.feedbackSubscriptions.at(-1), subscription); assert.equal(f.visible(), true);
  assert.equal(f.nativeSubscriptions.length, 0); assert.equal(timer.delay, 7000);
  assert.equal(f.nodes().find(node => node.type === "Text" && node.props.children === "Safe title one").props.numberOfLines, 1);
  f.act(timer.callback); assert.equal(f.visible(), false);
});

test("platform-resolved import leaves iOS lifetime implementation out of the default host", () => {
  assert.match(app, /import FeedbackHost from "\.\/src\/components\/FeedbackHost"/);
  assert.doesNotMatch(read("./FeedbackHost.jsx"), /useScreenReaderEnabled|useLayoutEffect|lifetime/);
  assert.doesNotMatch(hostSource, /announceForAccessibility|captureAppError|configureDiagnosticsIdentity/);
});


test("an effect reconnect with visible notice state retires that notice rather than restoring inert controls", t => {
  const f = fixture({ staff: true }); t.after(f.close); f.reader(false); f.emit(entry("before-suspend"));
  const oldSubscriber = f.feedbackSubscriptions.at(-1), oldTimer = f.timers.at(-1), oldDetails = f.button("View diagnostics for PIT-NET-001").onPress;
  assert.equal(f.visible(), true);
  f.render({ suspended: true }); assert.equal(oldSubscriber.active, false); assert.equal(f.visible(), false);
  f.render({ suspended: false }); assert.equal(f.visible(), false, "state retained by Suspense must not revive a retired notice");
  f.emit(entry("after-resume"));
  f.act(() => { oldSubscriber.callback(entry("stale-subscription")); oldTimer.callback(); oldDetails(); });
  assert.ok(f.texts().includes("Safe title after-resume")); assert.equal(f.visits.length, 0);
  assert.equal(f.feedbackSubscriptions.filter(item => item.active).length, 1);
  f.act(f.button("Dismiss message").onPress); assert.equal(f.visible(), false);
});

test("re-delivering the exact same entry creates a fresh presentation with independently fenced controls", t => {
  const f = fixture(); t.after(f.close); f.reader(false); const sameEntry = entry(); f.emit(sameEntry);
  const oldDismiss = f.button("Dismiss message").onPress, oldTimer = f.timers.at(-1);
  f.emit(sameEntry); f.act(() => { oldDismiss(); oldTimer.callback(); }); assert.equal(f.visible(), true);
  f.act(f.button("Dismiss message").onPress); assert.equal(f.visible(), false);
});


test("installed Metro resolves only iOS to the lifetime host and accessibility hook", () => {
  const { resolve } = require("metro-resolver");
  const context = {
    originModulePath: fileURLToPath(new URL("../../App.js", import.meta.url)),
    assetExts: new Set(), sourceExts: ["js", "jsx", "json", "ts", "tsx"], preferNativePlatform: true,
    mainFields: ["react-native", "browser", "main"], getPackageForModule: () => null,
    fileSystemLookup(path) {
      try { const stat = statSync(path); return { exists: true, type: stat.isDirectory() ? "d" : "f", realPath: realpathSync(path) }; }
      catch { return { exists: false }; }
    },
  };
  for (const platform of ["ios", "android", "web"]) {
    const suffix = platform === "ios" ? ".ios" : "";
    const host = resolve(context, "./src/components/FeedbackHost", platform);
    assert.equal(host.filePath, fileURLToPath(new URL(`./FeedbackHost${suffix}.jsx`, import.meta.url)));
    const hook = resolve({ ...context, originModulePath: host.filePath }, "../hooks/useScreenReaderEnabled", platform);
    assert.equal(hook.filePath, fileURLToPath(new URL(`../hooks/useScreenReaderEnabled${suffix}.js`, import.meta.url)));
  }
});
