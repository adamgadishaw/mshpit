import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const React = require("react"), reconciler = require("react-reconciler");
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { transformSync } = require("@babel/core");
const noop = () => {};
const code = transformSync(readFileSync(new URL("./MessagePrivacyControls.jsx", import.meta.url), "utf8"), {
  filename: "MessagePrivacyControls.jsx", babelrc: false, configFile: false,
  plugins: [[require("@babel/plugin-transform-react-jsx"), { runtime: "automatic" }], require("@babel/plugin-transform-modules-commonjs")],
}).code;

// Render the actual component with React. Only host primitives and the Store
// boundary are fixtures; this does not make API calls or operate a live account.
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
  const flush = () => { for (let i = 0; i < 5; i++) { host.flushSyncWork(); if (!host.flushPassiveEffects()) break; } };
  return { container, render(element) { host.updateContainerSync(element, root, null, null); flush(); }, act(callback) { host.flushSyncFromReconciler(callback); flush(); } };
}
const nodes = node => node.hidden ? [] : [node, ...(node.children || []).flatMap(nodes)];
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };

function fixture({ strict = false } = {}) {
  const renderer = createRenderer(), calls = [], states = new Map();
  let account = "A", epoch = 1, peer = "peer", route = { active: true }, store, throwing = false, externalBlockPending = false;
  const stateFor = (id, target) => {
    const key = JSON.stringify([id, target]);
    if (!states.has(key)) states.set(key, { blocked: false, muted: false });
    return states.get(key);
  };
  const module = { exports: {} };
  new Function("require", "module", "exports", code)(name => {
    if (name === "react") return React;
    if (name === "react/jsx-runtime") return require(name);
    if (name === "react-native") return { ...Object.fromEntries(["View", "Text", "Pressable", "ActivityIndicator"].map(n => [n, n])), StyleSheet: { create: value => value } };
    if (name === "../theme") return { colors: {}, radius: {}, focusRing: {} };
    if (name === "./Icon") return "Icon";
    throw new Error(`Unexpected import ${name}`);
  }, module, module.exports);
  const Component = module.exports.default;
  const f = {
    calls, states,
    all: () => nodes(renderer.container),
    text: () => f.all().filter(n => typeof n.text === "string").map(n => n.text).join(" "),
    button(label) { const n = f.all().find(n => n.type === "Pressable" && n.props.accessibilityLabel === label); assert.ok(n, `Missing button: ${label}`); return n; },
    press(label) { f.act(() => f.button(label).props.onPress()); },
    act: callback => React.act(() => renderer.act(callback)),
    render(changes = {}) {
      if (Object.hasOwn(changes, "account")) account = changes.account;
      if (Object.hasOwn(changes, "epoch")) epoch = changes.epoch;
      if (Object.hasOwn(changes, "peer")) peer = changes.peer;
      const id = account, renderedEpoch = epoch, gate = route;
      const command = action => target => {
        if (throwing) throw new Error("Synthetic synchronous Store failure");
        const before = { ...stateFor(id, target) }, request = { action, account: id, epoch: renderedEpoch, target, ...deferred(), before };
        calls.push(request);
        stateFor(id, target)[action.includes("mute") ? "muted" : "blocked"] = action === "mute" || action === "block";
        return request.promise;
      };
      store = {
        session: id ? { id } : null, chatAuthEpoch: renderedEpoch,
        isBlocked: target => stateFor(id, target).blocked, isMuted: target => stateFor(id, target).muted,
        isBlockMutationPending: () => externalBlockPending,
        blockUser: command("block"), unblockUser: command("unblock"), muteUser: command("mute"), unmuteUser: command("unmute"),
      };
      React.act(() => renderer.render(React.createElement(strict ? React.StrictMode : React.Fragment, null,
        React.createElement(Component, { otherId: peer, admitAction: () => gate.active, controls: store }))));
    },
    async settle(call, result = { ok: true }, reject = false) {
      // A resolved Store promise does not imply React's default-priority commit
      // has run. Drain the real renderer's async work, not an arbitrary tick.
      await React.act(async () => {
        if (!result?.ok || reject) Object.assign(stateFor(call.account, call.target), call.before);
        if (reject) call.reject(new Error("Synthetic request failure")); else call.resolve(result);
        await call.promise.catch(noop);
      });
    },
    setThrowing(value) { throwing = value; },
    setExternalBlockPending(value) { externalBlockPending = value; f.render(); },
    leave() { route.active = false; },
    return() { route = { active: true }; f.render(); },
    close: () => React.act(() => renderer.render(null)),
  };
  f.render(); return f;
}

test("starts collapsed, explains actual privacy and account-wide mute, and uses no keyboard or modal container", t => {
  const f = fixture(); t.after(f.close);
  assert.equal(f.button("Privacy and controls").props.accessibilityState.expanded, false);
  assert.equal(f.all().filter(n => n.type === "Pressable").length, 1);
  f.press("Privacy and controls");
  assert.match(f.text(), /stored on Pit’s servers and are not end-to-end encrypted/);
  assert.match(f.text(), /posts, suggestions, and social activity notifications across Pit/);
  assert.match(f.text(), /You can still message each other/);
  assert.ok(!f.all().some(n => /Modal|KeyboardAvoidingView|TextInput/.test(n.type || "")));
});

for (const strict of [false, true]) test(`rapid mute taps issue one command and success waits for confirmation${strict ? " in StrictMode" : ""}`, async t => {
  const f = fixture({ strict }); t.after(f.close); f.press("Privacy and controls");
  const captured = f.button("Mute account").props.onPress;
  f.act(() => { captured(); captured(); });
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].action, "mute");
  assert.doesNotMatch(f.text(), /Account muted\./);
  assert.match(f.text(), /Muting/);
  await f.settle(f.calls[0]);
  assert.match(f.text(), /Account muted\. You can still message each other/);
  f.press("Unmute account");
  assert.equal(f.calls[1].action, "unmute");
  await f.settle(f.calls[1]);
  assert.match(f.text(), /Account unmuted/);
});

test("block requires explicit inline confirmation and a cancelled captured confirm cannot execute", async t => {
  const f = fixture(); t.after(f.close); f.press("Privacy and controls"); f.press("Block account");
  assert.equal(f.calls.length, 0);
  assert.match(f.text(), /Blocking does not erase existing messages/);
  assert.match(f.text(), /your follows of each other will be removed/);
  const cancelledConfirm = f.button("Confirm block account").props.onPress;
  f.press("Cancel blocking account"); f.act(cancelledConfirm);
  assert.equal(f.calls.length, 0);
  f.press("Block account");
  const confirm = f.button("Confirm block account").props.onPress;
  f.act(() => { confirm(); confirm(); });
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].action, "block");
  assert.doesNotMatch(f.text(), /Account blocked\./);
  assert.doesNotMatch(f.text(), /This account is blocked/);
  await f.settle(f.calls[0]);
  assert.match(f.text(), /Account blocked/);
  f.press("Unblock account"); await f.settle(f.calls[1]);
  assert.match(f.text(), /Previous follows have not been restored/);
});

for (const action of ["mute", "unmute", "block", "unblock"]) test(`${action} failure remains retryable and does not claim success`, async t => {
  const f = fixture(); t.after(f.close); f.press("Privacy and controls");
  if (action === "unmute" || action === "unblock") {
    if (action === "unmute") f.press("Mute account");
    else { f.press("Block account"); f.press("Confirm block account"); }
    await f.settle(f.calls.at(-1));
  }
  const trigger = () => {
    f.press(`${action[0].toUpperCase()}${action.slice(1)} account`);
    if (action === "block") f.press("Confirm block account");
  };
  trigger(); const count = f.calls.length;
  await f.settle(f.calls.at(-1), { ok: false }, action === "unblock");
  assert.match(f.text(), /could not be .*Try again/);
  assert.doesNotMatch(f.text(), /Account (?:muted|unmuted|blocked|unblocked)\./);
  trigger(); assert.equal(f.calls.length, count + 1);
  await f.settle(f.calls.at(-1));
  assert.doesNotMatch(f.text(), /could not be/);
});

test("synchronous Store failure also releases the button and reports failure", async t => {
  const f = fixture(); t.after(f.close); f.press("Privacy and controls"); f.setThrowing(true);
  f.press("Mute account");
  assert.match(f.text(), /could not be muted/);
  assert.equal(f.button("Mute account").props.disabled, false);
  f.setThrowing(false); f.press("Mute account"); assert.equal(f.calls.length, 1); await f.settle(f.calls[0]);
});

for (const changes of [{ account: "B" }, { epoch: 2 }, { peer: "another-peer" }]) test(`captured controls and results cannot cross ${Object.keys(changes)[0]} boundaries`, async t => {
  const f = fixture(); t.after(f.close); f.press("Privacy and controls");
  const capturedMute = f.button("Mute account").props.onPress;
  f.press("Block account"); const capturedConfirm = f.button("Confirm block account").props.onPress;
  f.press("Cancel blocking account"); f.act(capturedMute);
  f.render(changes);
  f.act(() => { capturedMute(); capturedConfirm(); });
  assert.equal(f.calls.length, 1);
  await f.settle(f.calls[0]);
  assert.equal(f.button("Privacy and controls").props.accessibilityState.expanded, false);
  f.press("Privacy and controls"); assert.doesNotMatch(f.text(), /Account muted\./);
});

test("A to B to A rejects first-A callbacks and completion", async t => {
  const f = fixture(); t.after(f.close); f.press("Privacy and controls");
  const first = f.button("Mute account").props.onPress;
  f.act(first); f.render({ account: "B" }); f.render({ account: "A" });
  f.act(first); assert.equal(f.calls.length, 1);
  await f.settle(f.calls[0]); f.press("Privacy and controls");
  assert.doesNotMatch(f.text(), /Account muted\./);
});

test("inactive route admits no commands and a late completion does not leave a stuck control on return", async t => {
  const f = fixture(); t.after(f.close); f.press("Privacy and controls");
  const oldMute = f.button("Mute account").props.onPress;
  f.act(oldMute); f.leave(); f.act(oldMute); assert.equal(f.calls.length, 1);
  await f.settle(f.calls[0]); assert.doesNotMatch(f.text(), /Account muted\./);
  f.return(); assert.equal(f.button("Privacy and controls").props.accessibilityState.expanded, false);
  f.press("Privacy and controls"); f.act(oldMute); assert.equal(f.calls.length, 1);
  assert.equal(f.button("Unmute account").props.disabled, false);
});

test("unmount rejects captured actions and pending completion", async () => {
  const f = fixture(); f.press("Privacy and controls"); const captured = f.button("Mute account").props.onPress;
  f.act(captured); f.close(); f.act(captured); await f.settle(f.calls[0]);
  assert.equal(f.calls.length, 1); assert.equal(f.text(), "");
  f.render(); assert.equal(f.button("Privacy and controls").props.accessibilityState.expanded, false); f.close();
});

test("external block mutation and signed-out or self targets fail closed", t => {
  const f = fixture(); t.after(f.close); f.press("Privacy and controls");
  const mute = f.button("Mute account").props.onPress;
  f.setExternalBlockPending(true); f.act(mute); assert.equal(f.calls.length, 0);
  assert.equal(f.button("Mute account").props.disabled, true);
  f.render({ account: null }); assert.equal(f.text(), ""); f.act(mute); assert.equal(f.calls.length, 0);
  f.render({ account: "peer" }); assert.equal(f.text(), "");
});

test("a stale Store outcome never appears as a successful or failed privacy change", async t => {
  const f = fixture(); t.after(f.close); f.press("Privacy and controls"); f.press("Mute account");
  await f.settle(f.calls[0], { ok: false, stale: true });
  assert.doesNotMatch(f.text(), /Account muted\.|could not be/);
  assert.equal(f.button("Mute account").props.disabled, false);
});
