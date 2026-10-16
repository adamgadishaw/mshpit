import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import test from "node:test";
import * as lazyRecovery from "../lib/lazyWithRetry.js";

const require = createRequire(import.meta.url);
const { transformSync } = require("@babel/core");
const filename = new URL("../components/ErrorBoundary.jsx", import.meta.url);
const compiled = transformSync(readFileSync(filename, "utf8"), {
  filename: filename.pathname, babelrc: false, configFile: false,
  plugins: [[require("@babel/plugin-transform-react-jsx"), { runtime: "automatic" }], require("@babel/plugin-transform-modules-commonjs")],
}).code;

function fixture({ platform = "web" } = {}) {
  const calls = [], pending = [], removedKeys = [];
  const storage = new Map();
  let reloads = 0;
  const browserWindow = {
    location: { href: "http://localhost/discover", reload: () => { reloads++; } },
    sessionStorage: {
      getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: key => storage.delete(key),
    },
    localStorage: { removeItem: key => removedKeys.push(key) },
  };
  class Component {
    setState(update) {
      const patch = typeof update === "function" ? update(this.state) : update;
      if (patch) this.state = { ...this.state, ...patch };
    }
  }
  const module = { exports: {} };
  new vm.Script(compiled).runInNewContext({
    module, exports: module.exports, __DEV__: false, setTimeout, clearTimeout, window: browserWindow,
    require(name) {
      if (name === "react") return { Component };
      if (name === "react-native") return { StyleSheet: { create: value => value }, Platform: { OS: platform } };
      if (name === "../lib/lazyWithRetry") return lazyRecovery;
      if (name === "../theme") return { colors: {}, radius: {} };
      if (name === "../lib/diagnostics") return { captureAppError: () => ({ code: "PIT-APP-001", requestId: "local-reference" }) };
      if (name === "../lib/clientCrashReporter") return { reportClientCrash: (value) => {
        calls.push(value);
        return new Promise(resolve => pending.push(resolve));
      } };
      if (name === "react/jsx-runtime") return {};
      throw new Error("Unexpected test import: " + name);
    },
  });
  const Boundary = module.exports.default, boundary = new Boundary();
  const crash = (error) => {
    boundary.setState(Boundary.getDerivedStateFromError(error));
    boundary.componentDidCatch(error, {});
  };
  return { boundary, calls, pending, crash, browserWindow, reloadCount: () => reloads, removedKeys };
}

test("the recovery screen receives the server reference for its actual crash", async () => {
  const f = fixture(), error = new TypeError("private data is never sent as text");
  f.crash(error);
  assert.equal(f.calls[0].error, error);
  assert.equal(f.calls[0].kind, "render");
  f.pending[0]({ ok: true, requestId: "123e4567-e89b-42d3-a456-426614174000" });
  await Promise.resolve();
  assert.equal(f.boundary.state.appError.requestId, "123e4567-e89b-42d3-a456-426614174000");
});

test("a delayed crash report cannot overwrite a later crash after retry", async () => {
  const f = fixture();
  f.crash(new Error("first"));
  f.boundary.retry();
  const currentError = new Error("second");
  f.crash(currentError);
  f.pending[0]({ ok: true, requestId: "old-reference" });
  await Promise.resolve();
  assert.equal(f.boundary.state.appError.requestId, "local-reference");
  assert.equal(f.boundary.state.error, currentError);
  f.pending[1]({ ok: true, requestId: "new-reference" });
  await Promise.resolve();
  assert.equal(f.boundary.state.appError.requestId, "new-reference");
});

test("report completion cannot set state after unmount", async () => {
  const f = fixture();
  f.crash(new Error("first"));
  f.boundary.componentWillUnmount();
  f.boundary.setState = () => assert.fail("unmounted boundary received a state update");
  f.pending[0]({ ok: true, requestId: "server-reference" });
  await Promise.resolve();
});

test("failed telemetry does not hide the recovery screen or its local reference", async () => {
  const f = fixture(), error = new Error("first");
  f.crash(error);
  f.pending[0](false);
  await Promise.resolve();
  assert.equal(f.boundary.state.error, error);
  assert.equal(f.boundary.state.appError.requestId, "local-reference");
});

async function resolveLazyScreen(Screen) {
  try { return Screen._init(Screen._payload); }
  catch (pending) {
    if (!pending || typeof pending.then !== "function") throw pending;
    await pending;
    return Screen._init(Screen._payload);
  }
}

test("web Try again reloads the document after React caches a rejected dynamic chunk", async () => {
  const f = fixture();
  const previousWindow = globalThis.window, previousFetch = globalThis.fetch;
  const failure = Object.assign(new Error("Loading module http://localhost/_expo/static/js/web/SyntheticNewsRail-old.js failed.\n(error: http://localhost/_expo/static/js/web/SyntheticNewsRail-old.js)"), { name: "AsyncRequireError" });
  let failed = true, imports = 0;
  const recoveredPanel = () => null;
  const factory = async () => {
    imports++;
    if (failed) throw failure;
    return { default: recoveredPanel };
  };
  globalThis.window = f.browserWindow;
  globalThis.fetch = async () => { throw new TypeError("synthetic probe offline"); };
  try {
    const Panel = lazyRecovery.lazyWithRetry(factory, "SyntheticNewsRail");
    await assert.rejects(() => resolveLazyScreen(Panel), error => error === failure);
    assert.equal(imports, 2);
    f.crash(failure);
    assert.equal(f.reloadCount(), 0, "an unconfirmed network failure must not reload automatically");
    failed = false;
    await assert.rejects(() => resolveLazyScreen(Panel), error => error === failure);
    assert.equal(imports, 2, "React retains the rejection after the connection recovers");

    f.boundary.retry();
    assert.equal(f.reloadCount(), 1, "explicit Try again requests a fresh document");
    assert.equal(f.boundary.state.error, failure, "keep the recovery screen until navigation completes");
    assert.deepEqual(f.removedKeys, [], "chunk recovery must not reset local account data");
    // A fresh document recreates the module-scoped lazy component.
    const FreshPanel = lazyRecovery.lazyWithRetry(factory, "SyntheticNewsRail");
    assert.equal(await resolveLazyScreen(FreshPanel), recoveredPanel);
    assert.equal(imports, 3);
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
    globalThis.fetch = previousFetch;
  }
});

test("explicit web retry recognizes stale and browser dynamic-import errors", () => {
  const errors = [
    Object.assign(new Error("missing chunk"), { name: "ChunkLoadError" }),
    new Error("Loading chunk 7 failed"),
    new Error('Requiring unknown module "624".'),
    new TypeError("Failed to fetch dynamically imported module: http://localhost/old.js"),
    new TypeError("Importing a module script failed."),
    new TypeError("error loading dynamically imported module"),
  ];
  for (const error of errors) {
    const f = fixture();
    f.crash(error);
    assert.equal(f.reloadCount(), 0);
    f.boundary.retry();
    assert.equal(f.reloadCount(), 1, error.message);
    assert.equal(f.boundary.state.error, error);
    assert.deepEqual(f.removedKeys, []);
  }
});

test("ordinary web render and generic network errors still retry without a document reload", () => {
  for (const error of [new Error("row render failed"), new TypeError("Failed to fetch"), new Error("404 while rendering a row")]) {
    const f = fixture();
    f.crash(error);
    f.boundary.retry();
    assert.equal(f.reloadCount(), 0);
    assert.equal(f.boundary.state.error, null);
    assert.deepEqual(f.removedKeys, []);
  }
});

test("native chunk failures retain the existing boundary retry behavior", () => {
  for (const platform of ["android", "ios"]) {
    const f = fixture({ platform });
    f.crash(Object.assign(new Error("Loading module synthetic.js failed."), { name: "AsyncRequireError" }));
    f.boundary.retry();
    assert.equal(f.reloadCount(), 0);
    assert.equal(f.boundary.state.error, null);
    assert.deepEqual(f.removedKeys, []);
  }
});
