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

// Real component, React, account-task scope and close guard. No native or network writes.
function fixture({ platform = "ios", strict = false, closeBehavior = "count", badgeSupport = true, profileBadges = null } = {}) {
  const renderer = createRenderer(), requests = [], pickers = [], uploads = [], alerts = [];
  let closed = 0, route = true, epoch = 1, hidden = false;
  const suspension = deferred();
  let session = { id: "synthetic-account", name: "Fixture", handle: "fixture_fan", bio: "Original bio", genres: ["Rock"], favoriteShows: [], avatarUri: "https://media.example.org/old.jpg", profileBadgeSelectionSupported: badgeSupport, profileBadges };
  const closeGuardRef = { current: null };
  const native = { ...Object.fromEntries(["View", "Text", "ScrollView", "TextInput", "Pressable", "Image"].map(name => [name, name])),
    Platform: { OS: platform }, StyleSheet: { create: value => value, absoluteFill: {} }, Alert: { alert: (...args) => alerts.push(args) } };
  const imports = (name, local) => {
    if (name === "react") return React;
    if (name === "react/jsx-runtime") return require(name);
    if (name === "react-native") return native;
    if (name === "../theme") return { colors: {}, radius: {} };
    if (name === "../store") return { useStore: () => ({ session, chatAuthEpoch: epoch, locationCenter: value => value, userBadges: () => ["verified", "email-confirmed"],
      updateProfile: (...args) => { const request = { ...deferred(), args }; requests.push(request); return request.promise; } }) };
    if (name === "../hooks/useIOSProfileEditor") return execute(`../hooks/useIOSProfileEditor${platform === "ios" ? ".ios" : ""}.js`, imports);
    if (name === "../hooks/useAccountTaskScope") return execute("../hooks/useAccountTaskScope.js", imports);
    if (name === "expo-image-picker") return { launchImageLibraryAsync: (...args) => { const picker = { ...deferred(), args }; pickers.push(picker); return picker.promise; } };
    if (name === "../hooks/useProfileImageUpload") return { useProfileImageUpload: () => ({ imageCropDialog: null, uploadProfileImage: (asset, purpose, options) => options.upload(asset, { signal: options.signal }) }) };
    if (name === "../lib/mediaUpload") return { isDurableMediaUrl: value => /^https:/.test(value || ""), reportMediaPickerError: noop,
      uploadMediaAsset: (...args) => { const upload = { ...deferred(), args }; uploads.push(upload); return upload.promise; } };
    if (name === "../features/profileHistory/useProfileHistory") return { useProfileHistory: () => ({ status: "ready", posts: [{ id: "synthetic-show", artist: "Fixture artist" }], nextCursor: null }) };
    if (name === "../lib/lazyWithRetry") return { lazyWithRetry: () => "PickArtistsScreen" };
    if (name.startsWith("../components/")) return name.split("/").at(-1);
    return local(name);
  };
  const Screen = execute("./EditProfileScreen.jsx", imports).default;
  function Hide() { if (hidden) throw suspension.promise; return null; }
  const back = () => { if (closeBehavior === "throw") throw new Error("Synthetic navigation failure"); if (closeBehavior === "noop") return; return closeGuardRef.current ? closeGuardRef.current({ proceed: () => { closed++; } }) : closed++; };
  const f = { requests, pickers, uploads, alerts, closeGuardRef,
    get closed() { return closed; },
    all: () => nodes(renderer.container),
    find(predicate) { const found = f.all().find(predicate); assert.ok(found); return found; },
    input(label = "Bio") { return f.find(n => n.type === "TextInput" && (n.props.accessibilityLabel === label || n.props.placeholder === "Tell people about yourself" && label === "Bio")); },
    header() { return f.find(n => n.type === "SheetHeader").props.action; },
    footer() { return f.find(n => n.type === "Button").props; },
    button(label) { return f.find(n => n.type === "Pressable" && n.props.accessibilityLabel === label).props; },
    act: callback => renderer.act(callback),
    render() { renderer.render(React.createElement(strict ? React.StrictMode : React.Fragment, null,
      React.createElement(React.Suspense, { fallback: React.createElement("Fallback") }, React.createElement(Hide), React.createElement(Screen, { key: JSON.stringify([session?.id, epoch]), closeGuardRef, onClose: back, isCurrentRoute: () => route })))); },
    edit(value) { f.act(() => f.input().props.onChangeText(value)); },
    save() { let result; f.act(() => { result = f.header().onPress(); }); return result; },
    scope(id, nextEpoch = epoch) { session = { ...session, id }; epoch = nextEpoch; f.render(); },
    rerenderSession() { session = { ...session }; f.render(); },
    refreshSession(patch) { session = { ...session, ...patch }; f.render(); },
    leave() { route = false; },
    hide() { hidden = true; f.render(); },
    show() { hidden = false; f.render(); },
    close() { renderer.render(null); },
    async settle() { for (let i = 0; i < 10; i++) await Promise.resolve(); await new Promise(setImmediate); f.act(noop); },
    async complete(value = { ok: true }, index = requests.length - 1) { requests[index].resolve(value); await f.settle(); },
  };
  f.render(); return f;
}

test("badge choices toggle repeatedly, participate in cancel protection and save one confirmed draft", async t => {
  const f = fixture(); t.after(f.close);
  const label = "Verified profile badge";
  assert.equal(f.button(label).accessibilityState.checked, true);
  f.act(() => f.button(label).onPress());
  assert.equal(f.button(label).accessibilityState.checked, false);
  f.act(() => f.button(label).onPress());
  assert.equal(f.button(label).accessibilityState.checked, true);
  f.act(() => f.button("Hide all profile badges").onPress());
  assert.equal(f.button(label).accessibilityState.checked, false);
  f.act(() => f.closeGuardRef.current({ proceed: () => assert.fail("Unconfirmed discard") }));
  assert.equal(f.alerts.at(-1)[0], "Discard profile changes?");
  f.act(() => f.alerts.at(-1)[2].find(b => b.text === "Keep editing").onPress());
  assert.equal(f.button(label).accessibilityState.checked, false);
  const toggle = f.button(label).onPress, save = f.header().onPress;
  let submitted;
  f.act(() => { submitted = save(); toggle(); void save(); });
  assert.equal(f.requests.length, 1);
  assert.deepEqual(f.requests[0].args[0].profileBadges, []);
  assert.equal(f.button(label).disabled, true);
  await f.complete({ ok: false, error: "Could not confirm badge choices" });
  await submitted;
  await f.settle();
  assert.equal(f.closed, 0);
  assert.equal(f.button(label).accessibilityState.checked, false);
  void f.save();
  assert.deepEqual(f.requests[1].args[0].profileBadges, []);
  await f.complete();
  assert.equal(f.closed, 1);
});

test("show-all reset sends explicit null, clean saves preserve existing choice and old servers have no controls", async t => {
  const f = fixture({ profileBadges: [] }); t.after(f.close);
  void f.save();
  assert.equal(Object.hasOwn(f.requests[0].args[0], "profileBadges"), false);
  await f.complete({ ok: false });
  f.act(() => f.button("Show all profile badges").onPress());
  assert.equal(f.button("Verified profile badge").accessibilityState.checked, true);
  void f.save();
  assert.equal(f.requests[1].args[0].profileBadges, null);
  await f.complete();
  for (const platform of ["ios", "android", "web"]) {
    const old = fixture({ platform, badgeSupport: false }); t.after(old.close);
    assert.equal(old.all().some(n => n.props?.accessibilityLabel === "Hide all profile badges"), false);
    void old.save();
    assert.equal(Object.hasOwn(old.requests[0].args[0], "profileBadges"), false);
    await old.complete();
  }
});

test("badge-only discard does not save or leak into a reopened editor", t => {
  const f = fixture(); t.after(f.close);
  f.act(() => f.button("Hide all profile badges").onPress());
  let discarded = 0;
  f.act(() => f.closeGuardRef.current({ proceed: () => discarded++ }));
  const discard = f.alerts.at(-1)[2].find(b => b.text === "Discard").onPress;
  f.act(() => { discard(); discard(); });
  assert.equal(discarded, 1);
  assert.equal(f.requests.length, 0);
  const reopened = fixture(); t.after(reopened.close);
  assert.equal(reopened.button("Verified profile badge").accessibilityState.checked, true);
});

test("badge editing is iOS-only even with the shared server capability", t => {
  for (const platform of ["android", "web"]) {
    const f = fixture({ platform }); t.after(f.close);
    assert.equal(f.all().some(n => n.props?.accessibilityLabel === "Hide all profile badges"), false);
  }
});

test("untouched badge choices follow self hydration without dirtying or replaying a stale preference", async t => {
  const f = fixture({ badgeSupport: false }); t.after(f.close);
  assert.equal(f.all().some(n => n.props?.accessibilityLabel === "Hide all profile badges"), false);
  f.refreshSession({ profileBadgeSelectionSupported: true, profileBadges: [] });
  assert.equal(f.button("Verified profile badge").accessibilityState.checked, false);
  let cleanClose = 0;
  f.act(() => f.closeGuardRef.current({ proceed: () => cleanClose++ }));
  assert.equal(cleanClose, 1);
  assert.equal(f.alerts.length, 0);
  f.refreshSession({ profileBadges: ["verified"] });
  assert.equal(f.button("Verified profile badge").accessibilityState.checked, true);
  assert.equal(f.button("Email confirmed profile badge").accessibilityState.checked, false);
  void f.save();
  assert.equal(Object.hasOwn(f.requests[0].args[0], "profileBadges"), false);
  await f.complete();
});

test("explicit show-all intent survives a later self receipt and remains a guarded draft", async t => {
  const f = fixture({ profileBadges: null }); t.after(f.close);
  f.act(() => f.button("Show all profile badges").onPress());
  f.refreshSession({ profileBadges: [] });
  assert.equal(f.button("Verified profile badge").accessibilityState.checked, true);
  f.act(() => f.closeGuardRef.current({ proceed: () => assert.fail("Explicit selection differs from latest receipt") }));
  assert.equal(f.alerts.at(-1)[0], "Discard profile changes?");
  f.act(() => f.alerts.at(-1)[2].find(b => b.text === "Keep editing").onPress());
  void f.save();
  assert.equal(Object.hasOwn(f.requests[0].args[0], "profileBadges"), true);
  assert.equal(f.requests[0].args[0].profileBadges, null);
  await f.complete();
});

test("lost badge capability keeps an explicit draft and explains that it must be retried", async t => {
  const f = fixture(); t.after(f.close);
  f.act(() => f.button("Hide all profile badges").onPress());
  f.refreshSession({ profileBadgeSelectionSupported: false });
  const text = f.all().map(n => n.text || "").join(" ");
  assert.match(text, /Badge choices are temporarily unavailable/u);
  assert.doesNotMatch(text, /other profile edits can still be saved/u);
  void f.save();
  assert.deepEqual(f.requests[0].args[0].profileBadges, []);
  await f.complete({ ok: false });
  assert.equal(f.closed, 0);
  f.refreshSession({ profileBadgeSelectionSupported: true });
  assert.equal(f.button("Verified profile badge").accessibilityState.checked, false);
});

test("explicit badge choices survive self refresh and are still saved as the user's draft", async t => {
  const f = fixture(); t.after(f.close);
  f.act(() => f.button("Hide all profile badges").onPress());
  f.refreshSession({ profileBadges: ["verified"] });
  assert.equal(f.button("Verified profile badge").accessibilityState.checked, false);
  f.act(() => f.closeGuardRef.current({ proceed: () => assert.fail("Explicit badge draft is dirty") }));
  assert.equal(f.alerts.at(-1)[0], "Discard profile changes?");
  f.act(() => f.alerts.at(-1)[2].find(b => b.text === "Keep editing").onPress());
  void f.save();
  assert.deepEqual(f.requests[0].args[0].profileBadges, []);
  await f.complete();
});

for (const strict of [false, true]) test(`same-batch saves and keyboard edits are exclusive (StrictMode ${strict})`, async t => {
  const f = fixture({ strict }); t.after(f.close);
  f.edit("Submitted bio"); const input = f.input().props.onChangeText, header = f.header().onPress, footer = f.footer().onPress;
  f.act(() => { void header(); input("Unsent before commit"); void footer(); void header(); });
  assert.equal(f.requests.length, 1); assert.equal(f.requests[0].args[0].bio, "Submitted bio");
  assert.equal(f.input().props.editable, false); assert.equal(f.header().disabled, true); assert.equal(f.footer().disabled, true);
  f.edit("Unsent after commit"); assert.equal(f.input().props.value, "Submitted bio");
  f.rerenderSession(); f.edit("Unsent after Store render"); assert.equal(f.input().props.value, "Submitted bio");
  await f.complete(); assert.equal(f.closed, 1);
  f.act(() => { void header(); void f.header().onPress(); }); assert.equal(f.requests.length, 1);
  f.edit("Explicit later edit"); void f.save(); assert.equal(f.requests.length, 2);
  await f.complete({ ok: false, error: "Synthetic failure" }); assert.equal(f.input().props.value, "Explicit later edit"); assert.equal(f.input().props.editable, true);
});

test("same-batch edit then stale Save waits for committed draft", async t => {
  const f = fixture(); t.after(f.close); const save = f.header().onPress;
  f.act(() => { f.input().props.onChangeText("Newest"); void save(); }); assert.equal(f.requests.length, 0);
  void f.save(); assert.equal(f.requests[0].args[0].bio, "Newest"); await f.complete({ ok: false });
});

for (const rejected of [false, true]) test(`failed Save retains every field and uploaded photo (throw ${rejected})`, async t => {
  const f = fixture(); t.after(f.close); f.edit("Keep this draft");
  f.act(() => { void f.button("Change profile photo").onPress(); });
  f.pickers[0].resolve({ assets: [{ uri: "file:///synthetic.jpg" }] }); await f.settle();
  f.uploads[0].resolve("https://media.example.org/new.jpg"); await f.settle();
  void f.save(); const payload = f.requests[0].args[0];
  if (rejected) { f.requests[0].reject(new Error("Synthetic failure")); await f.settle(); } else await f.complete({ ok: false, error: "Synthetic failure" });
  assert.equal(f.closed, 0); assert.equal(f.input().props.value, "Keep this draft");
  void f.save(); assert.deepEqual(f.requests[1].args[0], payload); assert.equal(payload.avatarUri, "https://media.example.org/new.jpg"); await f.complete(); assert.equal(f.closed, 1);
});

test("native picker through upload excludes Save, other picker and retained edits", async t => {
  const f = fixture(); t.after(f.close); const photo = f.button("Change profile photo").onPress, banner = f.button("Add a profile banner").onPress, save = f.header().onPress, edit = f.input().props.onChangeText;
  f.act(() => { void photo(); void photo(); void banner(); void save(); edit("Rejected"); });
  assert.equal(f.pickers.length, 1); assert.equal(f.requests.length, 0); assert.equal(f.input().props.editable, false);
  f.pickers[0].resolve({ assets: [{ uri: "file:///synthetic.jpg" }] }); await f.settle(); assert.equal(f.uploads.length, 1);
  void f.save(); f.edit("Also rejected"); assert.equal(f.requests.length, 0); assert.equal(f.input().props.value, "Original bio");
  f.uploads[0].resolve("https://media.example.org/new.jpg"); await f.settle(); assert.equal(f.input().props.editable, true);
  void f.save(); assert.equal(f.requests[0].args[0].avatarUri, "https://media.example.org/new.jpg"); await f.complete();
});

for (const boundary of ["account", "epoch", "unmount", "route"]) test(`late Save and retained callback inert after ${boundary}`, async t => {
  const f = fixture(); t.after(f.close); const save = f.header().onPress, edit = f.input().props.onChangeText;
  void f.save();
  if (boundary === "account") { f.scope("other"); f.scope("synthetic-account"); }
  if (boundary === "epoch") f.scope("synthetic-account", 2);
  if (boundary === "unmount") f.close();
  if (boundary === "route") f.leave();
  f.act(() => { void save(); edit("Stale"); }); await f.complete(); assert.equal(f.requests.length, 1); assert.equal(f.closed, 0);
  if (boundary !== "route") assert.equal(f.requests[0].args[1].signal.aborted, true);
});

test("city and artists presentation retire underlying Save and callbacks", async t => {
  const f = fixture(); t.after(f.close);
  for (const label of ["Home city", "Favorite artists"]) {
    const save = f.header().onPress, edit = f.input().props.onChangeText;
    f.act(() => f.button(label).onPress());
    f.act(() => { void save(); edit("Stale"); }); assert.equal(f.requests.length, 0);
    const picker = f.find(n => n.type === (label === "Home city" ? "LocationPicker" : "PickArtistsScreen"));
    f.act(() => (picker.props.onClose || picker.props.onDone)()); assert.equal(f.input().props.value, "Original bio");
  }
});

for (const platform of ["android", "web"]) test(`${platform} retains original editable pending form and payload`, async t => {
  const f = fixture({ platform }); t.after(f.close); f.edit("Submitted"); void f.save();
  assert.equal(f.input().props.editable, undefined); f.edit("Later"); assert.equal(f.input().props.value, "Later");
  assert.equal(f.requests[0].args[0].bio, "Submitted"); await f.complete(); assert.equal(f.closed, 1);
});

test("Suspense retains accepted operation barrier, retires callbacks and defers confirmed close", async t => {
  const f = fixture(); t.after(f.close); f.edit("Submitted"); const save = f.header().onPress, edit = f.input().props.onChangeText;
  void f.save(); f.hide(); f.act(() => { void save(); edit("Hidden edit"); });
  assert.equal(f.requests.length, 1); await f.complete(); assert.equal(f.closed, 0);
  f.show(); assert.equal(f.closed, 1); assert.equal(f.input().props.value, "Submitted");
  f.act(() => { void save(); edit("Retired edit"); }); assert.equal(f.input().props.value, "Submitted"); assert.equal(f.requests.length, 1);
});

test("Suspense does not release pending media or discard picker-owned asset", async t => {
  const f = fixture(); t.after(f.close); f.act(() => { void f.button("Change profile photo").onPress(); });
  f.hide(); f.show(); void f.save(); assert.equal(f.requests.length, 0);
  f.pickers[0].resolve({ assets: [{ uri: "file:///synthetic.jpg" }] }); await f.settle(); f.hide();
  f.uploads[0].resolve("https://media.example.org/preserved.jpg"); await f.settle(); f.show(); void f.save();
  assert.equal(f.requests[0].args[0].avatarUri, "https://media.example.org/preserved.jpg"); await f.complete();
});

test("all current and retained draft controls reject edits during Save", async t => {
  const f = fixture(); t.after(f.close);
  const callbacks = f.all().filter(n => n.type === "Pressable" && n.props.onPress).map(n => n.props.onPress);
  const inputs = f.all().filter(n => n.type === "TextInput").map(n => n.props.onChangeText);
  void f.save(); const payload = f.requests[0].args[0];
  f.act(() => { callbacks.forEach(callback => { void callback(); }); inputs.forEach(callback => callback("Rejected")); });
  f.act(() => { f.all().filter(n => n.type === "Pressable" && n.props.onPress).forEach(n => { void n.props.onPress(); }); });
  assert.equal(f.pickers.length, 0); assert.equal(f.requests.length, 1); assert.equal(f.input().props.value, "Original bio");
  await f.complete({ ok: false }); void f.save(); assert.deepEqual(f.requests[1].args[0], payload); await f.complete();
});

for (const outcome of ["cancel", "throw", "upload-null", "upload-throw"]) test(`media ${outcome} unlocks and preserves previous photo`, async t => {
  const f = fixture(); t.after(f.close); f.edit("Draft"); f.act(() => { void f.button("Change profile photo").onPress(); });
  if (outcome === "cancel") f.pickers[0].resolve({ canceled: true });
  else if (outcome === "throw") f.pickers[0].reject(new Error("Synthetic picker failure"));
  else { f.pickers[0].resolve({ assets: [{ uri: "file:///synthetic.jpg" }] }); await f.settle(); if (outcome === "upload-null") f.uploads[0].resolve(null); else f.uploads[0].reject(new Error("Synthetic upload failure")); }
  await f.settle(); assert.equal(f.input().props.editable, true); void f.save(); assert.equal(f.requests[0].args[0].bio, "Draft"); assert.equal(Object.hasOwn(f.requests[0].args[0], "avatarUri"), false); assert.equal(f.find(n => n.type === "Avatar").props.user.avatarUri, "https://media.example.org/old.jpg"); await f.complete();
});

test("no-op edits still release the commit barrier for Save", async t => {
  const f = fixture(); t.after(f.close);
  f.act(() => f.button("No accent color").onPress()); void f.save(); assert.equal(f.requests.length, 1); await f.complete({ ok: false });
  f.act(() => f.input("Username").props.onChangeText("FIXTURE_FAN")); void f.save(); assert.equal(f.requests.length, 2); await f.complete();
});

for (const closeBehavior of ["throw", "noop"]) test(`confirmed ${closeBehavior} navigation does not resend until explicit edit`, async t => {
  const f = fixture({ closeBehavior }); t.after(f.close); void f.save(); await f.complete();
  assert.equal(f.closed, 0); void f.save(); assert.equal(f.requests.length, 1);
  f.edit("New explicit draft"); void f.save(); assert.equal(f.requests.length, 2); await f.complete();
});

for (const phase of ["picker", "upload"]) test(`real account scope retires pending ${phase} and old media controls`, async t => {
  const f = fixture(); t.after(f.close); const photo = f.button("Change profile photo").onPress;
  f.act(() => { void photo(); });
  if (phase === "upload") { f.pickers[0].resolve({ assets: [{ uri: "file:///synthetic.jpg" }] }); await f.settle(); }
  f.scope("other"); f.scope("synthetic-account"); f.act(() => { void photo(); }); assert.equal(f.pickers.length, 1);
  if (phase === "picker") { f.pickers[0].resolve({ assets: [{ uri: "file:///synthetic.jpg" }] }); await f.settle(); assert.equal(f.uploads.length, 0); }
  else { assert.equal(f.uploads[0].args[2].signal.aborted, true); f.uploads[0].resolve("https://media.example.org/stale.jpg"); await f.settle(); }
  void f.save(); assert.equal(Object.hasOwn(f.requests[0].args[0], "avatarUri"), false); assert.equal(f.find(n => n.type === "Avatar").props.user.avatarUri, "https://media.example.org/old.jpg"); await f.complete();
});

test("confirmed success while hidden never closes a replacement route", async t => {
  const f = fixture(); t.after(f.close); void f.save(); f.hide(); await f.complete(); f.leave(); f.show(); assert.equal(f.closed, 0); assert.equal(f.requests.length, 1);
});
