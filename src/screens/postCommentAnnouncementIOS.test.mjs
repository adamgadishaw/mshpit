import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { createIOSCommentDrafts, unavailableCommentDraft } from "../domain/iosCommentDrafts.mjs";
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

// Real Post handlers, React hooks, shared preference and retained-draft owner.
// Native speech/events and timers are synthetic; this does not verify VoiceOver.
function fixture({ platform = "ios", strict = false, reader = true, ready = true, unavailable = false, keyed = true, hookOnly = false, announceOnMount = false } = {}) {
  const renderer = createRenderer(), listeners = new Map(), captured = new Map();
  const timers = [], speech = [], requests = [], alerts = [], queries = [];
  const owner = createIOSCommentDrafts(); owner.account("A", 1);
  let account = "A", epoch = 1, post = "post", rows = ready ? [{ id: "parent", userId: "author", text: "Private parent text" }] : [];
  let lease = unavailable ? unavailableCommentDraft : owner.lease(post), hook;
  const clock = { setTimeout(callback, delay) { const timer = { callback, delay, cleared: false }; timers.push(timer); return timer; }, clearTimeout(timer) { timer.cleared = true; } };
  const listen = (name, callback) => {
    const active = listeners.get(name) || new Set(); active.add(callback); listeners.set(name, active);
    const history = captured.get(name) || []; history.push(callback); captured.set(name, history);
    return { remove: () => active.delete(callback) };
  };
  const native = {
    View: "View", Text: "Text", TextInput: "TextInput", Pressable: "Pressable", ScrollView: "ScrollView", ActivityIndicator: "ActivityIndicator",
    Platform: { OS: platform }, StyleSheet: { create: value => value }, Alert: { alert: (...args) => alerts.push(args) },
    AppState: { currentState: "active", addEventListener: listen },
    AccessibilityInfo: {
      addEventListener: listen,
      isScreenReaderEnabled: () => { const query = deferred(); queries.push(query); if (reader !== null) query.resolve(reader); return query.promise; },
      announceForAccessibilityWithOptions: (...args) => speech.push(args),
    },
  };
  let preference, announcement;
  const imports = (name, local) => {
    if (name === "react") return React;
    if (name === "react/jsx-runtime") return require(name);
    if (name === "react-native") return native;
    if (name === "./useScreenReaderEnabled") return preference;
    if (name === "../hooks/useIOSCommentAnnouncement") return announcement;
    if (name === "../hooks/useScopedRefresh") return () => ({ refreshing: false, refresh() {} });
    if (name === "../theme") return { colors: {}, radius: {}, roleColor: () => null };
    if (name === "../store") return { useStore: () => ({
      session: account ? { id: account } : null, chatAuthEpoch: epoch, feed: [], commentsFor: () => rows,
      userById: () => null, userBadges: () => [], loadComments: async () => ready ? { ok: true } : { ok: false },
      addComment: (...args) => { const request = { ...deferred(), args }; requests.push(request); return request.promise; },
    }) };
    if (name === "../components/Badge") return { BadgeRow: "BadgeRow" };
    if (name === "../components/PublicWebLinks") return { PublicTextLink: "PublicTextLink" };
    if (name === "../components/SocialReactionButtons") return { CommentLikeButton: "CommentLikeButton" };
    if (name.startsWith("../components/")) return name.split("/").at(-1);
    return local(name);
  };
  if (platform === "ios") preference = execute("../hooks/useScreenReaderEnabled.ios.js", imports);
  announcement = execute(`../hooks/useIOSCommentAnnouncement${platform === "ios" ? ".ios" : ""}.js`, imports, clock);
  const Post = execute("./PostScreen.jsx", imports).default;
  function HookHarness() {
    hook = announcement.default(account, epoch, post, lease, "target");
    React.useLayoutEffect(() => {
      if (!announceOnMount) return;
      // Resolve eligibility in this synthetic mount to arm before StrictMode's
      // effect cleanup/replay. The removed lifecycle's timer must stay revoked.
      for (const callback of [...listeners.get("screenReaderChanged") || []]) callback(true);
      hook.finish(hook.begin(), "confirmed");
    }, []);
    return null;
  }
  const f = {
    timers, speech, requests, alerts, queries, captured, listeners, owner,
    get lease() { return lease; }, get hook() { return hook; },
    all: () => nodes(renderer.container), find: predicate => { const node = f.all().find(predicate); assert.ok(node); return node; },
    get input() { return f.find(n => n.type === "TextInput"); },
    button: label => f.find(n => n.type === "Pressable" && n.props.accessibilityLabel === label),
    act: callback => renderer.act(callback),
    press(label) { let result; f.act(() => { result = f.button(label).props.onPress(); }); return result; },
    edit(text) { f.act(() => f.input.props.onChangeText(text)); },
    render() { renderer.render(React.createElement(strict ? React.StrictMode : React.Fragment, null,
      React.createElement(hookOnly ? HookHarness : Post, { key: keyed ? JSON.stringify([account, epoch, post]) : "same", log: { id: post, review: "Post" }, commentDraft: lease }))); },
    scope(id, nextEpoch = epoch, nextPost = post) { account = id; epoch = nextEpoch; post = nextPost; owner.account(account, epoch); lease = owner.lease(post); f.render(); },
    replaceLease(next) { lease = next; f.render(); },
    rows(next) { rows = next; f.render(); },
    rawState(value) { native.AppState.currentState = value; },
    reader(value) { f.act(() => { for (const callback of [...listeners.get("screenReaderChanged") || []]) callback(value); }); },
    state(value) { native.AppState.currentState = value; f.act(() => { for (const callback of [...listeners.get("change") || []]) callback(value); }); },
    tick(timer = timers.at(-1)) { assert.ok(timer); f.act(() => timer.callback()); },
    async settle() { for (let i = 0; i < 8; i++) await Promise.resolve(); await new Promise(setImmediate); f.act(() => {}); },
    async complete(result = { ok: true }, index = requests.length - 1) { requests[index].resolve(result); await f.settle(); },
    close: () => renderer.render(null),
  };
  f.render(); return f;
}

test("accepted Send confirms once with fixed copy and keeps newer draft; Return remains newline", async t => {
  const f = fixture(); t.after(f.close); await f.settle();
  f.edit("Private authored text\nSecond line"); const send = f.button("Send comment").props.onPress;
  f.act(() => { void send(); void send(); }); assert.equal(f.requests.length, 1);
  assert.equal(f.input.props.onSubmitEditing, undefined); assert.equal(f.input.props.multiline, true); assert.equal(f.input.props.returnKeyType, "default");
  f.edit("Newer private text"); await f.complete(); assert.equal(f.lease.read().text, "Newer private text");
  assert.equal(f.timers.length, 1); f.tick(); f.tick();
  assert.deepEqual(f.speech, [["Comment confirmed.", { queue: true }]]);
});

for (const throws of [false, true]) test(`failure ${throws ? "throw" : "result"} has truthful copy; exact Retry preserves payload and id`, async t => {
  const f = fixture(); t.after(f.close); await f.settle();
  f.edit("Secret draft"); void f.press("Send comment");
  if (throws) { f.requests[0].reject(new Error("Private transport text")); await f.settle(); } else await f.complete({ ok: false, error: { userMessage: "Private server text" } });
  f.tick(); assert.match(f.speech[0][0], /could not be confirmed/); assert.doesNotMatch(f.speech[0][0], /was not sent|Secret|Private/);
  f.edit("Newer draft"); void f.press("Retry previous comment"); assert.deepEqual(f.requests[1].args, f.requests[0].args);
  await f.complete(); f.tick(); assert.equal(f.speech[1][0], "Comment confirmed."); assert.equal(f.lease.read().text, "Newer draft");
});

test("current invalid parent is validated without delivery; clearing/changing the target revokes its timer", async t => {
  const f = fixture(); t.after(f.close); await f.settle(); f.edit("Reply"); f.press("Reply to comment"); f.rows([]);
  await f.press("Send comment"); assert.equal(f.requests.length, 0); const cancelled = f.timers.at(-1);
  f.press("Clear reply target"); f.tick(cancelled); assert.deepEqual(f.speech, []);
  f.act(() => f.lease.reply({ bad: "id" })); await f.press("Send comment"); const changed = f.timers.at(-1);
  f.rows([{ id: "other", userId: "author", text: "Other" }]); f.press("Reply to comment"); f.tick(changed); assert.deepEqual(f.speech, []);
  f.rows([]); await f.press("Send comment"); f.tick(); assert.match(f.speech[0][0], /^This reply target.*Clear it or choose another/);
});

test("Retry validates the original parent, never the newer reply target or payload", async t => {
  const f = fixture(); t.after(f.close); await f.settle(); f.edit("Original reply"); f.press("Reply to comment"); void f.press("Send comment"); await f.complete({ ok: false });
  f.edit("New draft"); f.rows([{ id: "other", userId: "author", text: "New parent" }]); f.press("Reply to comment");
  await f.press("Retry previous comment"); f.tick(); assert.equal(f.requests.length, 1); assert.match(f.speech[0][0], /^The previous reply target.*Refresh the thread/);
  assert.equal(f.lease.failedAttempt().parentId, "parent"); assert.equal(f.lease.read().parentId, "other");
  f.rows([{ id: "parent", userId: "author", text: "Restored" }]); void f.press("Retry previous comment");
  assert.deepEqual(f.requests[1].args, f.requests[0].args); await f.complete(); f.tick(); assert.equal(f.speech[1][0], "Comment confirmed.");
});

test("empty, loading, unavailable and stale Retry callbacks stay silent", async t => {
  for (const options of [{}, { ready: false }, { unavailable: true }]) {
    const f = fixture(options); t.after(f.close); await f.settle(); if (!options.unavailable && options.ready === false) f.edit("Draft");
    await f.press("Send comment"); assert.equal(f.requests.length, 0); assert.equal(f.timers.length, 0);
  }
  const f = fixture(); t.after(f.close); await f.settle(); f.edit("First"); void f.press("Send comment"); await f.complete({ ok: false });
  const stale = f.button("Retry previous comment").props.onPress;
  f.press("Discard previous attempt"); assert.equal(f.timers[0].cleared, true);
  f.act(() => f.alerts[0][2][1].onPress()); f.edit("Second"); void f.press("Send comment"); await f.complete({ ok: false });
  const count = f.timers.length; await stale(); assert.equal(f.requests.length, 2); assert.equal(f.timers.length, count);
  f.tick(f.timers[0]); assert.deepEqual(f.speech, []); f.tick(); assert.equal(f.speech.length, 1);
});

test("retained failure remount is silent; delivery after leave still settles and never speaks", async t => {
  const f = fixture(); t.after(f.close); await f.settle(); f.edit("Attempt"); void f.press("Send comment"); f.close();
  await f.complete({ ok: false }); assert.equal(f.lease.read().retry, true); assert.equal(f.timers.length, 0);
  f.render(); await f.settle(); assert.equal(f.timers.length, 0); assert.ok(f.button("Retry previous comment"));
  void f.press("Retry previous comment"); f.close(); await f.complete(); assert.equal(f.lease.read().text, ""); assert.equal(f.lease.read().retry, false); assert.deepEqual(f.speech, []);
});

test("captured Send after navigation and null delivery claims cannot arm speech", async t => {
  const f = fixture(); t.after(f.close); await f.settle(); f.edit("Draft"); const send = f.button("Send comment").props.onPress;
  f.close(); await send(); assert.equal(f.requests.length, 0); assert.equal(f.timers.length, 0);
  f.render(); await f.settle(); f.press("Reply to comment"); f.rows([]);
  // A declined lease claim with no validation publication must not be inferred
  // to be an invalid-parent outcome just from the displayed reply target.
  const lease = f.lease; f.replaceLease({ ...lease, claim: () => null });
  await f.press("Send comment"); assert.equal(f.requests.length, 0); assert.equal(f.timers.length, 0);
});

for (const timing of ["request", "timer"]) for (const transition of ["inactive", "background", "reader"]) test(`${transition} round trip during ${timing} permanently revokes action`, async t => {
  const f = fixture(); t.after(f.close); await f.settle(); f.edit("Draft"); void f.press("Send comment"); if (timing === "timer") await f.complete();
  // Same synchronous event turn, before React can render the final boolean.
  f.act(() => { if (transition === "reader") { f.reader(false); f.reader(true); } else { f.state(transition); f.state("active"); } });
  if (timing === "request") await f.complete(); for (const timer of f.timers) f.tick(timer);
  assert.deepEqual(f.speech, []); assert.equal(f.lease.read().sending, false); assert.equal(f.lease.read().text, "");
  f.edit("Fresh"); void f.press("Send comment"); await f.complete(); f.tick(); assert.equal(f.speech.length, 1);
});

test("unknown/off/background at acceptance never replays after reader/foreground becomes eligible", async t => {
  for (const condition of ["unknown", "off", "background"]) {
    const f = fixture({ reader: condition === "unknown" ? null : condition !== "off" }); t.after(f.close); await f.settle();
    if (condition === "background") f.state("background"); f.edit("Draft"); void f.press("Send comment");
    f.reader(true); f.state("active"); if (condition === "unknown") f.queries[0].resolve(true); await f.complete();
    assert.equal(f.timers.length, 0); assert.deepEqual(f.speech, []); assert.equal(f.lease.read().text, "");
  }
});

test("account, auth epoch, post and lease transitions revoke requests and timers, including A B A", async t => {
  for (const keyed of [true, false]) for (const timing of ["request", "timer"]) for (const change of ["account", "epoch", "post", "lease"]) {
    const f = fixture({ keyed }); t.after(f.close); await f.settle(); f.edit("Old"); void f.press("Send comment"); if (timing === "timer") await f.complete();
    if (change === "account") { f.scope("B"); f.scope("A"); }
    if (change === "epoch") { f.scope("A", 2); f.scope("A", 3); }
    if (change === "post") { f.scope("A", 1, "other"); f.scope("A", 1, "post"); }
    if (change === "lease") { f.replaceLease(f.owner.lease("other")); f.replaceLease(f.owner.lease("post")); }
    if (timing === "request") await f.complete(); for (const timer of f.timers) f.tick(timer); assert.deepEqual(f.speech, []);
  }
});

test("stale results never speak, even with ok true", async t => {
  for (const ok of [true, false]) { const f = fixture(); t.after(f.close); await f.settle(); f.edit("Draft"); void f.press("Send comment"); await f.complete({ ok, stale: true }); assert.equal(f.timers.length, 0); }
});

test("new accepted action supersedes queued speech; cancelled callback cannot speak or clear newer timer", async t => {
  const f = fixture(); t.after(f.close); await f.settle(); f.edit("First"); void f.press("Send comment"); await f.complete({ ok: false }); const old = f.timers[0];
  void f.press("Retry previous comment"); assert.equal(old.cleared, true); await f.complete(); const next = f.timers[1];
  f.tick(old); assert.equal(next.cleared, false); assert.deepEqual(f.speech, []); f.tick(next); f.tick(old); f.tick(next); assert.deepEqual(f.speech, [["Comment confirmed.", { queue: true }]]);
});

test("StrictMode removed listeners cannot cancel newer speech; hook duplicate completion is one-shot", async t => {
  const f = fixture({ strict: true, hookOnly: true }); t.after(f.close); await f.settle();
  assert.ok(f.captured.get("change").length >= 2); const claim = f.hook.begin(); f.hook.finish(claim, "confirmed"); f.hook.finish(claim, "unconfirmed");
  f.act(() => { f.captured.get("change")[0]("background"); f.captured.get("screenReaderChanged")[0](false); });
  assert.equal(f.timers.length, 1); f.tick(); f.tick(); assert.deepEqual(f.speech, [["Comment confirmed.", { queue: true }]]);
  const pending = f.hook.begin(); f.close(); f.render(); await f.settle(); f.hook.finish(pending, "confirmed"); assert.equal(f.timers.length, 1);
});

test("StrictMode cleanup permanently revokes an already queued mount lifecycle timer", async t => {
  const f = fixture({ strict: true, hookOnly: true, announceOnMount: true }); t.after(f.close); await f.settle();
  assert.equal(f.timers.length, 2); assert.equal(f.timers[0].cleared, true);
  f.tick(f.timers[0]); assert.deepEqual(f.speech, []); assert.equal(f.timers[1].cleared, false);
  f.tick(f.timers[1]); f.tick(f.timers[0]); assert.deepEqual(f.speech, [["Comment confirmed.", { queue: true }]]);
});

test("Android/web resolve inert hook and keep existing composer behavior with no native speech subscription", async t => {
  for (const platform of ["android", "web"]) {
    const f = fixture({ platform }); t.after(f.close); await f.settle(); f.edit("Draft");
    assert.equal(typeof f.input.props.onSubmitEditing, "function"); void f.press("Send comment"); await f.complete(); assert.equal(f.input.props.value, "");
    assert.equal(f.timers.length, 0); assert.equal(f.queries.length, 0); assert.equal(f.listeners.size, 0); assert.deepEqual(f.speech, []);
  }
  const fallback = readFileSync(new URL("../hooks/useIOSCommentAnnouncement.js", import.meta.url), "utf8"); assert.doesNotMatch(fallback, /import |AccessibilityInfo|AppState/);
});

test("foreground check revokes rather than suspends before the AppState event arrives", async t => {
  for (const timing of ["request", "timer"]) {
    const f = fixture({ hookOnly: true }); t.after(f.close); await f.settle(); const claim = f.hook.begin();
    if (timing === "timer") f.hook.finish(claim, "confirmed");
    f.rawState("inactive"); if (timing === "timer") f.tick(); else f.hook.finish(claim, "confirmed");
    f.rawState("active"); f.hook.finish(claim, "confirmed"); for (const timer of f.timers) f.tick(timer);
    assert.deepEqual(f.speech, []);
  }
});
