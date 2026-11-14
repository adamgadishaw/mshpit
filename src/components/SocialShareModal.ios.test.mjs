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
const nodes = node => [node, ...(node.children || []).flatMap(nodes)];
const text = node => node.text ?? (node.children || []).map(text).join(" ");
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const model = { id: "event-a", kind: "going", title: "Fixture concert", shareText: "Going to Fixture concert", url: "https://fixture.invalid/show/event-a",
  renderRequest: { kind: "event", eventId: "event-a", intent: "going" } };
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

// Exercise production JSX, its real hooks, preparation and native adapter. Only
// host components, the network/filesystem and native SDK calls are synthetic.
function fixture({ managed = true, entry = "modal", strict = false, os = "ios", reducedMotion = false, delayImport = false,
  delayAvailability = false, delayHandoff = false, delayEditor = false } = {}) {
  const renderer = createRenderer(), context = { IOSDetailPresentationContext: React.createContext(null) };
  const files = new Map(), requests = [], external = [], imports = [], availability = [], handoffs = [], diagnostics = [], editorLoads = [];
  const modules = new Map();
  let active = true, epoch = 1, token = Object.freeze({}), commandToken = Object.freeze({}), actionAllowed = true;
  let accountId = "account-a", currentModel = model, closes = 0;
  const actionPresentation = Object.freeze({ current: () => actionAllowed });
  const pending = (list, data) => { const request = { ...data, ...deferred() }; list.push(request); return request; };
  class File {
    constructor(base, name) { this.uri = `${base}/${name}`; }
    get exists() { return files.has(this.uri); }
    create() { files.set(this.uri, null); }
    write(bytes) { files.set(this.uri, bytes); }
    delete() { files.delete(this.uri); }
  }
  class AppError extends Error { constructor(message, options) { super(message); Object.assign(this, options); } }
  const native = { Platform: { OS: os }, View: "View", Text: "Text", Pressable: "Pressable", ScrollView: "ScrollView", Modal: "Modal",
    StyleSheet: { create: value => value, absoluteFill: {} }, useWindowDimensions: () => ({ width: 393 }),
    Linking: { openURL: async url => external.push(["source", url]), canOpenURL: url => {
      const request = pending(availability, { url }); if (!delayAvailability) request.resolve(true); return request.promise;
    } } };
  const share = { Social: { INSTAGRAM_STORIES: "story", TWITTER: "x", FACEBOOK: "facebook" },
    isPackageInstalled: async () => ({ isInstalled: true }),
    open: options => handoff("sheet", options), shareSingle: options => handoff("story", options) };
  function handoff(kind, options) {
    external.push([kind, options]); const request = pending(handoffs, { kind });
    if (!delayHandoff) request.resolve({ success: true }); return request.promise;
  }
  const dependencies = name => {
    if (name === "react" || name === "react/jsx-runtime") return require(name);
    if (name === "react-native") return native;
    if (name === "expo-image") return { Image: "ExpoImage" };
    if (name === "react-native-safe-area-context") return { SafeAreaView: "SafeAreaView" };
    if (name === "expo-file-system") return { File, Paths: { cache: "file:///fixture-cache" } };
    if (name === "expo-clipboard") return { setStringAsync: async url => { external.push(["copy", url]); return true; } };
    if (name.endsWith("/theme")) return { colors: {}, radius: {}, shadow: {}, space: value => value };
    if (name === "./Icon") return "Icon";
    if (name === "./ShareCardReveal") return { __esModule: true, default: "ShareCardReveal", ShareCardPrinting: "ShareCardPrinting" };
    if (name.endsWith("/useReducedMotion")) return () => reducedMotion;
    if (name.endsWith("/useIOSDetailPresentation")) return load("src/hooks/useIOSDetailPresentation.ios.js");
    if (name.endsWith("/useIOSDetailPresentation.js")) return require("./src/hooks/useIOSDetailPresentation.js");
    if (name.endsWith("/iosDetailPresentationContext.mjs")) return context;
    if (name.endsWith("/socialShareCard.mjs")) return require("./src/domain/socialShareCard.mjs");
    if (name.endsWith("/shareCardPreparation.mjs")) return require("./src/domain/shareCardPreparation.mjs");
    if (name.endsWith("/diagnostics")) return { AppError, captureAppError: error => diagnostics.push(error) };
    if (name.endsWith("/lazyWithRetry")) return { loadChunk: factory => factory() };
    if (name.endsWith("/socialShare")) return load("src/lib/socialShare.ios.js");
    if (name === "./api") return { apiBinary: (url, options) => pending(requests, { url, options }).promise };
    throw new Error(`Unexpected dependency ${name}`);
  };
  function load(file) {
    if (modules.has(file)) return modules.get(file);
    if (!codes.has(file)) codes.set(file, transformSync(readFileSync(path.join(root, file), "utf8")
      .replace('import("react-native-share")', "loadFixtureNativeShare()")
      .replace('import("./SocialShareModal")', "loadFixtureModal()"), {
      filename: file, babelrc: false, configFile: false,
      plugins: [[require("@babel/plugin-transform-react-jsx"), { runtime: "automatic" }], require("@babel/plugin-transform-modules-commonjs")],
    }).code);
    const module = { exports: {} };
    new Function("require", "module", "exports", "process", "loadFixtureNativeShare", "loadFixtureModal", codes.get(file))(
      dependencies, module, module.exports, { env: { EXPO_PUBLIC_META_APP_ID: "123456789" } },
      () => { const request = pending(imports, {}); if (!delayImport) request.resolve({ default: share }); return request.promise; },
      () => {
        const request = pending(editorLoads, {});
        if (!delayEditor) request.resolve(load("src/components/SocialShareModal.ios.jsx"));
        return request.promise;
      });
    modules.set(file, module.exports); return module.exports;
  }
  const component = entry === "modal" ? load("src/components/SocialShareModal.ios.jsx").default
    : load("src/components/SocialShareStudio.ios.jsx")[entry === "button" ? "SocialShareButton" : "default"];
  let presentation;
  function renewPresentation() {
    const owner = token, privacy = epoch;
    presentation = Object.freeze({ managed: true, active, token, commandToken,
      current: () => active && owner === token, canAct: () => active && owner === token && privacy === epoch });
  }
  renewPresentation();
  function render() {
    let element = React.createElement(component, { accountId, model: currentModel, actionPresentation, onClose: () => closes++ });
    if (managed) element = React.createElement(context.IOSDetailPresentationContext.Provider, { value: presentation }, element);
    if (strict) element = React.createElement(React.StrictMode, null, element);
    renderer.render(element);
  }
  const settle = async () => { for (let i = 0; i < 3; i++) { await new Promise(resolve => setImmediate(resolve)); renderer.act(noop); } };
  render();
  return { files, requests, external, imports, availability, handoffs, diagnostics, share, render, settle, editorLoads,
    editorModule: () => load("src/components/SocialShareModal.ios.jsx"),
    nativeAdapter: () => load("src/lib/socialShare.ios.js"), tree: () => renderer.container, presentation: () => presentation,
    button: label => nodes(renderer.container).find(node => node.type === "Pressable" && node.props.accessibilityLabel === label),
    press: label => renderer.act(() => {
      const node = nodes(renderer.container).find(node => node.type === "Pressable" && node.props.accessibilityLabel === label);
      assert.ok(node, label); node.props.onPress();
    }),
    act: renderer.act, closes: () => closes,
    setReducedMotion(value) { reducedMotion = value; render(); },
    cover() { active = false; },
    back() { active = true; token = Object.freeze({}); commandToken = Object.freeze({}); renewPresentation(); render(); },
    privacy({ render: update = false } = {}) { epoch++; commandToken = Object.freeze({}); if (update) { renewPresentation(); render(); } },
    expireAction() { actionAllowed = false; },
    changeAccount() { accountId = "account-b"; render(); },
    changeModel() { currentModel = { ...model, id: "event-b", url: model.url + "-b", renderRequest: { ...model.renderRequest, eventId: "event-b" } }; render(); },
    async ready() {
      await settle(); const request = requests.at(-1); assert.ok(request, "modal prepared real artwork");
      request.resolve({ bytes: Uint8Array.of(1), photoCreditUrl: "https://fixture.invalid/photo-source" }); await settle();
      assert.ok(nodes(renderer.container).some(node => node.type === "ExpoImage"));
    },
    dispose() { renderer.render(null); },
  };
}

test("Reduce Motion changes presentation without restarting preparation or replacing current controls", async () => {
  const f = fixture({ reducedMotion: true });
  try {
    assert.equal(nodes(f.tree()).find(node => node.type === "Modal").props.animationType, "none");
    await f.ready();
    const requestCount = f.requests.length, copy = f.button("Copy link").props.onPress;
    f.setReducedMotion(false);
    assert.equal(nodes(f.tree()).find(node => node.type === "Modal").props.animationType, "slide");
    f.setReducedMotion(true);
    assert.equal(nodes(f.tree()).find(node => node.type === "Modal").props.animationType, "none");
    assert.equal(f.requests.length, requestCount);
    f.act(copy); await f.settle();
    assert.deepEqual(f.external, [["copy", model.url]]);
  } finally { f.dispose(); }
});

for (const expiration of ["cover", "privacy", "expireAction", "dispose"]) {
  test(`captured production modal controls cannot act after ${expiration}`, async () => {
    const f = fixture();
    try {
      await f.ready();
      const controls = ["Copy link", "X", "Facebook", "Instagram Story", "Photo source", "Close share preview"]
        .map(label => { assert.ok(f.button(label), label); return f.button(label).props.onPress; });
      const escape = nodes(f.tree()).find(node => node.props?.onAccessibilityEscape).props.onAccessibilityEscape;
      const requestClose = nodes(f.tree()).find(node => node.type === "Modal").props.onRequestClose;
      f[expiration]();
      if (expiration === "privacy") assert.equal(f.presentation().current(), true, "privacy leaves navigation lifetime current");
      f.act(() => { controls.forEach(callback => callback()); escape(); requestClose(); }); await f.settle();
      assert.deepEqual(f.external, []); assert.equal(f.imports.length, 0); assert.equal(f.closes(), 0);
    } finally { f.dispose(); }
  });
  test(`captured artwork retry cannot restart preparation after ${expiration}`, async () => {
    const f = fixture();
    try {
      f.requests.at(-1).reject(new Error("fixture preparation failed")); await f.settle();
      const retry = f.button("Retry share artwork").props.onPress, reads = f.requests.length;
      f[expiration](); f.act(retry); await f.settle(); assert.equal(f.requests.length, reads);
    } finally { f.dispose(); }
  });
}

test("a pending private PNG arriving after cover is released without preview adoption or external handoff", async () => {
  const f = fixture();
  try {
    const callbacks = ["Copy link", "X", "Instagram Story"].map(label => f.button(label).props.onPress);
    f.cover(); f.requests.at(-1).resolve({ bytes: Uint8Array.of(1) }); await f.settle();
    f.act(() => callbacks.forEach(callback => callback()));
    assert.equal(f.files.size, 0); assert.deepEqual(f.external, []); assert.equal(f.imports.length, 0);
    assert.equal(nodes(f.tree()).some(node => node.type === "ExpoImage"), false);
    f.back(); assert.equal(f.button("Copy link"), undefined, "Back cannot reactivate the old modal");
  } finally { f.dispose(); }
});

for (const label of ["X", "Facebook", "Instagram Story"]) {
  test(`${label} rechecks ownership after its delayed native-module import`, async () => {
    const f = fixture({ delayImport: true });
    try {
      await f.ready(); f.press(label); assert.equal(f.imports.length, 1);
      f.cover(); f.imports[0].resolve({ default: f.share }); await f.settle();
      assert.deepEqual(f.external, []); assert.equal(f.availability.length, 0);
      assert.doesNotMatch(text(f.tree()), /opened|Nothing was posted|did not open/);
    } finally { f.dispose(); }
  });
}

test("Instagram rechecks command ownership after asynchronous app availability", async () => {
  const f = fixture({ delayAvailability: true });
  try {
    await f.ready(); f.press("Instagram Story"); await f.settle(); assert.equal(f.availability.length, 1);
    f.privacy(); assert.equal(f.presentation().current(), true);
    f.availability[0].resolve(true); await f.settle(); assert.deepEqual(f.external, []);
  } finally { f.dispose(); }
});

for (const outcome of ["resolve", "reject"]) {
  test(`an already dispatched native share can ${outcome} after cover without stale feedback`, async () => {
    const f = fixture({ delayHandoff: true });
    try {
      await f.ready(); f.press("X"); await f.settle(); assert.equal(f.external.length, 1);
      const before = text(f.tree()); f.cover();
      f.handoffs[0][outcome](outcome === "resolve" ? { success: true } : new Error("fixture handoff failed"));
      await f.settle(); assert.equal(text(f.tree()), before); assert.equal(f.external.length, 1);
    } finally { f.dispose(); }
  });
}

for (const entry of ["studio", "button"]) {
  test(`production ${entry} passes its action ownership through the lazy editor`, async () => {
    const f = fixture({ entry });
    try {
      if (entry === "button") f.press("Share going status");
      await f.ready(); const copy = f.button("Copy link").props.onPress;
      f.expireAction(); f.act(copy); await f.settle(); assert.deepEqual(f.external, []);
    } finally { f.dispose(); }
  });
}

for (const strict of [false, true]) {
  test(`direct unmanaged modal retains normal copy/share/source/retry behavior (StrictMode ${strict})`, async () => {
    const f = fixture({ managed: false, strict });
    try {
      f.requests.at(-1).reject(new Error("fixture preparation failed")); await f.settle();
      f.press("Retry share artwork"); await f.ready();
      const copy = f.button("Copy link").props.onPress;
      f.act(() => { copy(); copy(); }); await f.settle();
      assert.deepEqual(f.external, [["copy", model.url]], "same-tick double presses dispatch once");
      f.press("X"); await f.settle(); f.press("Instagram Story"); await f.settle(); f.press("Photo source"); await f.settle();
      assert.deepEqual(f.external.map(([kind]) => kind), ["copy", "sheet", "story", "source"]);
      assert.match(text(f.tree()), /Photo source opened/);
      f.press("Close share preview"); assert.equal(f.closes(), 1); f.act(copy); await f.settle(); assert.equal(f.external.length, 4);
    } finally { f.dispose(); }
    assert.equal(f.files.size, 0);
  });
}

for (const change of ["changeAccount", "changeModel"]) {
  test(`${change} retires old actions and action feedback before new preparation`, async () => {
    const f = fixture({ managed: false, delayHandoff: true });
    try {
      await f.ready(); const copy = f.button("Copy link").props.onPress;
      f.press("X"); await f.settle(); f[change](); f.act(copy);
      assert.equal(f.external.length, 1); assert.equal(f.button("Copy link").props.disabled, false);
      f.handoffs[0].resolve({ success: true }); await f.settle();
      assert.doesNotMatch(text(f.tree()), /Your share sheet opened/);
      await f.ready(); f.press("Copy link"); await f.settle(); assert.equal(f.external.length, 2);
    } finally { f.dispose(); }
  });
}

test("native adapter keeps its existing unmanaged default and checks explicit clipboard/link ownership", async () => {
  const f = fixture({ managed: false });
  try {
    const adapter = f.nativeAdapter(), preparedAsset = { fileUri: "file:///fixture.png" };
    await adapter.shareCardToSocialPlatform("facebook", model, { preparedAsset });
    await adapter.shareCardToInstagramStory(model, { preparedAsset });
    await adapter.copyShareLink(model.url); await adapter.openExternalShareUrl(model.url);
    assert.deepEqual(f.external.map(([kind]) => kind), ["sheet", "story", "copy", "source"]);
    await assert.rejects(adapter.copyShareLink(model.url, { isCurrent: () => false }), { name: "AbortError" });
    await assert.rejects(adapter.openExternalShareUrl(model.url, { isCurrent: () => false }), { name: "AbortError" });
    assert.equal(f.external.length, 4);
  } finally { f.dispose(); }
});

for (const label of ["X", "Instagram Story"]) {
  test(`${label} keeps an accepted PNG until native completion, then honors modal cleanup`, async () => {
    const f = fixture({ delayHandoff: true });
    try {
      await f.ready(); const uri = [...f.files.keys()][0];
      f.press(label); await f.settle(); assert.equal(f.handoffs.length, 1);
      f.dispose(); assert.equal(f.files.has(uri), true, "accepted native work still owns its PNG");
      f.handoffs[0].resolve({ success: true }); await f.settle();
      assert.equal(f.files.size, 0); assert.equal(f.external.length, 1);
    } finally { f.dispose(); }
  });
}

test("old native completion releases only its own PNG after a direct account switch", async () => {
  const f = fixture({ managed: false, delayHandoff: true });
  try {
    await f.ready(); const original = [...f.files.keys()][0];
    f.press("X"); await f.settle(); f.changeAccount(); await f.ready();
    const replacement = [...f.files.keys()].find(uri => uri !== original);
    assert.ok(replacement); assert.equal(f.files.size, 2);
    f.handoffs[0].resolve({ success: true }); await f.settle();
    assert.deepEqual([...f.files.keys()], [replacement]);
  } finally { f.dispose(); }
});

test("captured download control uses the same ownership gate even outside normal iOS rendering", async () => {
  const f = fixture({ os: "web" });
  try {
    await f.ready(); const download = f.button("Download card").props.onPress;
    f.privacy(); const before = text(f.tree()); f.act(download); await f.settle();
    assert.equal(text(f.tree()), before, "the unavailable native download helper was not invoked");
    assert.deepEqual(f.external, []);
  } finally { f.dispose(); }
});

test("privacy rerender retires the old modal despite an unchanged lifecycle token", async () => {
  const f = fixture();
  try {
    await f.ready(); const token = f.presentation().token, copy = f.button("Copy link").props.onPress;
    f.privacy({ render: true }); assert.equal(f.presentation().token, token);
    f.act(copy); await f.settle(); assert.deepEqual(f.external, []); assert.equal(f.button("Copy link"), undefined);
    assert.equal(f.files.size, 0);
  } finally { f.dispose(); }
});

test("an old unmanaged callback cannot borrow the lifetime of a fresh modal mount", async () => {
  const f = fixture({ managed: false });
  try {
    await f.ready(); const copy = f.button("Copy link").props.onPress;
    f.dispose(); f.render(); await f.ready();
    f.act(copy); await f.settle(); assert.deepEqual(f.external, []);
    f.press("Copy link"); await f.settle(); assert.deepEqual(f.external, [["copy", model.url]]);
  } finally { f.dispose(); }
});

for (const strict of [false, true]) {
  test(`loading Studio close callbacks cannot dismiss a newer open (StrictMode ${strict})`, async () => {
    const f = fixture({ entry: "button", strict, delayEditor: true });
    try {
      f.press("Share going status"); assert.equal(f.editorLoads.length, 1);
      const close = f.button("Close share preview").props.onPress;
      const requestClose = nodes(f.tree()).find(node => node.type === "Modal").props.onRequestClose;
      const escape = nodes(f.tree()).find(node => node.props?.onAccessibilityEscape).props.onAccessibilityEscape;
      f.act(close); f.press("Share going status");
      assert.ok(f.button("Close share preview"));
      f.act(() => { close(); requestClose(); escape(); });
      assert.ok(f.button("Close share preview"), "old loading controls cannot close the new Studio");
      f.editorLoads[0].resolve(f.editorModule()); await f.ready();
      f.press("Copy link"); await f.settle(); assert.deepEqual(f.external, [["copy", model.url]]);
    } finally { f.dispose(); }
  });
}

test("closed loading Studio rejects repeated close and captured retry before its parent unmounts", async () => {
  const f = fixture({ entry: "studio", delayEditor: true });
  try {
    f.editorLoads[0].reject(new Error("fixture chunk unavailable")); await f.settle();
    const close = f.button("Close share preview").props.onPress;
    const retry = f.button("Retry loading share preview").props.onPress;
    f.act(() => { close(); retry(); close(); }); await f.settle();
    assert.equal(f.closes(), 1); assert.equal(f.editorLoads.length, 1);
    assert.equal(f.button("Close share preview"), undefined);
  } finally { f.dispose(); }
});

test("unmounted loading Studio callbacks cannot close or retry a fresh direct mount", async () => {
  const f = fixture({ entry: "studio", delayEditor: true });
  try {
    f.editorLoads[0].reject(new Error("fixture chunk unavailable")); await f.settle();
    const close = f.button("Close share preview").props.onPress;
    const retry = f.button("Retry loading share preview").props.onPress;
    f.dispose(); f.render(); assert.equal(f.editorLoads.length, 2);
    f.act(() => { close(); retry(); }); await f.settle();
    assert.equal(f.closes(), 0); assert.equal(f.editorLoads.length, 2);
    f.editorLoads[1].resolve(f.editorModule()); await f.ready();
  } finally { f.dispose(); }
});

test("same-batch loading close and reopen creates a fresh owner and ignores the old retry", async () => {
  const f = fixture({ entry: "button", delayEditor: true });
  try {
    f.press("Share going status"); f.editorLoads[0].reject(new Error("fixture chunk unavailable")); await f.settle();
    const close = f.button("Close share preview").props.onPress;
    const retry = f.button("Retry loading share preview").props.onPress;
    const open = f.button("Share going status").props.onPress;
    f.act(() => { close(); open(); }); await f.settle();
    assert.equal(f.editorLoads.length, 2); assert.ok(f.button("Close share preview"));
    f.act(() => { retry(); close(); }); await f.settle();
    assert.equal(f.editorLoads.length, 2); assert.ok(f.button("Close share preview"));
    f.editorLoads[1].resolve(f.editorModule()); await f.ready();
  } finally { f.dispose(); }
});

for (const change of ["changeAccount", "changeModel"]) {
  test(`loading Studio rejects callbacks from before ${change}`, async () => {
    const f = fixture({ entry: "studio", delayEditor: true });
    try {
      const close = f.button("Close share preview").props.onPress;
      f[change](); f.act(close); assert.equal(f.closes(), 0);
      assert.ok(f.button("Close share preview"));
      f.editorLoads[0].resolve(f.editorModule()); await f.ready();
    } finally { f.dispose(); }
  });
}
