import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
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
  const renderer = createRenderer(), animations = [], values = [], scrolls = [], calls = [];
  let reduced = false, active = true, props = {};
  class Value { constructor(value) { this.value = value; values.push(this); } setValue(value) { this.value = value; } interpolate(config) { return { value: this, config }; } }
  const animation = (kind, config) => { const item = { kind, config, started: false, stopped: false, start() { this.started = true; }, stop() { this.stopped = true; } }; animations.push(item); return item; };
  const native = { View: "View", RefreshControl: "RefreshControl", Easing: { linear: "linear" }, StyleSheet: { create: x => x },
    Animated: { Value, View: "AnimatedView", timing: (value, config) => animation("timing", config), loop: config => animation("loop", config), sequence: config => animation("sequence", config) } };
  const module = { exports: {} };
  new Function("require", "module", "exports", code)(name => name === "react" || name === "react/jsx-runtime" ? require(name)
    : name === "react-native" ? native : name.endsWith("/theme") ? { colors: {} }
    : name.endsWith("/useReducedMotion") ? () => reduced : name.endsWith("/useAppActive") ? () => active : require(name), module, module.exports);
  const content = { paddingBottom: 24 }, ref = React.createRef();
  const f = {
    animations, values, scrolls, calls, content, ref,
    all: () => nodes(renderer.container),
    list: () => f.all().find(n => n.type === "FlatList"),
    control: () => f.list().props.refreshControl,
    act: renderer.act,
    render(patch = {}) { props = { ...props, ...patch }; renderer.render(React.createElement(module.exports.default,
      { onRefresh: () => new Promise((resolve, reject) => calls.push({ resolve, reject })), testID: "fixture", ...props },
      React.createElement("FlatList", { ref, key: "keep", data: ["cached"], contentContainerStyle: content, onScroll: event => scrolls.push(event) }))); },
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
  f.calls[0].reject(Error("offline")); await f.settle(); assert.equal(f.control().props.refreshing, false); assert.equal(f.list(), list);
  f.act(f.control().props.onRefresh); assert.equal(f.calls.length, 2); f.calls[1].resolve(); await f.settle(); assert.equal(f.control().props.refreshing, false);
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
  f.calls[0].resolve(); await f.settle(); assert.equal(f.control().props.refreshing, false);
  f.act(f.control().props.onRefresh); assert.equal(f.calls.length, 1);
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
