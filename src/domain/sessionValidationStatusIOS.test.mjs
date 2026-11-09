import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createSessionValidationStatus } from "./sessionValidationStatus.mjs";
import { sessionValidationStatusForOwner as createDefaultStatus } from "../hooks/sessionValidationStatus.js";
import { sessionValidationStatusForOwner as statusForIOSOwner } from "../hooks/sessionValidationStatus.ios.js";
import { landingRenderSurface } from "./landingStartup.mjs";
import { createRequire } from "node:module";
import { parse } from "@babel/parser";
import { createSessionValidationCoordinator, sessionValidationOutcome } from "./sessionValidation.mjs";
import { createSessionValidationRetry } from "./sessionValidationRetry.mjs";
import { createAuthTransitions } from "./authTransitions.mjs";
import { createFeedHeadStatus } from "./feedHeadStatus.mjs";
import { apiIdentityBarrierDecision } from "./apiIdentityState.mjs";
import { createRequestControl } from "../lib/requestControl.mjs";
import { retryAfterDelayMs } from "../lib/retryAfter.mjs";

const source = readFileSync(new URL("../store.js", import.meta.url), "utf8");
const provider = parse(source, { sourceType: "module", plugins: ["jsx"] }).program.body
  .find((node) => node.type === "ExportNamedDeclaration" && node.declaration?.id?.name === "StoreProvider")?.declaration;
const effect = provider.body.body.find((node) => node.type === "ExpressionStatement"
  && node.expression?.callee?.name === "useEffect"
  && source.slice(node.start, node.end).includes("const runValidation = async"))?.expression.arguments[0];
assert.ok(effect, "The production identity validation effect must exist");
const validationEffect = source.slice(effect.start, effect.end);
const authDeclaration = (name) => {
  const node = provider.body.body.find((node) => node.type === 'VariableDeclaration' && node.declarations.some((declaration) => declaration.id.name === name));
  assert.ok(node, name + ' must exist');
  return source.slice(node.start, node.end);
};
const apiSource = readFileSync(new URL("../lib/api.js", import.meta.url), "utf8");
const apiBody = parse(apiSource, { sourceType: "module" }).program.body.flatMap((node) => {
  if (node.type === "ImportDeclaration" || (node.type === "ExportNamedDeclaration" && !node.declaration)) return [];
  const declaration = node.type === "ExportNamedDeclaration" ? node.declaration : node;
  return [apiSource.slice(declaration.start, declaration.end)];
}).join("\n");
const tick = () => new Promise((resolve) => setImmediate(resolve));
const member = { id: "synthetic-member", name: "Fixture member" };

// Execute the complete Store effect and API transport. Only external I/O,
// React setters and unrelated account projections are synthetic seams.
function fixture({ confirmed = true, account = confirmed ? member : null, intent = null, platform = "ios", channel = platform === "ios" ? createSessionValidationStatus() : createDefaultStatus() } = {}) {
  const state = { ready: confirmed, session: account };
  const sessionRef = { current: account }, authReadyRef = { current: confirmed };
  const authValidationSequenceRef = { current: 0 };
  const requests = [], retired = [], adoptions = [], feedback = [], timers = new Map();
  const appListeners = new Set(), windowListeners = new Map(), documentListeners = new Map();
  let timerId = 0, coordinator, authState = intent, revoked = 0;
  const authTransitions = createAuthTransitions({
    read: () => authState, write: (value) => { authState = value; },
    revoke: async () => { revoked += 1; },
  });
  class AppError extends Error {
    constructor(message, properties) { super(message); Object.assign(this, properties); }
  }
  const transportBindings = {
    AppError, captureAppError: (error, options) => { feedback.push(options); return error; }, apiIdentityBarrierDecision, createRequestControl, retryAfterDelayMs,
    Platform: { OS: platform }, apiBaseForRuntime: () => "https://synthetic.invalid",
    reviewAllowsRequest: () => true, photoCreditUrlFromLinkHeader: () => null,
    fetch: (url, options) => new Promise((resolve, reject) => { requests.push({ url, options, resolve, reject }); }),
  };
  const transport = new Function(...Object.keys(transportBindings), `${apiBody}\nreturn { api, configureApiIdentity };`)(...Object.values(transportBindings));
  transport.configureApiIdentity(account?.id, { ready: confirmed });
  const dependencies = {
    invalidateIOSDetailPrivacy: () => 0,
    ...transport, sessionRef, authReadyRef, authValidationSequenceRef, authTransitions,
    sessionValidationStatus: channel,
    sessionValidationOutcome, createSessionValidationRetry: () => createSessionValidationRetry({ random: () => 0 }),
    createSessionValidationCoordinator: (options) => {
      coordinator = createSessionValidationCoordinator(options);
      return coordinator;
    },
    remoteIdentityValidationEnabled: () => true, ENABLE_DEMO_DATA: false,
    configureProductAnalytics() {}, resolveLegacyDraftsForIdentity() {}, adoptFeedAccount() {}, revalidateCachedFeed() {},
    setAuthReady: (value) => { state.ready = value; },
    setSession: (value) => { state.session = value; },
    retireRevalidatedAccount: (id) => { retired.push(id); },
    absorbServerUser: (user, options) => {
      adoptions.push({ user, options });
      authValidationSequenceRef.current += 1;
      sessionRef.current = user; state.session = user;
      authReadyRef.current = true; state.ready = true;
      transport.configureApiIdentity(user.id, { ready: true });
    },
    setTimeout: (work, ms) => { const id = ++timerId; timers.set(id, { work, ms }); return id; },
    clearTimeout: (id) => timers.delete(id),
    Platform: { OS: platform }, AppState: { addEventListener: (_, listener) => { appListeners.add(listener); return { remove: () => appListeners.delete(listener) }; } },
    AUTH_EPOCH_STORAGE_KEY: "auth-epoch", AUTH_INTENT_KEY: "auth-intent",
    window: { addEventListener: (key, listener) => windowListeners.set(key, listener), removeEventListener: key => windowListeners.delete(key) },
    document: { hidden: false, addEventListener: (key, listener) => documentListeners.set(key, listener), removeEventListener: key => documentListeners.delete(key) },
  };
  const cleanup = new Function(...Object.keys(dependencies), `return (${validationEffect})();`)(...Object.values(dependencies));
  // Logout synchronously retires the iOS presentation receipt as well as auth.
  // Use the real observer so this extracted runtime declaration keeps its boundary.
  const feedHeadStatus = createFeedHeadStatus();
  const authDependencies = {
    ...dependencies, accountMutationEpochRef: { current: 0 },
    feedRefreshRef: { current: { headStatus: feedHeadStatus } },
    switchLinkedAccountRequest: async (_actor, target) => ({ user: { id: target } }),
    localCommandError: () => ({ ok: false }), captureAppError() {}, AppError,
    broadcastAuthEpoch() {}, playHistoryRequestRef: { current: { sequence: 0 } }, playlistRequestRef: { current: { sequence: 0 } },
    setPlayHistory() {}, setPlayHistoryAccountId() {}, setPlayHistoryNextCursor() {}, setPlayHistoryErrorMode() {}, setPlayHistoryStatus() {},
    setMyPlaylistsForAccount() {}, setMyPlaylistsStatus() {}, setFriendsListening() {}, resetStaffState() {}, staffStateScopeRef: { current: null },
    remove() {}, clearStoredTheme() {}, purgeProductAnalyticsAccount() {},
    draftsRef: { current: [] }, follows: [], load() {}, save() {}, purgeAccountLocalPrivacy: () => ({ purged: false }),
  };
  const auth = new Function(...Object.keys(authDependencies), authDeclaration('performAuthentication') + '\n' + authDeclaration('logout') + '\n' + authDeclaration('switchLinkedAccount') + '\nreturn { performAuthentication, logout, switchLinkedAccount };')(...Object.values(authDependencies));
  const respond = (index, text, status = 200, headers = {}) => {
    assert.ok(requests[index], `Expected identity request ${index}`);
    requests[index].resolve(new Response(text, { status, headers: { "Content-Type": "application/json", ...headers } }));
  };
  const finish = async (text, status = 200, headers = {}) => {
    const pending = coordinator.validate({ force: true });
    await tick(); respond(requests.length - 1, text, status, headers);
    return pending;
  };
  const fireRetry = () => {
    assert.equal(timers.size, 1, "one scheduled recovery attempt");
    const [id, timer] = [...timers.entries()][0];
    timers.delete(id); timer.work();
    return coordinator.validate({ force: true });
  };
  return { state, requests, retired, adoptions, timers, get coordinator() { return coordinator; }, respond, finish, fireRetry, cleanup, authTransitions,
    channel, feedback, appListeners, windowListeners, documentListeners, status: () => channel?.getSnapshot(), restart: () => new Function(...Object.keys(dependencies), `return (${validationEffect})();`)(...Object.values(dependencies)),
    ...auth, feedHeadStatus, sessionRef, authReadyRef, authValidationSequenceRef, adopt: dependencies.absorbServerUser,
    get revoked() { return revoked; } };
}

for (const [label, payload, code] of [["503", '{"error":"Unavailable"}', 503], ["malformed 200", '{}', 200]]) {
  test(`iOS cold ${label} exposes recovery; a deliberate Retry replaces only local backoff`, async (t) => {
    const f = fixture({ confirmed: false }); t.after(f.cleanup);
    assert.equal(f.status().phase, "checking");
    const first = await f.finish(payload, code);
    assert.equal(first.result.authoritative, false);
    assert.equal(f.state.ready, false);
    assert.equal(f.status().phase, "unavailable");
    assert.equal([...f.timers.values()][0].ms, 5000);
    const oldTimer = [...f.timers.values()][0], retry = f.status().retry;
    const pending = retry();
    assert.equal(f.status().phase, "checking");
    assert.equal(f.timers.size, 0);
    retry(); retry(); oldTimer.work();
    await tick();
    assert.equal(f.requests.length, 2, "repeated taps and a captured cleared timer create no extra flight");
    f.respond(1, payload, code); await pending;
    assert.equal(f.status().phase, "unavailable");
    assert.equal([...f.timers.values()][0].ms, 10000, "manual retry does not reset automatic backoff progression");
    const recovered = f.status().retry(); await tick(); f.respond(2, JSON.stringify({ user: member })); await recovered;
    assert.equal(f.status().phase, "idle"); assert.equal(f.state.ready, true); assert.equal(f.timers.size, 0);
    assert.ok(f.feedback.every(options => options.toast === false));
  });
}

test("iOS Retry-After uses the existing single timer and exposes no early Retry action", async (t) => {
  const f = fixture({ confirmed: false }); t.after(f.cleanup);
  await f.finish('{"error":"Unavailable"}', 503, { "Retry-After": "120" });
  assert.equal(f.status().phase, "waiting"); assert.equal(f.status().retry, null);
  assert.equal(f.timers.size, 1); assert.equal([...f.timers.values()][0].ms, 120000);
  const pending = f.fireRetry(); await tick();
  assert.equal(f.status().phase, "checking"); assert.equal(f.requests.length, 2);
  f.respond(1, JSON.stringify({ user: member })); await pending;
  assert.equal(f.status().phase, "idle");
});

test("a Retry invoked while a failure is still settling joins without stealing its timer or superseding", async (t) => {
  const f = fixture({ confirmed: false }); t.after(f.cleanup);
  let joined = null;
  const unsubscribe = f.channel.subscribe(() => {
    if (f.status().phase === "unavailable") joined = f.status().retry();
  }); t.after(unsubscribe);
  const outcome = await f.finish('{"error":"Unavailable"}', 503);
  assert.deepEqual(await joined, outcome);
  assert.equal(f.requests.length, 1); assert.equal(f.timers.size, 1);
  assert.equal(f.status().phase, "unavailable");
});

test("strict revalidation remains locked; manual Retry keeps strict recovery on the same coordinator", async (t) => {
  const f = fixture(); t.after(f.cleanup);
  await f.finish(JSON.stringify({ user: member }));
  const strict = f.coordinator.validate({ force: true, strict: true }); await tick();
  assert.equal(f.state.ready, false); assert.equal(f.status().phase, "checking");
  f.respond(1, '{"error":"Unavailable"}', 503); await strict;
  const pending = f.status().retry(); await tick();
  f.respond(2, '{}'); await pending;
  assert.equal(f.state.ready, false); assert.equal(f.status().phase, "unavailable");
  assert.deepEqual(f.retired, []);
  const last = f.status().retry(); await tick(); f.respond(3, JSON.stringify({ user: member })); await last;
  assert.equal(f.state.ready, true); assert.equal(f.status().phase, "idle");
});

for (const operation of ["login", "same-ID login", "logout", "intent revision", "strict epoch", "unmount"]) {
  test(`a failed-snapshot Retry cannot act after ${operation}`, async (t) => {
    const f = fixture({ confirmed: operation === "same-ID login" }); t.after(f.cleanup);
    if (operation === "same-ID login") f.coordinator.validate({ force: true, strict: true });
    await f.finish('{"error":"Unavailable"}', 503);
    const retry = f.status().retry, oldTimer = [...f.timers.values()][0];
    if (operation === "login" || operation === "same-ID login") {
      const user = { id: operation === "same-ID login" ? member.id : "synthetic-replacement" };
      await f.performAuthentication(async () => ({ user }), ({ user }) => f.adopt(user));
      // Even if a new strict cycle locks the same account, sequence admission is retired.
      f.authReadyRef.current = false;
    } else if (operation === "logout") await f.logout();
    else if (operation === "intent revision") {
      const work = f.performAuthentication(async () => { throw new Error("synthetic rejection"); }, () => {});
      await assert.rejects(work);
    } else if (operation === "strict epoch") {
      const pending = f.coordinator.validate({ force: true, strict: true }); await tick();
      f.respond(1, '{}'); await pending;
    } else f.cleanup();
    const count = f.requests.length, timers = [...f.timers.entries()], state = f.status();
    retry(); await tick();
    assert.equal(f.requests.length, count); assert.deepEqual([...f.timers.entries()], timers);
    assert.equal(f.status(), state);
    if (operation === "unmount") { oldTimer.work(); await tick(); assert.equal(f.requests.length, count); }
  });
}

test("effect remounts retire old owner callbacks and cannot publish late failure into the new owner", async (t) => {
  const channel = createSessionValidationStatus();
  const old = fixture({ confirmed: false, channel });
  const oldPending = old.coordinator.validate({ force: true }); await tick();
  old.cleanup();
  const current = fixture({ confirmed: false, channel }); t.after(current.cleanup);
  await current.finish('{}');
  const snapshot = current.status();
  old.respond(0, '{"error":"Unavailable"}', 503); await oldPending;
  old.cleanup();
  assert.equal(current.status(), snapshot);
  const pending = snapshot.retry(); await tick(); current.respond(1, JSON.stringify({ user: member })); await pending;
  assert.equal(current.state.ready, true);
});

test("iOS status channel contains no error/account data and retires a same-owner failed snapshot", () => {
  const channel = createSessionValidationStatus(), owner = channel.begin(); let calls = 0;
  owner.unavailable(() => calls++); const first = channel.getSnapshot();
  assert.deepEqual(Object.keys(first), ["phase", "retry"]);
  owner.checking(); first.retry(); assert.equal(calls, 0);
  owner.unavailable(() => calls++); const second = channel.getSnapshot();
  const replacement = channel.begin(); second.retry(); owner.dispose(); owner.unavailable(() => calls++);
  assert.equal(channel.getSnapshot().phase, "checking"); assert.equal(calls, 0);
  replacement.dispose();
});

async function automaticTrace(platform, { confirmed, strict = false, payload, code, headers = {} }) {
  const f = fixture({ platform, confirmed });
  try {
    if (strict) f.coordinator.validate({ force: true, strict: true });
    const first = await f.finish(payload, code, headers);
    const trace = { first, state: { ...f.state }, retired: [...f.retired], delays: [], replies: [] };
    for (let i = 0; i < 2 && f.timers.size; i++) {
      trace.delays.push([...f.timers.values()][0].ms);
      const pending = f.fireRetry(); await tick(); f.respond(f.requests.length - 1, payload, code, headers);
      trace.replies.push(await pending);
    }
    if (f.timers.size) {
      const pending = f.fireRetry(); await tick(); f.respond(f.requests.length - 1, JSON.stringify({ user: member }));
      trace.recovered = await pending;
    }
    trace.final = { ...f.state };
    trace.requests = f.requests.map(({ url, options }) => ({ url, method: options.method, credentials: options.credentials, body: options.body }));
    trace.adoptions = f.adoptions; trace.feedback = f.feedback.map(x => x.toast); trace.timers = f.timers.size;
    if (platform !== "ios") assert.equal(f.channel, null);
    return trace;
  } finally { f.cleanup(); }
}
for (const scenario of [
  { confirmed: false, payload: '{}', code: 200 },
  { confirmed: false, payload: '{"error":"Unavailable"}', code: 503 },
  { confirmed: true, payload: '{"error":"Unavailable"}', code: 503 },
  { confirmed: true, strict: true, payload: '{}', code: 200 },
  { confirmed: false, payload: '{"error":"Unavailable"}', code: 503, headers: { "Retry-After": "120" } },
  { confirmed: true, payload: '{"user":null}', code: 200 },
  { confirmed: true, payload: '{"error":"Expired"}', code: 401 },
  { confirmed: true, payload: JSON.stringify({ user: member }), code: 200 },
]) test(`untapped iOS instrumentation preserves Android/web requests, returns, state and delays: ${JSON.stringify(scenario)}`, async () => {
  const ios = await automaticTrace("ios", scenario);
  assert.deepEqual(await automaticTrace("android", scenario), ios);
  assert.deepEqual(await automaticTrace("web", scenario), ios);
});

const require = createRequire(import.meta.url);
const React = require("react"), reconciler = require("react-reconciler"), { transformSync } = require("@babel/core");
const noop = () => {};
function createRenderer(nativeActions = []) {
  const context = {}, container = { children: [] };
  let priority = 0;
  const append = (parent, child) => parent.children.push(child);
  const remove = (parent, child) => { const index = parent.children.indexOf(child); if (index >= 0) parent.children.splice(index, 1); };
  const insert = (parent, child, before) => parent.children.splice(parent.children.indexOf(before), 0, child);
  const renderer = reconciler({
    supportsMutation: true, isPrimaryRenderer: true, supportsPersistence: false, supportsHydration: false,
    getRootHostContext: () => context, getChildHostContext: () => context, getPublicInstance: node => node,
    prepareForCommit: () => null, resetAfterCommit: noop,
    createInstance: (type, props) => ({ type, props, children: [], focus: () => nativeActions.push("focus"), blur: () => nativeActions.push("blur"), scrollTo: () => nativeActions.push("scroll") }), createTextInstance: text => ({ text }),
    appendInitialChild: append, appendChild: append, appendChildToContainer: append,
    removeChild: remove, removeChildFromContainer: remove, insertBefore: insert, insertInContainerBefore: insert,
    finalizeInitialChildren: () => false, shouldSetTextContent: () => false,
    commitUpdate: (node, type, oldProps, newProps) => { node.props = newProps; }, commitTextUpdate: (node, oldText, text) => { node.text = text; },
    hideInstance: noop, unhideInstance: noop, hideTextInstance: noop, unhideTextInstance: noop,
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

const walk = node => [node, ...(node.children || []).flatMap(walk)];
const allNodes = node => {
  if (!node || typeof node !== "object") return [];
  return [node, ...Object.values(node).flatMap(value => Array.isArray(value) ? value.flatMap(allNodes) : allNodes(value))];
};
function uiFixture(f, { platform = "ios", strict = false, mountOwner = false } = {}) {
  const renderer = createRenderer(), jobs = new Map(); let job = 0;
  const native = { ActivityIndicator: "ActivityIndicator", Pressable: "Pressable", Text: "Text", View: "View", ScrollView: "ScrollView", StyleSheet: { create: value => value } };
  const compile = (source, dependencies = {}) => {
    const code = transformSync(source, { babelrc: false, configFile: false,
      plugins: [[require("@babel/plugin-transform-react-jsx"), { runtime: "automatic" }], require("@babel/plugin-transform-modules-commonjs")],
    }).code;
    const module = { exports: {} };
    new Function("require", "module", "exports", ...Object.keys(dependencies), code)(name => {
      if (name === "react-native") return native;
      if (name === "../theme") return { colors: { amber: "amber", text: "text", textDim: "dim" } };
      return require(name);
    }, module, module.exports, ...Object.values(dependencies));
    return module.exports.default;
  };
  const SessionValidationPending = compile(readFileSync(new URL(`../components/SessionValidationPending${platform === "ios" ? ".ios" : ""}.jsx`, import.meta.url), "utf8"));
  const app = readFileSync(new URL("../../App.js", import.meta.url), "utf8");
  const nodes = allNodes(parse(app, { sourceType: "module", plugins: ["jsx"] }));
  const loading = nodes.find(node => node.type === "FunctionDeclaration" && node.id.name === "ScreenLoading");
  const pending = nodes.find(node => node.type === "ConditionalExpression" && app.slice(node.test.start, node.test.end) === 'landingSurface === "pending"');
  assert.ok(loading && pending, "actual Root pending selection and generic loading component exist");
  const ScreenLoading = compile(app.slice(loading.start, loading.end) + "\nexport default ScreenLoading;", {
    ...native, useState: React.useState, useEffect: React.useEffect, colors: { amber: "amber" }, styles: {},
    setTimeout: (work, delay) => { const id = ++job; jobs.set(id, { work, delay }); return id; }, clearTimeout: id => jobs.delete(id),
  });
  const Subject = compile(`export default function Subject({ state, landing, sessionValidationStatus }) {
    const landingSurface = landingRenderSurface({ authReady: state.ready, session: state.session, landing });
    return ${app.slice(pending.test.start, pending.test.end)} ? (${app.slice(pending.consequent.start, pending.consequent.end)}) : <ResolvedSurface surface={landingSurface} />;
  }`, { landingRenderSurface, SessionValidationPending, ScreenLoading, ResolvedSurface: "ResolvedSurface" });
  function Owner() { React.useEffect(() => f.restart(), []); return null; }
  const render = (landing = false) => renderer.render(React.createElement(strict ? React.StrictMode : React.Fragment, null,
    mountOwner ? React.createElement(Owner) : null,
    React.createElement(Subject, { state: f.state, landing, sessionValidationStatus: f.channel })));
  const settle = async () => { await tick(); renderer.act(noop); };
  render();
  return { renderer, render, settle, jobs,
    nodes: () => walk(renderer.container),
    texts: () => walk(renderer.container).filter(n => n.text != null).map(n => n.text),
    button: () => walk(renderer.container).find(n => n.props?.accessibilityRole === "button"),
    close: () => renderer.render(null),
  };
}

for (const code of [200, 503]) test(`actual Root pending branch shows iOS checking, ${code} failure, Retry and recovery`, async (t) => {
  const f = fixture({ confirmed: false }); t.after(f.cleanup);
  const ui = uiFixture(f); t.after(ui.close);
  assert.ok(ui.texts().includes("Checking your sign-in status…"));
  assert.equal(ui.button(), undefined); assert.equal(ui.jobs.size, 0);
  await f.finish(code === 200 ? '{}' : '{"error":"Unavailable"}', code); await ui.settle(); ui.render();
  assert.ok(ui.texts().includes("MSHPIT couldn’t finish loading"));
  assert.ok(ui.texts().includes("We couldn’t confirm your sign-in status. We’ll try again automatically."));
  assert.equal(ui.nodes().filter(n => n.type === "ResolvedSurface").length, 0, "private app/landing is not rendered while locked");
  const button = ui.button(); assert.equal(button.props.accessibilityLabel, "Retry loading MSHPIT");
  assert.equal(button.props.disabled, false); assert.ok(button.props.style.minHeight >= 44);
  assert.ok(button.props.style.minWidth >= 44);
  assert.ok(ui.nodes().some(n => n.type === "ScrollView" && n.props.contentContainerStyle.flexGrow === 1));
  assert.ok(ui.nodes().filter(n => n.type === "Text").every(n => n.props.numberOfLines == null && n.props.allowFontScaling !== false));
  let pending; ui.renderer.act(() => { pending = button.props.onPress(); }); await ui.settle();
  assert.ok(ui.texts().includes("Checking your sign-in status…")); assert.equal(ui.button(), undefined);
  f.respond(1, JSON.stringify({ user: member })); await pending; await ui.settle(); ui.render();
  assert.ok(ui.nodes().some(n => n.type === "ResolvedSurface" && n.props.surface === "app"));
  assert.equal(ui.texts().length, 0);
});

test("actual iOS Root retains the app for confirmed refresh errors and locks only for strict validation", async (t) => {
  const f = fixture(); t.after(f.cleanup);
  const ui = uiFixture(f); t.after(ui.close);
  await f.finish('{"error":"Unavailable"}', 503); await ui.settle(); ui.render();
  assert.ok(ui.nodes().some(n => n.type === "ResolvedSurface" && n.props.surface === "app"));
  assert.equal(ui.button(), undefined);
  const strict = f.coordinator.validate({ force: true, strict: true }); await tick(); ui.render();
  assert.ok(ui.texts().includes("Checking your sign-in status…"));
  f.respond(1, '{}'); await strict; await ui.settle(); ui.render();
  assert.ok(ui.texts().includes("MSHPIT couldn’t finish loading"));
});

test("actual iOS Root presents timing-neutral disabled recovery when the service asks it to wait", async (t) => {
  const f = fixture({ confirmed: false }); t.after(f.cleanup);
  const ui = uiFixture(f); t.after(ui.close);
  await f.finish('{"error":"Unavailable"}', 503, { "Retry-After": "7200" }); await ui.settle(); ui.render();
  assert.equal([...f.timers.values()][0].ms, 3600000, "existing one-hour hint bound is unchanged");
  assert.ok(ui.texts().includes("A retry is scheduled. We’ll check your sign-in status again automatically."));
  assert.equal(ui.button().props.disabled, true); assert.equal(ui.button().props.onPress, null);
});

for (const platform of ["android", "web"]) test(`actual ${platform} Root still renders the original generic loading surface`, async (t) => {
  const f = fixture({ confirmed: false, platform }); t.after(f.cleanup);
  const ui = uiFixture(f, { platform }); t.after(ui.close);
  await f.finish('{}'); await ui.settle(); ui.render();
  assert.equal(ui.jobs.size, 1);
  ui.renderer.act(() => { for (const { work, delay } of ui.jobs.values()) { assert.equal(delay, 250); work(); } });
  assert.deepEqual(ui.texts(), ["Loading..."]); assert.equal(ui.button(), undefined);
  assert.ok(ui.nodes().some(n => n.props?.accessibilityLabel === "Loading screen"));
});

test("React StrictMode effect replay leaves only the current identity owner able to recover", async (t) => {
  const f = fixture({ confirmed: false }); f.cleanup();
  const ui = uiFixture(f, { strict: true, mountOwner: true }); t.after(ui.close);
  await ui.settle();
  assert.equal(f.requests.length, 1, "stopped replay owner does not dispatch its queued request");
  await f.finish('{}'); await ui.settle(); ui.render();
  assert.ok(ui.texts().includes("MSHPIT couldn’t finish loading"));
  let pending; ui.renderer.act(() => { pending = ui.button().props.onPress(); }); await ui.settle();
  f.respond(1, JSON.stringify({ user: member })); await pending; await ui.settle(); ui.render();
  assert.equal(f.state.ready, true); assert.equal(f.timers.size, 0);
  assert.ok(ui.nodes().some(n => n.type === "ResolvedSurface"));
});

test("Store exposes its existing identity owner's platform-resolved status channel without another hook", () => {
  assert.match(source, /import \{ sessionValidationStatusForOwner \} from "\.\/hooks\/sessionValidationStatus"/);
  assert.match(source, /const sessionValidationStatus = sessionValidationStatusForOwner\(authValidationSequenceRef\)/);
  const owner = { current: 0 }, other = { current: 0 };
  const first = statusForIOSOwner(owner);
  assert.equal(statusForIOSOwner(owner), first);
  owner.current += 1;
  assert.equal(statusForIOSOwner(owner), first, "an identity epoch changes admission, not the owner channel");
  assert.notEqual(statusForIOSOwner(other), first, "another Store cannot inherit the channel");
  assert.equal(createDefaultStatus(owner), null);
});


test("same-ID reauthentication retires pending validation publication as well as its Retry action", async (t) => {
  const f = fixture(); t.after(f.cleanup);
  const pending = f.coordinator.validate({ force: true, strict: true }); await tick();
  await f.performAuthentication(async () => ({ user: member }), ({ user }) => f.adopt(user));
  f.respond(0, '{"error":"Unavailable"}', 503);
  assert.equal((await pending).result.stale, true);
  assert.equal(f.state.ready, true); assert.equal(f.state.session.id, member.id);
  assert.equal(f.status().phase, "idle"); assert.equal(f.status().retry, null); assert.equal(f.timers.size, 0);
});

test("actual foreground/visibility handlers retain single-flight and confirmed-state parity across platforms", async () => {
  const traces = [];
  for (const platform of ["ios", "android", "web"]) {
    const f = fixture({ platform });
    try {
      await f.finish(JSON.stringify({ user: member }));
      f.coordinator.markAuthoritative(Date.now() - 120000);
      f.coordinator.background(Date.now() - 61000);
      for (const listener of f.appListeners) listener("active");
      f.windowListeners.get("pageshow")?.();
      f.windowListeners.get("online")?.();
      f.documentListeners.get("visibilitychange")?.();
      const pending = f.coordinator.validate({ force: true }); await tick();
      assert.equal(f.requests.length, 2, "overlapping real foreground hooks share one request");
      f.respond(1, '{"error":"Unavailable"}', 503); const result = await pending;
      assert.equal(f.state.ready, true); assert.equal(f.state.session.id, member.id);
      if (platform === "ios") assert.equal(f.status().phase, "idle");
      const timer = [...f.timers.values()][0];
      traces.push({ result, state: f.state, requests: f.requests.map(x => x.url), delay: timer.ms, feedback: f.feedback.map(x => x.toast) });
    } finally { f.cleanup(); }
    assert.equal(f.appListeners.size, 0); assert.equal(f.windowListeners.size, 0); assert.equal(f.documentListeners.size, 0);
  }
  assert.deepEqual(traces[0], traces[1]); assert.deepEqual(traces[0], traces[2]);
});
