import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
const flatten = value => Object.assign({}, ...(Array.isArray(value) ? value.flat(Infinity) : [value]).filter(x => x && typeof x === "object"));
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const syntheticEdition = (extra = {}) => ({ id: "fixture-edition", festivalSlug: "fixture", name: "Fixture Festival 2099", startDate: "2099-07-01", endDate: "2099-07-02", city: "Fixture City", days: ["2099-07-01", "2099-07-02"], lineup: [{ name: "Fixture Artist", days: [] }], headliners: ["Fixture Artist"], lineupCount: 1, imageUrl: "https://example.test/festival.jpg", imageAttribution: "Fixture photographer", ...extra });
const page = (extra = {}) => ({ festival: { slug: "fixture", name: "Fixture Festival" }, upcoming: [syntheticEdition()], past: [], reviews: [], reviewStats: {}, announcement: null, ...extra });
class AppError extends Error { constructor(message, options = {}) { super(message); this.name = "AppError"; this.code = "PIT-NET-001"; this.retryable = true; Object.assign(this, options); } }

// Actual React and actual iOS components/hook/resource owner. All reads, writes,
// images and native views are synthetic; no live requests or device actions.
function fixture(component = "FestivalScreen", initialProps = {}, { strict = false } = {}) {
  const renderer = createRenderer(), modules = new Map(), reads = [], writes = [], auth = [], opened = [], scopes = [];
  let account = initialProps.accountId === undefined ? "A" : initialProps.accountId, epoch = 1, today = "2026-11-08";
  let props = component === "FestivalScreen" ? { slug: "fixture", signedIn: !!account, accountId: account, onRequireAuth: () => auth.push(true), ...initialProps } : { ...initialProps };
  const native = { View: "View", Text: "Text", Pressable: "Pressable", ScrollView: "ScrollView", TextInput: "TextInput", RefreshControl: "RefreshControl", ActivityIndicator: "ActivityIndicator", Platform: { OS: "ios", select: o => o.ios || o.default }, StyleSheet: { create: x => x, absoluteFill: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0 }, absoluteFillObject: {} }, useWindowDimensions: () => ({ width: 320, fontScale: 3.1 }), Linking: { openURL: async url => opened.push(url) } };
  const api = {
    readFestival: (slug, options) => { const request = { ...deferred(), slug, options, account }; reads.push(request); return request.promise; },
    readFestivals: options => { const request = { ...deferred(), options }; reads.push(request); return request.promise; },
    saveFestivalPlan: (slug, payload) => { const request = { ...deferred(), slug, payload, account, kind: "save" }; writes.push(request); return request.promise; },
    removeFestivalPlan: (slug, editionId) => { const request = { ...deferred(), slug, editionId, account, kind: "remove" }; writes.push(request); return request.promise; },
  };
  const load = path => { if (!modules.has(path)) modules.set(path, execute(path, imports)); return modules.get(path); };
  const context = React.createContext(null);
  const imports = (name, local) => {
    if (name === "react") return React;
    if (name === "react/jsx-runtime") return require(name);
    if (name === "react-native") return native;
    if (name === "expo-image") return { Image: "NativeImage" };
    if (name === "../../theme") return { colors: { text: "#eeeeee", textDim: "#cccccc", textFaint: "#bbbbbb", bg: "#111111", bgElev: "#191919", surface: "#222222", line: "#555555", amber: "#ffbb66" }, font: "font", displayFont: "display", mono: "mono", radius: { md: 12, lg: 16, pill: 999 }, space: x => x * 4 };
    if (name === "../../lib/diagnostics") return { AppError };
    if (name.endsWith("/lib/api")) return { captureApiIdentityCheck: expected => { const captured = epoch; return () => !!expected && account === expected && epoch === captured; } };
    if (name === "./festivalApi.mjs") return api;
    if (name === "./services/festivalIdentity") return load("./services/festivalIdentity.ios.js");
    if (name === "./festivalShare.mjs") return { buildFestivalShareModel: model => ({ id: "fixture-share", ...model }) };
    if (name === "./useFestivalDay") return () => today;
    if (name === "./useFestivalResource") { const hook = load("./useFestivalResource.js").default; return (...args) => { scopes.push(args[0]); return hook(...args); }; }
    if (name === "../../hooks/useImageAttempt") return load("../../hooks/useImageAttempt.ios.js");
    if (name === "../../components/PostNavigationContext") return { PostNavigationContext: context };
    if (name === "./Rise") return "Rise";
    if (name.startsWith("../../components/")) return name.split("/").at(-1);
    if (["./FestivalArtwork", "./FestivalCard", "./FestivalsPanel"].includes(name)) return load(`${name}.ios.jsx`);
    return local(name);
  };
  const Component = load(`./${component}.ios.jsx`).default;
  const render = () => renderer.render(strict ? React.createElement(React.StrictMode, null, React.createElement(Component, props)) : React.createElement(Component, props));
  const all = () => nodes(renderer.container);
  const text = () => all().map(n => n.text || n.props?.title || "").join(" ");
  const find = label => all().find(n => n.props?.accessibilityLabel === label || n.props?.title === label);
  const flush = async () => { for (let i = 0; i < 4; i++) await Promise.resolve(); await new Promise(setImmediate); renderer.act(noop); render(); renderer.act(noop); };
  render();
  return { all, text, find, reads, writes, auth, opened, scopes, render, flush,
    act: callback => renderer.act(callback), press: label => renderer.act(() => { const n = find(label); assert.ok(n, `missing control ${label}: ${text()}`); n.props.onPress(); }),
    resolve: async (index, data) => { reads[index].resolve(data); await flush(); }, reject: async index => { reads[index].reject(new AppError("private fixture error")); await flush(); },
    account: next => { account = next; epoch++; props = { ...props, signedIn: !!next, accountId: next }; render(); },
    invalidate: () => { epoch++; }, props: next => { props = { ...props, ...next }; render(); }, today: next => { today = next; render(); },
    refresh: () => { const scroll = all().find(n => n.type === "ScrollView" && n.props.refreshControl); assert.ok(scroll); renderer.act(() => { void scroll.props.refreshControl.props.onRefresh(); }); },
    unmount: () => renderer.render(null),
  };
}

test("iOS artwork keeps credited source intact and retries failed attempts without stale errors", () => {
  const f = fixture("FestivalArtwork", { edition: syntheticEdition() });
  const first = f.all().find(n => n.type === "NativeImage");
  assert.equal(first.props.contentFit, "contain"); assert.equal(first.props.source.uri, "https://example.test/festival.jpg");
  assert.match(f.text(), /Image: Fixture photographer/);
  const error = first.props.onError, displayed = first.props.onDisplay;
  f.act(() => error({ error: "fixture failure" }));
  assert.equal(f.all().filter(n => n.type === "NativeImage").length, 0);
  assert.match(f.text(), /could not load/);
  const failureFrame = f.all().find(n => flatten(n.props?.style).minHeight === 140);
  assert.equal(flatten(failureFrame.props.style).aspectRatio, undefined, "recovery grows with Dynamic Type");
  f.press("Retry image for Fixture Festival 2099");
  const retried = f.all().find(n => n.type === "NativeImage");
  assert.notEqual(retried, first); assert.equal(retried.props.source.uri, first.props.source.uri);
  f.act(() => { error({ error: "old" }); displayed(); });
  assert.equal(f.all().find(n => n.type === "NativeImage"), retried);
  f.act(() => retried.props.onError({ error: "new" })); assert.match(f.text(), /could not load/);
  f.unmount(); f.act(() => error({ error: "retired" }));
});

test("iOS artwork A→B→A and retained retry reject retired callbacks", () => {
  const f = fixture("FestivalArtwork", { edition: syntheticEdition() });
  const a = f.all().find(n => n.type === "NativeImage").props;
  f.act(() => a.onError({})); const oldRetry = f.find("Retry image for Fixture Festival 2099").props.onPress;
  f.props({ edition: syntheticEdition({ id: "B", imageUrl: "https://example.test/b.jpg" }) });
  const b = f.all().find(n => n.type === "NativeImage").props;
  f.props({ edition: syntheticEdition() }); const nextA = f.all().find(n => n.type === "NativeImage");
  f.act(() => { a.onError({}); b.onError({}); oldRetry(); });
  assert.equal(f.all().find(n => n.type === "NativeImage"), nextA); f.unmount();
});

test("missing or uncredited artwork is a neutral state, never invented imagery or auto retry", () => {
  for (const edition of [syntheticEdition({ imageUrl: null }), syntheticEdition({ imageAttribution: null }), syntheticEdition({ imageUrl: "http://example.test/image.jpg" })]) {
    const f = fixture("FestivalArtwork", { edition });
    assert.match(f.text(), /No credited festival image listed/); assert.equal(f.all().filter(n => n.type === "NativeImage").length, 0);
    assert.ok(!f.text().includes("could not load")); f.unmount();
  }
});

test("card artwork and body open the same canonical edition and use truthful lineup copy", () => {
  const opens = [], edition = syntheticEdition({ headliners: [] });
  const f = fixture("FestivalCard", { edition, onOpen: x => opens.push(x) });
  assert.match(f.text(), /Lineup not listed here yet/); f.press("Open Fixture Festival 2099");
  const body = f.all().find(n => n.type === "Pressable" && n.props.accessibilityLabel?.startsWith("Open Fixture Festival 2099,"));
  f.act(() => body.props.onPress()); assert.deepEqual(opens, [edition, edition]); f.unmount();
});

test("hub refresh is single flight, retains data on error and distinguishes first failure", async () => {
  const f = fixture("FestivalsHubScreen"); assert.match(f.text(), /Loading festivals/); assert.ok(!f.text().includes("No upcoming"));
  await f.reject(0); assert.match(f.text(), /Festivals could not load/); assert.ok(!f.text().includes("No upcoming"));
  f.press("Try again"); await f.resolve(1, { upcoming: [syntheticEdition()] });
  f.refresh(); f.refresh(); assert.equal(f.reads.length, 3);
  await f.reject(2); assert.match(f.text(), /Previously loaded dates/); assert.match(f.text(), /Fixture Festival 2099/);
  f.refresh(); assert.equal(f.reads.length, 4); const signal = f.reads[3].options.signal;
  f.unmount(); assert.equal(signal.aborted, true); await f.resolve(3, { upcoming: [] });
});

test("panel filters expired rows and updates month selection without making up dates", async () => {
  const f = fixture("FestivalsPanel");
  await f.resolve(0, { upcoming: [syntheticEdition({ id: "old", name: "Expired fixture", startDate: "2001-01-01", endDate: "2001-01-02" }), syntheticEdition()] });
  assert.ok(!f.text().includes("Expired fixture")); assert.match(f.text(), /July 2099/); assert.ok(!f.text().includes("just announced"));
  f.today("2100-01-01"); assert.match(f.text(), /No upcoming festival dates are listed/); assert.ok(!f.text().includes("Fixture Festival 2099")); f.unmount();
});

test("detail shows official dates before provider edition and explicit past editions", async () => {
  const f = fixture();
  await f.resolve(0, page({ announcement: { name: "Official 2098", startDate: "2098-08-01", endDate: "2098-08-02", source: { url: "https://example.test/official" } }, upcoming: [syntheticEdition(), syntheticEdition({ id: "old", name: "Expired fixture", startDate: "2001-01-01", endDate: "2001-01-02" })] }));
  assert.ok(f.text().indexOf("Official dates") < f.text().indexOf("Fixture Festival 2099")); assert.match(f.text(), /Past editions/); assert.match(f.text(), /2001/);
  assert.ok(!f.all().some(n => n.type === "FestivalBackdrop")); f.press("Open official festival announcement"); assert.deepEqual(f.opened, ["https://example.test/official"]); f.unmount();
});

test("detail empty and failed states never claim unannounced lineup or fake content", async () => {
  const f = fixture(); await f.reject(0); assert.match(f.text(), /could not load/); assert.ok(!f.text().includes("No upcoming"));
  f.press("Try again"); await f.resolve(1, page({ upcoming: [], expected: { label: "Expected July 2099" } }));
  assert.match(f.text(), /No upcoming edition is listed/); assert.match(f.text(), /not a confirmed date/); assert.equal(f.all().filter(n => n.type === "NativeImage").length, 0); f.unmount();
});

test("detail refresh keeps cache on failure and does not run twice", async () => {
  const f = fixture(); await f.resolve(0, page()); f.refresh(); f.refresh(); assert.equal(f.reads.length, 2);
  await f.reject(1); assert.match(f.text(), /Previously loaded information/); assert.match(f.text(), /Fixture Festival 2099/); f.unmount();
});

test("guest cannot expose private plan or send attendance; auth is requested explicitly", async () => {
  const f = fixture("FestivalScreen", { accountId: null, signedIn: false });
  await f.resolve(0, page({ upcoming: [syntheticEdition({ plan: { days: ["2099-07-01"], mustSee: ["Fixture Artist"] } })] }));
  assert.ok(!f.find("Share my plan")); f.press("I'm going"); assert.equal(f.auth.length, 1); assert.equal(f.writes.length, 0); f.unmount();
});

test("account change immediately removes private plan and fences old attendance callback", async () => {
  const f = fixture(); await f.resolve(0, page({ upcoming: [syntheticEdition({ plan: { days: ["2099-07-01"], mustSee: [] } })] }));
  const oldOpen = f.find("Edit your festival plan").props.onPress;
  assert.ok(f.find("Share my plan")); f.account("B"); assert.ok(!f.find("Share my plan")); assert.ok(!f.text().includes("Going ·"));
  f.act(oldOpen); assert.equal(f.writes.length, 0); await f.resolve(1, page()); assert.ok(!f.find("Save my plan"));
  assert.ok(f.scopes.some(s => s.includes('"A"'))); assert.ok(f.scopes.some(s => s.includes('"B"'))); f.unmount();
});

test("plan save has one owner, blocks editing/refresh, adopts only actual receipt", async () => {
  const f = fixture(); await f.resolve(0, page()); f.press("I'm going");
  const day = f.all().find(n => n.props?.accessibilityRole === "checkbox"); f.act(() => day.props.onPress());
  const save = f.find("Save my plan").props.onPress;
  f.act(() => { save(); save(); }); assert.equal(f.writes.length, 1); f.refresh(); assert.equal(f.reads.length, 1);
  f.act(() => day.props.onPress()); assert.deepEqual(f.writes[0].payload.days, ["2099-07-01"]);
  f.writes[0].resolve({ plan: { editionId: "fixture-edition", days: ["2099-07-01"], mustSee: [] } }); await f.flush();
  assert.ok(f.find("Share my plan")); assert.ok(!f.find("Save my plan")); f.unmount();
});

test("unconfirmed plan receipt keeps editor and does not fabricate a plan", async () => {
  const f = fixture(); await f.resolve(0, page()); f.press("I'm going");
  f.act(() => f.all().find(n => n.props?.accessibilityRole === "checkbox").props.onPress()); f.press("Save my plan");
  f.writes[0].resolve({}); await f.flush(); assert.match(f.text(), /could not be confirmed/); assert.ok(!f.find("Share my plan")); assert.ok(f.find("Save my plan")); f.unmount();
});

test("remove uses established plan:null server receipt and is single flight", async () => {
  const f = fixture(); await f.resolve(0, page({ upcoming: [syntheticEdition({ plan: { days: ["2099-07-01"], mustSee: [] } })] }));
  f.press("Edit your festival plan"); const remove = f.find("Not going").props.onPress;
  f.act(() => { remove(); remove(); }); assert.equal(f.writes.length, 1); assert.equal(f.writes[0].kind, "remove");
  f.writes[0].resolve({ plan: null }); await f.flush(); assert.ok(!f.find("Share my plan")); assert.ok(f.find("I'm going")); f.unmount();
});

test("pending save cannot adopt into another account and retired auth epoch cannot send", async () => {
  const f = fixture(); await f.resolve(0, page()); f.press("I'm going");
  f.act(() => f.all().find(n => n.props?.accessibilityRole === "checkbox").props.onPress()); const oldSave = f.find("Save my plan").props.onPress;
  f.press("Save my plan"); f.account("B"); f.writes[0].resolve({ plan: { editionId: "fixture-edition", days: ["2099-07-01"], mustSee: [] } }); await f.flush();
  await f.resolve(1, page()); f.act(oldSave); assert.equal(f.writes.length, 1); assert.ok(!f.find("Share my plan"));
  f.press("I'm going"); f.act(() => f.all().find(n => n.props?.accessibilityRole === "checkbox").props.onPress()); const nextSave = f.find("Save my plan").props.onPress;
  f.invalidate(); f.act(nextSave); assert.equal(f.writes.length, 1); f.unmount();
});

test("StrictMode festival mount and resource cleanup leave only latest read authoritative", async () => {
  const f = fixture("FestivalScreen", {}, { strict: true }); const last = f.reads.length - 1;
  await f.resolve(last, page()); for (let i = 0; i < last; i++) await f.resolve(i, page({ upcoming: [] }));
  assert.match(f.text(), /Fixture Festival 2099/); f.unmount();
});


test("actual day hook schedules UTC rollover and cleans timers/listeners in StrictMode", () => {
  const previous = process.env.TZ; process.env.TZ = "Pacific/Honolulu";
  const renderer = createRenderer(), timers = new Map(), listeners = new Set();
  let now = Date.parse("2026-12-31T23:59:30Z"), sequence = 0;
  const RealDate = Date;
  class ClockDate extends RealDate { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } }
  const presentation = require("./festivalPresentation.ios.mjs");
  const source = readFileSync(new URL("./useFestivalDay.ios.js", import.meta.url), "utf8");
  const code = transformSync(source, { filename: "useFestivalDay.ios.js", babelrc: false, configFile: false, plugins: [require("@babel/plugin-transform-modules-commonjs")] }).code;
  const module = { exports: {} };
  new Function("require", "module", "exports", "setTimeout", "clearTimeout", "Date", code)(name => {
    if (name === "react") return React;
    if (name === "react-native") return { AppState: { addEventListener(type, callback) { listeners.add(callback); return { remove() { listeners.delete(callback); } }; } } };
    if (name === "./festivalPresentation.ios.mjs") return { festivalToday: () => presentation.festivalToday(new ClockDate()) };
    throw Error(name);
  }, module, module.exports, (callback, delay) => { const id = ++sequence; timers.set(id, { callback, delay }); return id; }, id => timers.delete(id), ClockDate);
  function Host() { return React.createElement("Text", null, module.exports.default()); }
  const text = () => nodes(renderer.container).map(n => n.text || "").join("");
  try {
    renderer.render(React.createElement(React.StrictMode, null, React.createElement(Host)));
    assert.equal(text(), "2026-12-31"); assert.equal(timers.size, 1); assert.equal(listeners.size, 1);
    assert.equal([...timers.values()][0].delay, 30100, "UTC midnight, not Honolulu midnight");
    const tick = [...timers.values()][0].callback;
    now = Date.parse("2027-01-01T00:00:01Z"); renderer.act(tick); assert.equal(text(), "2027-01-01");
    const foreground = [...listeners][0]; now = Date.parse("2027-01-02T05:00:00Z"); renderer.act(() => foreground("active"));
    assert.equal(text(), "2027-01-02"); assert.equal(timers.size, 1);
    renderer.render(null); assert.equal(timers.size, 0); assert.equal(listeners.size, 0);
    renderer.act(() => { tick(); foreground("active"); }); assert.equal(timers.size, 0);
  } finally { renderer.render(null); if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; }
});
