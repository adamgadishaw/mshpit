import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { parse } from "@babel/parser";
import { createIOSLinkedNavigation } from "../domain/iosLinkedNavigation.mjs";
const require = createRequire(import.meta.url);
const React = require("react"), reconciler = require("react-reconciler");
const { transformSync } = require("@babel/core");
const codes = new Map(), noop = () => {};
function execute(path, imports) {
  const file = new URL(path, import.meta.url);
  if (!codes.has(path)) codes.set(path, transformSync(readFileSync(file, "utf8"), {
    filename: file.pathname, babelrc: false, configFile: false,
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
  return { container, renderLayout(element) { renderer.updateContainerSync(element, root, null, null); renderer.flushSyncWork(); }, flush, render(element) { renderer.updateContainerSync(element, root, null, null); flush(); },
    act(callback) { renderer.flushSyncFromReconciler(callback); flush(); } };
}

const nodes = node => [node, ...(node.children || []).flatMap(nodes)];
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const screenSource = readFileSync(new URL("./NotificationsScreen.jsx", import.meta.url), "utf8");
const fetchNode = parse(screenSource, { sourceType: "module", plugins: ["jsx"] }).program.body
  .filter(node => node.type === "VariableDeclaration").flatMap(node => node.declarations)
  .find(node => node.id.name === "fetchNotificationPost").init;
const screenFetch = api => new Function("api", `return (${screenSource.slice(fetchNode.start, fetchNode.end)});`)(api);
const row = (id, type = "comment", extra = {}) => ({ id, type, actorId: `actor-${id}`, actorName: `Actor ${id}`, postId: id, ts: 1, ...extra });

// Actual NotificationsScreen JSX/handlers + React lifecycle + iOS destination
// hook and domain owners. Store/API/native boundaries are entirely synthetic:
// all reads and explicit acknowledgement commands are mocked.
function fixture({ platform = "ios", strict = false, mountLookup = false, routeCurrent, readResult, refreshResult, olderResult, resource, initialRows } = {}) {
  const renderer = createRenderer(), requests = [], navigations = [], readCalls = [], refreshCalls = [];
  let account = "A", epoch = 1, navigation;
  let rows = initialRows || [row("one"), row("two"), row("follow", "follow"), row("dm", "dm"), row("plans", "plan_join"),
    row("artist", "artist_update", { artist: "Fixture Artist" }), row("cached"), row("none", "welcome"), row("missing", "like", { postId: null })];
  let activity = resource || { status: "ready", data: { readContract: "notification-ids-v1" }, error: null };
  const listeners = new Set(), olderCalls = [];
  const api = (path, options) => { const request = { path, options, ...deferred() }; requests.push(request); return request.promise; };
  const native = { View: "View", Text: "Text", Pressable: "Pressable", ScrollView: "ScrollView", ActivityIndicator: "ActivityIndicator",
    AppState: { addEventListener: (_, listener) => { listeners.add(listener); return { remove: () => listeners.delete(listener) }; } },
    Platform: { OS: platform }, StyleSheet: { create: value => value } };
  const imports = (name, local) => {
    if (name === "react") return React;
    if (name === "react/jsx-runtime") return require(name);
    if (name === "react-native" || name === "../components/NativeTabScroll") return native;
    if (name === "../hooks/useIOSActivityNavigation") return navigation;
    if (name === "../hooks/useScopedRefresh") return execute("../hooks/useScopedRefresh.js", imports);
    if (name === "../lib/api") return { api };
    if (name === "../theme") return { colors: {}, radius: {}, mono: {}, space: value => value };
    if (name === "../store") return { useStore: () => ({
      session: account ? { id: account } : null, chatAuthEpoch: epoch,
      notificationActivity: activity,
      loadMoreNotifications: options => { olderCalls.push(options); return olderResult ? olderResult(options) : Promise.resolve([]); },
      feed: [{ id: "cached", review: "Fixture cached review" }], myNotifications: () => rows,
      refreshNotifications: (...args) => { refreshCalls.push(args); return refreshResult ? refreshResult(...args) : Promise.resolve(rows); },
      markNotificationsRead: options => { readCalls.push(options); return readResult ? readResult(options) : Promise.resolve({ ok: true, value: {} }); },
    }) };
    if (name.startsWith("../components/")) return name.split("/").at(-1);
    // Only pure domain modules may reach the real require boundary.
    assert.ok(name.startsWith("../domain/"), `Unexpected dependency: ${name}`);
    return local(name);
  };
  navigation = execute(`../hooks/useIOSActivityNavigation${platform === "ios" ? ".ios" : ""}.js`, imports);
  const Screen = execute("./NotificationsScreen.jsx", imports).default;
  const callbacks = Object.fromEntries(["Close", "Profile", "Thread", "Post", "Plans", "Artist"].map(kind =>
    [kind === "Close" ? "onClose" : `onOpen${kind}`, value => navigations.push({ kind, value })]));
  callbacks.isCurrentIOSRoute = routeCurrent;
  let hook;
  function HookHarness() {
    hook = navigation.default({ accountId: account, authEpoch: epoch, feed: [], fetchPost: screenFetch(api), isCurrentRoute: routeCurrent, ...callbacks });
    const started = React.useRef(false);
    React.useLayoutEffect(() => {
      if (mountLookup && !started.current) { started.current = true; void hook.open(row("mount")); }
    }, []);
    return null;
  }
  const f = {
    requests, navigations, readCalls, refreshCalls, olderCalls,
    foreground() { for (const listener of listeners) listener("active"); },
    updateResource(value, nextRows = rows) { activity = value; rows = nextRows; f.render(); },
    button(label) { return f.find(n => n.type === "Pressable" && n.props.accessibilityLabel === label).props.onPress; },
    text() { return f.all().filter(n => n.text).map(n => n.text).join(" "); },
    get hook() { return hook; },
    all: () => nodes(renderer.container),
    find: predicate => { const found = f.all().find(predicate); assert.ok(found, "Expected rendered node"); return found; },
    row: id => f.find(n => n.type === "Pressable" && n.props.accessibilityLabel?.startsWith(`Actor ${id} `)),
    avatar: id => f.find(n => n.type === "Avatar" && n.props.user.name === `Actor ${id}`),
    get back() { return f.find(n => n.type === "ScreenHeader").props.onBack; },
    get dismiss() { return f.find(n => n.type === "Pressable" && n.props.accessibilityLabel === "Dismiss unavailable post message").props.onPress; },
    get notice() { return f.all().filter(n => n.type === "Text").map(n => n.props.children).find(value => typeof value === "string" && /^This post/.test(value)) || null; },
    get busy() { return f.all().filter(n => n.type === "Pressable" && n.props.accessibilityState?.busy).map(n => n.props.accessibilityLabel); },
    act: callback => renderer.act(callback),
    press(id) { const callback = f.row(id).props.onPress; f.act(callback); },
    render() { renderer.render(React.createElement(strict ? React.StrictMode : React.Fragment, null,
      React.createElement(mountLookup ? HookHarness : Screen, callbacks))); },
    scope(id, nextEpoch) { account = id; epoch = nextEpoch; f.render(); },
    unmountLayout() { renderer.renderLayout(null); },
    flush() { renderer.flush(); },
    close() { renderer.render(null); },
    async settle() { for (let i = 0; i < 8; i++) await Promise.resolve(); await new Promise(setImmediate); f.act(noop); },
    async complete(index = requests.length - 1, postId = requests[index].path.split("/").at(-1)) {
      requests[index].resolve({ post: { id: decodeURIComponent(postId), photos: null } }); await f.settle();
    },
    async fail(index = requests.length - 1, error = new Error("offline")) { requests[index].reject(error); await f.settle(); },
  };
  f.render();
  return f;
}

test("retained Activity controls cannot read, navigate or update after layout unmount", async () => {
  const f = fixture(); await f.settle();
  const open = f.row("one").props.onPress, avatar = f.avatar("one").props.onPress, back = f.back;
  f.unmountLayout();
  open(); avatar(); back();
  assert.equal(f.requests.length, 0);
  assert.deepEqual(f.navigations, []);
  f.flush(); await f.settle();
  open(); assert.equal(f.requests.length, 0);
});

for (const intent of ["avatar", "back", "follow", "dm", "plans", "artist", "cached", "none", "missing"]) {
  test(`Activity ${intent} synchronously revokes a pending Post before passive cleanup`, async () => {
    const f = fixture(); await f.settle();
    const retained = f.row("one").props.onPress;
    f.press("one");
    const callback = intent === "avatar" ? f.avatar("two").props.onPress : intent === "back" ? f.back
      : intent === "none" ? f.find(n => n.type === "Pressable" && n.props.accessibilityLabel?.startsWith("Welcome to Pit!")).props.onPress
      : intent === "artist" ? f.find(n => n.type === "Pressable" && n.props.accessibilityLabel?.startsWith("Fixture Artist:")).props.onPress
      : f.row(intent).props.onPress;
    callback();
    assert.equal(f.requests[0].options.signal.aborted, true, "revocation happens inside the real event callback");
    const count = f.navigations.length;
    if (!["none", "missing"].includes(intent)) {
      retained();
      assert.equal(f.requests.length, 1, "departed controls cannot create another request in this frame");
    }
    await f.complete(0);
    assert.equal(f.navigations.length, count);
    assert.equal(f.busy.length, 0);
    if (intent === "missing") assert.equal(f.notice, "This post is no longer available.");
  });
}

for (const boundary of ["logout", "account", "epoch", "round-trip", "same-epoch-round-trip", "batched-round-trip"]) {
  test(`Activity callback ownership survives ${boundary} without reviving old work`, async () => {
    const f = fixture(); await f.settle();
    const oldRow = f.row("one").props.onPress, oldAvatar = f.avatar("one").props.onPress, oldBack = f.back;
    f.press("one");
    if (boundary === "logout") f.scope(null, 2);
    if (boundary === "account") f.scope("B", 2);
    if (boundary === "epoch") f.scope("A", 2);
    if (boundary === "round-trip") { f.scope("B", 2); f.scope("A", 3); }
    if (boundary === "same-epoch-round-trip") { f.scope("B", 1); f.scope("A", 1); }
    if (boundary === "batched-round-trip") f.scope("A", 3);
    assert.equal(f.requests[0].options.signal.aborted, true);
    oldRow(); oldAvatar(); oldBack();
    assert.equal(f.requests.length, 1); assert.deepEqual(f.navigations, []);
    await f.fail(0);
    assert.equal(f.notice, null); assert.equal(f.busy.length, 0);
    if (boundary !== "logout") { f.press("two"); await f.complete(); assert.equal(f.navigations.at(-1).value.id, "two"); }
  });
}

for (const settlement of ["success", "failure"]) {
  test(`late old ${settlement} cannot clear a newer loading state or error`, async () => {
    const f = fixture(); await f.settle(); f.press("one"); f.press("two");
    assert.equal(f.requests[0].options.signal.aborted, true);
    if (settlement === "success") await f.complete(0); else await f.fail(0);
    assert.equal(f.busy.length, 1); assert.match(f.busy[0], /Actor two/);
    assert.equal(f.notice, null); assert.deepEqual(f.navigations, []);
    await f.fail(1, { status: 404 });
    assert.equal(f.busy.length, 0); assert.equal(f.notice, "This post is no longer available.");
  });
}

test("captured dismiss and cancelled completion cannot clear newer Activity feedback", async () => {
  const f = fixture(); await f.settle(); f.press("one"); await f.fail();
  const dismiss = f.dismiss;
  f.press("one"); f.press("two");
  f.act(dismiss); assert.equal(f.busy.length, 1);
  await f.fail(2, { status: 404 });
  f.act(dismiss); await f.fail(1);
  assert.equal(f.notice, "This post is no longer available.");
  f.act(f.dismiss); assert.equal(f.notice, null);
});

test("valid current fetched Post is normalized and current cached Post never reads", async () => {
  const f = fixture(); await f.settle(); f.press("one");
  f.render(); await f.complete();
  assert.deepEqual(f.navigations, [{ kind: "Post", value: { id: "one", photos: [], media: [], mediaAssetIds: [], setlist: [], taggedPeople: [] } }]);
  assert.equal(f.requests[0].path, "/api/posts/one");
  assert.equal(f.requests[0].options.silent, true);
  assert.equal(f.requests[0].options.context, "Opening this activity post");
  const cached = fixture(); await cached.settle(); cached.press("cached");
  assert.deepEqual(cached.navigations, [{ kind: "Post", value: { id: "cached", review: "Fixture cached review" } }]);
  assert.equal(cached.requests.length, 0);
});

for (const status of [403, 404, 410, 500]) {
  test(`Activity ${status} retains established failure copy and deliberate retry`, async () => {
    const f = fixture(); await f.settle(); f.press("one"); await f.fail(0, { status });
    assert.equal(f.notice, status === 500 ? "This post couldn't load. Check your connection and try again." : "This post is no longer available.");
    f.press("one"); await f.complete(); assert.equal(f.navigations.length, 1); assert.equal(f.notice, null);
  });
}

test("mismatched fetched record fails closed", async () => {
  const f = fixture(); await f.settle(); f.press("one"); await f.complete(0, "other");
  assert.deepEqual(f.navigations, []); assert.equal(f.notice, "This post is no longer available.");
});

test("StrictMode screen controls remain usable after layout cleanup/replay", async () => {
  const f = fixture({ strict: true }); await f.settle();
  f.press("one"); await f.complete(); assert.equal(f.navigations.at(-1).value.id, "one");
});

test("StrictMode cleanup revokes a pre-cleanup lookup even after setup resumes", async () => {
  const f = fixture({ strict: true, mountLookup: true });
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].options.signal.aborted, true);
  await f.complete(0); assert.deepEqual(f.navigations, []);
  assert.equal(f.hook.openingNotificationId, null);
  const current = f.hook.open(row("current"));
  await f.complete(1); await current;
  assert.equal(f.navigations.length, 1); assert.equal(f.navigations[0].value.id, "current");
});

for (const platform of ["ios", "android", "web"]) {
  test(`${platform} entry acknowledges its history while foreground and reconciliation leave arrivals unread`, async () => {
    const f = fixture({ platform }); await f.settle();
    assert.equal(f.readCalls.length, 1); assert.equal(f.refreshCalls.length, 1); assert.equal(f.requests.length, 0);
    f.render(); await f.settle(); assert.equal(f.refreshCalls.length, 1);
    f.foreground(); await f.settle(); assert.equal(f.refreshCalls.length, 1); assert.equal(f.readCalls.length, 1);
    f.scope("B", 2); await f.settle(); assert.equal(f.refreshCalls.length, 2);
    f.scope("B", 3); await f.settle(); assert.equal(f.refreshCalls.length, 3);
    assert.equal(f.readCalls.length, 3); f.close();
  });
}

for (const platform of ["android", "web"]) {
  test(`${platform} retains its current direct Avatar and fetched Post behavior`, async () => {
    const f = fixture({ platform }); await f.settle(); f.press("one");
    f.act(f.avatar("two").props.onPress);
    assert.equal(f.requests[0].options.signal.aborted, false);
    await f.complete();
    assert.deepEqual(f.navigations.map(n => n.kind), ["Profile", "Post"]);
  });
}

test("non-iOS navigation hook has no imports or state", () => {
  const source = readFileSync(new URL("../hooks/useIOSActivityNavigation.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /import /);
  assert.equal(execute("../hooks/useIOSActivityNavigation.js", () => { throw new Error("Unexpected import"); }).default(), null);
});

for (const outcome of ["success", "failure"]) {
  test(`pending ${outcome} and queued controls remain inert after unmount`, async () => {
    const f = fixture(); await f.settle();
    const old = f.row("one").props.onPress;
    f.press("one"); f.unmountLayout();
    assert.equal(f.requests[0].options.signal.aborted, true);
    old(); assert.equal(f.requests.length, 1);
    if (outcome === "success") await f.complete(0); else await f.fail(0);
    assert.deepEqual(f.navigations, []); assert.equal(f.all().length, 1);
  });
  test(`same-frame newer intent keeps its error after older ${outcome}`, async () => {
    const f = fixture(); await f.settle();
    const first = f.row("one").props.onPress, second = f.row("two").props.onPress;
    first(); second();
    assert.equal(f.requests.length, 2); assert.equal(f.requests[0].options.signal.aborted, true);
    await f.fail(1, { status: 404 });
    if (outcome === "success") await f.complete(0); else await f.fail(0);
    assert.equal(f.notice, "This post is no longer available.");
    assert.equal(f.busy.length, 0); assert.deepEqual(f.navigations, []);
  });
}

// Root writes its navigation refs synchronously; React screen cleanup is held
// back here so edge Back is tested independently from the Activity header.
function rootNavigationFixture() {
  const source = readFileSync(new URL("../../App.js", import.meta.url), "utf8");
  const ast = parse(source, { sourceType: "module", plugins: ["jsx"] });
  const names = ["cancelNewsStory", "cancelPublicRoute", "applyNavigation", "runAfterComposerClose", "popStack", "requestComposerPop", "back"];
  const declarations = new Map(); let predicate; const edgeCallbacks = [];
  function walk(node) {
    if (!node || typeof node !== "object") return;
    if (node.type === "VariableDeclarator" && names.includes(node.id?.name)) declarations.set(node.id.name,
      `const ${node.id.name} = ${source.slice(node.init.start, node.init.end)};`);
    if (node.type === "JSXOpeningElement" && node.name?.name === "NotificationsScreen") {
      const value = node.attributes.find(attribute => attribute.name?.name === "isCurrentIOSRoute").value.expression;
      predicate = source.slice(value.start, value.end);
    }
    if (node.type === "JSXOpeningElement" && node.name?.name === "IosDetailNavigation") {
      edgeCallbacks.push(node.attributes.find(attribute => attribute.name?.name === "onBack").value.expression.name);
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(walk);
      else if (value && typeof value === "object") walk(value);
    }
  }
  walk(ast); assert.ok(predicate); assert.ok(edgeCallbacks.length); assert.ok(edgeCallbacks.every(name => name === "back"));
  for (const name of names) assert.ok(declarations.has(name), `Missing Root callback ${name}`);
  const owner = createIOSLinkedNavigation(); const scope = owner.account("A", 1); owner.mount();
  const nav = { notifications: true }, stack = [{}, nav], queued = [];
  const stackRef = { current: stack }, navigationRef = { current: { stack, tab: "feed", landing: false } };
  const bindings = {
    Platform: { OS: "ios" }, web: false, nav, linkedNavigationScope: scope,
    linkedNavigationRef: { current: owner }, navigationRef, stackRef,
    newsLinkedClaimRef: { current: null }, newsOpenRef: { current: 0 }, setNewsStoryNotice: noop,
    publicLookup: {}, publicNavigationPendingRef: { current: null }, publicRouteRequestRef: { current: null }, setPublicNavigationNotice: noop,
    authNavigationAbortRef: { current: noop }, composerCloseGuardRef: { current: null },
    setStack: value => queued.push(value), setTab: noop, setLanding: noop,
  };
  const factory = new Function(...Object.keys(bindings), `${names.map(name => declarations.get(name)).join("\n")} return { back, applyNavigation, isCurrentRoute: ${predicate} };`);
  const root = factory(...Object.values(bindings));
  return { ...root, owner, queued,
    restoreFrame() { root.applyNavigation({ ...navigationRef.current, stack }); },
    freshRoute() { return factory(...Object.values({ ...bindings, linkedNavigationScope: owner.account("A", 1) })).isCurrentRoute; },
  };
}

for (const outcome of ["success", "failure"]) {
  test(`Root edge Back fences pending Activity ${outcome} before screen cleanup`, async () => {
    const root = rootNavigationFixture(), f = fixture({ routeCurrent: root.isCurrentRoute }); await f.settle();
    const oldRow = f.row("one").props.onPress, oldAvatar = f.avatar("one").props.onPress, oldBack = f.back;
    f.press("one"); root.back();
    assert.equal(root.queued.length, 1); assert.equal(root.queued[0].length, 1);
    assert.equal(root.isCurrentRoute(), false);
    oldRow(); oldAvatar(); oldBack(); assert.equal(f.requests.length, 1);
    if (outcome === "success") await f.complete(0); else await f.fail(0);
    assert.deepEqual(f.navigations, []); assert.equal(f.notice, null);
    // Even restoring the same object cannot revive callbacks from the old visit.
    root.restoreFrame(); oldRow(); oldAvatar(); oldBack();
    assert.equal(f.requests.length, 1); assert.deepEqual(f.navigations, []);
    f.close();
    const fresh = fixture({ routeCurrent: root.freshRoute() }); await fresh.settle();
    fresh.press("two"); await fresh.complete(); assert.equal(fresh.navigations[0].value.id, "two");
  });
}

test("Root route/account retirement also fences captured Activity notice controls", async () => {
  const root = rootNavigationFixture(), f = fixture({ routeCurrent: root.isCurrentRoute }); await f.settle();
  f.press("one"); await f.fail();
  const dismiss = f.dismiss, row = f.row("one").props.onPress;
  root.owner.account("A", 2);
  f.act(dismiss); row();
  assert.equal(f.requests.length, 1); assert.notEqual(f.notice, null);
  assert.deepEqual(f.navigations, []);
});

for (const platform of ["ios", "android", "web"]) {
  test(`${platform} opening snapshots unread rows and never waits before navigation`, async () => {
    const pending = deferred();
    const f = fixture({ platform, initialRows: [row("one"), row("two", "comment", { read: true })], readResult: () => pending.promise });
    await f.settle();
    assert.deepEqual(f.readCalls[0].rows.map(row=>row.id), ["one", "two"]);
    f.press("one"); await f.complete(); assert.equal(f.navigations.length, 1);
    assert.equal(f.readCalls[0].signal.aborted, true);
    assert.ok(!f.all().some(n=>n.props?.accessibilityLabel === "Mark loaded activity as read")); assert.equal(f.readCalls.length, 1);
    pending.resolve({ ok: true, value: {} }); await f.settle(); f.close();
  });
}
test("read retry preserves original IDs despite newer arrivals", async () => {
  const f = fixture({ initialRows: [row("one")], readResult: () => Promise.resolve({ ok: false, error: { retryable: true, userMessage: "Offline" } }) });
  await f.settle();
  assert.match(f.text(), /Some activity could not be loaded or marked read. Unconfirmed notifications remain new./);
  assert.doesNotMatch(f.text(), /unread badge is unchanged/);
  f.updateResource({ status: "ready", data: { readContract: "notification-ids-v1" } }, [row("new"), row("one")]);
  f.act(f.button("Retry marking activity read")); await f.settle();
  assert.deepEqual(f.readCalls.map(call => call.rows.map(row=>row.id)), [["one"], ["one"]]); f.close();
});
for (const boundary of ["unmount", "account", "epoch", "round-trip", "route"]) {
  test(`explicit read controls are fenced across ${boundary}`, async () => {
    let current = true; const pending = deferred(); let first = true;
    const f = fixture({ routeCurrent: () => current, readResult: () => { if(first) { first=false; return pending.promise; } return Promise.resolve({ok:true}); } }); await f.settle();
    const mark = f.find(n => n.type === "VinylRefreshBoundary").props.onRefresh;
    if (boundary === "unmount") f.unmountLayout();
    if (boundary === "account") f.scope("B", 2);
    if (boundary === "epoch") f.scope("A", 2);
    if (boundary === "round-trip") { f.scope("B", 2); f.scope("A", 3); }
    if (boundary === "route") current = false;
    mark(); assert.equal(f.readCalls.length, 1);
    if (boundary !== "route") assert.equal(f.readCalls[0].signal.aborted, true);
    pending.resolve({ ok: false, error: { userMessage: "Stale error" } }); await f.settle();
    assert.doesNotMatch(f.text(), /Stale error/); f.close();
  });
}
test("Activity distinguishes loading, true empty and offline while retaining loaded rows", async () => {
  const f = fixture({ initialRows: [], resource: { status: "loading", data: null } }); await f.settle();
  assert.match(f.text(), /Loading activity/); assert.doesNotMatch(f.text(), /No activity yet/);
  f.updateResource({ status: "error", error: { userMessage: "Offline" } });
  assert.match(f.text(), /Offline/); assert.doesNotMatch(f.text(), /No activity yet/);
  f.updateResource({ status: "ready", data: {} }); assert.match(f.text(), /No activity yet/);
  f.updateResource({ status: "error", error: { userMessage: "Offline" }, data: {} }, [row("one")]);
  assert.ok(f.row("one")); assert.match(f.text(), /previously loaded/); f.close();
});
test("legacy server cannot expose unsafe read button and older pages load without marking", async () => {
  const f = fixture({ readResult:()=>Promise.resolve({ok:false,error:{retryable:true,userMessage:"Marking activity read is temporarily unavailable"}}), resource: { status: "ready", data: { nextCursor: "cursor" } } }); await f.settle();
  assert.ok(!f.all().some(n => n.props?.accessibilityLabel === "Mark loaded activity as read"));
  assert.match(f.text(), /temporarily unavailable/);
  f.act(f.button("Load older activity")); await f.settle();
  assert.equal(f.olderCalls.length, 1); assert.equal(f.readCalls.length, 1); f.close();
});

test("capped history shows a clear limit instead of an endless older-page control", async () => {
  const f = fixture({ resource: { status: "ready", data: { historyLimited: true, nextCursor: null } } });
  await f.settle(); assert.match(f.text(), /latest 1,000 activities/);
  assert.ok(!f.all().some(n => n.props?.accessibilityLabel === "Load older activity")); f.close();
});

for (const name of ["AbortError", "Error"]) {
  test(`refresh and pagination ${name} settle without acknowledgement or unhandled failure`, async () => {
    const error = Object.assign(new Error("Synthetic failure"), { name });
    const f = fixture({ refreshResult: () => Promise.reject(error), olderResult: () => Promise.reject(error),
      resource: { status: "ready", data: { nextCursor: "older", readContract: "notification-ids-v1" } } });
    await f.settle();
    f.act(f.find(n => n.type === "VinylRefreshBoundary").props.onRefresh); await f.settle();
    f.act(f.button("Load older activity")); await f.settle();
    assert.equal(f.readCalls.length, 0);
    assert.equal(f.find(n => n.type === "VinylRefreshBoundary").props.refreshing, false);
    assert.equal(f.find(n => n.props?.accessibilityLabel === "Load older activity").props.disabled, false); f.close();
  });
}
test("Activity has one chronological history and acknowledges on opening only", async () => {
  const f = fixture(); await f.settle();
  assert.ok(!f.all().some(n => /Digest activity view|Recent activity view/.test(n.props?.accessibilityLabel || "")));
  assert.equal(f.readCalls.length, 1);
  assert.equal(f.refreshCalls[0][0].allHistory, true);
  f.updateResource({status:"ready",data:{}},[row("arrived"),row("one")]);
  await f.settle(); assert.equal(f.readCalls.length,1,"new arrivals do not trigger another acknowledgement"); f.close();
});

for (const boundary of ["account", "epoch", "round-trip"]) {
  test(`Activity read controls recover after leave and ${boundary} without reviving old callbacks`, async () => {
    const f = fixture(); await f.settle();
    const oldMark = f.find(n=>n.type === "VinylRefreshBoundary").props.onRefresh;
    f.press("follow"); await f.settle();
    f.act(oldMark); assert.equal(f.readCalls.length, 1);
    if (boundary === "account") f.scope("B", 2);
    if (boundary === "epoch") f.scope("A", 2);
    if (boundary === "round-trip") { f.scope("B", 2); f.scope("A", 3); }
    await f.settle();
    const currentCount = f.readCalls.length;
    f.act(oldMark); await f.settle(); assert.equal(f.readCalls.length, currentCount);
    assert.ok(currentCount >= 2); f.close();
  });
}
