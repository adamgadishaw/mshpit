import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import * as domain from "../domain/calendarBrowseMemory.mjs";

const require = createRequire(import.meta.url), React = require("react"), reconciler = require("react-reconciler");
const code = require("@babel/core").transformSync(readFileSync(new URL("./useCalendarBrowseState.js", import.meta.url), "utf8"), {
  babelrc: false, configFile: false, plugins: [require("@babel/plugin-transform-modules-commonjs")],
}).code;
const module = { exports: {} };
new Function("require", "module", "exports", code)(name => {
  if (name === "react") return React;
  assert.equal(name, "../domain/calendarBrowseMemory.mjs"); return domain;
}, module, module.exports);
const useCalendarBrowseState = module.exports.default, noop = () => {};

function renderer() {
  const context = {}; let priority = 0;
  const reconcilerInstance = reconciler({
    supportsMutation: true, isPrimaryRenderer: true, supportsPersistence: false, supportsHydration: false,
    getRootHostContext: () => context, getChildHostContext: () => context, getPublicInstance: node => node,
    prepareForCommit: () => null, resetAfterCommit: noop, clearContainer: noop,
    createInstance: (type, props) => ({ type, props }), createTextInstance: text => ({ text }),
    appendInitialChild: noop, appendChild: noop, appendChildToContainer: noop,
    removeChild: noop, removeChildFromContainer: noop, insertBefore: noop, insertInContainerBefore: noop,
    finalizeInitialChildren: () => false, shouldSetTextContent: () => false,
    commitUpdate: noop, commitTextUpdate: noop, resetTextContent: noop, commitMount: noop,
    hideInstance: noop, unhideInstance: noop, hideTextInstance: noop, unhideTextInstance: noop,
    scheduleTimeout: setTimeout, cancelTimeout: clearTimeout, noTimeout: -1, supportsMicrotasks: true, scheduleMicrotask: queueMicrotask,
    getCurrentUpdatePriority: () => priority, setCurrentUpdatePriority: value => { priority = value; }, resolveUpdatePriority: () => priority || 32,
    shouldAttemptEagerTransition: () => false, detachDeletedInstance: noop, maySuspendCommit: () => false, preloadInstance: () => true,
    startSuspendingCommit: noop, suspendInstance: noop, waitForCommitToBeReady: () => null, NotPendingTransition: null,
    HostTransitionContext: React.createContext(null), resetFormInstance: noop, bindToConsole: (method, args) => console[method].bind(console, ...args),
  });
  const fail = error => { throw error; };
  const root = reconcilerInstance.createContainer({}, 1, null, false, null, "", fail, fail, fail, null);
  const flush = () => { for (let i = 0; i < 5; i++) { reconcilerInstance.flushSyncWork(); if (!reconcilerInstance.flushPassiveEffects()) break; } };
  return {
    render(element) { reconcilerInstance.updateContainerSync(element, root, null, null); flush(); },
    act(action) { reconcilerInstance.flushSyncFromReconciler(action); flush(); },
  };
}

function fixture({ strict = false } = {}) {
  const host = renderer(), memory = domain.createCalendarBrowseMemory(), occurrence = {}, captures = [], calls = [];
  let latest, hidden = false, renderCount = 0;
  const waiting = new Promise(() => {});
  memory.account("a", 1);
  function Calendar() {
    renderCount += 1;
    const browse = useCalendarBrowseState({ memory, occurrence, accountId: "a", authEpoch: 1,
      initialState: { selected: "2026-11-10", cursor: { y: 2026, m: 10 } } });
    latest = browse;
    browse.scrollRef.current = { scrollTo: value => calls.push(value) };
    React.useLayoutEffect(() => { captures.push(browse.capture()); }, []);
    if (hidden) throw waiting;
    return null;
  }
  const render = (open = true) => host.render(open ? React.createElement(strict ? React.StrictMode : React.Fragment, null,
    React.createElement(React.Suspense, { fallback: null }, React.createElement(Calendar))) : null);
  return { host, memory, captures, calls, render, read: () => latest, count: () => renderCount,
    hide(value) { hidden = value; render(); } };
}

test("real React StrictMode replay revokes an earlier captured operation", () => {
  const f = fixture({ strict: true }); f.render();
  assert.ok(f.captures.length >= 2);
  assert.equal(f.captures[0](), false);
  assert.equal(f.captures.at(-1)(), true);
  f.render(false);
  assert.equal(f.captures.at(-1)(), false);
});

test("real React Suspense hiding retires captures and reveal restores fresh action admission", () => {
  const f = fixture(); f.render();
  const before = f.read().capture();
  assert.equal(before(), true);
  f.hide(true);
  assert.equal(before(), false);
  f.hide(false);
  assert.equal(before(), false);
  assert.equal(f.read().capture()(), true);
  f.render(false);
});

test("real React calendar to show and back restores preference and scroll without per-scroll renders", () => {
  const f = fixture(); f.render();
  f.host.act(() => f.read().update({ presentation: "agenda", scope: "plans", agendaLimit: 120 }));
  f.read().onLayout({ nativeEvent: { layout: { height: 500 } } });
  f.read().onContentSizeChange(320, 2000);
  const count = f.count();
  f.read().onScroll({ nativeEvent: { contentOffset: { y: 560 } } });
  assert.equal(f.count(), count);
  const old = f.read(); f.render(false); f.render();
  assert.equal(old.update({ view: "past" }), false);
  assert.equal(f.read().state.presentation, "agenda");
  assert.equal(f.read().state.agendaLimit, 120);
  f.read().onContentSizeChange(320, 2000);
  f.read().onLayout({ nativeEvent: { layout: { height: 500 } } });
  assert.deepEqual(f.calls.at(-1), { y: 560, animated: false });
  f.render(false);
});
