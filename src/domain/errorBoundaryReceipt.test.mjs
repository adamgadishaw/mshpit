import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import test from "node:test";

const require = createRequire(import.meta.url);
const { transformSync } = require("@babel/core");
const filename = new URL("../components/ErrorBoundary.jsx", import.meta.url);
const compiled = transformSync(readFileSync(filename, "utf8"), {
  filename: filename.pathname, babelrc: false, configFile: false,
  plugins: [[require("@babel/plugin-transform-react-jsx"), { runtime: "automatic" }], require("@babel/plugin-transform-modules-commonjs")],
}).code;

function fixture() {
  const calls = [], pending = [];
  class Component {
    setState(update) {
      const patch = typeof update === "function" ? update(this.state) : update;
      if (patch) this.state = { ...this.state, ...patch };
    }
  }
  const module = { exports: {} };
  new vm.Script(compiled).runInNewContext({
    module, exports: module.exports, __DEV__: false, setTimeout, clearTimeout,
    require(name) {
      if (name === "react") return { Component };
      if (name === "react-native") return { StyleSheet: { create: value => value }, Platform: { OS: "web" } };
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
  return { boundary, calls, pending, crash };
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
