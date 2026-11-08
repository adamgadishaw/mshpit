import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getEventListeners } from "node:events";
import { createRequire } from "node:module";
import test from "node:test";
const require = createRequire(import.meta.url);
const React = require("react"), reconciler = require("react-reconciler");
const { transformSync } = require("@babel/core");
const codes = new Map(), noop = () => {};
function execute(path, imports, timers = { setTimeout, clearTimeout }) {
  const file = new URL(path, import.meta.url);
  if (!codes.has(path)) codes.set(path, transformSync(readFileSync(file, "utf8"), {
    filename: file.pathname, babelrc: false, configFile: false,
    plugins: [[require("@babel/plugin-transform-react-jsx"), { runtime: "automatic" }], require("@babel/plugin-transform-modules-commonjs")],
  }).code);
  const module = { exports: {} };
  new Function("require", "module", "exports", "setTimeout", "clearTimeout", codes.get(path))(
    name => imports(name, createRequire(file)), module, module.exports, timers.setTimeout, timers.clearTimeout);
  return module.exports;
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
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };

// Real ThreadScreen, React, useScopedRefresh, read coordinator and known-reader
// preference. Store reads, read markers, native speech/events and time are all
// synthetic. This never mounts a production thread or writes a read receipt.
const MESSAGE = "Messages could not update. Check your connection and try again.";
function fixture({ platform = "ios", strict = false, reader = true, state = "active", hookOnly = false, announceOnMount = false } = {}) {
  const renderer = createRenderer(), listeners = new Map(), captured = new Map();
  const timers = [], speech = [], reads = [], users = [], queries = [], markers = [];
  let account = "A", epoch = 1, recipient = "recipient", hook, poll, owner = { alive: true };
  const clock = { setTimeout(callback, delay) { const timer = { callback, delay, cleared: false }; timers.push(timer); return timer; }, clearTimeout(timer) { timer.cleared = true; } };
  const listen = (name, callback) => {
    const active = listeners.get(name) || new Set(); active.add(callback); listeners.set(name, active);
    const history = captured.get(name) || []; history.push(callback); captured.set(name, history);
    return { remove: () => active.delete(callback) };
  };
  const native = {
    View: "View", Text: "Text", TextInput: "TextInput", Pressable: "Pressable", ScrollView: "ScrollView", ActivityIndicator: "ActivityIndicator", KeyboardAvoidingView: "KeyboardAvoidingView",
    Platform: { OS: platform }, StyleSheet: { create: value => value },
    AppState: { currentState: state, addEventListener: listen },
    AccessibilityInfo: {
      addEventListener: listen,
      isScreenReaderEnabled: () => { const query = deferred(); queries.push(query); if (reader !== null) query.resolve(reader); return query.promise; },
      announceForAccessibilityWithOptions: (...args) => speech.push(args),
    },
  };
  let preference, announcement, refresh;
  const imports = (name, local) => {
    if (name === "react") return React;
    if (name === "react/jsx-runtime") return require(name);
    if (name === "react-native") return native;
    if (name === "./useScreenReaderEnabled") return preference;
    if (name === "../hooks/useIOSThreadRefreshAnnouncement") return announcement;
    if (name === "../hooks/useScopedRefresh") return refresh;
    if (name === "../lib/useLiveChat") return callback => { poll = callback; };
    if (name === "../lib/useChatScroll") return () => ({ scrollRef: { current: null }, onScroll: noop, onContentSizeChange: noop });
    if (name === "../theme") return { colors: {}, radius: {}, mono: "mono" };
    if (name === "../store") return { useStore: () => ({
      session: account ? { id: account } : null, chatAuthEpoch: epoch,
      userById: () => ({ id: recipient, name: "Fixture member" }), threadMessages: () => [],
      loadThread: (id, options) => { const request = { ...deferred(), id, options }; reads.push(request); return request.promise; },
      loadUser: (id, options) => { const request = { ...deferred(), id, options }; users.push(request); return request.promise; },
      markThreadRead: id => markers.push(id),
    }) };
    if (name.startsWith("../components/")) return name.split("/").at(-1);
    return local(name);
  };
  if (platform === "ios") preference = execute("../hooks/useScreenReaderEnabled.ios.js", imports);
  announcement = execute(`../hooks/useIOSThreadRefreshAnnouncement${platform === "ios" ? ".ios" : ""}.js`, imports, clock);
  refresh = execute("../hooks/useScopedRefresh.js", imports);
  const Thread = execute("./ThreadScreen.jsx", imports).default;
  function HookHarness() {
    hook = announcement.default(account, epoch, recipient, owner, MESSAGE);
    React.useLayoutEffect(() => {
      if (!announceOnMount) return;
      for (const callback of [...listeners.get("screenReaderChanged") || []]) callback(true);
      hook.finish(hook.begin(), true);
    }, []);
    return null;
  }
  const f = {
    timers, speech, reads, users, queries, captured, listeners, markers, native,
    get hook() { return hook; }, get owner() { return owner; },
    all: () => nodes(renderer.container),
    find: predicate => { const node = f.all().find(predicate); assert.ok(node); return node; },
    get boundary() { return f.find(n => n.type === "VinylRefreshBoundary"); },
    act: callback => renderer.act(callback),
    refresh() { let result; f.act(() => { result = f.boundary.props.onRefresh(); }); return result; },
    poll(options = {}) { return poll(options); },
    render() { renderer.render(React.createElement(strict ? React.StrictMode : React.Fragment, null,
      React.createElement(hookOnly ? HookHarness : Thread, { otherId: recipient }))); },
    scope(id = account, nextEpoch = epoch, nextRecipient = recipient) { account = id; epoch = nextEpoch; recipient = nextRecipient; f.render(); },
    replaceOwner(next) { owner = next; f.render(); },
    rawState(value) { native.AppState.currentState = value; },
    reader(value) { f.act(() => { for (const callback of [...listeners.get("screenReaderChanged") || []]) callback(value); }); },
    state(value) { native.AppState.currentState = value; f.act(() => { for (const callback of [...listeners.get("change") || []]) callback(value); }); },
    tick(timer = timers.at(-1)) { assert.ok(timer); f.act(() => timer.callback()); },
    async settle() { for (let i = 0; i < 8; i++) await Promise.resolve(); await new Promise(setImmediate); f.act(() => {}); },
    async complete({ failed = true, index = reads.length - 1, userIndex = users.length - 1, result = { syncCursor: "fresh", relationshipContext: { following: true } } } = {}) {
      if (failed) reads[index].reject(new Error("Private transport text")); else reads[index].resolve(result);
      if (userIndex >= 0) users[userIndex].resolve({ status: "ready" });
      await f.settle();
    },
    close: () => renderer.render(null),
  };
  f.render(); return f;
}

for (const strict of [false, true]) test(`actual accepted refresh joins duplicate taps and queues one fixed failure (StrictMode ${strict})`, async t => {
  const f = fixture({ strict }); t.after(f.close); await f.settle();
  const first = f.refresh(); assert.equal(f.refresh(), first); await f.settle();
  assert.equal(f.reads.length, 1); assert.equal(f.users.length, 1); assert.equal(f.boundary.props.refreshing, true);
  assert.equal(f.reads[0].options.strict, true); assert.equal(f.reads[0].options.includeContext, true);
  assert.equal(f.timers.length, 0);
  await f.complete(); const outcome = await first; assert.equal(outcome.ok, false);
  assert.equal(f.boundary.props.refreshing, false); assert.equal(f.timers.length, 1); assert.equal(f.timers[0].delay, 120);
  f.tick(); f.tick(); assert.deepEqual(f.speech, [[MESSAGE, { queue: true }]]); assert.deepEqual(f.markers, []);
});

for (const timing of ["request", "timer"]) for (const transition of ["inactive", "background", "reader"]) test(`${transition} round trip during actual ${timing} permanently revokes action`, async t => {
  const f = fixture(); t.after(f.close); await f.settle(); const result = f.refresh(); await f.settle();
  if (timing === "timer") await f.complete();
  // Deliver both events in one turn: a final on/active snapshot cannot restore
  // the older request's permission to speak.
  f.act(() => { if (transition === "reader") { f.reader(false); f.reader(true); } else { f.state(transition); f.state("active"); } });
  if (timing === "request") {
    assert.equal(f.refresh(), result); // A joined tap must not re-arm it either.
    assert.equal(f.reads[0].options.signal.aborted, false);
    assert.equal(f.users[0].options.signal.aborted, false);
    await f.complete();
  }
  assert.equal((await result).ok, false); assert.equal(f.boundary.props.refreshing, false);
  for (const timer of f.timers) f.tick(timer); assert.deepEqual(f.speech, []);
  const next = f.refresh(); await f.settle(); await f.complete(); await next; f.tick(); assert.equal(f.speech.length, 1);
});

for (const condition of ["unknown", "off", "inactive", "background", "unknown-app"]) test(`${condition} at acceptance cannot speak after becoming eligible`, async t => {
  const f = fixture({ reader: condition === "unknown" ? null : condition !== "off", state: condition === "unknown-app" ? null : ["inactive", "background"].includes(condition) ? condition : "active" });
  t.after(f.close); await f.settle(); const result = f.refresh(); await f.settle();
  f.reader(true); f.state("active"); if (condition === "unknown") f.queries[0].resolve(true);
  await f.complete(); assert.equal((await result).ok, false); assert.equal(f.timers.length, 0); assert.deepEqual(f.speech, []);
  const next = f.refresh(); await f.settle(); await f.complete(); await next; f.tick(); assert.equal(f.speech.length, 1);
});

test("successful refresh remains silent and still publishes current relationship data and full results", async t => {
  const f = fixture(); t.after(f.close); await f.settle(); const promise = f.refresh(); await f.settle();
  f.reader(false); f.reader(true); await f.complete({ failed: false });
  assert.deepEqual(await promise, { ok: true, value: { threadResult: { syncCursor: "fresh", relationshipContext: { following: true } }, userResult: { status: "ready" } } });
  assert.equal(f.boundary.props.refreshing, false); assert.equal(f.timers.length, 0); assert.deepEqual(f.markers, []);
  assert.ok(f.all().some(n => n.props?.accessibilityLabel?.includes("You follow this member.")));
});

test("manual failure still waits for both reads, including member-result errors", async t => {
  const f = fixture(); t.after(f.close); await f.settle(); const promise = f.refresh(); await f.settle();
  f.users[0].resolve({ status: "error", error: "Private member error" }); await f.settle();
  assert.equal(f.boundary.props.refreshing, true); assert.equal(f.timers.length, 0);
  f.reads[0].resolve({ syncCursor: "fresh" }); await f.settle(); assert.equal((await promise).ok, false);
  assert.equal(f.boundary.props.refreshing, false); f.tick(); assert.deepEqual(f.speech, [[MESSAGE, { queue: true }]]);
});

test("actual polling failures and successful polls never arm speech or member reads", async t => {
  const f = fixture(); t.after(f.close); await f.settle();
  const first = f.poll(), failure = assert.rejects(first, /Private/); await f.settle();
  await f.complete({ userIndex: -1 }); await failure;
  assert.equal(f.timers.length, 0); assert.equal(f.users.length, 0);
  const next = f.poll({ after: "cursor" }); await f.settle(); await f.complete({ failed: false, userIndex: -1 }); await next;
  assert.equal(f.reads[1].options.after, "cursor"); assert.equal(f.timers.length, 0); assert.deepEqual(f.markers, []);
});

for (const timing of ["request", "timer"]) for (const change of ["account", "epoch", "recipient"]) test(`${change} A B A during actual ${timing} cannot revive old speech or data`, async t => {
  const f = fixture(); t.after(f.close); await f.settle(); const result = f.refresh(); await f.settle();
  if (timing === "timer") await f.complete();
  if (change === "account") { f.scope("B"); f.scope("A"); }
  if (change === "epoch") { f.scope("A", 2); f.scope("A", 1); }
  if (change === "recipient") { f.scope("A", 1, "other"); f.scope("A", 1, "recipient"); }
  if (timing === "request") await f.complete({ failed: false });
  const outcome = await result; if (timing === "request") assert.equal(outcome.aborted, true);
  for (const timer of f.timers) f.tick(timer); assert.deepEqual(f.speech, []);
  assert.ok(!f.all().some(n => n.props?.accessibilityLabel?.includes("You follow this member.")));
  const next = f.refresh(); await f.settle(); await f.complete(); await next; f.tick(); assert.equal(f.speech.length, 1);
});

for (const timing of ["request", "timer"]) test(`unmount during ${timing} cancels speech; stale completion cannot affect remount`, async t => {
  const f = fixture(); t.after(f.close); await f.settle(); const result = f.refresh(); await f.settle();
  if (timing === "timer") await f.complete(); f.close();
  assert.equal(f.listeners.get("change").size, 0); assert.equal(f.listeners.get("screenReaderChanged").size, 0);
  f.render(); await f.settle(); if (timing === "request") await f.complete(); await result;
  for (const timer of f.timers) f.tick(timer); assert.deepEqual(f.speech, []);
  const next = f.refresh(); await f.settle(); await f.complete(); await next; f.tick(); assert.equal(f.speech.length, 1);
});

test("superseded failure callbacks cannot speak or clear a newer pending timer", async t => {
  const f = fixture(); t.after(f.close); await f.settle(); let result = f.refresh(); await f.settle(); await f.complete(); await result;
  const old = f.timers[0]; result = f.refresh(); assert.equal(old.cleared, true); await f.settle(); await f.complete(); await result;
  const latest = f.timers[1]; f.tick(old); assert.equal(latest.cleared, false); assert.deepEqual(f.speech, []);
  f.state("background"); assert.equal(latest.cleared, true); f.state("active"); f.tick(old); f.tick(latest); assert.deepEqual(f.speech, []);
});

test("StrictMode stale listeners and duplicate completion cannot revoke or replay a newer claim", async t => {
  const f = fixture({ strict: true, hookOnly: true }); t.after(f.close); await f.settle();
  assert.ok(f.captured.get("change").length >= 2);
  const claim = f.hook.begin(); f.hook.finish(claim, true); f.hook.finish(claim, true);
  f.act(() => { f.captured.get("change")[0]("background"); f.captured.get("screenReaderChanged")[0](false); });
  assert.equal(f.timers.length, 1); f.tick(); f.tick(); assert.deepEqual(f.speech, [[MESSAGE, { queue: true }]]);
  const pending = f.hook.begin(); f.close(); f.render(); await f.settle(); f.hook.finish(pending, true); assert.equal(f.timers.length, 1);
});

test("StrictMode cleanup revokes queued mount lifecycle timer before replay", async t => {
  const f = fixture({ strict: true, hookOnly: true, announceOnMount: true }); t.after(f.close); await f.settle();
  assert.equal(f.timers.length, 2); assert.equal(f.timers[0].cleared, true); f.tick(f.timers[0]); assert.deepEqual(f.speech, []);
  assert.equal(f.timers[1].cleared, false); f.tick(f.timers[1]); f.tick(f.timers[0]); assert.deepEqual(f.speech, [[MESSAGE, { queue: true }]]);
});

for (const timing of ["request", "timer"]) test(`owner replacement and raw eligibility loss revoke ${timing} claims`, async t => {
  const f = fixture({ hookOnly: true }); t.after(f.close); await f.settle(); const old = f.hook, owner = f.owner, claim = old.begin();
  if (timing === "timer") old.finish(claim, true);
  f.replaceOwner({ alive: true }); f.replaceOwner(owner); old.finish(claim, true);
  for (const timer of f.timers) f.tick(timer); assert.deepEqual(f.speech, []);
  const next = f.hook.begin(); if (timing === "timer") f.hook.finish(next, true);
  f.rawState("inactive"); if (timing === "timer") f.tick(); else f.hook.finish(next, true);
  f.rawState("active"); f.hook.finish(next, true); for (const timer of f.timers) f.tick(timer); assert.deepEqual(f.speech, []);
});

test("abort owns only speech cleanup and native exceptions cannot alter refresh settlement", async t => {
  const f = fixture({ hookOnly: true }); t.after(f.close); await f.settle();
  const controller = new AbortController(), claim = f.hook.begin(controller.signal); f.hook.finish(claim, true);
  controller.abort(); assert.equal(f.timers[0].cleared, true); f.tick(); assert.deepEqual(f.speech, []);
  const aborted = new AbortController(); aborted.abort(); assert.equal(f.hook.begin(aborted.signal), null);
  let attempts = 0;
  f.native.AccessibilityInfo.announceForAccessibilityWithOptions = () => { attempts++; throw new Error("native speech unavailable"); };
  f.hook.finish(f.hook.begin(), true); assert.doesNotThrow(() => f.tick()); assert.doesNotThrow(() => f.tick()); assert.equal(attempts, 1);
});

for (const platform of ["android", "web"]) test(`${platform} retains legacy refresh without speech imports, preferences or listeners`, async t => {
  const f = fixture({ platform }); t.after(f.close); await f.settle(); const result = f.refresh(); await f.settle();
  await f.complete({ failed: false }); assert.equal((await result).ok, true); assert.equal(f.boundary.props.refreshing, false);
  assert.equal(f.queries.length, 0); assert.equal(f.listeners.size, 0); assert.equal(f.timers.length, 0); assert.deepEqual(f.speech, []);
  const next = f.refresh(); await f.settle(); await f.complete(); assert.equal((await next).ok, false); assert.deepEqual(f.speech, []);
  const fallback = readFileSync(new URL("../hooks/useIOSThreadRefreshAnnouncement.js", import.meta.url), "utf8"); assert.doesNotMatch(fallback, /import |AccessibilityInfo|AppState/);
});

test("disabled manual task never arms a claim or starts any reads", async t => {
  const f = fixture(); t.after(f.close); await f.settle(); f.scope(null); assert.deepEqual(await f.refresh(), { ok: false, disabled: true });
  assert.equal(f.users.length, 0); assert.equal(f.reads.length, 0); assert.equal(f.timers.length, 0);
});

test("older account failure cannot clear newer refresh progress, speech or relationship data", async t => {
  const f = fixture(); t.after(f.close); await f.settle(); const old = f.refresh(); await f.settle();
  f.scope("B"); const latest = f.refresh(); await f.settle(); assert.equal(f.reads.length, 2); assert.equal(f.users.length, 2);
  await f.complete({ index: 0, userIndex: 0 }); assert.equal((await old).aborted, true);
  assert.equal(f.boundary.props.refreshing, true); assert.equal(f.timers.length, 0);
  await f.complete({ index: 1, userIndex: 1, failed: false }); assert.equal((await latest).ok, true);
  assert.equal(f.boundary.props.refreshing, false); assert.ok(f.all().some(n => n.props?.accessibilityLabel?.includes("You follow this member.")));
  assert.equal(f.timers.length, 0);
});

test("stale Store result and AbortError are silent typed refresh cancellations", async t => {
  for (const mode of ["stale", "abort-error"]) {
    const f = fixture(); t.after(f.close); await f.settle(); const result = f.refresh(); await f.settle();
    const signal = f.users[0].options.signal;
    assert.equal(signal.aborted, false); assert.equal(getEventListeners(signal, "abort").length, 2);
    if (mode === "stale") f.reads[0].resolve({ stale: true });
    else f.reads[0].reject(Object.assign(new Error("Cancelled"), { name: "AbortError" }));
    f.users[0].resolve({ status: "ready" }); await f.settle(); assert.equal((await result).aborted, true);
    assert.equal(signal.aborted, false); assert.equal(getEventListeners(signal, "abort").length, 0);
    assert.equal(f.boundary.props.refreshing, false); assert.equal(f.timers.length, 0); assert.deepEqual(f.speech, []);
  }
});

test("late initial reader lookup cannot overrule a live event for accepted speech", async t => {
  const f = fixture({ reader: null }); t.after(f.close); await f.settle();
  f.reader(true); const result = f.refresh(); await f.settle();
  f.queries[0].resolve(false); await f.settle(); await f.complete(); await result; f.tick(); assert.deepEqual(f.speech, [[MESSAGE, { queue: true }]]);
});

test("captured old abort listener cannot cancel a newer accepted claim", async t => {
  const f = fixture({ hookOnly: true }); t.after(f.close); await f.settle(); let captured;
  const signal = { aborted: false, addEventListener(_name, listener) { captured = listener; }, removeEventListener() {} };
  const old = f.hook.begin(signal); f.hook.finish(old, true); const latest = f.hook.begin(); f.hook.finish(latest, true);
  captured(); f.tick(f.timers[0]); assert.equal(f.timers[1].cleared, false); assert.deepEqual(f.speech, []);
  f.tick(f.timers[1]); assert.deepEqual(f.speech, [[MESSAGE, { queue: true }]]);
});
