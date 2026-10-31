import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { runInNewContext } from "node:vm";
import React, { act, Component, createElement as h } from "react";
import Reconciler from "react-reconciler";
import { DefaultEventPriority } from "react-reconciler/constants.js";
import { transformSync } from "@babel/core";
import { lazyWithRetry } from "../lib/lazyWithRetry.js";

const require = createRequire(import.meta.url);
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Exercise real React error/Suspense reconciliation using small in-memory nodes.
// No browser, DOM emulator, application server, network or native app is started.
const context = {};
let priority = 0;
const append = (parent, child) => { parent.children.push(child); };
const remove = (parent, child) => { parent.children.splice(parent.children.indexOf(child), 1); };
const renderer = Reconciler({
  supportsMutation: true, isPrimaryRenderer: true,
  getRootHostContext: () => context, getChildHostContext: () => context,
  getPublicInstance: instance => instance,
  prepareForCommit: () => null, resetAfterCommit() {},
  createInstance: (type, props) => ({ type, props, children: [] }),
  createTextInstance: text => ({ text, children: [] }),
  appendInitialChild: append, appendChild: append, appendChildToContainer: append,
  removeChild: remove, removeChildFromContainer: remove,
  insertBefore(parent, child, before) { parent.children.splice(parent.children.indexOf(before), 0, child); },
  insertInContainerBefore(parent, child, before) { parent.children.splice(parent.children.indexOf(before), 0, child); },
  finalizeInitialChildren: () => false, shouldSetTextContent: () => false,
  commitUpdate(instance, _type, _oldProps, props) { instance.props = props; },
  commitTextUpdate(instance, _oldText, text) { instance.text = text; },
  resetTextContent() {}, clearContainer(container) { container.children = []; },
  hideInstance(instance) { instance.hidden = true; }, unhideInstance(instance) { instance.hidden = false; },
  hideTextInstance(instance) { instance.hidden = true; }, unhideTextInstance(instance) { instance.hidden = false; },
  detachDeletedInstance() {},
  scheduleTimeout: setTimeout, cancelTimeout: clearTimeout, noTimeout: -1,
  supportsMicrotasks: true, scheduleMicrotask: queueMicrotask,
  getCurrentUpdatePriority: () => priority,
  setCurrentUpdatePriority(value) { priority = value; },
  resolveUpdatePriority: () => priority || DefaultEventPriority,
  maySuspendCommit: () => false, preloadInstance: () => true,
  startSuspendingCommit() {}, suspendInstance() {}, waitForCommitToBeReady: () => null,
  NotPendingTransition: null, HostTransitionContext: React.createContext(null),
  resetFormInstance() {}, requestPostPaintCallback() {},
});

function loadJsx(file, mocks) {
  const { code } = transformSync(readFileSync(new URL(file, import.meta.url), "utf8"), {
    filename: file, babelrc: false, configFile: false,
    plugins: [["@babel/plugin-transform-react-jsx", { runtime: "automatic" }], "@babel/plugin-transform-modules-commonjs"],
  });
  const exports = {};
  runInNewContext(code, { exports, require: name => name in mocks ? mocks[name] : require(name) });
  return exports.default;
}

function fixture(factory, report = () => {}) {
  const imports = [], diagnostics = [];
  const Optional = loadJsx("./OptionalHomeShowCountdown.jsx", {
    "../lib/diagnostics": { captureAppError(error, options) { diagnostics.push({ error, options }); report(); } },
    "../lib/lazyWithRetry": { lazyWithRetry(_factory, name) {
      assert.equal(name, "HomeShowCountdown");
      const lazy = lazyWithRetry(factory, name);
      imports.push(lazy);
      return lazy;
    } },
  });
  return { Optional, imports, diagnostics };
}

class AppBoundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error) { this.props.onError(error); }
  render() { return this.state.failed ? h("app-error", null, "Something went wrong") : this.props.children; }
}

function root(t) {
  const tree = { children: [] }, uncaught = [], appErrors = [];
  const container = renderer.createContainer(tree, 1, null, false, null, "", error => uncaught.push(error), () => {}, error => uncaught.push(error), null);
  const render = async children => {
    await act(async () => { renderer.updateContainer(h(AppBoundary, { onError: error => appErrors.push(error) }, children), container, null, null); });
  };
  t.after(async () => {
    await act(async () => { renderer.updateContainer(null, container, null, null); });
    assert.deepEqual(uncaught, []);
  });
  const nodes = (node = tree) => node.hidden ? [] : [node, ...node.children.flatMap(child => nodes(child))];
  return { render, tree, appErrors, nodes, text: () => nodes().map(node => node.text || "").join("") };
}

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const settle = async lazy => { await act(async () => { await lazy.preload().catch(() => {}); }); };
const body = optional => [h("feed", { key: "feed" }, "Feed usable"), optional, h("rail", { key: "rail" }, "Rail usable")];

test("Safari chunk rejection hides only the countdown after one retry; rerenders do not retry or reload", async t => {
  const error = new Error("Error loading dynamically imported module: https://example.test/HomeShowCountdown.js");
  const storage = new Map();
  let attempts = 0, reloads = 0;
  globalThis.window = { location: { href: "https://example.test/", reload() { reloads++; } }, sessionStorage: {
    getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key),
  } };
  t.after(() => { delete globalThis.window; });
  const probe = t.mock.method(globalThis, "fetch", async () => ({ status: 200, headers: new Headers({ "content-type": "application/javascript" }) }));
  const f = fixture(async () => { attempts++; throw error; });
  const r = root(t);
  const widget = props => h(f.Optional, { key: "countdown", fallback: h("loading", null, "Loading countdown"), ...props });
  await r.render(body(widget({ plan: { id: "first" } })));
  assert.equal(r.text(), "Feed usableLoading countdownRail usable");
  await settle(f.imports[0]);
  assert.equal(r.text(), "Feed usableRail usable");
  assert.equal(attempts, 2);
  assert.equal(probe.mock.callCount(), 1);
  assert.equal(reloads, 0);
  assert.equal(storage.size, 0);
  assert.deepEqual(r.appErrors, []);
  assert.equal(f.diagnostics.length, 1);
  assert.equal(f.diagnostics[0].error, error);
  assert.equal(f.diagnostics[0].options.toast, false);
  for (let i = 0; i < 3; i++) await r.render(body(widget({ plan: { id: `updated-${i}` } })));
  assert.equal(attempts, 2);
  assert.equal(f.imports.length, 1);
  assert.equal(r.text(), "Feed usableRail usable");
});

test("successful countdown retains props, callbacks and child state across parent updates", async t => {
  let mounts = 0, unmounts = 0, attempts = 0, opened = 0;
  function Countdown(props) {
    React.useEffect(() => { mounts++; return () => { unmounts++; }; }, []);
    return h("countdown", props, props.plan.title);
  }
  const f = fixture(async () => { attempts++; return { default: Countdown }; });
  const r = root(t), plan = { title: "Next show" }, onOpen = () => opened++;
  await r.render(body(h(f.Optional, { key: "countdown", plan, compact: true, onOpen })));
  await settle(f.imports[0]);
  const rendered = r.nodes().find(node => node.type === "countdown");
  assert.equal(rendered.props.plan, plan);
  assert.equal(rendered.props.compact, true);
  rendered.props.onOpen();
  assert.equal(opened, 1);
  assert.equal(r.text(), "Feed usableNext showRail usable");
  await r.render(body(h(f.Optional, { key: "countdown", plan: { title: "Updated show" }, onOpen })));
  assert.equal(r.text(), "Feed usableUpdated showRail usable");
  assert.equal(mounts, 1);
  assert.equal(attempts, 1);
  assert.equal(f.imports.length, 1);
  assert.deepEqual(f.diagnostics, []);
  await r.render(body(null));
  assert.equal(unmounts, 1);
});

test("returning after navigation creates a fresh lazy attempt and can recover", async t => {
  let available = false, attempts = 0;
  const f = fixture(async () => {
    attempts++;
    if (!available) throw new Error("Network request failed");
    return { default: () => h("countdown", null, "Recovered countdown") };
  });
  const r = root(t);
  await r.render(body(h(f.Optional, { key: "countdown" })));
  await settle(f.imports[0]);
  assert.equal(attempts, 2);
  await r.render(h("other-screen", null, "Discover"));
  available = true;
  await r.render(body(h(f.Optional, { key: "countdown" })));
  await settle(f.imports[1]);
  assert.equal(attempts, 3);
  assert.equal(r.text(), "Feed usableRecovered countdownRail usable");
  assert.deepEqual(r.appErrors, []);
});

test("late rejection after unmount cannot disturb the next screen or poison a later mount", async t => {
  const pending = deferred();
  let available = false;
  const f = fixture(() => available ? Promise.resolve({ default: () => h("countdown", null, "Recovered") }) : pending.promise);
  const r = root(t);
  await r.render(body(h(f.Optional, { key: "countdown" })));
  const oldImport = f.imports[0];
  await r.render(h("other-screen", null, "Discover"));
  await act(async () => {
    pending.reject(new Error("Network request failed"));
    await oldImport.preload().catch(() => {});
  });
  assert.equal(r.text(), "Discover");
  assert.deepEqual(r.appErrors, []);
  assert.deepEqual(f.diagnostics, []);
  available = true;
  await r.render(body(h(f.Optional, { key: "countdown" })));
  await settle(f.imports[1]);
  assert.equal(r.text(), "Feed usableRecoveredRail usable");
});

test("a countdown render failure stays local even if Diagnostics fails", async t => {
  const f = fixture(async () => ({ default() { throw new Error("Countdown render failed"); } }), () => { throw new Error("Diagnostics failed"); });
  const r = root(t);
  await r.render(body(h(f.Optional, { key: "countdown" })));
  await settle(f.imports[0]);
  assert.equal(r.text(), "Feed usableRail usable");
  assert.deepEqual(r.appErrors, []);
  assert.equal(f.diagnostics.length, 1);
});

test("errors outside the countdown still reach the app boundary", async t => {
  const failure = new Error("Feed render failed");
  const f = fixture(async () => ({ default: () => h("countdown", null, "Next show") }));
  function BrokenFeed() { throw failure; }
  const r = root(t);
  await r.render(body(h(f.Optional, { key: "countdown" })));
  await settle(f.imports[0]);
  await r.render([h(BrokenFeed, { key: "feed" }), h(f.Optional, { key: "countdown" })]);
  assert.equal(r.text(), "Something went wrong");
  assert.deepEqual(r.appErrors, [failure]);
  assert.deepEqual(f.diagnostics, []);
});
