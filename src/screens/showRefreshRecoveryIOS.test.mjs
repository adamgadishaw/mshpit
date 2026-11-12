import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL("../../", import.meta.url));
const require = createRequire(new URL("../../package.json", import.meta.url));
const React = require("react"), reconciler = require("react-reconciler");
const { transformSync } = require("@babel/core");
const noop = () => {};
const codes = new Map();
function execute(file, imports, timers = null) {
  const absolute = path.join(root, file);
  if (!codes.has(file)) codes.set(file, transformSync(readFileSync(absolute, "utf8"), {
    filename: absolute, babelrc: false, configFile: false,
    plugins: [[require("@babel/plugin-transform-react-jsx"), { runtime: "automatic" }], require("@babel/plugin-transform-modules-commonjs")],
  }).code);
  const module = { exports: {} };
  new Function("require", "module", "exports", "setTimeout", "clearTimeout", codes.get(file))(
    name => imports(name, createRequire(absolute)), module, module.exports,
    timers ? fn => { const key = {}; timers.set(key, fn); return key; } : setTimeout,
    timers ? key => timers.delete(key) : clearTimeout);
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
    createInstance: (type, props) => ({ type, props, children: [] }), createTextInstance: text => ({ text }),
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
const nodes = node => [node, ...(node.children || []).flatMap(nodes)];
const text = node => node.text ?? (node.children || []).map(text).join(" ");
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const { AppError } = execute("src/lib/diagnostics.js", (name, local) =>
  name === "./persist" ? { load: () => [], save: noop, remove: noop, setPersistErrorHandler: noop } : local(name));
const networkError = () => new AppError(undefined, { kind: "network" });
const showApi = require("./src/features/showSocial/showSocialApi.mjs");
const publicApi = require("./src/features/showSocial/publicEventSnapshotApi.mjs");

// Real Show screen, attendance child, public/canonical normalizers, memorial
// hook/API, refresh hook and AppError. Only transport, Store, native hosts and
// unrelated resources are synthetic. No mutation or external opener may run.
function fixture({ platform = "ios", lifecycle = "cancelled", publicState = "active", providerBacked = true, fontScale = 1 } = {}) {
  const renderer = createRenderer(), reads = [], memorialReads = [], publicReads = [], calls = [], empty = [];
  const rsvpTimers = new Map();
  let refreshHook, snapshotHook, memorialHook, memorialApi, attendanceControls, recovery;
  let log = { ...(publicState !== "none" ? { id: "tm_fixture" } : {}), artist: "Fixture artist", venue: "Fixture venue",
    date: "2099-01-01", ticketUrl: "https://seller.example/ticket", source: "ticketmaster" };
  const record = (kind, options) => { calls.push({ kind, options }); };
  const transport = async (url, options) => {
    if (url.startsWith("/api/shows/")) {
      const request = { ...deferred(), url, options }; reads.push(request); record("document", options); return request.promise;
    }
    if (url.startsWith("/api/resolve?")) {
      publicReads.push({ url, options }); record("public", options);
      if (publicState === "error") throw networkError();
      const id = log.id;
      return { entity: { kind: "event", publicEventSnapshot: true, id, path: "/event/" + id,
        name: log.artist, artist: log.artist, venue: log.venue, date: log.date, ticketUrl: log.ticketUrl,
        eventStatus: publicState === "cancelled" ? "cancelled" : "onsale" } };
    }
    if (url.endsWith("/memorial")) {
      const request = { ...deferred(), url, options }; memorialReads.push(request); record("memorial", options); return request.promise;
    }
    if (url.includes("/attendees?scope=")) { record("crowd", options); return { scope: "everyone", attendees: [], total: 0, viewerGoing: false, viewerAttendance: null }; }
    if (url.endsWith("/meta")) { record("lounge", options); return { messageCount: 0, status: "open" }; }
    assert.fail("Unexpected synthetic transport: " + url);
  };
  const native = { AppState: { currentState: "active", addEventListener: () => ({ remove: noop }) },
    Platform: { OS: platform, select: value => value[platform] || value.default },
    View: "View", Text: "Text", ScrollView: "ScrollView", Pressable: "Pressable", ActivityIndicator: "ActivityIndicator",
    StyleSheet: { create: value => value, absoluteFill: {} }, useWindowDimensions: () => ({ width: 393, height: 852, fontScale }) };
  const store = {
    session: { id: "fixture" }, venueCoord: () => null, venuePhotos: () => empty, venuePhotoState: () => ({ status: "ready" }),
    loadVenuePhotos: async (venue, options) => { record("photos", options); return empty; },
    concertKey: row => [row.artist, row.venue, row.date].join("|"), isGoing: () => false, isGoingBusy: () => false,
    toggleGoing: () => assert.fail("No real Going"), applyMyAttendanceMutation: () => assert.fail("No attendance mutation"),
    loungeFor: () => empty, artistSummary: () => null, addLog: () => assert.fail("No publication"),
  };
  const services = {
    readShowDocument: options => showApi.readShowDocument(options, { apiCall: transport }),
    readPublicEventSnapshot: options => publicApi.readPublicEventSnapshot(options, { apiCall: transport }),
    readShowCrowdAttendance: options => showApi.readShowCrowdAttendance(options, { apiCall: transport }),
    readShowLoungeMeta: options => showApi.readShowLoungeMeta(options, { apiCall: transport }),
    writeShowAttendance: () => assert.fail("No attendance write"),
  };
  const imports = (name, local) => {
    if (name.endsWith("/useEventRsvp")) return execute("src/hooks/useEventRsvp.js", imports, rsvpTimers);
    if (name.endsWith("/concertDetailLayout")) return require("./src/components/concertDetailLayout" + (platform === "web" ? ".web" : "") + ".js");
    if (name.endsWith("/ShowSection")) return execute("src/features/showDetails/ShowSection.jsx", imports);
    if (name.endsWith("/lazyWithRetry")) return { lazyWithRetry: (_read, label) => { assert.equal(label, "AfterShowSection"); return execute("src/screens/AfterShowSection.jsx", imports).default; } };
    if (name.endsWith("/usePublicVenueSnapshot")) return () => ({ resource: { status: "ready", data: null } });
    if (name.endsWith("/useIOSDetailPresentation")) return require("./src/hooks/useIOSDetailPresentation.js");
    if (name === "react" || name === "react/jsx-runtime") return require(name);
    if (name === "react-native") return native;
    if (name === "./ShowRefreshRecovery") return recovery;
    if (name === "../store") return { useStore: () => store };
    if (name === "../theme" || name === "../../theme") return { colors: new Proxy({}, { get: (_, key) => String(key) }),
      displayFont: "display", mono: "mono", radius: {}, shadow: {}, space: value => value * 4 };
    if (name === "../features/showSocial/showSocialService" || name === "./showSocialService") return services;
    if (name === "../hooks/useScopedRefresh") return refreshHook;
    if (name === "../hooks/usePublicEventSnapshot") return snapshotHook;
    if (name === "../features/artistMemorials/useArtistMemorial") return memorialHook;
    if (name === "./services/artistMemorialApi.mjs") return memorialApi;
    if (name === "../../../lib/api") return { api: transport, AppError };
    if (name === "../features/showSocial/ShowAttendanceControls") return attendanceControls;
    if (name === "../../components/SocialShareStudio") return { SocialShareButton: "SocialShareButton" };
    if (name === "../hooks/useCanonicalArtistIdentity") return { __esModule: true, default: () => ({
      artistKey: log.artist === "Fixture artist" ? "fixture_artist" : "other_fixture_artist", status: "ready", retry: noop, retryDisabled: false, missing: false, error: null,
    }) };
    if (name === "../features/artistEvents/useArtistEventArchive") return { useArtistEventReviews: () => ({
      resource: { data: { reviews: [] }, status: "ready" }, reload: noop, loadMore: noop,
    }) };
    if (name === "../lib/useAppActive") return { __esModule: true, default: () => true };
    if (name === "../components/useIOSTicketAction") return { __esModule: true, default: () => ({
      open: () => assert.fail("No external ticket opening"), error: "",
    }) };
    if (name === "../lib/showTime") return local(name + ".js");
    if ((name.startsWith("../components/") || name.startsWith("../../components/")) && !name.endsWith(".mjs")
      || name === "../features/catalogEditor/CatalogText") return name.split("/").at(-1);
    return local(name);
  };
  recovery = execute("src/screens/ShowRefreshRecovery" + (platform === "ios" ? ".ios" : "") + ".jsx", imports);
  refreshHook = execute("src/hooks/useScopedRefresh.js", imports);
  snapshotHook = execute("src/hooks/usePublicEventSnapshot" + (platform === "ios" ? ".ios" : "") + ".js", imports);
  memorialApi = execute("src/features/artistMemorials/services/artistMemorialApi.mjs", imports);
  memorialHook = execute("src/features/artistMemorials/useArtistMemorial" + (platform === "ios" ? ".ios" : "") + ".js", imports);
  attendanceControls = execute("src/features/showSocial/ShowAttendanceControls" + (platform === "ios" ? ".ios" : "") + ".jsx", imports);
  const Screen = execute("src/screens/ShowScreen" + (platform === "ios" ? ".ios" : "") + ".jsx", imports).default;
  const render = () => renderer.render(React.createElement(Screen, { log, onClose: noop }));
  const all = () => nodes(renderer.container);
  const retry = () => all().find(node => node.props?.accessibilityLabel === "Retry refreshing show details");
  const inspect = () => ({
    header: all().find(node => node.type === "ScreenHeader")?.props.kicker,
    tickets: all().filter(node => node.type === "Pressable" && node.props.accessibilityRole === "link").length,
    legacyGoing: all().some(node => node.props?.accessibilityLabel === "Add this show to Going"),
    typedGoing: all().some(node => node.props?.accessibilityRole === "radio" && node.props.accessibilityLabel === "Going"),
    retained: !!retry(),
  });
  const doc = { id: "show_" + "a".repeat(64), canonicalKey: store.concertKey(log), artist: log.artist, venue: log.venue,
    localDate: log.date, startsAt: Date.parse("2099-01-01T20:00:00Z"), lifecycle,
    ...(providerBacked ? { provider: { name: "ticketmaster", eventId: "fixture", backed: true } } : {}) };
  const flush = async () => { for (let i = 0; i < 5; i++) { await new Promise(setImmediate); renderer.act(noop); } };
  return {
    reads, memorialReads, publicReads, calls, doc, render, flush, all, retry, inspect, text: () => text(renderer.container),
    async ready() { render(); await flush(); reads[0].resolve({ show: doc }); memorialReads[0].resolve({ memorial: null }); await flush(); },
    refresh() { let pending; renderer.act(() => { pending = all().find(node => node.type === "VinylRefreshBoundary").props.onRefresh(); }); return pending; },
    retryRefresh() { const control = retry(); assert.ok(control); assert.equal(control.props.disabled, false); let pending;
      renderer.act(() => { pending = control.props.onPress(); }); return pending; },
    account(id) { store.session = { id }; render(); },
    target() { log = { ...log, id: "tm_fixture_two", artist: "Other fixture artist" }; render(); },
    close() { renderer.render(null); },
  };
}
async function failRefresh(f, error = networkError(), { memorialError = false, retry = false } = {}) {
  const documentIndex = f.reads.length, memorialIndex = f.memorialReads.length;
  const pending = retry ? f.retryRefresh() : f.refresh();
  await f.flush();
  f.reads[documentIndex].reject(error);
  if (memorialError) f.memorialReads[memorialIndex].reject(networkError());
  else f.memorialReads[memorialIndex].resolve({ memorial: null });
  const outcome = await pending; await f.flush(); return outcome;
}

for (const lifecycle of ["cancelled", "postponed"]) for (const failure of [
  { kind: "network" }, { kind: "timeout" }, { status: 503 }, { status: 502, serverCode: "PROVIDER_UNAVAILABLE" },
]) test("iOS retains " + lifecycle + " through " + JSON.stringify(failure), async () => {
  const f = fixture({ lifecycle }); await f.ready();
  assert.equal(f.inspect().tickets, 0);
  assert.equal(f.inspect().typedGoing, false, "the actual attendance child offers no new state for cancellation/postponement");
  const error = new AppError(undefined, failure), outcome = await failRefresh(f, error);
  assert.equal(outcome.ok, false); assert.equal(outcome.error, error);
  assert.equal(f.inspect().header, lifecycle === "cancelled" ? "Cancelled" : "Postponed");
  assert.equal(f.inspect().tickets, 0); assert.equal(f.inspect().legacyGoing, false);
  assert.equal(f.inspect().typedGoing, false);
  assert.match(f.text(), /Showing the last confirmed show details/);
  assert.ok(f.retry().props.style.minHeight >= 44); assert.equal(f.retry().props.accessibilityRole, "button");
  f.close(); await f.flush();
});

for (const lifecycle of ["cancelled", "postponed"]) for (const publicState of ["active", "error", "none"]) {
  test("whole refresh outage preserves " + lifecycle + " with public " + publicState, async () => {
    const f = fixture({ lifecycle, publicState, fontScale: 3.1 }); await f.ready();
    const pending = f.refresh(); await f.flush();
    assert.equal(f.inspect().tickets, 0, "the real memorial loading gate cannot temporarily re-enable tickets");
    f.reads[1].reject(networkError()); f.memorialReads[1].reject(networkError());
    assert.equal((await pending).ok, false); await f.flush();
    assert.equal(f.inspect().tickets, 0); assert.equal(f.inspect().legacyGoing, false); assert.ok(f.retry());
    assert.doesNotMatch(f.text(), /available tickets/);
    assert.equal(f.all().some(node => node.type === "ScrollView" && nodes(node).includes(f.retry())), true);
    const recovery = f.retryRefresh(); await f.flush();
    assert.equal(f.retry().props.disabled, true); assert.equal(f.retry().props.accessibilityState.busy, true);
    f.reads[2].resolve({ show: f.doc }); f.memorialReads[2].resolve({ memorial: null });
    assert.equal((await recovery).ok, true); await f.flush();
    assert.equal(f.inspect().retained, false); assert.equal(f.inspect().tickets, 0);
    assert.equal(f.inspect().header, lifecycle === "cancelled" ? "Cancelled" : "Postponed");
    f.close(); await f.flush();
  });
}

test("repeated explicit retry preserves status until a successful canonical replacement", async () => {
  const f = fixture(); await f.ready();
  await failRefresh(f);
  const before = f.calls.length;
  await f.flush(); assert.equal(f.calls.length, before, "failure alone starts no automatic retry");
  await failRefresh(f, new AppError(undefined, { status: 503 }), { retry: true });
  assert.equal(f.inspect().header, "Cancelled"); assert.equal(f.inspect().retained, true);
  const pending = f.retryRefresh(); await f.flush();
  f.reads[3].resolve({ show: { ...f.doc, lifecycle: "upcoming" } }); f.memorialReads[3].resolve({ memorial: null });
  assert.equal((await pending).ok, true); await f.flush();
  assert.equal(f.inspect().header, "Upcoming concert"); assert.equal(f.inspect().tickets, 1);
  assert.equal(f.inspect().typedGoing, true); assert.equal(f.inspect().legacyGoing, false); assert.equal(f.inspect().retained, false);
  f.close(); await f.flush();
});

test("initial failure and non-provider documents cannot create retained canonical evidence", async () => {
  const f = fixture(); f.render(); await f.flush();
  f.reads[0].reject(networkError()); f.memorialReads[0].resolve({ memorial: null }); await f.flush();
  assert.equal(f.inspect().retained, false); assert.equal(f.inspect().legacyGoing, true);
  f.close(); await f.flush();
  const g = fixture({ providerBacked: false }); await g.ready(); await failRefresh(g);
  assert.equal(g.inspect().retained, false); g.close(); await g.flush();
});

for (const options of [
  { status: 401 }, { status: 403, serverCode: "FORBIDDEN" }, { status: 404, serverCode: "NOT_FOUND" },
  { status: 409 }, { status: 410 }, { status: 409, serverCode: "IDENTITY_CHANGED" },
  { status: 403, code: "PIT-NET-001", retryable: true },
  { status: 503, retryable: false }, { kind: "invalid_response" },
  { code: "PIT-CHAT-001" }, { status: 429, retryable: false },
]) test("authoritative/other failure never retains: " + JSON.stringify(options), async () => {
  const f = fixture(); await f.ready(); await failRefresh(f); assert.equal(f.inspect().retained, true);
  const outcome = await failRefresh(f, new AppError(undefined, options), { retry: true });
  assert.equal(outcome.ok, false); assert.equal(f.inspect().retained, false);
  assert.equal(f.inspect().header, "Upcoming concert", "existing unavailable fallback is unchanged");
  f.close(); await f.flush();
});

test("suppressed identity failure cannot retain an otherwise network-classified response", async () => {
  const f = fixture(); await f.ready();
  await failRefresh(f, Object.assign(networkError(), { diagnosticSuppressed: true }));
  assert.equal(f.inspect().retained, false); f.close(); await f.flush();
});

for (const response of [null, { show: null }, { show: { bad: "shape" } }]) {
  test("normalized unavailable response clears stale evidence: " + JSON.stringify(response), async () => {
    const f = fixture(); await f.ready(); await failRefresh(f);
    const pending = f.retryRefresh(); await f.flush();
    f.reads[2].resolve(response); f.memorialReads[2].resolve({ memorial: null });
    assert.equal((await pending).ok, true); await f.flush();
    assert.equal(f.inspect().retained, false); assert.equal(f.inspect().header, "Upcoming concert");
    f.close(); await f.flush();
  });
}

test("matching validated public cancellation still overrides an upcoming canonical replacement", async () => {
  const f = fixture({ publicState: "cancelled", lifecycle: "upcoming" }); await f.ready();
  assert.equal(f.inspect().header, "Cancelled"); await failRefresh(f, networkError(), { memorialError: true });
  assert.equal(f.inspect().header, "Cancelled"); assert.equal(f.inspect().tickets, 0);
  const pending = f.retryRefresh(); await f.flush();
  f.reads[2].resolve({ show: f.doc }); f.memorialReads[2].resolve({ memorial: null });
  await pending; await f.flush(); assert.equal(f.inspect().tickets, 0); assert.equal(f.inspect().retained, false);
  f.close(); await f.flush();
});

for (const change of ["account", "target"]) test(change + " transition retires retained data and pending work", async () => {
  const f = fixture(); await f.ready(); await failRefresh(f);
  const pending = f.retryRefresh(); await f.flush();
  f[change](change === "account" ? "other-member" : undefined); await f.flush();
  assert.equal(f.reads[2].options.signal.aborted, true);
  assert.equal(f.inspect().retained, false);
  f.reads[2].resolve({ show: f.doc }); f.memorialReads[2].resolve({ memorial: null });
  await pending; await f.flush(); assert.equal(f.inspect().retained, false);
  f.reads[3].reject(networkError()); f.memorialReads[3].resolve({ memorial: null }); await f.flush();
  assert.equal(f.inspect().retained, false); assert.equal(f.inspect().header, "Upcoming concert");
  assert.equal(f.reads[3].options.expectedAccountId, change === "account" ? "other-member" : "fixture");
  f.close(); await f.flush();
});

test("unmount and same-target remount cannot recover the previous instance's canonical document", async () => {
  const f = fixture(); await f.ready(); await failRefresh(f);
  const pending = f.retryRefresh(); await f.flush(); f.close(); await f.flush();
  assert.equal(f.reads[2].options.signal.aborted, true);
  const g = fixture(); g.render(); await g.flush();
  f.reads[2].resolve({ show: f.doc }); f.memorialReads[2].resolve({ memorial: null }); await pending; await f.flush();
  g.reads[0].reject(networkError()); g.memorialReads[0].resolve({ memorial: null }); await g.flush();
  assert.equal(g.inspect().retained, false); assert.equal(g.inspect().header, "Upcoming concert");
  g.close(); await g.flush();
});

for (const platform of ["ios", "android", "web"]) test(platform + " preserves request admission/options/order", async () => {
  const f = fixture({ platform }); await f.ready();
  assert.equal(f.reads[0].url, "/api/shows/Fixture%20artist%7CFixture%20venue%7C2099-01-01");
  assert.equal(f.publicReads[0].url, "/api/resolve?path=%2Fevent%2Ftm_fixture");
  const start = f.calls.length, result = await failRefresh(f);
  assert.deepEqual(f.calls.slice(start).map(call => call.kind), ["document", "crowd", "lounge", "photos", "memorial"]);
  assert.equal(f.reads.length, 2); assert.equal(f.publicReads.length, 1);
  const options = f.reads[1].options;
  assert.deepEqual(Object.keys(options).sort(), ["context", "expectedAccountId", "signal", "silent"]);
  assert.equal(options.context, "Loading show details"); assert.equal(options.expectedAccountId, "fixture"); assert.equal(options.silent, true);
  if (platform !== "ios") {
    assert.equal(result.ok, true, "non-iOS refresh result remains exact");
    assert.equal(f.inspect().header, "Upcoming concert"); assert.equal(f.inspect().tickets, 1);
    assert.equal(f.inspect().legacyGoing, true); assert.equal(f.inspect().retained, false);
  }
  f.close(); await f.flush();
});

for (const platform of ["android", "web"]) test(platform + " retains existing public fallback while memorial is unavailable", async () => {
  const f = fixture({ platform }); await f.ready();
  const pending = f.refresh(); await f.flush();
  assert.equal(f.inspect().tickets, 1, "non-iOS public panel does not adopt the iOS canonical restriction");
  f.reads[1].reject(networkError()); f.memorialReads[1].reject(networkError());
  assert.equal((await pending).ok, true); await f.flush();
  assert.equal(f.inspect().tickets, 1); assert.equal(f.inspect().retained, false);
  assert.match(f.text(), /available tickets/);
  f.close(); await f.flush();
});

for (const lifecycle of ["cancelled", "postponed"]) test("successful " + lifecycle + " refresh retains independent artist recovery after memorial failure", async () => {
  const f = fixture({ lifecycle }); await f.ready();
  const pending = f.refresh(); await f.flush();
  f.reads[1].resolve({ show: f.doc }); f.memorialReads[1].reject(networkError());
  assert.equal((await pending).ok, true, "canonical receipt is successful; memorial has its own feedback");
  await f.flush();
  assert.equal(f.inspect().retained, false); assert.equal(f.inspect().tickets, 0);
  assert.doesNotMatch(f.text(), /available tickets/);
  const artistRetry = f.all().find(node => node.props?.accessibilityLabel === "Retry checking artist availability");
  const publicRetry = f.all().find(node => node.props?.accessibilityLabel === "Refresh event details");
  assert.ok(artistRetry); assert.ok(publicRetry);
  assert.equal(artistRetry.props.disabled, false); assert.equal(publicRetry.props.disabled, false);
  assert.ok(artistRetry.props.style.minHeight >= 44);
  artistRetry.props.onPress(); await f.flush();
  assert.equal(f.reads.length, 2, "artist recovery does not invent a canonical refresh");
  f.memorialReads[2].resolve({ memorial: null }); await f.flush();
  assert.equal(f.inspect().header, lifecycle === "cancelled" ? "Cancelled" : "Postponed");
  assert.equal(f.inspect().tickets, 0);
  f.close(); await f.flush();
});

async function actualTransportError(response) {
  const source = readFileSync(path.join(root, "src/lib/api.js"), "utf8");
  const { parse } = require("@babel/parser");
  const body = parse(source, { sourceType: "module" }).program.body.flatMap(node => {
    if (node.type === "ImportDeclaration" || node.type === "ExportNamedDeclaration" && !node.declaration) return [];
    const declaration = node.type === "ExportNamedDeclaration" ? node.declaration : node;
    return [source.slice(declaration.start, declaration.end)];
  }).join("\n");
  let fetches = 0;
  const bindings = {
    AppError, captureAppError: error => error, Platform: { OS: "ios" }, reviewAllowsRequest: () => true,
    apiBaseForRuntime: () => "https://fixture.invalid", photoCreditUrlFromLinkHeader: () => null,
    ...require("./src/domain/apiIdentityState.mjs"), ...require("./src/lib/requestControl.mjs"), ...require("./src/lib/retryAfter.mjs"),
    fetch: async () => { fetches++; return response; },
  };
  const transport = new Function(...Object.keys(bindings), body + "\nreturn {api, configureApiIdentity};")(...Object.values(bindings));
  transport.configureApiIdentity("fixture");
  const error = await transport.api("/api/shows/synthetic", { silent: true, expectedAccountId: "fixture" }).catch(error => error);
  assert.ok(error instanceof AppError); assert.equal(fetches, 1);
  return error;
}

for (const mode of ["html", "body", "json"]) test("actual API 200 " + mode + " distinguishes transport uncertainty from malformed JSON", async () => {
  const response = mode === "body"
    ? { ok: true, status: 200, headers: new Headers({ "Content-Type": "application/json" }),
      text: async () => { throw new TypeError("Synthetic interrupted response body"); } }
    : new Response(mode === "html" ? "<html>Temporary intermediary</html>" : "{malformed", {
      status: 200, headers: { "Content-Type": mode === "html" ? "text/html" : "application/json" },
    });
  const error = await actualTransportError(response);
  assert.equal(error.status, 200); assert.equal(error.code, mode === "json" ? "PIT-API-001" : "PIT-NET-001");
  const f = fixture(); await f.ready(); await failRefresh(f, error);
  assert.equal(f.inspect().retained, mode !== "json");
  assert.equal(f.inspect().tickets, mode === "json" ? 1 : 0);
  f.close(); await f.flush();
});

test("actual API retryable429 retains cancellation without an automatic retry", async () => {
  const error = await actualTransportError(new Response(JSON.stringify({ code: "RATE_LIMITED", retryable: true }), {
    status: 429, headers: { "Content-Type": "application/json", "Retry-After": "30" },
  }));
  assert.equal(error.code, "PIT-RATE-001"); assert.equal(error.status, 429); assert.ok(error.retryAfterMs >= 30_000);
  const f = fixture(); await f.ready(); await failRefresh(f, error);
  assert.equal(f.inspect().retained, true); assert.equal(f.inspect().tickets, 0);
  const requests = f.reads.length; await f.flush(); assert.equal(f.reads.length, requests);
  f.close(); await f.flush();
});
