import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import * as browseDomain from "../../domain/calendarBrowseMemory.mjs";
import * as requestDomain from "./calendarShowsRequest.mjs";
import * as controllerDomain from "./calendarShowsController.mjs";

const require = createRequire(import.meta.url), React = require("react"), reconciler = require("react-reconciler");
const noop = () => {};
function loadHook(path, modules) {
  const code = require("@babel/core").transformSync(readFileSync(new URL(path, import.meta.url), "utf8"), {
    babelrc: false, configFile: false, plugins: [require("@babel/plugin-transform-modules-commonjs")],
  }).code;
  const module = { exports: {} };
  new Function("require", "module", "exports", code)(name => {
    if (name === "react") return React;
    assert.ok(Object.hasOwn(modules, name), `Unexpected import ${name}`); return modules[name];
  }, module, module.exports);
  return module.exports.default;
}
const useCalendarBrowseState = loadHook("../../hooks/useCalendarBrowseState.js", { "../domain/calendarBrowseMemory.mjs": browseDomain });
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
  const host = renderer(), memory = browseDomain.createCalendarBrowseMemory(), occurrence = {}, requests = [];
  let latest, props = { accountId: "a", authEpoch: 1 }, hidden = false;
  const waiting = new Promise(() => {});
  const detail = { active: true, token: {}, current: () => !hidden };
  const useCalendarShows = loadHook("./useCalendarShows.js", {
    "../../hooks/useIOSDetailPresentation": { __esModule: true, default: () => detail },
    "./calendarShowsRequest.mjs": requestDomain, "./calendarShowsController.mjs": controllerDomain,
    "./calendarShowsApi": { calendarShowsError: error => Object.assign(new Error(error.message), { name: "AppError", code: "PIT-API-001", retryable: true }), readCalendarShows: (query, options) => new Promise((resolve, reject) => requests.push({ query, options, resolve, reject })) },
  });
  function Calendar() {
    const browse = useCalendarBrowseState({ memory, occurrence, ...props,
      initialState: { selected: "2026-11-20", cursor: { y: 2026, m: 10 }, scope: "all", presentation: "month" } });
    const shows = useCalendarShows({ ...browse.state, ...props, capture: browse.capture, isCurrent: browse.isCurrent,
      homeCity: "Toronto", homeCountry: "Canada" });
    latest = { browse, shows };
    if (hidden) throw waiting;
    return null;
  }
  const render = (open = true) => {
    memory.account(props.accountId, props.authEpoch);
    host.render(open ? React.createElement(strict ? React.StrictMode : React.Fragment, null,
      React.createElement(React.Suspense, { fallback: null }, React.createElement(Calendar))) : null);
  };
  const settle = async () => { for (let i = 0; i < 4; i++) { await Promise.resolve(); host.act(noop); } };
  const answer = (index, id, nextCursor = null) => requests[index].resolve({
    events: [{ id, artist: "Band", venue: "Hall", date: requests[index].query.date || requests[index].query.fromDate }], nextCursor,
    complete: nextCursor === null, monthSummary: { dayPresence: { "2026-11-20": true, "2026-11-30": true }, complete: false },
  });
  return { host, requests, render, settle, answer, read: () => latest,
    change(value) { props = { ...props, ...value }; render(); },
    hide(value) { hidden = value; render(); },
  };
}

test("real React month hook and browse ownership settle without a render/refetch loop", async () => {
  const f = fixture({ strict: true }); f.render(); await f.settle();
  assert.ok(f.requests.length >= 1 && f.requests.length <= 3);
  const latest = f.requests.length - 1;
  f.answer(latest, "selected-day"); await f.settle();
  assert.equal(f.read().shows.status, "ready");
  const count = f.requests.length;
  for (let i = 0; i < 8; i++) { f.render(); await f.settle(); }
  assert.equal(f.requests.length, count);
  assert.equal(f.read().shows.events[0].id, "selected-day");
  f.render(false);
});

test("real React date/month changes request that window immediately and ignore late prior results", async () => {
  const f = fixture(); f.render(); await f.settle();
  const old = f.requests.length - 1;
  f.host.act(() => f.read().browse.update({ selected: "2026-11-30" })); await f.settle();
  const next = f.requests.length - 1;
  assert.ok(next > old);
  assert.equal(f.requests[next].query.date, "2026-11-30");
  assert.equal(f.requests[old].options.signal.aborted, true);
  assert.deepEqual(f.read().shows.events, []);
  f.answer(old, "stale-day"); f.answer(next, "later-day"); await f.settle();
  assert.deepEqual(f.read().shows.events.map(row => row.id), ["later-day"]);
  f.host.act(() => f.read().browse.update({ cursor: { y: 2027, m: 5 }, selected: "2027-06-30" })); await f.settle();
  assert.equal(f.requests.at(-1).query.month, "2027-06");
  assert.deepEqual(f.read().shows.events, []);
  assert.deepEqual(f.read().shows.dayPresence, {});
  f.render(false);
});

test("real React account and local scope changes cannot carry prior private results or queued actions", async () => {
  const f = fixture(); f.render(); await f.settle();
  const oldIndex = f.requests.length - 1, old = f.read().shows;
  f.change({ accountId: "b", authEpoch: 2 }); await f.settle();
  assert.deepEqual(f.read().shows.events, []);
  const count = f.requests.length;
  assert.equal((await old.refresh()).value, null);
  assert.equal(f.requests.length, count);
  f.answer(oldIndex, "account-a-private"); await f.settle();
  assert.deepEqual(f.read().shows.events, []);
  f.answer(f.requests.length - 1, "account-b"); await f.settle();
  f.host.act(() => f.read().browse.update({ scope: "local" })); await f.settle();
  assert.equal(f.requests.at(-1).query.city, "Toronto");
  assert.equal(f.requests.at(-1).query.country, "CA");
  assert.deepEqual(f.read().shows.events, []);
  f.render(false);
});

test("real React Suspense cover retires month reads and old handlers remain retired on reveal", async () => {
  const f = fixture(); f.render(); await f.settle();
  const old = f.read().shows, index = f.requests.length - 1;
  f.hide(true); await f.settle();
  f.answer(index, "covered"); await f.settle();
  f.hide(false); await f.settle();
  const count = f.requests.length;
  assert.equal((await old.refresh()).value, null);
  assert.equal(f.requests.length, count);
  assert.deepEqual(f.read().shows.events, []);
  f.answer(f.requests.length - 1, "fresh-reveal"); await f.settle();
  assert.equal(f.read().shows.events[0].id, "fresh-reveal");
  f.render(false);
});
