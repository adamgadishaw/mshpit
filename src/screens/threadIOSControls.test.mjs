import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { createIOSMessageDrafts } from "../domain/iosMessageDrafts.mjs";
import { createIOSLinkedNavigation } from "../domain/iosLinkedNavigation.mjs";
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
    hideInstance: node => { node.hidden = true; }, unhideInstance: node => { node.hidden = false; }, hideTextInstance: noop, unhideTextInstance: noop,
    HostTransitionContext: React.createContext(null), resetFormInstance: noop, bindToConsole: (method, args) => console[method].bind(console, ...args),
  });
  const fail = error => { throw error; };
  const root = renderer.createContainer(container, 1, null, false, null, "", fail, fail, fail, null);
  const flush = () => { for (let i = 0; i < 5; i++) { renderer.flushSyncWork(); if (!renderer.flushPassiveEffects()) break; } };
  return { container, renderLayout(element) { renderer.updateContainerSync(element, root, null, null); renderer.flushSyncWork(); }, flush, render(element) { renderer.updateContainerSync(element, root, null, null); flush(); },
    act(callback) { renderer.flushSyncFromReconciler(callback); flush(); } };
}
const nodes = node => node.hidden ? [] : [node, ...(node.children || []).flatMap(nodes)];
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };

// Actual React, ThreadScreen, platform admission hook, retained draft owner,
// Root route expression and Root navigation functions. All Store/native/API
// boundaries are synthetic: no live DM route, read receipt or network access.
const rootSource = readFileSync(new URL("../../App.js", import.meta.url), "utf8");
const route = rootSource.split("\n").find(line => line.includes("overlay = <ThreadScreen"));
const routeCode = transformSync(`export default function route({ Platform, nav, navigationRef, linkedNavigationRef, linkedNavigationScope, messageDraftsRef, back, onOpenProfile, onOpenProfileByHandle, onReport, ThreadScreen }) {
  const openProfile = onOpenProfile, openProfileByHandle = onOpenProfileByHandle, openReport = onReport;
  ${route.replace("else if", "if").replace("overlay =", "var overlay =")} return overlay;
}`, { babelrc: false, configFile: false, plugins: [[require("@babel/plugin-transform-react-jsx"), { runtime: "automatic" }], require("@babel/plugin-transform-modules-commonjs")] }).code;
const routeModule = { exports: {} };
new Function("require", "module", "exports", routeCode)(require, routeModule, routeModule.exports);
const rootAST = require("@babel/parser").parse(rootSource, { sourceType: "module", plugins: ["jsx"] }).program.body.find(n => n.type === "FunctionDeclaration" && n.id?.name === "Root");
const commandNames = ["cancelPublicRoute", "applyNavigation", "writeNavigation", "commitGo", "popStack"];
const commands = rootAST.body.body.flatMap(statement => statement.type === "VariableDeclaration" ? statement.declarations : [])
  .filter(node => commandNames.includes(node.id?.name)).map(node => `const ${node.id.name} = ${rootSource.slice(node.init.start, node.init.end)};`).join("\n");
const rootCommands = new Function("Platform", "navigationRef", "stackRef", "linkedNavigationRef", "session", `
  const noop = () => {}, web = false;
  const publicLookup = {}, publicNavigationPendingRef = {}, publicRouteRequestRef = {}, authNavigationAbortRef = {};
  const setPublicNavigationNotice = noop, cancelNewsStory = noop, setStack = noop, setTab = noop, setLanding = noop;
  const prepareAvailableNavigationFrame = value => value, navigationFrameForAccount = value => value, pathForFrame = () => "/fixture";
  ${commands}
  return { go: commitGo, back: popStack };
`);

function fixture({ platform = "ios", strict = false, capacity = 32, messageRequest = false } = {}) {
  const renderer = createRenderer(), sends = [], retries = [], cancels = [], reads = [], accepts = [];
  const drafts = createIOSMessageDrafts({ capacity });
  const linkedNavigationRef = { current: createIOSLinkedNavigation() }; linkedNavigationRef.current.mount();
  let account = "A", epoch = 1, suspended = false;
  const initialFrame = { thread: "recipient" };
  const navigationRef = { current: { stack: [{}, initialFrame], tab: "feed", landing: false } };
  const stackRef = { current: navigationRef.current.stack };
  const native = { Platform: { OS: platform }, StyleSheet: { create: value => value },
    useWindowDimensions: () => ({ width: 390, height: 844, fontScale: 1 }),
    ...Object.fromEntries(["View", "Text", "TextInput", "Pressable", "ScrollView", "ActivityIndicator", "KeyboardAvoidingView"].map(name => [name, name])) };
  const request = (list, args) => { const value = { ...deferred(), args }; list.push(value); return value.promise; };
  let controls;
  const imports = (name, local) => {
    if (name === "react") return React;
    if (name === "react/jsx-runtime") return require(name);
    if (name === "react-native") return native;
    if (name === "../hooks/useIOSThreadControls") return controls;
    if (name === "../hooks/useIOSThreadRefreshAnnouncement") return () => ({ begin: () => null, finish: noop });
    if (name === "../hooks/useScopedRefresh") return () => ({ refreshing: false, refresh: noop });
    if (name === "../lib/useLiveChat") return noop;
    if (name === "../lib/useChatScroll") return () => ({ scrollRef: { current: null }, onScroll: noop, onContentSizeChange: noop });
    if (name === "../theme") return { colors: {}, radius: {}, mono: "mono" };
    if (name === "../store") return { useStore: () => ({
      session: account ? { id: account } : null, chatAuthEpoch: epoch,
      userById: id => ({ id, name: "Fixture member" }),
      threadMessages: () => [{ id: "failed-row", text: "Failed draft", failed: true, from: account }],
      sendDM: (...args) => request(sends, args), retryChatMessage: (...args) => request(retries, args),
      cancelChatMessage: id => { cancels.push(id); return true; },
      loadThread: (...args) => { reads.push(args); return Promise.resolve({}); },
      markThreadRead: () => { throw new Error("Unexpected read marker"); }, loadUser: noop,
      getDMRequestState: () => messageRequest ? "pending" : null,
      acceptDMRequest: (...args) => request(accepts, args),
    }) };
    if (name.startsWith("../components/")) return name.split("/").at(-1);
    assert.ok(name.startsWith("../domain/"), `Unexpected dependency: ${name}`);
    return local(name);
  };
  controls = execute(`../hooks/useIOSThreadControls${platform === "ios" ? ".ios" : ""}.js`, imports);
  const Thread = execute("./ThreadScreen.jsx", imports).default;
  const suspension = new Promise(() => {});
  function MaybeSuspend() { if (suspended) throw suspension; return null; }
  const command = () => rootCommands(native.Platform, navigationRef, stackRef, linkedNavigationRef, account ? { id: account } : null);
  const f = {
    sends, retries, cancels, reads, accepts, drafts, navigationRef, linkedNavigationRef,
    get lease() { return drafts.lease(navigationRef.current.stack.at(-1).thread || "recipient"); },
    all: () => nodes(renderer.container),
    find: predicate => { const node = f.all().find(predicate); assert.ok(node, "Expected rendered control"); return node; },
    get input() { return f.find(n => n.type === "TextInput"); },
    get header() { return f.find(n => n.type === "ScreenHeader"); },
    button: label => f.find(n => n.type === "Pressable" && n.props.accessibilityLabel === label),
    capture() { return {
      edit: f.input.props.onChangeText, submit: f.input.props.onSubmitEditing,
      tap: f.button("Send direct message to Fixture member").props.onPress,
      retry: f.button("Retry direct message").props.onPress, cancel: f.button("Cancel failed message").props.onPress,
      accept: messageRequest ? f.button("Accept message request").props.onPress : undefined,
    }; },
    edit(value) { f.act(() => f.input.props.onChangeText(value)); },
    send() { let result; f.act(() => { result = platform === "ios" ? f.button("Send direct message to Fixture member").props.onPress() : f.input.props.onSubmitEditing(); }); return result; },
    retry() { let result; f.act(() => { result = f.button("Retry direct message").props.onPress(); }); return result; },
    act: callback => renderer.act(callback),
    render() {
      drafts.account(account, epoch);
      const linkedNavigationScope = linkedNavigationRef.current.account(account, epoch);
      const nav = navigationRef.current.stack.at(-1);
      const element = nav.thread ? routeModule.exports.default({ Platform: native.Platform, nav, navigationRef, linkedNavigationRef,
        linkedNavigationScope, messageDraftsRef: { current: drafts }, ThreadScreen: Thread,
        back: () => { command().back(); f.render(); },
        onOpenProfile: id => { command().go({ profileId: id }); f.render(); }, onOpenProfileByHandle: noop, onReport: noop,
      }) : React.createElement("Profile");
      renderer.render(React.createElement(strict ? React.StrictMode : React.Fragment, null,
        React.createElement(React.Suspense, { fallback: React.createElement("Fallback") }, element, React.createElement(MaybeSuspend))));
    },
    scope(id = account, nextEpoch = epoch, recipient) {
      account = id; epoch = nextEpoch;
      if (recipient) command().go({ thread: recipient });
      f.render();
    },
    authBeforeRender(id, nextEpoch) { account = id; epoch = nextEpoch; drafts.account(account, epoch); linkedNavigationRef.current.account(account, epoch); },
    goBeforeRender(frame) { command().go(frame); },
    popBeforeRender() { command().back(); },
    profile() { f.act(() => f.header.props.right.props.onPress()); },
    back() { command().back(); f.render(); },
    suspend(value) { suspended = value; f.render(); },
    unmountLayout() { renderer.renderLayout(null); },
    close() { renderer.render(null); },
    async settle() { for (let i = 0; i < 8; i++) await Promise.resolve(); await new Promise(setImmediate); f.act(noop); },
    async complete(list, index = list.length - 1, result = { ok: true }) { list[index].resolve(result); await f.settle(); },
  };
  f.render(); return f;
}
const invokeRetired = (f, old) => f.act(() => { old.edit("Retired overwrite"); void old.submit?.(); void old.tap(); void old.retry(); old.cancel(); void old.accept?.(); });
const noCommands = f => { assert.equal(f.sends.length, 0); assert.equal(f.retries.length, 0); assert.deepEqual(f.cancels, []); assert.deepEqual(f.reads, []); assert.equal(f.accepts.length, 0); };

test("request acceptance needs a current route and does not send a reply", async t => {
  const f = fixture({ messageRequest: true }); t.after(f.close); await f.settle();
  const old = f.capture(); f.goBeforeRender({ profileId: "member" });
  invokeRetired(f, old); noCommands(f); f.render(); f.back(); await f.settle();
  const accept = f.button("Accept message request").props.onPress;
  f.act(() => { void accept(); void accept(); });
  assert.equal(f.accepts.length, 1); assert.deepEqual(f.accepts[0].args, ["recipient"]);
  assert.equal(f.sends.length, 0);
  await f.complete(f.accepts, 0, { ok: false });
  f.find(n => n.type === "Text" && n.props.children === "This request couldn’t be accepted. Try again.");
  assert.equal(f.button("Accept message request").props.disabled, false);
});

test("old acceptance completion cannot announce success in a different account", async t => {
  const f = fixture({ messageRequest: true }); t.after(f.close); await f.settle();
  f.act(() => { void f.button("Accept message request").props.onPress(); });
  f.scope("B", 2);
  await f.complete(f.accepts);
  assert.equal(f.all().some(n => n.type === "Text" && n.props.children === "Message request accepted."), false);
});

for (const strict of [false, true]) test(`actual Profile navigation rejects retained edit/send/retry/cancel; draft survives (StrictMode ${strict})`, async t => {
  const f = fixture({ strict }); t.after(f.close); await f.settle(); f.edit("Draft kept before leaving"); const old = f.capture(), lease = f.lease;
  f.profile(); invokeRetired(f, old); noCommands(f);
  assert.equal(lease.read().text, "Draft kept before leaving"); f.back(); await f.settle();
  assert.equal(f.input.props.value, "Draft kept before leaving"); invokeRetired(f, old); noCommands(f);
  f.edit("Fresh control"); void f.send(); assert.deepEqual(f.sends[0].args, ["recipient", "Fresh control"]);
});

for (const action of ["push", "pop", "same-frame-return"]) test(`actual Root ${action} revokes controls before layout cleanup`, t => {
  const f = fixture(); t.after(f.close); f.edit("Keep me"); const old = f.capture(), lease = f.lease;
  if (action === "pop") f.popBeforeRender(); else f.goBeforeRender({ profileId: "member" });
  if (action === "same-frame-return") f.popBeforeRender();
  invokeRetired(f, old); noCommands(f); assert.equal(lease.read().text, "Keep me");
  if (action === "same-frame-return") {
    f.render(); invokeRetired(f, old); noCommands(f); f.edit("Current again"); void f.send(); assert.equal(f.sends.length, 1);
  }
});

test("layout unmount rejects all retained actions before passive cleanup", t => {
  const f = fixture(); t.after(f.close); f.edit("Keep me"); const old = f.capture(), lease = f.lease;
  f.unmountLayout(); invokeRetired(f, old); noCommands(f); assert.equal(lease.read().text, "Keep me");
  f.render(); invokeRetired(f, old); noCommands(f);
});

for (const strict of [false, true]) test(`Suspense hide/reconnect retires old controls and admits current controls (StrictMode ${strict})`, async t => {
  const f = fixture({ strict }); t.after(f.close); await f.settle(); f.edit("Keep me"); const old = f.capture(), lease = f.lease;
  f.suspend(true); invokeRetired(f, old); noCommands(f); assert.equal(lease.read().text, "Keep me");
  f.suspend(false); await f.settle(); invokeRetired(f, old); noCommands(f); assert.equal(f.input.props.value, "Keep me");
  f.edit("Current after reconnect"); void f.send(); assert.equal(f.sends.length, 1);
});

for (const kind of ["account", "epoch", "recipient"]) test(`${kind} A-B-A cannot revive old callbacks or cross draft ownership`, t => {
  const f = fixture(); t.after(f.close); f.edit("A draft"); const old = f.capture();
  if (kind === "account") { f.scope("B"); f.scope("A"); }
  if (kind === "epoch") { f.scope("A", 2); f.scope("A", 1); }
  if (kind === "recipient") { f.scope("A", 1, "other"); f.scope("A", 1, "recipient"); }
  f.edit("New A draft"); invokeRetired(f, old); noCommands(f); assert.equal(f.input.props.value, "New A draft");
  void f.send(); assert.deepEqual(f.sends[0].args, ["recipient", "New A draft"]);
});

for (const kind of ["account", "epoch"]) test(`Root ${kind} fence rejects old controls before child renders`, t => {
  const f = fixture(); t.after(f.close); f.edit("Old auth draft"); const old = f.capture();
  f.authBeforeRender(kind === "account" ? "B" : "A", kind === "epoch" ? 2 : 1);
  invokeRetired(f, old); noCommands(f); f.render(); assert.equal(f.input.props.value, "");
});

for (const destination of ["profile", "hidden", "unmount"]) for (const success of [true, false]) test(`accepted send settles its exact retained lease after ${destination}, success=${success}`, async t => {
  const f = fixture(); t.after(f.close); f.edit("Accepted draft"); const lease = f.lease, promise = f.send(), old = f.capture();
  assert.equal(lease.read().sending, true);
  if (destination === "profile") f.profile(); else if (destination === "hidden") f.suspend(true); else f.close();
  invokeRetired(f, old); assert.equal(f.sends.length, 1); assert.equal(f.retries.length, 0); assert.deepEqual(f.cancels, []);
  await f.complete(f.sends, 0, { ok: success }); await promise;
  assert.deepEqual(lease.read(), { text: success ? "" : "Accepted draft", sending: false });
  if (destination === "profile") f.back(); else if (destination === "hidden") f.suspend(false); else f.render();
  assert.equal(f.input.props.value, success ? "" : "Accepted draft");
});

test("iOS Return edits a newline without sending; repeated same-tick Send admits one claim and preserves newer edits", async t => {
  const f = fixture(); t.after(f.close); const old = f.capture();
  assert.equal(old.submit, undefined); assert.equal(f.input.props.multiline, true); assert.equal(f.input.props.submitBehavior, "newline");
  f.act(() => old.edit("First line\nSecond line"));
  assert.equal(f.sends.length, 0); assert.equal(f.input.props.value, "First line\nSecond line");
  f.act(() => { old.edit("First draft"); void old.tap(); void old.tap(); old.edit("Newer draft"); });
  assert.deepEqual(f.sends.map(x => x.args), [["recipient", "First draft"]]); assert.equal(f.input.props.value, "Newer draft");
  await f.complete(f.sends); assert.deepEqual(f.lease.read(), { text: "Newer draft", sending: false });
  void f.send(); assert.deepEqual(f.sends[1].args, ["recipient", "Newer draft"]);
});

test("pending send survives navigation/return without another claim and preserves a return edit", async t => {
  const f = fixture(); t.after(f.close); f.edit("First"); const lease = f.lease; void f.send(); f.profile(); f.back();
  assert.equal(f.lease, lease); assert.equal(f.input.props.value, "First"); void f.send(); assert.equal(f.sends.length, 1);
  f.edit("Return edit"); await f.complete(f.sends); assert.deepEqual(lease.read(), { text: "Return edit", sending: false });
});

for (const newer of [false, true]) test(`accepted failed-row retry settles original snapshot across navigation; newer edit=${newer}`, async t => {
  const f = fixture(); t.after(f.close); f.edit("Failed draft"); const lease = f.lease; const pending = f.retry(); f.profile();
  if (newer) { f.back(); f.edit("Newer draft"); }
  await f.complete(f.retries); await pending;
  assert.deepEqual(f.retries[0].args, ["failed-row"]); assert.equal(lease.read().text, newer ? "Newer draft" : "");
});

test("retry cannot clear an exact pending send claim; current cancel stays a Store command", async t => {
  const f = fixture(); t.after(f.close); f.edit("Failed draft"); void f.send(); void f.retry();
  await f.complete(f.retries); assert.deepEqual(f.lease.read(), { text: "Failed draft", sending: true });
  f.act(() => f.button("Cancel failed message").props.onPress()); assert.deepEqual(f.cancels, ["failed-row"]);
  await f.complete(f.sends); assert.deepEqual(f.lease.read(), { text: "", sending: false });
});

test("rejected accepted send preserves draft and fresh controls can retry sending", async t => {
  const f = fixture(); t.after(f.close); f.edit("Retry me"); void f.send(); f.profile();
  f.sends[0].reject(new Error("synthetic offline")); await f.settle(); f.back();
  assert.deepEqual(f.lease.read(), { text: "Retry me", sending: false }); void f.send(); assert.equal(f.sends.length, 2);
});

test("old accepted account completion cannot erase a new account/epoch draft", async t => {
  const f = fixture(); t.after(f.close); f.edit("Old account"); void f.send(); f.scope("B", 2); f.edit("New account");
  await f.complete(f.sends); assert.deepEqual(f.lease.read(), { text: "New account", sending: false });
});

for (const platform of ["android", "web"]) test(`${platform} retains default local composer and command admission behavior`, async t => {
  const f = fixture({ platform }); t.after(f.close); f.edit("Legacy text"); const old = f.capture();
  f.profile(); f.act(() => { void old.submit(); void old.retry(); old.cancel(); });
  assert.deepEqual(f.sends[0].args, ["recipient", "Legacy text"]); assert.deepEqual(f.retries[0].args, ["failed-row"]); assert.deepEqual(f.cancels, ["failed-row"]);
  await f.complete(f.sends); await f.complete(f.retries); f.back(); assert.equal(f.input.props.value, "");
});

for (const kind of ["account", "epoch"]) test(`same-tick Root ${kind} A-B-A rejects old controls without an intermediate child render`, t => {
  const f = fixture(); t.after(f.close); f.edit("Original"); const old = f.capture();
  f.authBeforeRender(kind === "account" ? "B" : "A", kind === "epoch" ? 2 : 1);
  f.authBeforeRender("A", 1); invokeRetired(f, old); noCommands(f);
  f.render(); f.edit("New auth lifetime"); invokeRetired(f, old); noCommands(f);
  assert.equal(f.input.props.value, "New auth lifetime"); void f.send(); assert.equal(f.sends.length, 1);
});

test("Suspense reconnect does not release an accepted claim and another hide retires reconnected controls", async t => {
  const f = fixture(); t.after(f.close); f.edit("Accepted"); const lease = f.lease; void f.send(); const old = f.capture();
  f.suspend(true); f.suspend(false); await f.settle(); invokeRetired(f, old); void f.send();
  assert.equal(f.sends.length, 1); assert.equal(lease.read().sending, true);
  f.edit("Newer after reconnect"); const reconnected = f.capture(); f.suspend(true); invokeRetired(f, reconnected);
  await f.complete(f.sends); assert.deepEqual(lease.read(), { text: "Newer after reconnect", sending: false });
  f.suspend(false); await f.settle(); invokeRetired(f, old); invokeRetired(f, reconnected);
  assert.equal(f.sends.length, 1); assert.equal(f.retries.length, 0); assert.deepEqual(f.cancels, []);
  void f.send(); assert.deepEqual(f.sends[1].args, ["recipient", "Newer after reconnect"]);
});

test("accepted failed-row retry settles while hidden without reviving hidden controls", async t => {
  const f = fixture(); t.after(f.close); f.edit("Failed draft"); const lease = f.lease; void f.retry(); const old = f.capture();
  f.suspend(true); invokeRetired(f, old); await f.complete(f.retries);
  assert.equal(f.retries.length, 1); assert.equal(f.sends.length, 0); assert.deepEqual(f.cancels, []);
  assert.deepEqual(lease.read(), { text: "", sending: false }); f.suspend(false); await f.settle();
  invokeRetired(f, old); f.edit("Fresh draft"); void f.send(); assert.equal(f.sends.length, 1);
});

for (const platform of ["android", "web"]) for (const kind of ["account", "epoch", "recipient", "unmount"]) {
  test(`${platform} retired acceptance cannot target a new ${kind}`, async t => {
    const f = fixture({ platform, messageRequest: true }); t.after(f.close); await f.settle();
    const accept = f.button("Accept message request").props.onPress;
    if (kind === "account") f.scope("B", 2);
    if (kind === "epoch") f.scope("A", 2);
    if (kind === "recipient") f.scope("A", 1, "other");
    if (kind === "unmount") f.close();
    f.act(() => { void accept(); });
    assert.equal(f.accepts.length, 0);
  });
}
