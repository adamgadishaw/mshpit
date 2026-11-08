import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const React = require("react");
const reconciler = require("react-reconciler");
const { transformSync } = require("@babel/core");
const implementation = transformSync(readFileSync(new URL("./useIOSTicketAction.js", import.meta.url), "utf8"), {
  babelrc: false, configFile: false, plugins: [require("@babel/plugin-transform-modules-commonjs")],
}).code;
const noop = () => {};
function createRenderer(onCommit) {
  const context = {}, container = { children: [] };
  let priority = 0;
  const append = (parent, child) => parent.children.push(child);
  const remove = (parent, child) => { const index = parent.children.indexOf(child); if (index >= 0) parent.children.splice(index, 1); };
  const insert = (parent, child, before) => parent.children.splice(parent.children.indexOf(before), 0, child);
  const renderer = reconciler({
    supportsMutation: true, isPrimaryRenderer: true, supportsPersistence: false, supportsHydration: false,
    getRootHostContext: () => context, getChildHostContext: () => context, getPublicInstance: node => node,
    prepareForCommit: () => null, resetAfterCommit: () => onCommit?.(),
    createInstance: (type, props) => ({ type, props, children: [] }), createTextInstance: text => ({ text }),
    appendInitialChild: append, appendChild: append, appendChildToContainer: append,
    removeChild: remove, removeChildFromContainer: remove, insertBefore: insert, insertInContainerBefore: insert,
    finalizeInitialChildren: () => false, shouldSetTextContent: () => false,
    commitUpdate: (node, type, oldProps, newProps) => { node.props = newProps; },
    commitTextUpdate: (node, oldText, text) => { node.text = text; },
    clearContainer: node => { node.children = []; }, resetTextContent: noop, commitMount: noop,
    scheduleTimeout: setTimeout, cancelTimeout: clearTimeout, noTimeout: -1,
    supportsMicrotasks: true, scheduleMicrotask: queueMicrotask,
    getCurrentUpdatePriority: () => priority, setCurrentUpdatePriority: value => { priority = value; },
    resolveUpdatePriority: () => priority || 32, shouldAttemptEagerTransition: () => false,
    hideInstance: node => { node.hidden = true; }, unhideInstance: node => { node.hidden = false; },
    hideTextInstance: node => { node.hidden = true; }, unhideTextInstance: node => { node.hidden = false; },
    detachDeletedInstance: noop, maySuspendCommit: () => false, preloadInstance: () => true,
    startSuspendingCommit: noop, suspendInstance: noop, waitForCommitToBeReady: () => null,
    NotPendingTransition: null, HostTransitionContext: React.createContext(null), resetFormInstance: noop,
    bindToConsole: (method, args) => console[method].bind(console, ...args),
  });
  const fail = error => { throw error; };
  const root = renderer.createContainer(container, 1, null, false, null, "", fail, fail, fail, null);
  const flush = () => { for (let i = 0; i < 5; i++) { renderer.flushSyncWork(); if (!renderer.flushPassiveEffects()) break; } };
  return {
    container,
    render(element) { renderer.updateContainerSync(element, root, null, null); flush(); },
    act(callback) { renderer.flushSyncFromReconciler(callback); flush(); },
  };
}

const nodes = node => node.hidden ? [] : [node, ...(node.children || []).flatMap(nodes)];
const TICKET_URL = "https://seller.example/synthetic-ticket";

// Actual React commits, layout cleanup, StrictMode and Suspense reconnects.
// Native speech and the ticket helper are mocked: no native sheet, external
// navigation, purchase, server or production write can happen in these tests.
function fixture({ platform = "ios", strict = false } = {}) {
  const calls = [], speech = [], setups = [], cleanups = [];
  let reader = true, readerCalls = 0, afterCommit = null;
  const renderer = createRenderer(() => afterCommit?.());
  const module = { exports: {} };
  const dependencies = {
    react: React,
    "react-native": { Platform: { OS: platform }, AccessibilityInfo: {
      announceForAccessibilityWithOptions(message, options) { speech.push({ message, ...options }); },
    } },
    "../hooks/useScreenReaderEnabled": () => { readerCalls++; return reader; },
    "../lib/ticketLinks": { openTicketLink(url, options) {
      return new Promise((resolve, reject) => calls.push({ url, options, reject, finish(status) {
        if (["failed", "rejected"].includes(status)) options?.onFailure({ status });
        resolve({ status });
      } }));
    } },
  };
  new Function("require", "module", "exports", implementation)(name => dependencies[name], module, module.exports);
  const useTicketAction = module.exports.default;
  function Probe({ scope }) {
    const action = useTicketAction(scope);
    React.useLayoutEffect(() => {
      setups.push(action);
      return () => cleanups.push(action);
    }, []);
    return React.createElement("TicketControl", action);
  }
  const suspended = new Promise(noop);
  function Gate(props) {
    if (props.suspended) throw suspended;
    return React.createElement(Probe, props);
  }
  let props = { scope: "A" };
  const f = {
    calls, speech, setups, cleanups,
    action: () => nodes(renderer.container).find(node => node.type === "TicketControl")?.props,
    act: callback => renderer.act(callback),
    render(update = {}) {
      props = { ...props, ...update };
      renderer.render(React.createElement(strict ? React.StrictMode : React.Fragment, null,
        React.createElement(React.Suspense, { fallback: null }, React.createElement(Gate, props))));
    },
    reader(value) { reader = value; f.render(); },
    readerCalls: () => readerCalls,
    onCommit(callback) { afterCommit = callback; },
    open(action = f.action()) { let pending; f.act(() => { pending = action.open(TICKET_URL); }); return pending; },
    async finish(index, status = "opened") {
      f.act(() => calls[index].finish(status));
      for (let i = 0; i < 5; i++) await Promise.resolve();
      f.act(noop);
    },
    close() { renderer.render(null); },
  };
  f.render();
  return f;
}

test("actual React layout unmount retires captured ticket controls before passive effects", async t => {
  const f = fixture(); t.after(f.close);
  const old = f.action();
  let commits = 0;
  f.onCommit(() => { commits++; old.open(TICKET_URL); });
  f.close(); f.onCommit(null);
  assert.equal(commits, 1);
  await old.open(TICKET_URL);
  assert.equal(f.calls.length, 0);
  assert.deepEqual(f.speech, []);
});

test("actual React scope A-B-A retires old A controls while ordinary rerenders preserve current controls", async t => {
  const f = fixture(); t.after(f.close);
  const oldA = f.action();
  f.onCommit(() => oldA.open(TICKET_URL));
  f.render({ scope: "B" }); f.render({ scope: "A" });
  f.onCommit(null);
  await oldA.open(TICKET_URL);
  assert.equal(f.calls.length, 0);
  const current = f.action();
  f.render();
  const pending = f.open(current);
  assert.equal(f.calls.length, 1);
  await f.finish(0); assert.deepEqual(await pending, { status: "opened" });
});

test("actual StrictMode replay retires old controls and publishes usable current controls", async t => {
  const f = fixture({ strict: true }); t.after(f.close);
  assert.ok(f.setups.length >= 2, "React must actually replay layout setup");
  assert.ok(f.cleanups.length >= 1);
  for (const old of f.cleanups) await old.open(TICKET_URL);
  assert.equal(f.calls.length, 0);
  const pending = f.open();
  assert.equal(f.calls.length, 1);
  await f.finish(0); await pending;
});

for (const strict of [false, true]) test(`actual React reconnect cannot revive a previously usable ticket control (StrictMode ${strict})`, async t => {
  const f = fixture({ strict }); t.after(f.close);
  const old = f.action();
  const pending = f.open(old);
  assert.equal(f.calls.length, 1, "the retained control was initially usable");
  f.render({ suspended: true });
  await old.open(TICKET_URL);
  assert.equal(f.calls.length, 1);
  f.render({ suspended: false });
  await old.open(TICKET_URL);
  assert.equal(f.calls.length, 1, "reconnect must not lend its new lifetime to the old callback");
  const next = f.open();
  assert.equal(f.calls.length, 2);
  await f.finish(0, "failed"); await pending;
  await f.open();
  assert.equal(f.calls.length, 2, "old completion cannot release the new pending claim");
  assert.equal(f.action().error, "");
  assert.deepEqual(f.speech, []);
  await f.finish(1, "failed"); await next;
  assert.ok(f.action().error);
  assert.equal(f.speech.length, 1);
});

test("actual React duplicates, failure/cancellation and manual retry retain current speech policy", async t => {
  const f = fixture(); t.after(f.close);
  f.reader(false);
  const current = f.action();
  let pending = f.open(current);
  await current.open(TICKET_URL);
  assert.equal(f.calls.length, 1);
  f.reader(true);
  await f.finish(0, "failed"); await pending;
  assert.ok(f.action().error);
  assert.deepEqual(f.speech, [{ message: f.action().error, queue: true }]);
  f.render(); assert.equal(f.speech.length, 1);
  for (const status of ["rejected", "cancelled", "opened"]) {
    pending = f.open();
    assert.equal(f.action().error, "");
    await f.finish(f.calls.length - 1, status); await pending;
    assert.equal(Boolean(f.action().error), status === "rejected");
  }
  assert.equal(f.calls.length, 4);
  assert.equal(f.speech.length, 2);
});

test("actual React rejected helper releases the current claim for an explicit retry", async t => {
  const f = fixture(); t.after(f.close);
  const pending = f.open();
  const rejected = assert.rejects(pending, /synthetic failure/);
  f.calls[0].reject(new Error("synthetic failure")); await rejected;
  const retry = f.open();
  assert.equal(f.calls.length, 2);
  await f.finish(1); await retry;
});

for (const platform of ["android", "web"]) test(`actual React ${platform} retains the exact direct opener behavior`, async t => {
  const f = fixture({ platform, strict: true }); t.after(f.close);
  const old = f.action();
  const first = f.open(old), duplicate = f.open(old);
  f.render({ scope: "B" }); f.render({ scope: "A" });
  f.close();
  const retained = old.open(TICKET_URL);
  assert.equal(f.calls.length, 3, "no iOS dedup or lifetime behavior is added to this platform");
  for (let i = 0; i < 3; i++) {
    assert.equal(f.calls[i].options, undefined);
    await f.finish(i, "failed");
  }
  await Promise.all([first, duplicate, retained]);
  assert.equal(f.readerCalls(), 0);
  assert.deepEqual(f.speech, []);
});
