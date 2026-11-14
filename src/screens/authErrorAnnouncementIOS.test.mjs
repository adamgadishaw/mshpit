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
function createRenderer(events) {
  const context = {}, container = { children: [] };
  let priority = 0;
  const append = (parent, child) => parent.children.push(child);
  const remove = (parent, child) => { const index = parent.children.indexOf(child); if (index >= 0) parent.children.splice(index, 1); };
  const insert = (parent, child, before) => parent.children.splice(parent.children.indexOf(before), 0, child);
  const renderer = reconciler({
    supportsMutation: true, isPrimaryRenderer: true, supportsPersistence: false, supportsHydration: false,
    getRootHostContext: () => context, getChildHostContext: () => context, getPublicInstance: node => node,
    prepareForCommit: () => null, resetAfterCommit: noop,
    createInstance: (type, props) => ({ type, props, children: [], focus() { events.push(type); }, scrollTo() {} }), createTextInstance: text => ({ text }),
    appendInitialChild: append, appendChild: append, appendChildToContainer: append,
    removeChild: remove, removeChildFromContainer: remove, insertBefore: insert, insertInContainerBefore: insert,
    finalizeInitialChildren: () => false, shouldSetTextContent: () => false,
    commitUpdate: (node, type, oldProps, newProps) => { node.props = newProps; }, commitTextUpdate: (node, oldText, text) => { node.text = text; },
    clearContainer: node => { node.children = []; }, resetTextContent: noop, commitMount: noop,
    scheduleTimeout: setTimeout, cancelTimeout: clearTimeout, noTimeout: -1, supportsMicrotasks: true, scheduleMicrotask: queueMicrotask,
    getCurrentUpdatePriority: () => priority, setCurrentUpdatePriority: value => { priority = value; }, resolveUpdatePriority: () => priority || 32,
    shouldAttemptEagerTransition: () => false, detachDeletedInstance: noop, maySuspendCommit: () => false, preloadInstance: () => true,
    startSuspendingCommit: noop, suspendInstance: noop, waitForCommitToBeReady: () => null, NotPendingTransition: null,
    HostTransitionContext: React.createContext(null), hideInstance: node => { node.hidden = true; }, unhideInstance: node => { node.hidden = false; }, hideTextInstance: noop, unhideTextInstance: noop, resetFormInstance: noop, bindToConsole: (method, args) => console[method].bind(console, ...args),
  });
  const fail = error => { throw error; };
  const root = renderer.createContainer(container, 1, null, false, null, "", fail, fail, fail, null);
  const flush = () => { for (let i = 0; i < 5; i++) { renderer.flushSyncWork(); if (!renderer.flushPassiveEffects()) break; } };
  return { container, render(element) { renderer.updateContainerSync(element, root, null, null); flush(); },
    act(callback) { renderer.flushSyncFromReconciler(callback); flush(); } };
}
const nodes = node => [node, ...(node.children || []).flatMap(nodes)];
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };


// Actual AuthScreen, native CredentialForm, React and shared known-reader owner.
// No service/network calls: every credential, response, native event is synthetic.
function fixture({ platform = "ios", strict = false, reader = true, hookOnly = false } = {}) {
  const events = [], renderer = createRenderer(events), listeners = new Map(), captured = new Map();
  const timers = [], speech = [], requests = [], queries = [], done = [];
  let account = null, epoch = 1, scope = "one", hook, suspend = false, throwSpeech = false;
  const navigationAbortRef = { current: null };
  const clock = { setTimeout(callback) { const timer = { callback, cleared: false }; timers.push(timer); return timer; }, clearTimeout(timer) { timer.cleared = true; } };
  const listen = (name, callback) => {
    const active = listeners.get(name) || new Set(); active.add(callback); listeners.set(name, active);
    const history = captured.get(name) || []; history.push(callback); captured.set(name, history);
    return { remove: () => active.delete(callback) };
  };
  const native = {
    View: "View", Text: "Text", TextInput: "TextInput", Pressable: "Pressable", ScrollView: "ScrollView", ActivityIndicator: "ActivityIndicator", KeyboardAvoidingView: "KeyboardAvoidingView",
    Platform: { OS: platform }, StyleSheet: { create: value => value },
    AppState: { currentState: "active", addEventListener: listen },
    AccessibilityInfo: {
      addEventListener: listen,
      isScreenReaderEnabled: () => { const query = deferred(); queries.push(query); if (reader !== null) query.resolve(reader); return query.promise; },
      announceForAccessibilityWithOptions: (...args) => { if (throwSpeech) throw Error("native synthetic failure"); speech.push(args); },
    },
  };
  let preference, announcement, credential;
  const request = (kind, args) => { const value = { ...deferred(), kind, args }; requests.push(value); return value.promise; };
  const imports = (name, local) => {
    if (name === "react") return React;
    if (name === "react/jsx-runtime") return require(name);
    if (name === "react-native") return native;
    if (name === "react-native-safe-area-context") return { useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) };
    if (name === "./useScreenReaderEnabled") return preference;
    if (name === "../hooks/useIOSAuthErrorAnnouncement") return announcement;
    if (name === "../components/credential-form") return credential;
    if (name === "../features/signupHandle/useSignupHandleAvailability") return { useSignupHandleAvailability: () => ({ resource: { status: "idle" }, retry: noop }) };
    if (name === "../lib/lazyWithRetry") return { lazyWithRetry: () => "Policy" };
    if (name === "../theme") return { colors: {}, radius: {}, shadow: {}, space: n => n };
    if (name === "../store") return { useStore: () => ({ session: account ? { id: account } : null, chatAuthEpoch: epoch,
      login: (...args) => request("login", args), signup: (...args) => request("signup", args), forgotPassword: (...args) => request("reset", args) }) };
    if (name.startsWith("../components/")) return name.split("/").at(-1);
    return local(name);
  };
  if (platform === "ios") preference = execute("../hooks/useScreenReaderEnabled.ios.js", imports);
  announcement = execute(`../hooks/useIOSAuthErrorAnnouncement${platform === "ios" ? ".ios" : ""}.js`, imports, clock);
  credential = execute("../components/credential-form.jsx", imports);
  const Auth = execute("./AuthScreen.jsx", imports).default;
  const never = new Promise(() => {});
  function MaybeSuspend() { if (suspend) throw never; return null; }
  function Hook() { hook = announcement.default(account, epoch, scope); return null; }
  const f = {
    timers, speech, requests, queries, captured, listeners, done, events, navigationAbortRef,
    get hook() { return hook; },
    all: () => nodes(renderer.container), find: predicate => { const node = f.all().find(predicate); assert.ok(node); return node; },
    input: name => f.find(n => n.type === "TextInput" && n.props.nativeID.endsWith(`-${name}`)),
    button: label => f.find(n => n.type === "Pressable" && (n.props.accessibilityLabel === label || nodes(n).some(child => child.text === label))),
    act: callback => renderer.act(callback),
    press(label) { let result; f.act(() => { result = f.button(label).props.onPress(); }); return result; },
    edit(name, text) { f.act(() => f.input(name).props.onChangeText(text)); },
    credentials() { f.edit("email", "synthetic@example.test"); f.edit("password", "synthetic-password1"); },
    render() { renderer.render(React.createElement(strict ? React.StrictMode : React.Fragment, null,
      React.createElement(React.Suspense, { fallback: "Loading" }, React.createElement(hookOnly ? Hook : Auth, { navigationAbortRef, onDone: (...args) => done.push(args) }), React.createElement(MaybeSuspend)))); },
    scope(id, nextEpoch = epoch, nextScope = scope) { account = id; epoch = nextEpoch; scope = nextScope; f.render(); },
    suspend(value) { suspend = value; f.render(); },
    reader(value) { f.act(() => { for (const callback of [...listeners.get("screenReaderChanged") || []]) callback(value); }); },
    state(value) { native.AppState.currentState = value; f.act(() => { for (const callback of [...listeners.get("change") || []]) callback(value); }); },
    tick(timer = timers.at(-1)) { assert.ok(timer); f.act(() => timer.callback()); },
    async settle() { for (let i = 0; i < 8; i++) await Promise.resolve(); await new Promise(setImmediate); f.act(() => {}); },
    async complete(result = { ok: false, error: { userMessage: "Synthetic private server text" } }, index = requests.length - 1) { requests[index].resolve(result); await f.settle(); },
    throwSpeech() { throwSpeech = true; },
    close: () => renderer.render(null),
  };
  f.render(); return f;
}

const loginMessage = "Sign-in could not be confirmed. Review the error before trying again.";
test("actual login + form: same-tick single flight, retained password, fixed failure once, retry", async t => {
  const f = fixture(); t.after(f.close); await f.settle(); f.credentials();
  assert.equal(f.input("password").props.returnKeyType, "go");
  const press = f.button("Log in").props.onPress;
  f.act(() => { void press(); void press(); }); assert.equal(f.requests.length, 1);
  await f.complete(); assert.equal(f.input("password").props.value, "synthetic-password1");
  assert.ok(f.events.includes("Text")); assert.equal(f.button("Log in").props.disabled, false);
  f.tick(); f.tick(); assert.deepEqual(f.speech, [[loginMessage, { queue: true }]]);
  f.act(() => { void f.input("password").props.onSubmitEditing(); }); await f.complete(); f.tick();
  assert.equal(f.requests.length, 2); assert.equal(f.speech.length, 2);
});

test("rejection and native speech throw are independent of auth settlement", async t => {
  const f = fixture(); t.after(f.close); await f.settle(); f.credentials(); void f.press("Log in");
  f.requests[0].reject(Error("synthetic@example.test synthetic-password1 private")); await f.settle();
  f.throwSpeech(); f.tick(); assert.equal(f.button("Log in").props.disabled, false); assert.equal(f.input("password").props.value, "synthetic-password1");
  void f.press("Log in"); await f.complete({ ok: true, accountId: "account" });
  assert.equal(f.done.length, 1); assert.equal(f.input("password").props.value, ""); assert.equal(f.speech.length, 0);
});

for (const when of ["request", "timer"]) for (const transition of ["reader", "inactive", "background"]) test(`${transition} roundtrip before ${when} revokes without changing auth`, async t => {
  const f = fixture(); t.after(f.close); await f.settle(); f.credentials(); void f.press("Log in");
  if (when === "timer") await f.complete();
  f.act(() => { if (transition === "reader") { f.reader(false); f.reader(true); } else { f.state(transition); f.state("active"); } });
  if (when === "request") await f.complete();
  f.timers.forEach(timer => f.tick(timer)); assert.deepEqual(f.speech, []); assert.equal(f.input("password").props.value, "synthetic-password1");
  void f.press("Log in"); await f.complete(); f.tick(); assert.equal(f.speech.length, 1);
});

for (const reader of [null, false]) test(`reader=${reader} at acceptance never retroactively arms`, async t => {
  const f = fixture({ reader }); t.after(f.close); await f.settle(); f.credentials(); void f.press("Log in"); f.reader(true); await f.complete(); assert.equal(f.timers.length, 0);
});
test("background acceptance cannot arm after returning", async t => {
  const f = fixture(); t.after(f.close); await f.settle(); f.credentials(); f.state("background"); void f.press("Log in"); f.state("active"); await f.complete(); assert.equal(f.timers.length, 0);
});

for (const result of [{ ok: false }, { ok: true, accountId: "stale" }]) test(`navigation abort fences stale ${result.ok ? "success" : "failure"}`, async t => {
  const f = fixture(); t.after(f.close); await f.settle(); f.credentials(); void f.press("Log in");
  f.act(() => f.navigationAbortRef.current()); assert.equal(f.requests[0].args[3].signal.aborted, true);
  await f.complete(result); assert.equal(f.timers.length, 0); assert.equal(f.done.length, 0); assert.equal(f.input("password").props.value, "");
});
test("navigation after settlement cancels queued error even with no pending auth", async t => {
  const f = fixture(); t.after(f.close); await f.settle(); f.credentials(); void f.press("Log in"); await f.complete();
  f.act(() => f.navigationAbortRef.current()); f.tick(); assert.deepEqual(f.speech, []);
});

for (const change of ["input", "mode", "account", "epoch", "unmount", "suspend"]) test(`${change} revokes queued failure; remount never replays`, async t => {
  const f = fixture({ strict: true }); t.after(f.close); await f.settle(); f.credentials(); void f.press("Log in"); await f.complete();
  if (change === "input") f.edit("email", "newer@example.test");
  if (change === "mode") f.press("No account? Sign up");
  if (change === "account") f.scope("other");
  if (change === "epoch") f.scope(null, 2);
  if (change === "unmount") { f.close(); f.render(); }
  if (change === "suspend") { f.suspend(true); f.suspend(false); }
  f.tick(); assert.deepEqual(f.speech, []);
});

test("older captured timer cannot clear newer queued failure", async t => {
  const f = fixture(); t.after(f.close); await f.settle(); f.credentials(); void f.press("Log in"); await f.complete(); const old = f.timers[0];
  void f.press("Log in"); await f.complete(); const fresh = f.timers[1]; f.tick(old); assert.equal(fresh.cleared, false); assert.deepEqual(f.speech, []); f.tick(fresh); assert.equal(f.speech.length, 1);
});

test("invalid fields and forgot-password flow retain existing behavior without auth speech", async t => {
  const f = fixture(); t.after(f.close); await f.settle(); await f.press("Log in"); assert.equal(f.requests.length, 0); assert.equal(f.timers.length, 0); assert.ok(f.events.includes("TextInput"));
  f.credentials(); f.press("Forgot password?"); void f.press("Send reset link"); await f.complete(); assert.equal(f.requests[0].kind, "reset"); assert.equal(f.timers.length, 0);
});

async function signupReady(f) {
  f.press("No account? Sign up"); f.edit("name", "Synthetic Person"); f.edit("handle", "synthetic_person");
  await f.press("Continue to sign-in"); f.credentials(); await f.press("Continue to music");
  const genre = f.find(n => n.type === "Pressable" && n.props.accessibilityRole === "checkbox"); f.act(() => genre.props.onPress());
  await f.press("Continue to the last step"); f.press("18+"); f.press("I agree to the Terms and Privacy policy");
}
test("actual signup failure speaks fixed copy; HANDLE_TAKEN keeps field focus only", async t => {
  const f = fixture(); t.after(f.close); await f.settle(); await signupReady(f); void f.press("Create account"); assert.equal(f.requests[0].kind, "signup"); await f.complete(); f.tick();
  assert.deepEqual(f.speech, [["Account creation could not be confirmed. Review the error before trying again.", { queue: true }]]);
  void f.press("Create account"); await f.complete({ ok: false, error: { serverCode: "HANDLE_TAKEN", userMessage: "Username taken" } });
  assert.equal(f.timers.length, 1); assert.equal(f.input("password").props.value, "synthetic-password1");
});

for (const platform of ["android", "web"]) test(`${platform} default hook is inert and actual auth unchanged`, async t => {
  const f = fixture({ platform }); t.after(f.close); await f.settle(); f.credentials(); void f.press("Log in"); await f.complete();
  assert.equal(f.input("password").props.value, "synthetic-password1"); assert.equal(f.queries.length, 0); assert.equal(f.listeners.size, 0); assert.equal(f.timers.length, 0); assert.equal(f.speech.length, 0);
});

test("stale hook controls, signals and listeners cannot cancel new scope's timer", async t => {
  const f = fixture({ hookOnly: true }); t.after(f.close); await f.settle(); const old = f.hook, abort = new AbortController();
  const claim = old.begin(abort.signal); old.finish(claim, false); const timer = f.timers[0];
  const listener = f.captured.get("change")[0]; f.close(); f.render(); await f.settle();
  f.scope("new", 2, "two"); const current = f.hook; current.finish(current.begin(new AbortController().signal), false); const fresh = f.timers.at(-1);
  old.cancel(); assert.equal(old.begin(), null); old.finish(claim, false); abort.abort(); listener("background"); f.tick(timer);
  assert.equal(fresh.cleared, false); f.tick(fresh); assert.equal(f.speech.length, 1);
});

for (const change of ["input", "account", "epoch", "unmount", "suspend"]) test(`${change} during deferred login permanently revokes later failure`, async t => {
  const f = fixture(); t.after(f.close); await f.settle(); f.credentials(); void f.press("Log in");
  if (change === "input") f.edit("email", "later@example.test");
  if (change === "account") f.scope("different");
  if (change === "epoch") f.scope(null, 2);
  if (change === "unmount") { f.close(); f.render(); }
  if (change === "suspend") { f.suspend(true); f.suspend(false); }
  await f.complete(); assert.equal(f.timers.length, 0); assert.deepEqual(f.speech, []);
});

test("signup intent and inline policy changes revoke queued failure", async t => {
  for (const label of ["Share optional limited account usage data", "Read Terms", "Read Privacy policy", "Back to music"]) {
    const f = fixture(); t.after(f.close); await f.settle(); await signupReady(f); void f.press("Create account"); await f.complete();
    f.press(label); f.tick(); assert.deepEqual(f.speech, []);
  }
});

test("successful account choice is silent; accepted account selection failure uses login copy", async t => {
  const f = fixture(); t.after(f.close); await f.settle(); f.credentials(); void f.press("Log in");
  await f.complete({ ok: true, chooseAccount: true, accounts: [{ id: "first", name: "Synthetic", handle: "person" }] });
  assert.equal(f.timers.length, 0); assert.equal(f.input("password").props.value, "synthetic-password1");
  void f.press("Synthetic · @person"); await f.complete(); f.tick(); assert.equal(f.speech[0][0], loginMessage);
  assert.equal(f.requests[1].args[2], "first");
});

test("unknown initial lookup and late native events cannot revive interrupted attempt", async t => {
  const f = fixture({ reader: null }); t.after(f.close); await f.settle(); f.reader(true); f.credentials(); void f.press("Log in");
  f.reader(false); f.queries[0].resolve(true); await f.settle(); f.reader(true); await f.complete(); assert.equal(f.timers.length, 0);
});

test("hook deduplicates finish; old abort listeners and callbacks leave newer timer alone", async t => {
  const f = fixture({ hookOnly: true, strict: true }); t.after(f.close); await f.settle();
  const a = new AbortController(), old = f.hook.begin(a.signal); f.hook.finish(old, false); f.hook.finish(old, false); assert.equal(f.timers.length, 1);
  const next = f.hook.begin(new AbortController().signal); f.hook.finish(next, false); const fresh = f.timers[1];
  a.abort(); f.tick(f.timers[0]); f.hook.finish(old, false); assert.equal(fresh.cleared, false); f.tick(fresh); assert.equal(f.speech.length, 1);
});


test("captured controls cannot borrow reconnected same-scope Suspense lifetime", async t => {
  const f = fixture({ hookOnly: true, strict: true }); t.after(f.close); await f.settle(); const old = f.hook;
  f.suspend(true); f.suspend(false); await f.settle();
  assert.equal(old.begin(new AbortController().signal), null); old.finish(null, false); assert.equal(f.timers.length, 0);
  const fresh = f.hook; fresh.finish(fresh.begin(new AbortController().signal), false); old.cancel();
  assert.equal(f.timers[0].cleared, false); f.tick(); assert.equal(f.speech.length, 1);
});


test("actual captured CredentialSubmit after Suspense may retain legacy auth but never old speech", async t => {
  const f = fixture({ strict: true }); t.after(f.close); await f.settle(); f.credentials(); const oldPress = f.button("Log in").props.onPress;
  f.suspend(true); f.suspend(false); await f.settle(); f.act(() => { void oldPress(); }); await f.complete();
  assert.equal(f.requests.length, 1); assert.equal(f.timers.length, 0); assert.deepEqual(f.speech, []);
  void f.press("Log in"); await f.complete(); f.tick(); assert.equal(f.speech.length, 1);
});

test("successful and field-focused auth results retire the optional signal listener", async t => {
  const f = fixture(); t.after(f.close); await f.settle(); f.credentials(); void f.press("Log in");
  const successSignal = f.requests[0].args[3].signal; assert.equal(getEventListeners(successSignal, "abort").length, 1);
  await f.complete({ ok: true, accountId: "synthetic" }); assert.equal(getEventListeners(successSignal, "abort").length, 0);
  await signupReady(f); void f.press("Create account"); const fieldSignal = f.requests[1].args[1].signal;
  await f.complete({ ok: false, error: { serverCode: "HANDLE_TAKEN" } }); assert.equal(getEventListeners(fieldSignal, "abort").length, 0); assert.equal(f.timers.length, 0);
});
