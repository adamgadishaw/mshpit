import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
const require = createRequire(import.meta.url);
const React = require("react");
const reconciler = require("react-reconciler");
const { transformSync } = require("@babel/core");
const codes = new Map();
function execute(path, imports, clock) {
  const file = new URL(path, import.meta.url);
  if (!codes.has(path)) codes.set(path, transformSync(readFileSync(file, "utf8"), {
    filename: file.pathname, babelrc: false, configFile: false,
    plugins: [[require("@babel/plugin-transform-react-jsx"), { runtime: "automatic" }], require("@babel/plugin-transform-modules-commonjs")],
  }).code);
  const module = { exports: {} };
  new Function("require", "module", "exports", "setTimeout", "clearTimeout", "document", "window", codes.get(path))(name => imports(name, createRequire(file)), module, module.exports, clock?.setTimeout || setTimeout, clock?.clearTimeout || clearTimeout, clock?.document, clock?.window);
  return module.exports.default;
}
const noop = () => {};
function createRenderer(measurements) {
  const context = {}, container = { children: [] };
  let priority = 0, focusedInput = null;
  const append = (parent, child) => parent.children.push(child);
  const remove = (parent, child) => {
    const index = parent.children.indexOf(child);
    if (index >= 0) parent.children.splice(index, 1);
  };
  const insert = (parent, child, before) => parent.children.splice(parent.children.indexOf(before), 0, child);
  const renderer = reconciler({
    supportsMutation: true, isPrimaryRenderer: true, supportsPersistence: false, supportsHydration: false,
    getRootHostContext: () => context, getChildHostContext: () => context, getPublicInstance: (node) => node,
    prepareForCommit: () => null, resetAfterCommit: noop,
    createInstance: (type, props) => ({
      type, props, children: [], measureInWindow(callback) { measurements.push({ node: this, callback }); }, focus() { if (focusedInput) focusedInput.focused = false; focusedInput = this; this.focused = true; },
      blur() { this.focused = false; this.blurs = (this.blurs || 0) + 1; if (focusedInput === this) focusedInput = null; }, scrollToEnd() {},
    }), createTextInstance: (text) => ({ text }),
    appendInitialChild: append, appendChild: append, appendChildToContainer: append,
    removeChild: remove, removeChildFromContainer: remove, insertBefore: insert, insertInContainerBefore: insert,
    finalizeInitialChildren: () => false, shouldSetTextContent: () => false,
    commitUpdate: (node, type, oldProps, newProps) => { node.props = newProps; },
    commitTextUpdate: (node, oldText, text) => { node.text = text; },
    clearContainer: (node) => { node.children = []; }, resetTextContent: noop, commitMount: noop,
    scheduleTimeout: setTimeout, cancelTimeout: clearTimeout, noTimeout: -1,
    supportsMicrotasks: true, scheduleMicrotask: queueMicrotask,
    getCurrentUpdatePriority: () => priority, setCurrentUpdatePriority: (value) => { priority = value; },
    resolveUpdatePriority: () => priority || 32, shouldAttemptEagerTransition: () => false,
    hideInstance: node => { node.hidden = true; }, unhideInstance: node => { node.hidden = false; },
    hideTextInstance: node => { node.hidden = true; }, unhideTextInstance: node => { node.hidden = false; },
    detachDeletedInstance: noop, maySuspendCommit: () => false, preloadInstance: () => true,
    startSuspendingCommit: noop, suspendInstance: noop, waitForCommitToBeReady: () => null,
    NotPendingTransition: null, HostTransitionContext: React.createContext(null), resetFormInstance: noop,
    bindToConsole: (method, args) => console[method].bind(console, ...args),
  });
  const fail = (error) => { throw error; };
  const root = renderer.createContainer(container, 1, null, false, null, "", fail, fail, fail, null);
  const flush = () => {
    for (let iteration = 0; iteration < 5; iteration++) {
      renderer.flushSyncWork();
      if (!renderer.flushPassiveEffects()) break;
    }
  };
  return {
    container, focusedInput: () => focusedInput,
    render(element) { renderer.updateContainerSync(element, root, null, null); flush(); },
    act(callback) { renderer.flushSyncFromReconciler(callback); flush(); },
  };
}

const nodes = node => [node, ...(node.children || []).flatMap(nodes)];
const layout = (y, height, width = 300) => ({ nativeEvent: { layout: { x: 0, y, width, height } } });
const scroll = (y, height = 200) => ({ nativeEvent: { contentOffset: { x: 0, y }, layoutMeasurement: { width: 300, height }, contentSize: { width: 300, height: 1000 } } });
const incoming = (id, at) => ({ id, at, from: "recipient", text: id, server: true });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

// Runs the actual ThreadScreen and receipt hook with React. Only native bounds,
// activity events and Store I/O are fixtures; it makes no native-device claim.
function fixture({ platform = "web", strict = false, rows = [incoming("old", 1), incoming("new", 2)] } = {}) {
  const measurements = [], listeners = new Map(), listenerHistory = [], writes = [], timers = new Map(), scrollCalls = [];
  const renderer = createRenderer(measurements);
  let timerId = 0, currentRows = rows, accountId = "viewer", epoch = 1, route = true, blocked = false, sendResult = { ok: true }, refreshTask;
  const listen = (name, callback) => { listenerHistory.push({ name, callback }); const set = listeners.get(name) || new Set(); set.add(callback); listeners.set(name, set); return { remove: () => set.delete(callback) }; };
  const doc = { visibilityState: "visible", addEventListener: (name, cb) => listen(name, cb), removeEventListener: (name, cb) => listeners.get(name)?.delete(cb) };
  const clock = { setTimeout: cb => { timers.set(++timerId, cb); return timerId; }, clearTimeout: id => timers.delete(id), document: doc, window: doc };
  const AppState = { currentState: "active", addEventListener: listen };
  const native = {
    ...Object.fromEntries(["View", "Text", "TextInput", "Pressable", "ScrollView", "ActivityIndicator", "KeyboardAvoidingView"].map(name => [name, name])),
    Platform: { OS: platform }, StyleSheet: { create: value => value }, useWindowDimensions: () => ({ fontScale: 1 }), AppState,
  };
  let hook;
  const imports = (name, local) => {
    if (name === "react") return React;
    if (name === "react/jsx-runtime") return require(name);
    if (name === "react-native") return native;
    if (name === "../theme") return { colors: {}, radius: {}, mono: "mono" };
    if (name === "../hooks/useVisibleDirectMessageRead") return hook;
    if (name === "../hooks/useIOSThreadControls") return () => () => route;
    if (name === "../hooks/useIOSThreadRefreshAnnouncement") return () => ({ begin: noop, finish: noop });
    if (name === "../hooks/useScopedRefresh") return ({ task }) => { refreshTask = task; return { refreshing: false, refresh: () => task({ signal: new AbortController().signal }) }; };
    if (name === "../lib/useLiveChat") return noop;
    if (name === "../lib/useChatScroll") return () => {
      const scrollRef = React.useRef(null);
      return { scrollRef, onLayout: e => scrollCalls.push(["layout", e]), onScroll: e => scrollCalls.push(["scroll", e]), onScrollBeginDrag: e => scrollCalls.push(["drag", e]), onContentSizeChange: (...args) => scrollCalls.push(["content", ...args]) };
    };
    if (name === "../store") return { useStore: () => ({
      session: accountId ? { id: accountId } : null, chatAuthEpoch: epoch,
      userById: () => ({ id: "recipient", name: "Recipient" }), threadMessages: () => currentRows,
      sendDM: noop, retryChatMessage: noop, cancelChatMessage: noop,
      loadThread: async () => ({}), loadUser: async () => ({}), isBlocked: () => blocked,
      markThreadRead: async (otherId, options) => { writes.push({ accountId, otherId, ...options }); return typeof sendResult === "function" ? sendResult() : sendResult; },
    }) };
    if (name.startsWith("../components/")) return name.split("/").at(-1);
    return local(name);
  };
  hook = execute("../hooks/useVisibleDirectMessageRead.js", imports, clock);
  const Thread = execute("./ThreadScreen.jsx", imports, clock);
  const props = { otherId: "recipient", isCurrentRoute: () => route, onClose: noop };
  const f = {
    writes, measurements, scrollCalls, listenerHistory, listeners,
    capturedTimer: () => [...timers.values()][0],
    all: () => nodes(renderer.container),
    get viewport() { return f.all().find(n => n.type === "ScrollView"); },
    row(id) { return f.all().find(n => n.type === "View" && n.props.onLayout && n.props.collapsable === false && nodes(n).some(child => child.type === "MentionText" && child.props.text === id)); },
    act: cb => renderer.act(cb),
    render() { renderer.render(React.createElement(strict ? React.StrictMode : React.Fragment, null, React.createElement(Thread, props))); },
    layOut(id, y, height = 40) { const row = f.row(id); assert.ok(row, `row ${id}`); row.bounds = [0, 100 + y, 300, height]; f.act(() => row.props.onLayout(layout(y, height))); },
    layoutViewport() { f.viewport.bounds = [0, 100, 300, 200]; f.act(() => f.viewport.props.onLayout(layout(0, 200))); },
    scroll(y) { f.act(() => f.viewport.props.onScroll(scroll(y))); },
    async settle() { for (let i = 0; i < 5; i++) await Promise.resolve(); f.act(noop); },
    runTimers() { const ready = [...timers.values()]; timers.clear(); f.act(() => ready.forEach(cb => cb())); },
    measure() { let count = 0; while (measurements.length) { const { node, callback } = measurements.shift(); assert.ok(node.bounds, `Expected measured ${node.type} bounds`); f.act(() => callback(...node.bounds)); count += 1; } return count; },
    state(value) { AppState.currentState = value; f.act(() => [...listeners.get("change") || []].forEach(cb => cb(value))); },
    visibility(value) { doc.visibilityState = value; f.act(() => [...listeners.get("visibilitychange") || []].forEach(cb => cb())); },
    page(value) { f.act(() => [...listeners.get(value) || []].forEach(cb => cb())); },
    account(id, nextEpoch) { accountId = id; epoch = nextEpoch; f.render(); },
    route(value, render = true) { route = value; if (render) f.render(); },
    block() { blocked = true; f.render(); },
    rows(value) { currentRows = value; f.render(); },
    result(value) { sendResult = value; },
    refresh: () => refreshTask({ signal: new AbortController().signal }),
    close() { renderer.render(null); },
  };
  f.render(); return f;
}

test("Thread waits for measured visibility, composes scrolling, and keeps offscreen arrivals unread", async t => {
  const f = fixture(); t.after(f.close);
  await f.settle(); assert.equal(f.writes.length, 0);
  f.layoutViewport(); f.layOut("old", 20); f.layOut("new", 400);
  f.runTimers(); assert.equal(f.writes.length, 0, "a layout/scroll request is not visibility proof");
  assert.ok(f.measure() <= 4, "anchor + visible candidates only");
  await f.settle(); assert.deepEqual(f.writes.map(w => w.messageId), ["old"]);
  f.rows([incoming("old", 1), incoming("new", 2), incoming("arrival", 3)]);
  f.layOut("arrival", 450); f.scroll(0); f.runTimers(); f.measure(); await f.settle();
  assert.deepEqual(f.writes.map(w => w.messageId), ["old"]);
  f.row("new").bounds = [0, 220, 300, 40];
  f.row("arrival").bounds = [0, 270, 300, 40];
  f.scroll(280); f.runTimers(); f.measure(); await f.settle();
  assert.deepEqual(f.writes.map(w => w.messageId), ["old", "new"], "partially below viewport arrival remains unread");
  assert.ok(f.viewport.props.onLayout);
  assert.ok(f.scrollCalls.some(([kind]) => kind === "scroll"));
});

test("short content reads at actual offset zero without requiring a scroll event", async t => {
  const f = fixture({ strict: true, rows: [incoming("old", 1)] }); t.after(f.close);
  f.layoutViewport(); f.layOut("old", 0); f.runTimers(); f.measure(); await f.settle();
  assert.equal(f.writes.length, 1); assert.equal(f.writes[0].messageId, "old");
  assert.ok(f.writes[0].signal instanceof AbortSignal); assert.equal(f.writes[0].isCurrent(), true);
});

test("stale native measurements, account A-B-A callbacks, block and route fences cannot mark", async t => {
  const f = fixture({ rows: [incoming("old", 1)] }); t.after(f.close);
  f.layoutViewport(); f.layOut("old", 0); const oldLayout = f.row("old").props.onLayout;
  f.runTimers(); assert.ok(f.measurements.length);
  f.account("someone-else", 2); f.account("viewer", 3);
  f.act(() => oldLayout(layout(0, 40))); f.measure(); await f.settle(); assert.equal(f.writes.length, 0);
  f.layoutViewport(); f.layOut("old", 0); f.runTimers();
  f.route(false, false); f.measure(); await f.settle(); assert.equal(f.writes.length, 0);
  f.route(true); f.layoutViewport(); f.layOut("old", 0); f.runTimers(); f.block(); f.measure(); await f.settle(); assert.equal(f.writes.length, 0);
});

test("background revokes an in-flight request; foreground retries earned target without new layout", async t => {
  const f = fixture({ rows: [incoming("old", 1)] }); t.after(f.close);
  const pending = deferred(); f.result(() => pending.promise);
  f.layoutViewport(); f.layOut("old", 0); f.runTimers(); f.measure(); await f.settle();
  const request = f.writes[0]; assert.ok(request);
  const oldScroll = f.viewport.props.onScroll;
  f.visibility("hidden"); assert.equal(request.signal.aborted, true); assert.equal(request.isCurrent(), false);
  pending.resolve({ ok: true }); await f.settle();
  f.result({ ok: true }); f.visibility("visible"); await f.settle();
  assert.deepEqual(f.writes.map(w => w.messageId), ["old", "old"]);
  f.rows([incoming("old", 1), incoming("new", 2)]);
  f.act(() => oldScroll(scroll(500))); f.runTimers(); f.measure(); await f.settle();
  assert.equal(f.writes.length, 2);
});

test("web hidden/pagehide forbids measurement and revokes requests; visible recovery is bounded", async t => {
  const f = fixture({ platform: "web", rows: [incoming("old", 1)] }); t.after(f.close);
  f.visibility("hidden"); f.layoutViewport(); f.layOut("old", 0); f.runTimers(); f.measure(); await f.settle(); assert.equal(f.writes.length, 0);
  f.visibility("visible"); f.layoutViewport(); f.layOut("old", 0); f.result({ ok: false }); f.runTimers(); f.measure(); await f.settle();
  assert.equal(f.writes.length, 1);
  f.page("pagehide"); f.page("pageshow"); await f.settle(); assert.equal(f.writes.length, 2);
  f.visibility("hidden"); f.visibility("visible"); await f.settle(); assert.equal(f.writes.length, 3);
  f.visibility("hidden"); f.visibility("visible"); await f.settle(); assert.equal(f.writes.length, 3);
  f.result({ ok: true }); await f.refresh(); await f.settle(); assert.equal(f.writes.length, 4, "successful explicit refresh opens a new recovery episode");
});

test("covered route revokes pending receipt and uncovers with fresh authority and native proof", async t => {
  const f = fixture({ rows: [incoming("old", 1)] }); t.after(f.close);
  const pending = deferred(); f.result(() => pending.promise);
  f.layoutViewport(); f.layOut("old", 0); f.runTimers(); f.measure(); await f.settle();
  const prior = f.writes[0], captured = f.viewport.props.onScroll;
  f.route(false); assert.equal(prior.signal.aborted, true); assert.equal(prior.isCurrent(), false);
  f.rows([incoming("old", 1), incoming("new", 2)]); f.layOut("new", 80);
  f.runTimers(); f.measure(); await f.settle(); assert.equal(f.writes.length, 1);
  pending.resolve({ ok: true }); f.result({ ok: true });
  f.route(true); await f.settle(); assert.deepEqual(f.writes.map(w => w.messageId), ["old", "old"]);
  f.act(() => captured(scroll(1000))); await f.settle(); assert.equal(f.writes.length, 2);
  f.runTimers(); f.measure(); await f.settle();
  assert.deepEqual(f.writes.map(w => w.messageId), ["old", "old", "new"], "covered arrival needs fresh bounds before it earns a receipt");
});

test("foreground measures newly laid out background messages without requiring another layout", async t => {
  const f = fixture({ rows: [incoming("old", 1)] }); t.after(f.close);
  f.layoutViewport(); f.layOut("old", 0); f.runTimers(); f.measure(); await f.settle();
  f.visibility("hidden"); f.rows([incoming("old", 1), incoming("new", 2)]); f.layOut("new", 80);
  f.runTimers(); f.measure(); await f.settle(); assert.equal(f.writes.length, 1);
  f.visibility("visible"); await f.settle(); assert.equal(f.writes.length, 1);
  f.runTimers(); f.measure(); await f.settle(); assert.deepEqual(f.writes.map(w => w.messageId), ["old", "new"]);
});

test("an owner replacement remeasures an unchanged native viewport and rows without carrying its read cursor", async t => {
  const f = fixture({ rows: [incoming("old", 1)] }); t.after(f.close);
  f.layoutViewport(); f.layOut("old", 0); f.runTimers(); f.measure(); await f.settle();
  f.account("viewer", 2); await f.settle(); assert.equal(f.writes.length, 1, "new owner has not earned visibility yet");
  f.runTimers(); f.measure(); await f.settle();
  assert.equal(f.writes.length, 2, "fresh native proof works even if no new onLayout occurs");
});

test("removed StrictMode listeners and cancelled measurement timers cannot revoke or own current work", async t => {
  const f = fixture({ strict: true, rows: [incoming("old", 1)] }); t.after(f.close);
  const stateHandlers = f.listenerHistory.filter(entry => entry.name === "visibilitychange");
  assert.ok(stateHandlers.length >= 2, "StrictMode installs a fresh listener");
  f.layoutViewport(); f.layOut("old", 0); const cancelled = f.capturedTimer();
  f.route(false); f.route(true);
  f.act(() => { stateHandlers[0].callback(); cancelled(); });
  f.runTimers(); f.measure(); await f.settle();
  assert.equal(f.writes.length, 1); assert.equal(f.writes[0].isCurrent(), true);
  f.close(); assert.equal(f.listeners.get("visibilitychange")?.size || 0, 0);
  assert.equal(f.writes[0].isCurrent(), false);
});
