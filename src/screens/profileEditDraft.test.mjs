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
    hideInstance: node => { node.hidden = true; }, unhideInstance: node => { node.hidden = false; }, hideTextInstance: noop, unhideTextInstance: noop,
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

// Exercise the real editor with synthetic session/picker/upload/HTTP boundaries.
function fixture(platform, overrides = {}) {
  const renderer = createRenderer(), requests = [], pickers = [], uploads = [];
  let closed = 0;
  let session = { id: "synthetic-admin", name: "Legacy_Name", handle: "fixture_admin", bio: "Existing bio",
    genres: [], favoriteShows: ["removed-review"], avatarUri: "https://media.example/old.jpg",
    banner: "file:///legacy-banner.jpg", ...overrides };
  const native = { ...Object.fromEntries(["View", "Text", "ScrollView", "TextInput", "Pressable", "Image"].map(name => [name, name])),
    Platform: { OS: platform }, Alert: { alert: noop }, StyleSheet: { create: value => value, absoluteFill: {} } };
  const imports = (name, local) => {
    if (name === "react") return React;
    if (name === "react/jsx-runtime") return require(name);
    if (name === "react-native") return native;
    if (name === "../theme") return { colors: {}, radius: {} };
    if (name === "../store") return { useStore: () => ({ session, locationCenter: value => value,
      updateProfile: (...args) => { const request = { ...deferred(), args }; requests.push(request); return request.promise; } }) };
    if (name === "../hooks/useIOSProfileEditor") return execute(`../hooks/useIOSProfileEditor${platform === "ios" ? ".ios" : ""}.js`, imports);
    if (name === "../hooks/useAccountTaskScope") return execute("../hooks/useAccountTaskScope.js", imports);
    if (name === "../hooks/useReducedMotion") return () => false;
    if (name === "expo-image-picker") return { launchImageLibraryAsync: (...args) => { const picker = { ...deferred(), args }; pickers.push(picker); return picker.promise; } };
    if (name === "../hooks/useProfileImageUpload") return { useProfileImageUpload: () => ({ imageCropDialog: null, uploadProfileImage: (asset, purpose, options) => options.upload(asset, { signal: options.signal }) }) };
    if (name === "../lib/mediaUpload") return { isDurableMediaUrl: value => /^https?:/.test(value || ""), reportMediaPickerError: noop,
      uploadMediaAsset: (...args) => { const upload = { ...deferred(), args }; uploads.push(upload); return upload.promise; } };
    if (name === "../features/profileHistory/useProfileHistory") return { useProfileHistory: () => ({ status: "error", posts: [], nextCursor: null }) };
    if (name === "../lib/lazyWithRetry") return { lazyWithRetry: () => "PickArtistsScreen" };
    if (name.startsWith("../components/")) return name.split("/").at(-1);
    return local(name);
  };
  const Screen = execute("./EditProfileScreen.jsx", imports).default;
  const f = { requests, pickers, uploads,
    get closed() { return closed; },
    find(predicate) { const found = nodes(renderer.container).find(predicate); assert.ok(found); return found; },
    header() { return f.find(n => n.type === "SheetHeader").props.action; },
    act: callback => renderer.act(callback),
    render() { renderer.render(React.createElement(Screen, { onClose: () => { closed++; } })); },
    refresh(patch) { session = { ...session, ...patch }; f.render(); },
    editBio(value) { f.act(() => f.find(n => n.type === "TextInput" && n.props.placeholder === "Tell people about yourself").props.onChangeText(value)); },
    save() { let result; f.act(() => { result = f.header().onPress(); }); return result; },
    pick() { f.act(() => { void f.find(n => n.type === "Pressable" && n.props.accessibilityLabel === "Change profile photo").props.onPress(); }); },
    close() { renderer.render(null); },
    async settle() { for (let i = 0; i < 10; i++) await Promise.resolve(); await new Promise(setImmediate); f.act(noop); },
  };
  f.render(); return f;
}

for (const platform of ["web", "ios", "android"]) {
  test(`${platform}: failed upload keeps the previous photo and shows an inline error until retry`, async t => {
    const f = fixture(platform); t.after(f.close);
    f.pick(); f.pickers[0].resolve({ canceled: false, assets: [{ uri: "file:///synthetic.jpg" }] }); await f.settle();
    f.uploads[0].reject({ userMessage: "Confirm your email before uploading." }); await f.settle();
    assert.equal(f.find(n => n.type === "Avatar").props.user.avatarUri, "https://media.example/old.jpg");
    assert.equal(f.find(n => n.props?.accessibilityRole === "alert").children[0].text, "Confirm your email before uploading.");
    assert.equal(f.header().disabled, false);
    f.pick(); f.pickers[1].resolve({ canceled: false, assets: [{ uri: "file:///retry.jpg" }] }); await f.settle();
    f.uploads[1].resolve("https://media.example/retry.jpg"); await f.settle();
    assert.equal(f.find(n => n.type === "Avatar").props.user.avatarUri, "https://media.example/retry.jpg");
  });
  test(`${platform}: photo edit omits invalid legacy name, empty genres, stale pins and local banner`, async t => {
    const f = fixture(platform); t.after(f.close);
    assert.equal(f.header().disabled, false, "unchanged empty legacy genres do not lock unrelated edits");
    f.pick();
    f.pickers[0].resolve({ canceled: false, assets: [{ uri: "file:///synthetic.jpg" }] }); await f.settle();
    f.uploads[0].resolve("https://media.example/new.jpg"); await f.settle();
    assert.equal(f.find(n => n.type === "Avatar").props.user.avatarUri, "https://media.example/new.jpg");
    f.refresh({ bio: "Saved on another device", banner: "https://media.example/remote-banner.jpg" });
    void f.save();
    assert.deepEqual(f.requests[0].args[0], { avatarUri: "https://media.example/new.jpg" });
    assert.equal(f.requests[0].args[1].expectedAccountId, "synthetic-admin");
    f.requests[0].resolve({ ok: false, error: "Synthetic save failure" }); await f.settle();
    assert.equal(f.closed, 0);
    assert.equal(f.find(n => n.type === "Avatar").props.user.avatarUri, "https://media.example/new.jpg");
    void f.save(); assert.deepEqual(f.requests[1].args[0], f.requests[0].args[0]);
    f.requests[1].resolve({ ok: true }); await f.settle(); assert.equal(f.closed, 1);
  });
  test(`${platform}: clearing bio is sent explicitly and reverting an edit omits it`, async t => {
    const f = fixture(platform); t.after(f.close);
    f.editBio(""); void f.save(); assert.deepEqual(f.requests[0].args[0], { bio: "" });
    f.requests[0].resolve({ ok: false }); await f.settle();
    f.editBio("Existing bio"); void f.save(); assert.deepEqual(f.requests[1].args[0], {});
    f.requests[1].resolve({ ok: true }); await f.settle();
  });
  test(`${platform}: deliberately clearing all genres remains invalid`, async t => {
    const f = fixture(platform, { genres: ["Rock"] }); t.after(f.close);
    f.act(() => f.find(n => n.type === "Pressable" && n.children.some(c => c.type === "Text" && c.children.some(text => text.text === "Rock"))).props.onPress());
    assert.equal(f.header().disabled, true);
    void f.save(); assert.equal(f.requests.length, 0);
  });
}

for (const platform of ["web", "ios", "android"]) {
  test(`${platform}: invalid changed name explains the problem and can be corrected without genres`, async t => {
    const f = fixture(platform); t.after(f.close);
    const name = () => f.find(n => n.type === "TextInput" && n.props.placeholder === "Your name");
    f.act(() => name().props.onChangeText("Bad_Name"));
    assert.equal(f.header().disabled, true);
    assert.match(f.find(n => n.props?.accessibilityRole === "alert").children[0].text, /no underscores or emoji/);
    void f.save(); assert.equal(f.requests.length, 0); await f.settle();
    f.act(() => name().props.onChangeText("Valid Name"));
    assert.equal(f.header().disabled, false);
    void f.save(); assert.deepEqual(f.requests[0].args[0], { name: "Valid Name" });
    f.requests[0].resolve({ ok: false, error: { source: "api", status: 409, message: "That username is taken. Choose another one.", userMessage: "Check your request." } });
    await f.settle();
    assert.equal(f.find(n => n.props?.accessibilityRole === "alert").children[0].text, "That username is taken. Choose another one.");
    assert.equal(name().props.value, "Valid Name");
    assert.equal(f.closed, 0);
  });
  test(`${platform}: removing the last genre shows its explanation before Save`, t => {
    const f = fixture(platform, { genres: ["Rock"] }); t.after(f.close);
    f.act(() => f.find(n => n.type === "Pressable" && n.children.some(c => c.type === "Text" && c.children.some(text => text.text === "Rock"))).props.onPress());
    assert.equal(f.header().disabled, true);
    assert.match(f.find(n => n.props?.accessibilityRole === "alert").children[0].text, /Choose/);
    assert.equal(f.requests.length, 0);
  });
}

test("untouched legacy blank name permits unrelated bio save, but clearing a valid name explains the no-op", async t => {
  const legacy = fixture("web", { name: "" }); t.after(legacy.close);
  legacy.editBio("New bio");
  assert.equal(legacy.header().disabled, false);
  void legacy.save(); assert.deepEqual(legacy.requests[0].args[0], { bio: "New bio" });
  legacy.requests[0].resolve({ ok: true }); await legacy.settle();
  const current = fixture("web", { name: "Valid Name" }); t.after(current.close);
  current.act(() => current.find(n => n.type === "TextInput" && n.props.placeholder === "Your name").props.onChangeText(""));
  assert.equal(current.header().disabled, true);
  assert.match(current.find(n => n.props?.accessibilityRole === "alert").children[0].text, /Use a name/);
  void current.save(); assert.equal(current.requests.length, 0);
});
