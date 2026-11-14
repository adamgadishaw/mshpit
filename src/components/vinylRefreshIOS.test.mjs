import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { createPageReturnController, assignScrollRef, scrollPageToTop } from "../domain/pageReturn.mjs";
const require = createRequire(import.meta.url), React = require("react"), reconciler = require("react-reconciler");
const { transformSync } = require("@babel/core");
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
  return { container, render(element) { renderer.updateContainerSync(element, root, null, null); flush(); },
    act(callback) { renderer.flushSyncFromReconciler(callback); flush(); } };
}

const nodes = node => [node, ...(node.children || []).flatMap(nodes)];
const source = new URL("./VinylRefreshBoundary.ios.jsx", import.meta.url);
const code = transformSync(readFileSync(source, "utf8"), { filename: source.pathname, babelrc: false, configFile: false,
  plugins: [[require("@babel/plugin-transform-react-jsx"), { runtime: "automatic" }], require("@babel/plugin-transform-modules-commonjs")] }).code;
function fixture() {
  const pageController = createPageReturnController();
  pageController.activate("native");
  const page = { register: (handler, refreshes) => pageController.register("native", handler, refreshes) };
  let now = 0, nextTimer = 0;
  const timers = new Map(), chromeContext = React.createContext(null);
  const schedule = (callback, delay) => { const id = ++nextTimer; timers.set(id, { callback, at: now + delay }); return id; };
  const renderer = createRenderer(), animations = [], values = [], scrolls = [], calls = [];
  let reduced = false, active = true, preview = false, props = {}, chrome = null;
  let presentation = { active: true, current: () => true, canAct: () => true, guard: callback => callback, token: null, commandToken: null };
  class Value { constructor(value) { this.value = value; values.push(this); } setValue(value) { this.value = value; } interpolate(config) { return { value: this, config }; } }
  const animation = (kind, config) => { const item = { kind, config, started: false, stopped: false, start() { this.started = true; }, stop() { this.stopped = true; } }; animations.push(item); return item; };
  const native = { View: "View", RefreshControl: "RefreshControl", Easing: { linear: "linear" }, StyleSheet: { create: x => x },
    Animated: { Value, View: "AnimatedView", timing: (value, config) => animation("timing", config), loop: config => animation("loop", config), sequence: config => animation("sequence", config) } };
  const module = { exports: {} };
  new Function("require", "module", "exports", "setTimeout", "clearTimeout", "Date", code)(name => name === "react" || name === "react/jsx-runtime" ? require(name)
    : name === "react-native" ? native : name.endsWith("/theme") ? { colors: {} }
    : name.endsWith("/PageReturnContext") ? { usePageReturn: () => page }
    : name.endsWith("/pageReturn.mjs") ? { assignScrollRef, scrollPageToTop }
    : name.endsWith("/NativeScrollChrome.ios") ? { NativeScrollChromeContext: chromeContext }
    : name.endsWith("/useIOSDetailPresentation") ? () => presentation
    : name.endsWith("/useNativeTabPreview") ? () => preview
    : name.endsWith("/useReducedMotion") ? () => reduced : name.endsWith("/useAppActive") ? () => active : require(name), module, module.exports, schedule, id => timers.delete(id), { now: () => now });
  const content = { paddingBottom: 24 }, ref = React.createRef();
  const f = {
    animations, values, scrolls, calls, content, ref, timers,
    all: () => nodes(renderer.container),
    list: () => f.all().find(n => n.type === "FlatList"),
    control: () => f.list().props.refreshControl,
    pageController,
    preview(value) { preview = value; f.render(); },
    act: renderer.act,
    render(patch = {}) { props = { ...props, ...patch }; renderer.render(React.createElement(chromeContext.Provider, { value: chrome }, React.createElement(module.exports.default,
      { onRefresh: () => new Promise((resolve, reject) => calls.push({ resolve, reject })), testID: "fixture", ...props },
      React.createElement("FlatList", { ref, key: "keep", data: ["cached"], contentContainerStyle: content, onScroll: event => scrolls.push(event) })))); },
    advance(ms) {
      const until = now + ms;
      while (true) {
        const next = [...timers].filter(([, timer]) => timer.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        now = next[1].at; timers.delete(next[0]); f.act(next[1].callback);
      }
      now = until;
    },
    chrome(value) { chrome = value; f.render(); },
    presentation(value) { presentation = { ...presentation, ...value }; f.render(); },
    reduced(value) { reduced = value; f.render(); }, active(value) { active = value; f.render(); },
    async settle() { for (let i = 0; i < 6; i++) { await new Promise(setImmediate); f.act(noop); } }, close() { renderer.render(null); },
  };
  f.render(); return f;
}
test("iOS keeps UIKit gesture and the real list, holds pending work and retries failures", async t => {
  const f = fixture(); t.after(f.close); const list = f.list(), control = f.control();
  assert.equal(control.type, "RefreshControl"); assert.equal(control.props.tintColor, "transparent");
  assert.equal(f.list().props.contentContainerStyle, f.content); assert.equal(f.list().props.alwaysBounceVertical, true);
  f.act(() => { control.props.onRefresh(); control.props.onRefresh(); }); assert.equal(f.calls.length, 1); assert.equal(f.control().props.refreshing, true);
  f.calls[0].reject(Error("offline")); await f.settle(); f.advance(1000); assert.equal(f.control()?.props.refreshing || false, false); assert.equal(f.list(), list);
  f.act(f.control().props.onRefresh); assert.equal(f.calls.length, 2); f.calls[1].resolve(); await f.settle(); f.advance(1000); assert.equal(f.control()?.props.refreshing || false, false);
});
test("vinyl follows empty overscroll space without consuming the existing scroll callback", t => {
  const f = fixture(); t.after(f.close);
  for (const y of [200, 0, -24, -80]) { const event = { nativeEvent: { contentOffset: { y }, contentInset: { top: 20 } } }; f.list().props.onScroll(event); assert.equal(f.scrolls.at(-1), event); assert.equal(f.values[0].value, Math.max(0, -y - 20)); }
  const indicator = f.all().find(n => n.props?.testID === "fixture-vinyl"); assert.equal(indicator.props.pointerEvents, "none"); assert.equal(indicator.props.accessibilityElementsHidden, true);
});
test("jello pop/spin stop on live Reduce Motion and background, without delaying real work", async t => {
  const f = fixture(); t.after(f.close); f.act(f.control().props.onRefresh);
  assert.equal(f.animations.filter(a => a.kind === "loop" && a.started).length, 1);
  assert.ok(f.animations.filter(a => a.kind === "timing").every(a => a.config.useNativeDriver && a.config.isInteraction === false));
  f.reduced(true); assert.ok(f.animations.filter(a => a.started).every(a => a.stopped));
  const before = f.animations.length; f.active(false); f.reduced(false); assert.equal(f.animations.length, before);
  f.calls[0].resolve(); await f.settle(); assert.equal(f.control()?.props.refreshing || false, false);
  if (f.control()) f.act(f.control().props.onRefresh); assert.equal(f.calls.length, 1);
});
test("disabled and unmounted native refresh callbacks cannot issue reads", t => {
  const f = fixture(); const callback = f.control().props.onRefresh;
  f.render({ enabled: false }); f.act(callback); assert.equal(f.calls.length, 0);
  f.render({ enabled: true, refreshing: true }); f.act(callback); assert.equal(f.calls.length, 0);
  f.close(); callback(); assert.equal(f.calls.length, 0);
});


test("captured UIKit refresh callbacks are retired across disable/enable and background/foreground", t => {
  const f = fixture(); t.after(f.close); const first = f.control().props.onRefresh;
  f.render({ enabled: false }); f.render({ enabled: true }); f.act(first); assert.equal(f.calls.length, 0);
  const second = f.control().props.onRefresh; f.active(false); f.active(true); f.act(second); assert.equal(f.calls.length, 0);
  f.act(f.control().props.onRefresh); assert.equal(f.calls.length, 1);
});


test("fast data arrives immediately while a full visible cycle holds the native inset, then settles without a pose reset", async t => {
  const f = fixture(); t.after(f.close); const list = f.list();
  f.act(f.control().props.onRefresh);
  assert.equal(f.calls.length, 1, "network starts on release, before any visual timer");
  f.advance(30); f.calls[0].resolve("fresh rows"); await f.settle();
  assert.equal(f.control().props.refreshing, true);
  assert.equal(f.control().props.accessibilityState.busy, true);
  f.advance(969); assert.equal(f.control().props.refreshing, true);
  f.act(f.control().props.onRefresh); assert.equal(f.calls.length, 1, "repeated release coalesces during visual hold");
  f.values[1].setValue(0.37); f.advance(1);
  assert.equal(f.control()?.props.refreshing || false, false);
  assert.equal(f.values[1].value, 0.37, "settle freezes current rotation instead of snapping back to zero");
  assert.equal(f.list(), list);
  assert.ok(f.animations.filter(a => a.started).every(a => a.stopped));
  f.act(f.control().props.onRefresh); assert.equal(f.calls.length, 2, "next pull works immediately after settle");
});

test("slow refresh spins as long as work is pending and completes without another visual delay", async t => {
  const f = fixture(); t.after(f.close); f.act(f.control().props.onRefresh);
  f.advance(4800); assert.equal(f.control().props.refreshing, true); assert.equal(f.timers.size, 0);
  f.calls[0].resolve(); await f.settle();
  assert.equal(f.control()?.props.refreshing || false, false); assert.equal(f.timers.size, 0);
});

test("external refresh stays controlled and a synchronous gesture completion still gets one visible cycle", async t => {
  const f = fixture(); t.after(f.close);
  f.render({ refreshing: true }); f.advance(1200); assert.equal(f.control().props.refreshing, true);
  f.render({ refreshing: false }); assert.equal(f.control()?.props.refreshing || false, false);
  let reads = 0; f.render({ onRefresh: () => { reads++; } });
  f.act(f.control().props.onRefresh); await f.settle(); assert.equal(reads, 1);
  f.advance(1000); assert.equal(f.control()?.props.refreshing || false, false);
  f.render({ refreshing: true }); f.advance(2000); assert.equal(f.control().props.refreshing, true);
  f.render({ refreshing: false }); assert.equal(f.control()?.props.refreshing || false, false);
});

for (const interrupt of ["reduced", "active", "disabled"]) test(`${interrupt} cancels only the decorative hold and leaves no timer`, async t => {
  const f = fixture(); t.after(f.close); f.act(f.control().props.onRefresh);
  f.calls[0].resolve(); await f.settle(); assert.equal(f.timers.size, 1);
  if (interrupt === "reduced") f.reduced(true);
  else if (interrupt === "active") f.active(false);
  else f.render({ enabled: false });
  await f.settle();
  assert.equal(f.control()?.props.refreshing || false, false); assert.equal(f.timers.size, 0);
});

test("Reduce Motion never delays network completion or restarts a canceled decorative hold", async t => {
  const f = fixture(); t.after(f.close); f.reduced(true); f.act(f.control().props.onRefresh);
  assert.equal(f.animations.length, 0); f.reduced(false);
  f.calls[0].resolve(); await f.settle(); assert.equal(f.control()?.props.refreshing || false, false);
});

test("chrome measurement keeps the entire vinyl below the activity bar throughout pull and native settle", t => {
  const f = fixture(); t.after(f.close); const owner = {};
  for (const height of [48, 92, 136]) {
    f.chrome({ owner, height });
    const indicator = f.all().find(n => n.props?.testID === "fixture-vinyl"), visual = indicator.props.style[1];
    assert.equal(visual.top, height);
    for (const y of [-60, -80, -50, -32, 0]) {
      const event = { nativeEvent: { contentOffset: { y }, contentInset: { top: 0 } } };
      f.list().props.onScroll(event); assert.equal(f.values[0].value, Math.max(0, -y)); assert.equal(f.scrolls.at(-1), event);
    }
  }
  f.render({ progressViewOffset: 12 }); assert.equal(f.all().find(n => n.props?.testID === "fixture-vinyl").props.style[1].top, 148);
});

for (const retirement of ["account/route chrome owner", "detail command token"]) test(`${retirement} retires completed dwell and late work without settling the new refresh`, async t => {
  const f = fixture(); t.after(f.close);
  const change = () => retirement.startsWith("account") ? f.chrome({ owner: {}, height: 92 }) : f.presentation({ commandToken: {} });
  change(); f.act(f.control().props.onRefresh); f.calls[0].resolve(); await f.settle();
  assert.equal(f.timers.size, 1); change(); assert.equal(f.timers.size, 0); assert.equal(f.control()?.props.refreshing || false, false);
  f.act(f.control().props.onRefresh); change(); f.act(f.control().props.onRefresh);
  assert.equal(f.calls.length, 3); f.calls[1].resolve(); await f.settle(); f.advance(1200);
  assert.equal(f.control().props.refreshing, true); f.calls[2].resolve(); await f.settle();
  assert.equal(f.control()?.props.refreshing || false, false);
});

test("a callback rerender or chrome remeasurement does not shorten the admitted cycle; unmount cancels its timer", async () => {
  const f = fixture(), owner = {}; f.chrome({ owner, height: 92 }); f.act(f.control().props.onRefresh);
  f.calls[0].resolve(); await f.settle(); f.advance(400); f.chrome({ owner, height: 136 });
  assert.equal(f.control().props.refreshing, true); f.advance(599); assert.equal(f.control().props.refreshing, true);
  f.close(); assert.equal(f.timers.size, 0); f.advance(1000);
});


test("disable/enable retires an ignored-cancellation request and its timer without blocking the next pull", async t => {
  const f = fixture(); t.after(f.close); f.act(f.control().props.onRefresh);
  f.render({ enabled: false }); f.render({ enabled: true });
  f.act(f.control().props.onRefresh); assert.equal(f.calls.length, 2);
  f.calls[0].resolve(); await f.settle(); f.advance(1400);
  assert.equal(f.control().props.refreshing, true); f.calls[1].resolve(); await f.settle();
  assert.equal(f.control()?.props.refreshing || false, false); assert.equal(f.timers.size, 0);
});


test("a slow JS commit still gives an instantly completed request a full visible animation", async t => {
  const f = fixture(); t.after(f.close); f.render({ onRefresh: () => Promise.resolve() });
  f.control().props.onRefresh(); f.advance(800); await f.settle();
  f.advance(999); assert.equal(f.control().props.refreshing, true);
  f.advance(1); assert.equal(f.control()?.props.refreshing || false, false);
});

test("a canceled short pull tracks the finger and native return without reads, timers, or list replacement", t => {
  const f = fixture(); t.after(f.close); const list = f.list();
  for (const y of [0, -16, -40, -22, 0, 150]) {
    const event = { nativeEvent: { contentOffset: { y }, contentInset: { top: 0 } } };
    f.list().props.onScroll(event); assert.equal(f.scrolls.at(-1), event);
    assert.equal(f.values[0].value, Math.max(0, -y));
  }
  assert.equal(f.calls.length, 0); assert.equal(f.timers.size, 0); assert.equal(f.animations.length, 0);
  assert.equal(f.list(), list); assert.equal(f.ref.current, f.list());
});

test("title and tab returns share the native refresh latch and keep the caller's list ref", async t => {
  const f = fixture(); t.after(f.close);
  const positions = [];
  f.ref.current.scrollToOffset = options => positions.push(options);
  assert.equal(f.pageController.capability("native"), 2);
  f.act(() => { f.pageController.request("native"); f.control().props.onRefresh(); f.pageController.request("native"); });
  assert.equal(f.calls.length, 1, "title, tab and pull issue one request while pending");
  assert.deepEqual(positions, [{ offset: 0, animated: false }, { offset: 0, animated: false }]);
  f.calls[0].resolve(); await f.settle(); f.advance(1000);
  f.act(() => f.pageController.request("native")); assert.equal(f.calls.length, 2);
});

test("disabled refresh removes UIKit control while titles still scroll; previews cannot claim the page", t => {
  const f = fixture(); t.after(f.close);
  const positions = [];
  f.ref.current.scrollToOffset = options => positions.push(options);
  const oldPull = f.control().props.onRefresh;
  f.render({ enabled: false });
  assert.equal(f.control(), undefined);
  assert.equal(f.pageController.capability("native"), 1);
  f.act(() => { f.pageController.request("native"); oldPull(); });
  assert.equal(f.calls.length, 0); assert.equal(positions.length, 1);
  f.preview(true);
  assert.equal(f.pageController.capability("native"), 0);
  assert.equal(f.pageController.request("native"), false);
  f.preview(false); f.render({ enabled: true });
  assert.equal(f.pageController.capability("native"), 2);
  f.presentation({ active: false, canAct: () => false });
  assert.equal(f.pageController.capability("native"), 0);
  assert.equal(f.pageController.request("native"), false);
});
