import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const React = require("react"), reconciler = require("react-reconciler");
const { transformSync } = require("@babel/core");
const codes = new Map(), noop = () => {};
function execute(path, imports, timers) {
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
  const remove = (parent, child) => { const i = parent.children.indexOf(child); if (i >= 0) parent.children.splice(i, 1); };
  const insert = (parent, child, before) => parent.children.splice(parent.children.indexOf(before), 0, child);
  const host = reconciler({
    supportsMutation: true, isPrimaryRenderer: true, supportsPersistence: false, supportsHydration: false,
    getRootHostContext: () => context, getChildHostContext: () => context, getPublicInstance: node => node,
    prepareForCommit: () => null, resetAfterCommit: noop,
    createInstance: (type, props) => ({ type, props, children: [] }), createTextInstance: text => ({ text }),
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
  const root = host.createContainer(container, 1, null, false, null, "", fail, fail, fail, null);
  const flush = () => { for (let i = 0; i < 8; i++) { host.flushSyncWork(); if (!host.flushPassiveEffects()) break; } };
  return { container, render(element) { host.updateContainerSync(element, root, null, null); flush(); }, act(callback) { host.flushSyncFromReconciler(callback); flush(); } };
}
const nodes = node => node.hidden ? [] : [node, ...(node.children || []).flatMap(nodes)];
const textOf = node => nodes(node).filter(n => typeof n.text === "string").map(n => n.text).join(" ");
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const conversation = (id, name, text, options = {}) => ({
  otherId: id, otherUser: { id, name, handle: `${id}.music` }, unread: 0,
  last: { id: `${id}-last`, from: id, text, ts: "11m" }, ...options,
});
const defaultMain = () => [
  conversation("rhea", "Rhéa Stone", "Meet by the merch table", { unread: 2 }),
  conversation("sam", "Sam Perry", "Doors at eight\nSee you there", { last: { from: "A", text: "Doors at eight\nSee you there", ts: "1h" } }),
];
const defaultRequests = () => [conversation("jules", "Jules Ortiz", "Any spare ticket?", { unread: 3 })];

// Actual InboxScreen, InboxPresentation, MessageScreenHeader, PageTitle and
// scoped refresh hook are rendered. Network, native drawing and polling timers
// are controlled boundaries; these checks do not certify pixels or VoiceOver.
function fixture({ platform = "ios", fontScale = 1, strict = false, main = defaultMain(), requests = defaultRequests(), account = "A" } = {}) {
  const renderer = createRenderer(), timers = new Map(), searches = [], reads = [], opened = [], closed = [];
  const data = { account, epoch: 1, main, requests };
  let store, poll, sequence = 0;
  const clock = { setTimeout(callback, delay) { const id = ++sequence; timers.set(id, { callback, delay }); return id; }, clearTimeout(id) { timers.delete(id); } };
  const imports = (name, local) => {
    if (name === "react") return React;
    if (name === "react/jsx-runtime") return require(name);
    if (name === "react-native") return {
      ...Object.fromEntries(["View", "Text", "TextInput", "Pressable", "ScrollView", "ActivityIndicator"].map(n => [n, n])),
      Platform: { OS: platform }, useWindowDimensions: () => ({ width: 390, height: 844, fontScale }), StyleSheet: { create: value => value, hairlineWidth: 0.5 },
    };
    if (name === "../store") return { useStore: () => store };
    if (name === "../theme") return { colors: {}, focusRing: {}, font: "fixture-font" };
    if (name === "../lib/useLiveChat") return (load, options) => { poll = { load, options }; };
    if (name === "../hooks/useScopedRefresh") return Refresh;
    if (name === "../components/InboxPresentation") return Presentation;
    if (name === "./MessageScreenHeader") return Header;
    if (name === "./PageReturnContext") return PageReturn;
    if (["./Avatar", "./Icon", "./VinylRefreshBoundary"].includes(name)) return name.slice(2);
    return local(name);
  };
  const PageReturn = execute("../components/PageReturnContext.jsx", imports, clock);
  const Header = execute("../components/MessageScreenHeader.jsx", imports, clock).default;
  const Presentation = execute("../components/InboxPresentation.jsx", imports, clock).default;
  const Refresh = execute("../hooks/useScopedRefresh.js", imports, clock).default;
  const Inbox = execute("./InboxScreen.jsx", imports, clock).default;
  const f = {
    data, searches, reads, opened, closed, timers,
    all: () => nodes(renderer.container), text: () => textOf(renderer.container),
    find(predicate, label = "rendered node") { const n = f.all().find(predicate); assert.ok(n, `Missing ${label}`); return n; },
    button(label) { return f.find(n => n.type === "Pressable" && n.props.accessibilityLabel === label, label); },
    input(label = "Search conversations") { return f.find(n => n.type === "TextInput" && n.props.accessibilityLabel === label, label); },
    get rows() { return f.all().filter(n => n.props?.testID === "conversation-row"); },
    get rowLabels() { return f.rows.map(n => n.props.accessibilityLabel); },
    get boundary() { return f.find(n => n.type === "VinylRefreshBoundary"); },
    get pollOptions() { return poll.options; },
    act: callback => renderer.act(callback),
    press(label) { let result; f.act(() => { result = f.button(label).props.onPress(); }); return result; },
    type(value, label) { f.act(() => f.input(label).props.onChangeText(value)); },
    render(changes = {}) {
      Object.assign(data, changes);
      const id = data.account, epoch = data.epoch;
      store = {
        session: id ? { id } : null, chatAuthEpoch: epoch,
        mainThreads: () => data.main, requestThreads: () => data.requests,
        searchPeople: (query, options) => {
          const request = { query, options, account: id, epoch, ...deferred() }; searches.push(request); return request.promise;
        },
        loadInboxThreads: options => {
          const request = { options, account: id, epoch, ...deferred() }; reads.push(request); return request.promise;
        },
      };
      renderer.render(React.createElement(strict ? React.StrictMode : React.Fragment, null,
        React.createElement(Inbox, { onClose: () => closed.push("close"), onOpenThread: id => opened.push(id) })));
    },
    async drain() { for (let i = 0; i < 8; i++) await Promise.resolve(); await new Promise(setImmediate); f.act(noop); },
    async runSearchTimers() {
      f.act(() => { for (const [id, timer] of [...timers]) { timers.delete(id); timer.callback(); } });
      await f.drain();
    },
    async searchResult(index, rows) { searches[index].resolve(rows); await f.drain(); },
    async searchError(index, error = new Error("Synthetic search failure")) { searches[index].reject(error); await f.drain(); },
    poll() { let promise; f.act(() => { promise = poll.load({ signal: new AbortController().signal }); }); promise.catch(noop); return promise; },
    async ready() { const promise = f.poll(); await f.drain(); reads.at(-1).resolve({ ok: true }); await promise; await f.drain(); },
    close: () => renderer.render(null),
  };
  f.render(); return f;
}

test("large text keeps folder, search, compose and back controls functional", t => {
  const f = fixture({ fontScale: 2 }); t.after(f.close);
  assert.equal(f.input().props.placeholder, "Search");
  f.type("@rhea.music"); assert.equal(f.rows.length, 1);
  f.press("Clear search");
  f.press("Message requests, 1"); assert.match(f.rowLabels[0], /Jules Ortiz/);
  f.press("New message"); assert.ok(f.input("Find someone to message"));
  f.press("Back to messages"); assert.ok(f.input());
  f.press("Go back"); assert.deepEqual(f.closed, ["close"]);
});

test("local conversation search finds names, handles, accents and latest preview without fetching people", t => {
  const f = fixture(); t.after(f.close);
  for (const query of ["rhEa", "rhea.music", "@rhea.music", "MERCH", "stone table", "  RHEA  merch "]) {
    f.type(query); assert.equal(f.rows.length, 1); assert.match(f.rowLabels[0], /Rhéa Stone/);
  }
  f.type("eight"); assert.equal(f.rows.length, 1); assert.match(f.rowLabels[0], /Sam Perry/);
  assert.match(f.input().props.accessibilityHint, /latest message previews/);
  assert.equal(f.searches.length, 0); assert.equal(f.timers.size, 0);
  f.press("Clear search"); assert.equal(f.input().props.value, ""); assert.equal(f.rows.length, 2);
});

test("search only filters the selected folder, preserving request count and opening the actual recipient", t => {
  const f = fixture({ requests: [conversation("new1", "Dana", "First request"), conversation("new2", "Mira", "Other request")] }); t.after(f.close);
  f.type("Dana"); assert.equal(f.rows.length, 0);
  assert.equal(f.button("Message requests, 2").props.accessibilityState.selected, false);
  f.press("Message requests, 2"); assert.equal(f.rows.length, 1);
  assert.equal(f.button("Message requests, 2").props.accessibilityState.selected, true);
  assert.match(f.text(), /Open a request to accept it/);
  f.act(() => f.rows[0].props.onPress()); assert.deepEqual(f.opened, ["new1"]);
  assert.equal(f.button("Message requests, 2").props.accessibilityState.selected, true);
  assert.equal(f.data.requests.length, 2, "opening does not silently accept or remove a request");
});

test("real unread totals cap visually while accessible labels retain their exact count", t => {
  const f = fixture({ main: [conversation("one", "One", "Hello", { unread: 1 }), conversation("many", "Many", "More", { unread: 142 }), conversation("zero", "Zero", "Nothing new")] }); t.after(f.close);
  assert.match(f.rowLabels[0], /, 1 unread/); assert.match(f.rowLabels[1], /, 142 unread/);
  assert.doesNotMatch(f.rowLabels[2], /unread/);
  assert.ok(nodes(f.rows[1]).some(n => n.text === "99+"));
  assert.ok(!nodes(f.rows[2]).some(n => n.text === "0"));
});

test("previews describe own, pending and unconfirmed messages without fake read, presence or relationship claims", t => {
  const f = fixture({ requests: [], main: [
    conversation("own", "Alex", "unused", { last: { from: "A", text: "On\nmy way", ts: "1m" }, relationshipContext: { friend: true, concertBuddy: true } }),
    conversation("pending", "Blair", "unused", { last: { from: "A", text: "Sending plan", pending: true } }),
    conversation("uncertain", "Casey", "unused", { last: { from: "A", text: "Lost receipt", failed: true, deliveryState: "unconfirmed", deliveryUncertain: true } }),
  ] }); t.after(f.close);
  assert.match(f.rowLabels[0], /You: On my way/);
  assert.match(f.rowLabels[1], /Sending: Sending plan/);
  assert.match(f.rowLabels[2], /Not confirmed: Lost receipt/);
  assert.doesNotMatch(f.text(), /\b(?:Online|Seen|Delivered|Read|Friend|Concert buddy|Verified)\b/);
  assert.doesNotMatch(f.button("Message requests").props.accessibilityLabel, /, 0/);
});

for (const changes of [{ account: "B" }, { epoch: 2 }]) test(`conversation filter and folder reset when ${Object.keys(changes)[0]} changes`, async t => {
  const f = fixture(); t.after(f.close);
  f.type("ticket"); f.press("Message requests, 1"); assert.equal(f.rows.length, 1);
  const oldSetQuery = f.input().props.onChangeText;
  f.render(changes); await f.drain();
  assert.equal(f.input().props.value, ""); assert.equal(f.button("Messages").props.accessibilityState.selected, true);
  f.act(() => oldSetQuery("stale query")); assert.equal(f.input().props.value, "");
  assert.equal(f.rows.length, 2);
});

test("compose opens and cancels independently of the local conversation filter", t => {
  const f = fixture(); t.after(f.close); f.type("rhea"); f.press("New message");
  assert.equal(f.input("Find someone to message").props.value, "");
  assert.match(f.text(), /Find your people/); assert.equal(f.rows.length, 0);
  assert.equal(f.boundary.props.enabled, false);
  assert.ok(!f.all().some(n => n.props?.accessibilityRole === "tab"));
  f.press("Back to messages");
  assert.deepEqual(f.closed, []); assert.equal(f.input().props.value, "rhea"); assert.equal(f.rows.length, 1);
  f.press("Go back"); assert.deepEqual(f.closed, ["close"]);
});

test("a captured conversation press cannot navigate after the account changes", async t => {
  const f = fixture(); t.after(f.close);
  const openOldConversation = f.rows[0].props.onPress;
  f.render({ account: "B", epoch: 2, main: [conversation("new-account-peer", "New account peer", "Hello")] }); await f.drain();
  f.act(openOldConversation);
  assert.deepEqual(f.opened, [], "the old row belongs to the previous account");
  f.act(() => f.rows[0].props.onPress()); assert.deepEqual(f.opened, ["new-account-peer"]);
});

test("debounced people search shows loading, excludes self, caps results and opens the selected person", async t => {
  const f = fixture(); t.after(f.close); f.press("New message"); f.type("  al  ", "Find someone to message"); await f.drain();
  assert.match(f.text(), /Searching people/); assert.equal(f.input("Find someone to message").props.accessibilityState.busy, true);
  assert.equal(f.searches.length, 0); await f.runSearchTimers();
  assert.equal(f.searches.length, 1); assert.equal(f.searches[0].query, "al");
  assert.equal(f.searches[0].options.throwOnError, true); assert.ok(f.searches[0].options.signal instanceof AbortSignal);
  await f.searchResult(0, [{ id: "A", name: "Self" }, ...Array.from({ length: 15 }, (_, i) => ({ id: `person${i}`, name: `Al ${i}`, handle: `al${i}` }))]);
  assert.ok(!f.all().some(n => n.props?.accessibilityLabel === "Message Self"));
  const people = f.all().filter(n => n.type === "Pressable" && /^Message Al /.test(n.props.accessibilityLabel || ""));
  assert.equal(people.length, 12);
  f.press("Message Al 4"); assert.deepEqual(f.opened, ["person4"]);
  assert.equal(f.input().props.value, ""); assert.ok(f.searches[0].options.signal.aborted);
});

test("people search failure is distinguishable from empty results and retries the same query", async t => {
  const f = fixture(); t.after(f.close); f.press("New message"); f.type("nobody", "Find someone to message"); await f.runSearchTimers();
  await f.searchError(0);
  assert.match(f.text(), /People search could not update/); assert.doesNotMatch(f.text(), /No people found/);
  f.press("Retry people search for nobody"); await f.drain(); assert.match(f.text(), /Searching people/);
  await f.runSearchTimers(); assert.equal(f.searches[1].query, "nobody");
  await f.searchResult(1, []); assert.match(f.text(), /No people found/); assert.doesNotMatch(f.text(), /could not update/);
  f.press("Clear search"); assert.match(f.text(), /Find your people/); assert.doesNotMatch(f.text(), /No people found/);
});

test("changing people query aborts the old request and late results cannot replace the new matches", async t => {
  const f = fixture(); t.after(f.close); f.press("New message"); f.type("old", "Find someone to message"); await f.runSearchTimers();
  f.type("new", "Find someone to message"); assert.ok(f.searches[0].options.signal.aborted); await f.runSearchTimers();
  await f.searchResult(1, [{ id: "new", name: "New match" }]); await f.searchResult(0, [{ id: "old", name: "Old match" }]);
  assert.ok(f.button("Message New match")); assert.doesNotMatch(f.text(), /Old match/);
});

test("a captured people result cannot open a conversation after the authentication epoch changes", async t => {
  const f = fixture(); t.after(f.close); f.press("New message"); f.type("Alex", "Find someone to message"); await f.runSearchTimers();
  await f.searchResult(0, [{ id: "old-result", name: "Alex" }]);
  const openOldPerson = f.button("Message Alex").props.onPress;
  f.render({ epoch: 2 }); await f.drain(); f.act(openOldPerson);
  assert.deepEqual(f.opened, [], "the search result belongs to the old authentication scope");
});

for (const closeLabel of ["Close new message", "Back to messages"]) test(`${closeLabel} cancels search timers and outstanding search`, async t => {
  const f = fixture(); t.after(f.close); f.press("New message"); f.type("old", "Find someone to message");
  f.press(closeLabel); await f.runSearchTimers(); assert.equal(f.searches.length, 0);
  f.press("New message"); f.type("old", "Find someone to message"); await f.runSearchTimers(); f.press(closeLabel);
  assert.ok(f.searches[0].options.signal.aborted); await f.searchResult(0, [{ id: "old", name: "Old match" }]);
  assert.doesNotMatch(f.text(), /Old match/); assert.equal(f.input().props.value, "");
});

for (const changes of [{ account: "B" }, { epoch: 2 }, { account: null }]) test(`people results cannot cross ${JSON.stringify(changes)} transition`, async t => {
  const f = fixture(); t.after(f.close); f.press("New message"); f.type("private", "Find someone to message"); await f.runSearchTimers();
  f.render(changes); assert.ok(f.searches[0].options.signal.aborted); await f.searchResult(0, [{ id: "hidden", name: "Previous account result" }]);
  assert.doesNotMatch(f.text(), /Previous account result/); assert.equal(f.timers.size, 0);
  if (changes.account !== null) { assert.equal(f.input().props.value, ""); assert.ok(f.button("New message")); }
  else { assert.match(f.text(), /Log in to message people/); assert.equal(f.pollOptions.enabled, false); assert.equal(f.boundary.props.enabled, false); }
});

test("unmount aborts pending people search and late rejection stays silent", async () => {
  const f = fixture(); f.press("New message"); f.type("pending", "Find someone to message"); await f.runSearchTimers();
  f.close(); assert.ok(f.searches[0].options.signal.aborted); await f.searchError(0);
  assert.equal(f.text(), ""); assert.equal(f.timers.size, 0);
});

test("empty inbox loading, error, retry and ready states remain distinct", async t => {
  const f = fixture({ main: [], requests: [] }); t.after(f.close);
  assert.match(f.text(), /Loading conversations/); assert.doesNotMatch(f.text(), /Start a conversation/);
  const first = f.poll(); await f.drain(); f.reads[0].reject(new Error("offline")); await assert.rejects(first); await f.drain();
  assert.match(f.text(), /Inbox couldn’t update/); assert.doesNotMatch(f.text(), /Start a conversation/);
  const retry = f.press("Retry loading inbox"); await f.drain();
  assert.equal(f.boundary.props.refreshing, true); assert.match(f.text(), /Loading conversations/);
  f.reads[1].resolve({ ok: true }); await retry; await f.drain();
  assert.equal(f.boundary.props.refreshing, false); assert.match(f.text(), /Start a conversation/);
  assert.doesNotMatch(f.text(), /Loading conversations|couldn’t update/);
  f.press("New message"); assert.ok(f.input("Find someone to message"));
});

test("failed refresh keeps cached conversations actionable and successful retry clears the error", async t => {
  const f = fixture(); t.after(f.close); await f.ready();
  let refresh; f.act(() => { refresh = f.boundary.props.onRefresh(); }); await f.drain();
  assert.equal(f.rows.length, 2); f.reads[1].reject(new Error("offline")); await refresh; await f.drain();
  assert.match(f.text(), /Inbox couldn’t update/); assert.equal(f.rows.length, 2);
  f.act(() => f.rows[1].props.onPress()); assert.deepEqual(f.opened, ["sam"]);
  const retry = f.press("Retry loading inbox"); await f.drain(); f.reads[2].resolve({ ok: true }); await retry; await f.drain();
  assert.doesNotMatch(f.text(), /Inbox couldn’t update/); assert.equal(f.rows.length, 2);
});

test("background poll failure after readiness retains usable content without a false empty state", async t => {
  const f = fixture(); t.after(f.close); await f.ready();
  const poll = f.poll(); await f.drain(); f.reads[1].reject(new Error("temporary poll failure")); await assert.rejects(poll); await f.drain();
  assert.equal(f.rows.length, 2); assert.doesNotMatch(f.text(), /Inbox couldn’t update|Start a conversation|Loading conversations/);
});

test("no-match conversation search and empty request folder provide different recovery actions", async t => {
  const f = fixture({ requests: [] }); t.after(f.close); await f.ready(); f.type("missing");
  assert.match(f.text(), /No conversations found/); assert.match(f.text(), /names and latest previews/);
  assert.doesNotMatch(f.text(), /No message requests/);
  f.press("Clear search"); f.press("Message requests");
  assert.match(f.text(), /No message requests/); assert.doesNotMatch(f.text(), /No conversations found/);
});

for (const platform of ["android", "web"]) test(`${platform} uses the same local filter and compose behavior without an iOS loading placeholder`, t => {
  const f = fixture({ platform }); t.after(f.close); f.type("merch");
  assert.equal(f.rows.length, 1); assert.doesNotMatch(f.text(), /Loading conversations/);
  f.press("New message"); assert.ok(f.input("Find someone to message")); f.press("Close new message");
  assert.equal(f.input().props.value, "merch");
});
