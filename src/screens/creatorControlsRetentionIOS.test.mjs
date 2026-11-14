import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import test from "node:test";
const root = fileURLToPath(new URL("../../", import.meta.url));
const require = createRequire(new URL("../../package.json", import.meta.url));
const React = require("react"), reconciler = require("react-reconciler");
const { transformSync } = require("@babel/core");
const noop = () => {};
const walk = node => [node, ...(node.children || []).flatMap(walk)];
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
function createRenderer() {
  const context = {}, container = { children: [] }; let priority = 0, focusedInput = null;
  const remove = (parent, child) => { const index = parent.children.indexOf(child); if (index >= 0) parent.children.splice(index, 1); };
  const append = (parent, child) => { remove(parent, child); parent.children.push(child); };
  const insert = (parent, child, before) => { remove(parent, child); parent.children.splice(parent.children.indexOf(before), 0, child); };
  const renderer = reconciler({
    supportsMutation: true, isPrimaryRenderer: true, supportsPersistence: false, supportsHydration: false,
    getRootHostContext: () => context, getChildHostContext: () => context, getPublicInstance: node => node,
    prepareForCommit: () => null, resetAfterCommit: noop,
    createInstance: (type, props) => ({ type, props, children: [], offset: 0,
      focus() { if (focusedInput) focusedInput.focused = false; focusedInput = this; this.focused = true; },
      blur() { this.focused = false; if (focusedInput === this) focusedInput = null; }, scrollToEnd: noop,
      measureInWindow: callback => callback(0, 0, 393, 852), startAnimating: async () => {}, stopAnimating: async () => {} }),
    createTextInstance: text => ({ text }),
    appendInitialChild: append, appendChild: append, appendChildToContainer: append,
    removeChild: remove, removeChildFromContainer: remove, insertBefore: insert, insertInContainerBefore: insert,
    finalizeInitialChildren: () => false, shouldSetTextContent: () => false,
    commitUpdate: (node, type, oldProps, props) => { node.props = props; }, commitTextUpdate: (node, oldText, text) => { node.text = text; },
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
  const owner = renderer.createContainer(container, 1, null, false, null, "", fail, fail, fail, null);
  const flush = () => { for (let i = 0; i < 20; i++) { renderer.flushSyncWork(); if (!renderer.flushPassiveEffects()) break; } };
  return { container, flush, focusedInput: () => focusedInput, render(element) { renderer.updateContainerSync(element, owner, null, null); flush(); },
    transition(element) { React.startTransition(() => renderer.updateContainer(element, owner, null, null)); },
    act(callback) { renderer.flushSyncFromReconciler(callback); flush(); } };
}

// Real event controls, disclosure, update rows/preferences and iOS presentation
// hook. Only platform hosts and transport are substituted.
function fixture({ owner = false, preferenceOnly = false } = {}) {
  const renderer = createRenderer(), modules = new Map(), writes = [], actions = [];
  const Context = React.createContext(null);
  let token = {}, active = true, account = "A", target = "td_canonical";
  const entity = { entityType: "event", entityKey: "event:canonical", label: "Canonical event" };
  const page = { entity, canManage: owner, canFollow: true, canRequest: true, claimed: owner, following: true, notifyUpdates: true };
  const write = (kind, args) => { const pending = { kind, args, ...deferred() }; writes.push(pending); return pending.promise; };
  const load = file => {
    if (modules.has(file)) return modules.get(file);
    const absolute = path.join(root, file), module = { exports: {} };
    modules.set(file, module.exports);
    const code = transformSync(fs.readFileSync(absolute, "utf8"), { filename: absolute, babelrc: false, configFile: false,
      plugins: [[require("@babel/plugin-transform-react-jsx"), { runtime: "automatic" }], require("@babel/plugin-transform-modules-commonjs")] }).code;
    new Function("require", "module", "exports", code)(name => imports(name, absolute), module, module.exports);
    modules.set(file, module.exports); return module.exports;
  };
  const imports = (name, from) => {
    if (name === "react" || name === "react/jsx-runtime") return require(name);
    if (name === "react-native") return { View: "View", Text: "Text", TextInput: "TextInput", Pressable: "Pressable", ActivityIndicator: "ActivityIndicator", StyleSheet: { create: x => x }, useWindowDimensions: () => ({ width: 393, height: 852, fontScale: 1 }) };
    if (name.endsWith("/DynamicTypeText")) return load("src/components/DynamicTypeText.ios.jsx");
    if (name.endsWith("/theme")) return { colors: {}, radius: {}, focusRing: {} };
    if (name.endsWith("/Button")) return "Button";
    if (name.endsWith("/Icon")) return "Icon";
    if (name.endsWith("/SmartImage")) return "SmartImage";
    if (name.endsWith("/diagnostics")) return { toAppError: x => x };
    if (name.endsWith("/iosDetailPresentationContext.mjs")) return { IOSDetailPresentationContext: Context };
    if (name.endsWith("/useIOSDetailPresentation")) return load("src/hooks/useIOSDetailPresentation.ios.js");
    if (name.endsWith("/useIOSDetailPresentation.js")) return require(path.join(root, "src/hooks/useIOSDetailPresentation.js"));
    if (name.endsWith("/eventAccountApi.mjs")) return {
      readEventAccount: async () => ({ ...page }),
      setEventFollowing: args => write("follow", args), requestEventAccess: args => write("claim", args),
    };
    if (name.endsWith("/creatorPostsApi.mjs")) return {
      fetchCreatorPosts: async () => [{ id: "update", creatorUpdate: { title: "Canonical update" }, review: "Author update" }],
      fetchCreatorPreference: async () => ({ following: true, notifyUpdates: true }),
      setCreatorUpdatePreference: args => write("preference", args),
    };
    if (name === "./CreatorUpdatePreference") return load("src/features/creatorPosts/CreatorUpdatePreference.jsx");
    return createRequire(from)(name);
  };
  const Panel = load("src/features/eventAccounts/EventAccountPanel.jsx").default;
  const Updates = load("src/features/creatorPosts/CreatorPostsSection.jsx").default;
  const Preference = load("src/features/creatorPosts/CreatorUpdatePreference.jsx").default;
  const Section = load("src/features/showDetails/ShowSection.jsx").default;
  const render = () => {
    const claim = token, current = () => active && claim === token;
    const admission = { active, current, canAct: current, guard: callback => typeof callback === "function" ? (...args) => { if (current()) return callback(...args); } : callback };
    const props = { targetKind: "event", targetId: target, accountId: account,
      onCompose: value => actions.push(["compose", value]), onOpenPost: value => actions.push(["post", value]),
      onRequireAuth: () => actions.push(["auth"]), renderUpdates: values => React.createElement(Updates, values) };
    renderer.render(React.createElement(Context.Provider, { value: admission }, preferenceOnly
      ? React.createElement(Preference, { entityType: "event", entityKey: entity.entityKey, accountId: account })
      : React.createElement(Section, { title: "Event access", initiallyOpen: true, keepMounted: true }, React.createElement(Panel, props))));
  };
  const all = () => walk(renderer.container);
  const button = label => all().find(n => n.props?.title === label || n.props?.accessibilityLabel === label);
  const f = { page, entity, writes, actions, all, button, render,
    input: () => all().find(n => n.type === "TextInput"),
    act: renderer.act, press: label => { const node = button(label); assert.ok(node, label); renderer.act(() => node.props.onPress()); },
    async settle() { for (let i = 0; i < 6; i++) { await new Promise(setImmediate); renderer.act(noop); } },
    cover() { active = false; token = {}; render(); }, back() { active = true; token = {}; render(); },
    account(id, idTarget = target) { account = id; target = idTarget; token = {}; render(); },
    close() { active = false; token = {}; renderer.render(null); },
  };
  render(); return f;
}

test("native event access preserves a claim draft through collapse and cover; only current callbacks submit once", async t => {
  const f = fixture(); t.after(f.close); await f.settle();
  f.press("Represent this event or festival?");
  f.act(() => f.input().props.onChangeText("My official role and contact remain authored here."));
  const oldText = f.input().props.onChangeText, oldSend = f.button("Send access request").props.onPress;
  const oldFollow = f.button("Unfollow event updates").props.onPress;
  f.press("Event access"); f.press("Event access");
  assert.match(f.input().props.value, /official role/);
  f.cover(); f.act(() => { oldText("Discarded overwrite"); oldSend(); oldFollow(); });
  f.back(); f.act(() => { oldText("Still stale"); oldSend(); oldFollow(); });
  assert.equal(f.writes.length, 0); assert.match(f.input().props.value, /official role/);
  f.press("Send access request"); f.press("Send access request");
  assert.equal(f.writes.length, 1); assert.equal(f.writes[0].kind, "claim");
  assert.equal(f.writes[0].args.id, "td_canonical"); assert.equal(f.writes[0].args.accountId, "A");
  f.writes[0].resolve({ ok: false, error: { message: "Try again" } }); await f.settle();
  assert.match(f.input().props.value, /official role/);
  f.press("Send access request"); assert.equal(f.writes.length, 2);
  f.account("B", "td_other"); await f.settle();
  assert.equal(f.writes[1].args.signal.aborted, true);
  f.writes[1].resolve({ ok: true }); await f.settle();
  assert.equal(f.input(), undefined);
  f.press("Represent this event or festival?"); assert.equal(f.input().props.value, "");
});

test("native creator compose and row navigation keep canonical entities and deny covered or revoked controls", async t => {
  const f = fixture({ owner: true }); t.after(f.close); await f.settle();
  const compose = f.button("Post to followers").props.onPress, open = f.button("Open update: Canonical update").props.onPress;
  f.act(compose); assert.equal(f.actions[0][1], f.entity);
  f.cover(); f.act(() => { compose(); open(); }); f.back(); f.act(() => { compose(); open(); });
  assert.equal(f.actions.length, 1);
  f.press("Post to followers"); f.press("Open update: Canonical update");
  assert.equal(f.actions.length, 3); assert.equal(f.actions[2][1].id, "update");
  f.page.canManage = false; f.account("held"); await f.settle();
  assert.equal(f.button("Post to followers"), undefined);
  f.act(compose); assert.equal(f.actions.length, 3);
});

test("native update preferences reject retired presses, settle one accepted save and abort across accounts", async t => {
  const f = fixture({ preferenceOnly: true }); t.after(f.close); await f.settle();
  const old = f.button("Turn off update alerts").props.onPress;
  f.cover(); f.act(old); f.back(); f.act(old); assert.equal(f.writes.length, 0);
  f.press("Turn off update alerts"); f.press("Turn off update alerts"); assert.equal(f.writes.length, 1);
  f.cover(); f.writes[0].resolve({ following: true, notifyUpdates: false }); await f.settle(); f.back();
  assert.ok(f.button("Turn on update alerts"));
  f.press("Turn on update alerts"); f.account("B"); await f.settle();
  assert.equal(f.writes[1].args.signal.aborted, true);
  f.writes[1].resolve({ following: true, notifyUpdates: false }); await f.settle();
  assert.ok(f.button("Turn off update alerts"));
});
