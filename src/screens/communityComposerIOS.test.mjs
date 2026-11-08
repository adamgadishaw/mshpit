import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
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
    hideInstance: node => { node.hidden = true; }, unhideInstance: node => { node.hidden = false; },
    hideTextInstance: node => { node.hidden = true; }, unhideTextInstance: node => { node.hidden = false; },
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
const nodes = node => node.hidden ? [] : [node, ...(node.children || []).flatMap(nodes)];
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };

// Actual screen JSX, iOS/default hook, Root owner initialization/route expressions,
// and AST-extracted Store queue/send/delivery/retry/cancel functions. Only native
// widgets, eligibility reads/attendance, and the API boundary are synthetic.
// No production session, server, network, native device or publication is used.
import { createIOSMessageDrafts } from "../domain/iosMessageDrafts.mjs";
import * as delivery from "../domain/chatDelivery.mjs";
import { clean, LIMITS } from "../domain/validation.mjs";
const parse = require("@babel/parser").parse;
const rootSource = readFileSync(new URL("../../App.js", import.meta.url), "utf8");
const ownerSource = rootSource.slice(rootSource.indexOf("  const communityDraftsRef ="), rootSource.indexOf("  const commentDraftsRef ="));
const routeLines = rootSource.split("\n").filter(line => /overlay = <(?:FanClub|Lounge)Screen/.test(line));
const routeModule = { exports: {} };
const routeCode = transformSync(`export default function RootSlice({ Platform, session, chatAuthEpoch, nav, navigationRef,
  linkedNavigationRef, linkedNavigationScope, back, openProfile, openProfileByHandle, openReport, openSignIn, openFanClub,
  FanClubScreen, LoungeScreen, concertKey, createIOSMessageDrafts, messageDraftsMountedRef, refreshDraftCapacity, exposeOwner }) {
  const { useRef } = require("react");
  ${ownerSource}
  exposeOwner(communityDraftsRef.current);
  let overlay;
  ${routeLines.join("\n").replace("else if", "if")}
  return overlay || <OtherScreen />;
}`, { babelrc: false, configFile: false, plugins: [[require("@babel/plugin-transform-react-jsx"), { runtime: "automatic" }], require("@babel/plugin-transform-modules-commonjs")] }).code.replace("OtherScreen", '"OtherScreen"');
new Function("require", "module", "exports", routeCode)(require, routeModule, routeModule.exports);
const RootSlice = routeModule.exports.default;
const storeSource = readFileSync(new URL("../store.js", import.meta.url), "utf8"), storeFunctions = new Map();
function visit(node) {
  if (!node || typeof node !== "object") return;
  if (node.type === "VariableDeclarator" && node.id?.name && node.init) storeFunctions.set(node.id.name, storeSource.slice(node.init.start, node.init.end));
  for (const value of Object.values(node)) if (Array.isArray(value)) value.forEach(visit); else if (value && typeof value === "object") visit(value);
}
visit(parse(storeSource, { sourceType: "module", plugins: ["jsx"] }));
const storeFunction = (name, dependencies) => new Function(...Object.keys(dependencies), `return (${storeFunctions.get(name)});`)(...Object.values(dependencies));

function fixture({ kind = "fan", platform = "ios", strict = false, capacity = 32, autoMeta = true, cutoffAt = null } = {}) {
  const timers = new Map();
  const screenTimers = { setTimeout(callback, delay) { const token = {}; timers.set(token, { callback, delay }); return token; }, clearTimeout(token) { timers.delete(token); } };
  const renderer = createRenderer(), requests = [], metadata = [], entries = [], joins = [], cancels = [], retries = [], queued = [], reads = [];
  const chatOutboxRef = { current: [] }, sessionRef = { current: { id: "A", name: "Fixture", initials: "FX" } }, chatAuthEpochRef = { current: 1 };
  const linkedNavigationRef = { current: createIOSLinkedNavigation() }; linkedNavigationRef.current.mount();
  let target = "canonical-one", canonical = "canonical-one", member = true, identityStatus = "ready", memorial = "living", legacy = false;
  let frame, hidden = false, currentOwner, latestHook, latestPolling, confirmed = [], seq = 0, metaStatus = "open";
  const navigationRef = { current: { stack: [] } }, suspension = new Promise(() => {});
  const native = { Platform: { OS: platform }, StyleSheet: { create: value => value },
    ...Object.fromEntries(["View", "Text", "TextInput", "Pressable", "ScrollView", "KeyboardAvoidingView"].map(name => [name, name])) };
  const commitChatOutbox = update => { chatOutboxRef.current = update(chatOutboxRef.current); };
  const api = (path, options) => {
    const request = { path, options, ...deferred() };
    if (path.endsWith("/meta")) {
      metadata.push(request);
      if (autoMeta) request.resolve({ status: metaStatus, attendeeCount: 3, members: 3, messageCount: 1, cutoffAt });
    } else requests.push(request);
    return request.promise;
  };
  const deliverChatMessage = storeFunction("deliverChatMessage", { ...delivery, chatOutboxRef, sessionRef, chatAuthEpochRef, commitChatOutbox, api,
    commitConfirmedChatMessage: (item, id) => { confirmed.push({ ...item, id, pending: false, failed: false }); } });
  const queueChatMessage = storeFunction("queueChatMessage", { ...delivery, commitChatOutbox, deliverChatMessage });
  const dependencies = { ...delivery, clean, LIMITS, currentMutationActor: () => sessionRef.current,
    fcKey: value => String(value).trim().toLowerCase(), chatAuthEpochRef,
    nextChatMutationId: type => delivery.createChatClientMutationId(type, 1000, ++seq / 1000),
    queueChatMessage: item => { queued.push(item); return queueChatMessage(item); } };
  const addFanClubMessage = storeFunction("addFanClubMessage", dependencies);
  const addLoungeMessage = storeFunction("addLoungeMessage", dependencies);
  const retryStore = storeFunction("retryChatMessage", { deliverChatMessage });
  const cancelStore = storeFunction("cancelChatMessage", { ...delivery, chatOutboxRef, sessionRef, commitChatOutbox });
  const messages = () => [{ id: "other", userId: "other", name: "Other", text: "Fixture message", ts: "now" },
    ...confirmed.filter(item => item.ownerId === sessionRef.current?.id && item.kind === kind && item.channelKey === canonical),
    ...delivery.chatOutboxFor(chatOutboxRef.current, { ownerId: sessionRef.current?.id, kind, channelKey: canonical })];
  const imports = (name, local) => {
    if (name === "react") return React;
    if (name === "react/jsx-runtime") return require(name);
    if (name === "react-native") return native;
    if (name === "../hooks/useIOSCommunityComposer") return { __esModule: true, default: args => { latestHook = hook.default(args); return latestHook; } };
    if (name === "../theme") return { colors: {}, radius: {}, mono: "mono" };
    if (name === "../seed/ingested") return { artistMeta: () => null };
    if (name === "../store") return { isStaff: () => false, useStore: () => ({
      session: sessionRef.current, chatAuthEpoch: chatAuthEpochRef.current,
      fanClubFor: messages, loungeFor: messages, fanClubCount: () => 3, isFanClubMember: () => member,
      userById: id => ({ id, name: "Other" }), concertKey: log => log.key, attendeesFor: () => [],
      addFanClubMessage, addLoungeMessage,
      retryChatMessage: id => { retries.push(id); return retryStore(id); },
      cancelChatMessage: id => { cancels.push(id); return cancelStore(id); },
      joinFanClub: artist => { const request = { artist, ...deferred() }; joins.push(request); return request.promise; },
      enterLounge: log => { const request = { log, ...deferred() }; entries.push(request); return request.promise; },
      loadFanClub: () => assert.fail("Unexpected real chat read"),
      loadLounge: () => { const request = deferred(); reads.push(request); return request.promise; },
      clearLounge: noop, removeLoungeMessage: () => assert.fail("No moderation writes"),
    }) };
    if (name === "../lib/api") return { api };
    if (name === "../lib/useLiveChat") return (read, options) => { latestPolling = { read, ...options }; };
    if (name === "../lib/useChatScroll") return () => ({ scrollRef: { current: null }, onScroll: noop, onContentSizeChange: noop });
    if (name === "../hooks/useScopedRefresh") return () => ({ refreshing: false, refresh: noop });
    if (name === "../domain/artistLegacy.mjs") return { isLegacyArtistMemorial: () => legacy };
    if (name === "../features/artistMemorials/useArtistMemorial") return { useArtistMemorial: () => ({ resource: { data: null }, availability: memorial, reload: noop }) };
    if (name === "../hooks/useCanonicalArtistIdentity") return () => ({ artistName: "Fixture Artist", artistKey: canonical, status: identityStatus, retry: noop });
    if (name === "../config/runtime.mjs") return { ENABLE_CREW: false };
    if (name.startsWith("../components/")) return name.split("/").at(-1);
    assert.ok(name.startsWith("../domain/"), `Unexpected dependency: ${name}`);
    return local(name);
  };
  const hook = execute(`../hooks/useIOSCommunityComposer${platform === "ios" ? ".ios" : ""}.js`, imports);
  const FanClubScreen = execute("./FanClubScreen.jsx", imports).default, LoungeScreen = execute("./LoungeScreen.jsx", imports, screenTimers).default;
  function MaybeSuspend() { if (hidden) throw suspension; return null; }
  const messageDraftsMountedRef = { current: true };
  function Harness() {
    const [, refreshDraftCapacity] = React.useState(0);
    const props = { Platform: native.Platform, session: sessionRef.current, chatAuthEpoch: chatAuthEpochRef.current,
      nav: frame, navigationRef, linkedNavigationRef,
      linkedNavigationScope: linkedNavigationRef.current.account(sessionRef.current?.id || null, chatAuthEpochRef.current),
      back: () => f.navigate("back"), openProfile: () => f.navigate("profile"), openProfileByHandle: () => f.navigate("profile"),
      openReport: () => f.navigate("report"), openSignIn: () => f.navigate("auth"), openFanClub: () => f.navigate("fan"),
      FanClubScreen, LoungeScreen, concertKey: log => log.key, createIOSMessageDrafts: options => createIOSMessageDrafts({ ...options, capacity }),
      messageDraftsMountedRef, refreshDraftCapacity, exposeOwner: owner => { currentOwner = owner; } };
    // The exact Root JSX expression owns the real hook and component instance.
    return React.createElement(React.Suspense, { fallback: React.createElement("Fallback") },
      React.createElement(RootSlice, props), React.createElement(MaybeSuspend));
  }
  const makeFrame = () => kind === "fan" ? { fanClub: target } : { lounge: { key: target, artist: "Fixture Artist", venue: "Fixture Venue" } };
  frame = makeFrame(); navigationRef.current.stack = [{}, frame];
  const f = {
    requests, metadata, entries, joins, cancels, retries, queued, reads, renderer, navigationRef, linkedNavigationRef,
    get owner() { return currentOwner; }, get hook() { return latestHook; }, get outbox() { return chatOutboxRef.current; }, get polling() { return latestPolling; },
    all: () => nodes(renderer.container),
    find: predicate => { const node = f.all().find(predicate); assert.ok(node, "Expected rendered node"); return node; },
    get input() { return f.find(n => n.type === "TextInput"); },
    get send() { return f.find(n => n.type === "Pressable" && n.props.accessibilityLabel?.startsWith("Send message")); },
    get metadataRetry() { return f.find(n => n.type === "Pressable" && n.props.accessibilityLabel === "Retry Lounge status"); },
    get retry() { return f.find(n => n.type === "Pressable" && n.props.accessibilityLabel?.startsWith("Retry ")); },
    get cancel() { return f.find(n => n.type === "Pressable" && n.props.accessibilityLabel?.startsWith("Cancel failed")); },
    get avatar() { return f.find(n => n.type === "Avatar"); },
    get entry() { return f.find(n => n.type === "Pressable" && nodes(n).some(c => typeof c.props?.children === "string" && c.props.children.includes("Enter this show's"))); },
    get leave() { return f.find(n => n.type === "ScreenHeader").props.right.props.onPress; },
    act: callback => renderer.act(callback),
    render() { renderer.render(React.createElement(strict ? React.StrictMode : React.Fragment, null, React.createElement(Harness))); },
    navigate(destination, render = true) {
      linkedNavigationRef.current.invalidate();
      frame = { [destination]: true }; navigationRef.current.stack = [{}, frame];
      if (render) f.render();
    },
    return() { linkedNavigationRef.current.invalidate(); frame = makeFrame(); navigationRef.current.stack = [{}, frame]; f.render(); },
    target(value, newKind = kind) { target = canonical = value; kind = newKind; f.return(); },
    canonical(value) { canonical = value; f.render(); },
    account(id, epoch) { sessionRef.current = id ? { id, name: "Fixture", initials: "FX" } : null; chatAuthEpochRef.current = epoch; f.render(); },
    membership(value) { member = value; f.render(); },
    eligibility({ status = identityStatus, availability = memorial, archive = legacy } = {}) { identityStatus = status; memorial = availability; legacy = archive; f.render(); },
    edit(value) { f.act(() => f.input.props.onChangeText(value)); },
    submit() { f.act(() => { void f.input.props.onSubmitEditing(); }); },
    hide(value = true) { hidden = value; f.render(); },
    unmountLayout() { renderer.renderLayout(null); },
    close() { messageDraftsMountedRef.current = false; renderer.render(null); linkedNavigationRef.current.unmount(); },
    async settle() { for (let i = 0; i < 10; i++) await Promise.resolve(); await new Promise(setImmediate); f.act(noop); f.render(); },
    async ready() { await f.settle(); if (kind === "lounge") await f.enter(); },
    async enter(success = true, { waitForMetadata = autoMeta } = {}) {
      const before = metadata.at(-1);
      f.act(() => { void f.entry.props.onPress(); });
      entries.at(-1).resolve({ ok: success });
      await f.settle();
      if (!success || !waitForMetadata) return;
      // Committing enteredRoom starts another metadata effect. Its promise may
      // be resolved before React has adopted it, especially when rendering
      // yields under suite load. Ready means that fresh owned read has opened
      // the actual polling gate, not merely that a TextInput exists.
      for (let attempt = 0; attempt < 10; attempt++) {
        const current = metadata.at(-1);
        if (current && current !== before && !current.options.signal.aborted) {
          await current.promise;
          await f.settle();
          if (metadata.at(-1) === current && !current.options.signal.aborted && f.polling.enabled) return;
        } else await f.settle();
      }
      assert.fail("Explicit Lounge entry did not adopt fresh current metadata");
    },
    async complete(index = requests.length - 1, result = { id: "confirmed" }) { requests[index].resolve(result); await f.settle(); },
    async fail(index = requests.length - 1) { requests[index].reject(new Error("Unknown transport outcome")); await f.settle(); },
    async closed() { const promise = latestPolling.read({ signal: new AbortController().signal }); reads.at(-1).resolve({ closed: true }); await promise; await f.settle(); },
    setMetaStatus(status) { metaStatus = status; },
    fireCutoff() {
      const timer = [...timers.values()].at(-1); assert.ok(timer);
      const originalNow = Date.now;
      try { Date.now = () => cutoffAt + 1; timer.callback(); } finally { Date.now = originalNow; }
    },
  };
  f.render();
  return f;
}

for (const kind of ["fan", "lounge"]) {
  test(`${kind}: Avatar/Profile/Back retains draft; Lounge requires fresh explicit confirmed entry`, async () => {
    const f = fixture({ kind }); await f.ready(); f.edit("Unsent community draft");
    f.act(() => f.avatar.props.onPress()); f.return(); await f.settle();
    assert.equal(f.queued.length, 0);
    if (kind === "lounge") {
      assert.equal(f.entries.length, 1); assert.equal(f.polling.enabled, false);
      assert.equal(f.all().some(n => n.type === "TextInput"), false);
      f.act(() => { void f.entry.props.onPress(); }); await f.settle();
      assert.equal(f.polling.enabled, false); assert.equal(f.all().some(n => n.type === "TextInput"), false);
      f.entries.at(-1).resolve({ ok: true }); await f.settle();
      assert.equal(f.entries.length, 2);
    }
    assert.equal(f.input.props.value, "Unsent community draft"); f.close();
  });
  test(`${kind}: same-batch keyboard Submit and Send create one actual outbox intent`, async () => {
    const f = fixture({ kind }); await f.ready(); f.edit("One intended message");
    const keyboard = f.input.props.onSubmitEditing, send = f.send.props.onPress;
    f.act(() => { void keyboard(); void send(); void keyboard(); });
    assert.equal(f.queued.length, 1); assert.equal(f.outbox.length, 1); assert.equal(f.requests.length, 1);
    assert.equal(f.outbox[0].status, "sending"); assert.equal(f.send.props.accessibilityState.busy, true);
    await f.complete(); assert.equal(f.input.props.value, ""); assert.equal(f.outbox.length, 0); f.close();
  });
  for (const departure of ["avatar", "before-cleanup", "frame-ABA", "layout-unmount"]) test(`${kind}: retained edit/Submit rejected after ${departure}`, async () => {
    const f = fixture({ kind }); await f.ready(); f.edit("Private draft");
    const edit = f.input.props.onChangeText, submit = f.input.props.onSubmitEditing, lease = f.owner.lease(JSON.stringify([kind, "canonical-one"]));
    if (departure === "avatar") f.act(() => f.avatar.props.onPress());
    else if (departure === "before-cleanup") f.navigate("profile", false);
    else if (departure === "layout-unmount") f.unmountLayout();
    else { const oldFrame = f.navigationRef.current.stack.at(-1); f.navigate("profile", false); f.navigationRef.current.stack.push(oldFrame); }
    f.act(() => { edit("Retired edit"); void submit(); });
    assert.equal(f.requests.length, 0); assert.equal(lease.read().text, "Private draft"); f.close();
  });
  for (const newer of [null, "new message", "same text"]) test(`${kind}: accepted send settles after navigation and preserves newer revision ${newer}`, async () => {
    const f = fixture({ kind }); await f.ready(); f.edit("same text"); f.submit();
    f.act(() => f.avatar.props.onPress()); f.return(); await f.settle(); if (kind === "lounge") await f.enter();
    assert.equal(f.send.props.accessibilityState.busy, true);
    if (newer) { f.edit("temporary"); f.edit(newer); }
    f.submit(); assert.equal(f.requests.length, 1);
    await f.complete(); assert.equal(f.input.props.value, newer || ""); f.close();
  });
  test(`${kind}: unknown outcome retains failed Store row; exact retry reuses mutation and unchanged draft`, async () => {
    const f = fixture({ kind }); await f.ready(); f.edit("  retry safely  "); f.submit();
    const mutation = f.outbox[0].clientMutationId, id = f.outbox[0].id;
    await f.fail(); assert.equal(f.input.props.value, "  retry safely  "); assert.equal(f.outbox[0].failed, true);
    const retry = f.retry.props.onPress;
    f.act(() => { void retry(); void retry(); });
    assert.equal(f.requests.length, 2); assert.equal(f.queued.length, 1);
    assert.equal(f.requests[1].options.body.clientMutationId, mutation); assert.deepEqual(f.retries, [id, id]);
    await f.complete(); assert.equal(f.input.props.value, ""); assert.equal(f.outbox.length, 0); f.close();
  });
  for (const changed of ["new draft", "retry safely"]) test(`${kind}: Retry success never clears newer ${changed} revision`, async () => {
    const f = fixture({ kind }); await f.ready(); f.edit("retry safely"); f.submit(); await f.fail();
    f.edit("A newer draft");
    f.act(() => { void f.retry.props.onPress(); }); f.edit("temporary"); f.edit(changed);
    await f.complete(); assert.equal(f.input.props.value, changed); f.close();
  });
  test(`${kind}: retired failed-row Retry and Cancel cannot mutate Store`, async () => {
    const f = fixture({ kind }); await f.ready(); f.edit("failed draft"); f.submit(); await f.fail();
    const retry = f.retry.props.onPress, cancel = f.cancel.props.onPress;
    f.navigate("profile", false); f.act(() => { void retry(); cancel(); });
    assert.deepEqual(f.retries, []); assert.deepEqual(f.cancels, []); assert.equal(f.outbox.length, 1); f.close();
  });
  test(`${kind}: explicit Cancel only removes the failed row and leaves the draft`, async () => {
    const f = fixture({ kind }); await f.ready(); f.edit("failed draft"); f.submit(); await f.fail();
    f.act(() => f.cancel.props.onPress()); assert.equal(f.outbox.length, 0); assert.equal(f.input.props.value, "failed draft"); f.close();
  });
  for (const transition of ["account-ABA", "epoch", "logout"]) test(`${kind}: ${transition} erases private drafts and fences old callbacks/settlements`, async () => {
    const f = fixture({ kind }); await f.ready(); f.edit("old private draft"); f.submit();
    const edit = f.input.props.onChangeText, submit = f.input.props.onSubmitEditing;
    if (transition === "account-ABA") { f.account("B", 1); f.account("A", 1); }
    else if (transition === "epoch") f.account("A", 2);
    else { f.account(null, 2); f.account("A", 3); }
    await f.settle(); if (kind === "lounge") await f.enter();
    assert.equal(f.input.props.value, ""); assert.equal(f.input.props.editable, true);
    f.edit("new private draft"); assert.equal(f.input.props.value, "new private draft");
    f.act(() => { edit("retired"); void submit(); }); await f.complete();
    assert.equal(f.requests.length, 1); assert.equal(f.input.props.value, "new private draft"); f.close();
  });
  for (const strict of [false, true]) for (const success of [false, true]) test(`${kind}: Suspense disconnect/reconnect strict=${strict} success=${success}`, async () => {
    const f = fixture({ kind, strict }); await f.ready(); f.edit("hidden draft"); f.submit();
    const edit = f.input.props.onChangeText, submit = f.input.props.onSubmitEditing;
    f.hide(); f.act(() => { edit("retired"); void submit(); });
    if (success) await f.complete(); else await f.fail();
    f.hide(false); await f.settle();
    // StrictMode may replay the existing Lounge entry reset effect. Retaining
    // a draft never grants entry: require its actual explicit gate again.
    if (kind === "lounge" && !f.all().some(n => n.type === "TextInput")) {
      assert.equal(f.polling.enabled, false);
      await f.enter();
    }
    assert.equal(f.input.props.value, success ? "" : "hidden draft"); assert.equal(f.requests.length, 1);
    f.act(() => { edit("retired again"); void submit(); }); assert.equal(f.requests.length, 1);
    f.edit("fresh controls"); assert.equal(f.input.props.value, "fresh controls"); f.close();
  });
}

test("FanClub membership loss/rejoin retains draft but cannot revive old callbacks or autojoin", async () => {
  const f = fixture(); await f.ready(); f.edit("members only"); const submit = f.input.props.onSubmitEditing;
  f.membership(false); f.act(() => { void submit(); }); assert.equal(f.requests.length, 0); assert.equal(f.joins.length, 0);
  f.membership(true); f.act(() => { void submit(); }); assert.equal(f.requests.length, 0); assert.equal(f.input.props.value, "members only");
  f.submit(); assert.equal(f.requests.length, 1); await f.complete(); f.close();
});
test("FanClub leave pauses admission synchronously before membership render", async () => {
  const f = fixture(); await f.ready(); f.edit("not after leave"); const submit = f.input.props.onSubmitEditing;
  f.act(() => { void f.leave(); void submit(); }); assert.equal(f.requests.length, 0); assert.equal(f.joins.length, 1);
  f.joins[0].resolve({ ok: false }); await f.settle(); f.submit(); assert.equal(f.requests.length, 1); f.close();
});
for (const gate of [{ status: "checking" }, { status: "unavailable" }, { availability: "checking" }, { archive: true, availability: "deceased" }]) test(`FanClub canonical/memorial gate ${JSON.stringify(gate)} revokes send`, async () => {
  const f = fixture(); await f.ready(); f.edit("gated draft"); const submit = f.input.props.onSubmitEditing;
  f.eligibility(gate); f.act(() => { void submit(); }); assert.equal(f.requests.length, 0);
  assert.equal(f.all().some(n => n.type === "TextInput"), false); f.close();
});
test("Canonical target ABA and channel namespaces isolate retained drafts", async () => {
  const f = fixture(); await f.ready(); f.edit("fan one"); const submit = f.input.props.onSubmitEditing;
  f.canonical("canonical-two"); assert.equal(f.input.props.value, ""); f.edit("fan two");
  f.canonical("canonical-one"); f.act(() => { void submit(); }); assert.equal(f.requests.length, 0); assert.equal(f.input.props.value, "fan one");
  f.target("canonical-one", "lounge"); await f.ready(); assert.equal(f.input.props.value, ""); f.edit("lounge one");
  f.target("canonical-one", "fan"); await f.ready(); assert.equal(f.input.props.value, "fan one"); f.close();
});
test("Lounge closure fences retained controls without restoring entry or polling", async () => {
  const f = fixture({ kind: "lounge" }); await f.ready(); f.edit("not after closure"); const submit = f.input.props.onSubmitEditing;
  await f.closed(); f.act(() => { void submit(); }); assert.equal(f.requests.length, 0); assert.equal(f.polling.enabled, false);
  assert.equal(f.all().some(n => n.type === "TextInput"), false);
  f.setMetaStatus("closed"); f.navigate("profile"); f.return(); await f.settle();
  assert.equal(f.entries.length, 1); assert.equal(f.polling.enabled, false); assert.equal(f.all().some(n => n.type === "TextInput"), false); f.close();
});
test("Lounge failed/guest entry does not expose a restored draft or poll", async () => {
  const f = fixture({ kind: "lounge" }); await f.ready(); f.edit("private draft"); f.navigate("profile"); f.return(); await f.settle();
  await f.enter(false); assert.equal(f.polling.enabled, false); assert.equal(f.all().some(n => n.type === "TextInput"), false);
  f.act(() => { void f.entry.props.onPress(); }); f.entries.at(-1).resolve({ ok: true, guest: true }); await f.settle();
  assert.equal(f.polling.enabled, false); assert.equal(f.all().some(n => n.type === "TextInput"), false); f.close();
});
test("Root capacity pressure protects pending claims and later admits a new channel", async () => {
  const f = fixture({ capacity: 1 }); await f.ready(); f.edit("pending one"); f.submit();
  f.target("canonical-two"); await f.ready(); assert.equal(f.input.props.editable, false); f.edit("must not vanish"); f.submit();
  assert.equal(f.requests.length, 1); await f.complete(); assert.equal(f.input.props.editable, true);
  f.edit("admitted two"); assert.equal(f.input.props.value, "admitted two"); f.close();
});
for (const platform of ["android", "web"]) for (const kind of ["fan", "lounge"]) test(`${platform} ${kind}: default hook leaves legacy local path and no Root draft owner`, async () => {
  const f = fixture({ platform, kind }); await f.ready(); assert.equal(f.owner, null); assert.equal(f.hook, null);
  f.edit("legacy text"); f.submit(); assert.equal(f.requests.length, 1); await f.complete(); assert.equal(f.input.props.value, "");
  f.edit("local only"); f.navigate("profile"); f.return(); await f.settle(); if (kind === "lounge") await f.enter();
  assert.equal(f.input.props.value, ""); f.close();
});

for (const strict of [false, true]) for (const closure of ["read", "cutoff"]) test(`Lounge ${closure} closure strict=${strict} revokes admission before React renders`, async () => {
  const f = fixture({ kind: "lounge", strict, cutoffAt: closure === "cutoff" ? Date.now() + 60000 : null });
  await f.ready(); f.edit("Do not send into closed room"); const submit = f.input.props.onSubmitEditing, edit = f.input.props.onChangeText;
  if (closure === "read") {
    const promise = f.polling.read({ signal: new AbortController().signal });
    f.reads.at(-1).resolve({ closed: true }); await promise;
  } else f.fireCutoff();
  void submit(); edit("Retired edit");
  assert.equal(f.queued.length, 0);
  assert.equal(f.owner.lease(JSON.stringify(["lounge", "canonical-one"])).read().text, "Do not send into closed room");
  await f.settle(); assert.equal(f.polling.enabled, false); f.close();
});
for (const kind of ["fan", "lounge"]) test(`${kind}: deliberate fresh Send after failed delivery retains Store's separate-intent semantics`, async () => {
  const f = fixture({ kind }); await f.ready(); f.edit("same text"); f.submit(); await f.fail();
  const failedId = f.outbox[0].clientMutationId; f.submit();
  assert.equal(f.queued.length, 2); assert.notEqual(f.outbox[1].clientMutationId, failedId);
  assert.deepEqual(f.retries, []); f.close();
});

test("Idle capacity recovers after departed subscriber cleanup without an unowned fallback", async () => {
  const f = fixture({ capacity: 1 }); await f.ready(); f.edit("old bounded draft");
  const edit = f.input.props.onChangeText, submit = f.input.props.onSubmitEditing;
  f.target("canonical-two"); await f.ready(); assert.equal(f.input.props.editable, true);
  f.edit("visible current draft"); f.act(() => { edit("retired"); void submit(); });
  assert.equal(f.input.props.value, "visible current draft"); assert.equal(f.requests.length, 0); f.close();
});
test("A name without a canonical key cannot allocate a sendable fan draft", async () => {
  const f = fixture(); await f.ready(); f.canonical(null);
  assert.equal(f.input.props.editable, false); f.edit("raw display name"); f.submit();
  assert.equal(f.requests.length, 0); f.close();
});
for (const kind of ["fan", "lounge"]) test(`${kind}: failed-row retry settlement survives navigation without clearing a newer draft`, async () => {
  const f = fixture({ kind }); await f.ready(); f.edit("failed message"); f.submit(); await f.fail();
  f.act(() => { void f.retry.props.onPress(); }); f.navigate("profile"); f.return(); await f.settle();
  if (kind === "lounge") await f.enter(); f.edit("newer on return"); await f.complete();
  assert.equal(f.input.props.value, "newer on return"); assert.equal(f.queued.length, 1); f.close();
});
for (const kind of ["fan", "lounge"]) test(`${kind}: capacity recovery does not retire a still-owned pending eligibility command`, async () => {
  const f = fixture({ kind, capacity: 1 }); await f.ready(); f.edit("pending first channel"); f.submit();
  f.target("canonical-two"); await f.settle();
  if (kind === "fan") {
    f.membership(false); await f.settle();
    const join = f.find(n => n.type === "Pressable" && nodes(n).some(child => child.props?.children === "Join the fan club"));
    f.act(() => { void join.props.onPress(); });
  } else f.act(() => { void f.entry.props.onPress(); });
  await f.complete();
  if (kind === "fan") { f.membership(true); f.joins.at(-1).resolve({ ok: true }); }
  else f.entries.at(-1).resolve({ ok: true });
  await f.settle();
  assert.equal(f.input.props.editable, true);
  if (kind === "fan") assert.equal(f.find(n => n.type === "ScreenHeader").props.right.props.disabled, false);
  else assert.equal(f.polling.enabled, true);
  f.close();
});
for (const kind of ["fan", "lounge"]) {
  test(`${kind}: missing delivery receipt retains the Store failed row and exact draft`, async () => {
    const f = fixture({ kind }); await f.ready(); f.edit("confirmation unknown"); f.submit();
    await f.complete(0, {});
    assert.equal(f.input.props.value, "confirmation unknown"); assert.equal(f.outbox[0].status, "failed");
    assert.equal(f.requests.length, 1); assert.equal(f.queued.length, 1); f.close();
  });
  test(`${kind}: Retry then captured Cancel cannot cancel an accepted Store delivery`, async () => {
    const f = fixture({ kind }); await f.ready(); f.edit("already retrying"); f.submit(); await f.fail();
    const retry = f.retry.props.onPress, cancel = f.cancel.props.onPress;
    f.act(() => { void retry(); cancel(); });
    assert.equal(f.outbox.length, 1); assert.equal(f.outbox[0].status, "sending");
    assert.equal(f.queued.length, 1); await f.complete(); assert.equal(f.input.props.value, ""); f.close();
  });
}

test("Retained Lounge draft cannot advertise editable/enabled controls during fresh metadata confirmation", async () => {
  const f = fixture({ kind: "lounge", autoMeta: false });
  const openMeta = async () => {
    f.metadata.at(-1).resolve({ status: "open", attendeeCount: 3, messageCount: 1 }); await f.settle();
  };
  await openMeta(); await f.enter(); await openMeta(); f.edit("retained private text");
  f.navigate("profile"); f.return(); await openMeta(); await f.enter();
  assert.equal(f.input.props.value, "retained private text"); assert.equal(f.input.props.editable, false);
  assert.equal(f.send.props.disabled, true); assert.equal(f.send.props.accessibilityState.disabled, true);
  f.edit("not admitted"); f.submit(); assert.equal(f.requests.length, 0); assert.equal(f.input.props.value, "retained private text");
  await openMeta(); assert.equal(f.input.props.editable, true); assert.equal(f.send.props.disabled, false);
  f.edit("fresh admitted text"); f.submit(); assert.equal(f.requests.length, 1); f.close();
});

test("Lounge entry readiness waits for fresh metadata after logout before accepting a newer draft", async () => {
  const f = fixture({ kind: "lounge", autoMeta: false });
  const openMeta = async () => {
    f.metadata.at(-1).resolve({ status: "open", attendeeCount: 3, messageCount: 1 }); await f.settle();
  };
  await openMeta(); await f.enter(); await openMeta();
  f.edit("old private draft"); f.submit();
  const edit = f.input.props.onChangeText, submit = f.input.props.onSubmitEditing;
  f.account(null, 2); f.account("A", 3); await openMeta();
  let entered = false;
  const entering = f.enter(true, { waitForMetadata: true }).then(() => { entered = true; });
  await f.settle();
  assert.equal(entered, false, "The helper must not return before consequent metadata is adopted");
  assert.equal(f.input.props.editable, false); assert.equal(f.polling.enabled, false);
  f.edit("not yet admitted"); assert.equal(f.input.props.value, "");
  await openMeta(); await entering;
  assert.equal(f.input.props.editable, true); assert.equal(f.polling.enabled, true);
  f.edit("new private draft"); assert.equal(f.input.props.value, "new private draft");
  f.act(() => { edit("retired"); void submit(); }); await f.complete();
  assert.equal(f.requests.length, 1); assert.equal(f.input.props.value, "new private draft");
  f.close();
});

async function returningLoungeWithPendingMetadata(options = {}) {
  const f = fixture({ kind: "lounge", autoMeta: false, ...options });
  f.openMetadata = async (payload = { status: "open", attendeeCount: 3, messageCount: 1 }) => {
    f.metadata.at(-1).resolve(payload); await f.settle();
  };
  await f.openMetadata(); await f.enter(); await f.openMetadata();
  f.edit("retained recovery draft"); f.navigate("profile"); f.return();
  await f.openMetadata(); await f.enter();
  return f;
}
const hasLoungeStatus = (f, copy) => f.all().some(n => n.type === "Text" && n.props.children === copy);

for (const strict of [false, true]) test(`Entered Lounge failure Retry preserves entry/draft and dedupes clicks, strict=${strict}`, async () => {
  const f = await returningLoungeWithPendingMetadata({ strict });
  const entries = f.entries.length;
  assert.equal(hasLoungeStatus(f, "Checking this Lounge…"), true);
  assert.equal(f.input.props.value, "retained recovery draft"); assert.equal(f.input.props.editable, false);
  f.metadata.at(-1).reject(new Error("Metadata offline")); await f.settle();
  assert.equal(hasLoungeStatus(f, "Lounge status could not be confirmed."), true);
  const retry = f.metadataRetry.props.onPress, count = f.metadata.length;
  const style = Object.assign({}, ...[f.metadataRetry.props.style].flat());
  assert.ok(style.minHeight >= 44); assert.ok(style.minWidth >= 44);
  assert.equal(f.metadataRetry.props.accessibilityRole, "button");
  f.act(() => { retry(); retry(); retry(); });
  assert.equal(f.metadata.length, count + 1); assert.equal(f.entries.length, entries);
  assert.equal(f.polling.enabled, false); assert.equal(f.input.props.editable, false);
  f.act(retry); assert.equal(f.metadata.length, count + 1);
  f.edit("blocked until confirmed"); assert.equal(f.input.props.value, "retained recovery draft");
  await f.openMetadata();
  assert.equal(f.polling.enabled, true); assert.equal(f.input.props.editable, true);
  assert.equal(f.input.props.value, "retained recovery draft"); assert.equal(f.entries.length, entries);
  f.act(retry); assert.equal(f.metadata.length, count + 1); assert.equal(f.requests.length, 0); f.close();
});
test("Entered Lounge Retry closed response preserves existing closed-room UI", async () => {
  const f = await returningLoungeWithPendingMetadata(); const entries = f.entries.length;
  f.metadata.at(-1).reject(new Error("Metadata offline")); await f.settle();
  f.act(() => f.metadataRetry.props.onPress());
  await f.openMetadata({ status: "closed", attendeeCount: 3, messageCount: 0 });
  assert.equal(f.find(n => n.type === "ScreenHeader").props.kicker, "Lounge closed");
  assert.equal(f.all().some(n => n.type === "TextInput" || n.props?.accessibilityLabel === "Retry Lounge status"), false);
  assert.equal(f.polling.enabled, false); assert.equal(f.entries.length, entries);
  assert.equal(f.owner.lease(JSON.stringify(["lounge", "canonical-one"])).read().text, "retained recovery draft"); f.close();
});
test("Unknown metadata and repeated failure each expose a fresh bounded explicit Retry", async () => {
  const f = await returningLoungeWithPendingMetadata(); const entries = f.entries.length;
  await f.openMetadata({}); assert.equal(f.input.props.editable, false);
  const firstRetry = f.metadataRetry.props.onPress; f.act(firstRetry);
  f.metadata.at(-1).reject(new Error("Still offline")); await f.settle();
  const count = f.metadata.length;
  f.act(firstRetry); assert.equal(f.metadata.length, count);
  f.act(() => f.metadataRetry.props.onPress()); await f.openMetadata(null);
  assert.equal(f.polling.enabled, false); assert.equal(f.input.props.editable, false);
  assert.equal(f.input.props.value, "retained recovery draft");
  f.act(() => f.metadataRetry.props.onPress()); await f.openMetadata();
  assert.equal(f.input.props.editable, true); assert.equal(f.entries.length, entries);
  assert.equal(f.requests.length, 0); f.close();
});
for (const departure of ["before-cleanup", "frame-ABA", "account-ABA", "epoch", "channel-ABA", "layout-unmount"]) test(`Lounge metadata Retry cannot start reads after ${departure}`, async () => {
  const f = await returningLoungeWithPendingMetadata();
  f.metadata.at(-1).reject(new Error("Offline")); await f.settle();
  const retry = f.metadataRetry.props.onPress;
  if (departure === "before-cleanup") f.navigate("profile", false);
  else if (departure === "frame-ABA") { const frame = f.navigationRef.current.stack.at(-1); f.navigate("profile", false); f.navigationRef.current.stack.push(frame); }
  else if (departure === "account-ABA") { f.account("B", 1); f.account("A", 1); }
  else if (departure === "epoch") f.account("A", 2);
  else if (departure === "channel-ABA") { f.target("canonical-two"); f.target("canonical-one"); }
  else f.unmountLayout();
  const count = f.metadata.length; f.act(retry); assert.equal(f.metadata.length, count); f.close();
});
for (const strict of [false, true]) test(`Suspense retires metadata Retry but preserves a usable current failure, strict=${strict}`, async () => {
  const f = await returningLoungeWithPendingMetadata({ strict });
  f.metadata.at(-1).reject(new Error("Offline")); await f.settle();
  const retry = f.metadataRetry.props.onPress, count = f.metadata.length, entries = f.entries.length;
  f.hide(); f.act(retry); assert.equal(f.metadata.length, count);
  f.hide(false); await f.settle(); f.act(retry);
  // StrictMode may replay the existing entry reset/metadata effect on reveal.
  // A fresh metadata read never grants entry or starts another Going action.
  if (!f.all().some(n => n.props?.accessibilityLabel === "Retry Lounge status")) {
    f.metadata.at(-1).reject(new Error("Retry after reveal")); await f.settle();
  }
  const currentCount = f.metadata.length;
  f.act(() => f.metadataRetry.props.onPress()); assert.equal(f.metadata.length, currentCount + 1);
  await f.openMetadata(); assert.equal(f.entries.length, entries);
  assert.equal(f.owner.lease(JSON.stringify(["lounge", "canonical-one"])).read().text, "retained recovery draft"); f.close();
});
for (const outcome of ["open", "closed", "error"]) test(`Aborted departed metadata Retry cannot adopt a late ${outcome} result`, async () => {
  const f = await returningLoungeWithPendingMetadata();
  f.metadata.at(-1).reject(new Error("Offline")); await f.settle(); f.act(() => f.metadataRetry.props.onPress());
  const old = f.metadata.at(-1), entries = f.entries.length;
  f.navigate("profile"); assert.equal(old.options.signal.aborted, true); f.return();
  if (outcome === "error") old.reject(new Error("Retired failure")); else old.resolve({ status: outcome, attendeeCount: 3, messageCount: 1 });
  await f.settle();
  assert.equal(f.find(n => n.type === "ScreenHeader").props.kicker, "Lounge");
  assert.equal(f.polling.enabled, false); assert.equal(f.entries.length, entries);
  assert.equal(f.all().some(n => n.type === "TextInput" || n.props?.accessibilityLabel === "Retry Lounge status"), false);
  await f.openMetadata(); await f.enter(); await f.openMetadata();
  assert.equal(f.input.props.value, "retained recovery draft"); assert.equal(f.entries.length, entries + 1); f.close();
});
test("Guest iOS metadata Retry reads only aggregate state without entry or automatic login", async () => {
  const f = fixture({ kind: "lounge", autoMeta: false }); f.account(null, 2);
  f.metadata.at(-1).reject(new Error("Public metadata offline")); await f.settle();
  const count = f.metadata.length; f.act(() => f.metadataRetry.props.onPress()); assert.equal(f.metadata.length, count + 1);
  f.metadata.at(-1).resolve({ status: "open", attendeeCount: 3, messageCount: 1 }); await f.settle();
  assert.equal(f.polling.enabled, false); assert.equal(f.entries.length, 0); assert.equal(f.requests.length, 0);
  assert.equal(f.all().some(n => n.type === "TextInput"), false);
  assert.equal(hasLoungeStatus(f, "Log in to enter the Lounge"), true); f.close();
});
for (const platform of ["android", "web"]) test(`${platform} entered-room metadata feedback and retry path remain unchanged`, async () => {
  const f = fixture({ kind: "lounge", platform, autoMeta: false });
  f.metadata.at(-1).resolve({ status: "open", attendeeCount: 3, messageCount: 1 }); await f.settle(); await f.enter();
  assert.equal(hasLoungeStatus(f, "Checking this Lounge…"), false);
  f.metadata.at(-1).reject(new Error("Metadata offline")); await f.settle();
  assert.equal(hasLoungeStatus(f, "Lounge status could not be confirmed."), false);
  assert.equal(f.all().some(n => n.props?.accessibilityLabel === "Retry Lounge status"), false);
  assert.equal(f.entries.length, 1); assert.equal(f.requests.length, 0); f.close();
});
