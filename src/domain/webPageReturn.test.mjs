import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { transformSync } from "@babel/core";
import * as pageReturn from "./pageReturn.mjs";
import * as webPull from "./webPullRefresh.mjs";

const require = createRequire(import.meta.url);
const code = transformSync(readFileSync(new URL("../components/VinylRefreshBoundary.web.jsx", import.meta.url), "utf8"), {
  filename: "VinylRefreshBoundary.web.jsx", configFile: false, babelrc: false,
  plugins: [[require("@babel/plugin-transform-react-jsx"), { runtime: "automatic" }], require("@babel/plugin-transform-modules-commonjs")],
}).code;

function desktopFixture(onRefresh) {
  const controller = pageReturn.createPageReturnController();
  controller.activate("desktop");
  const page = { register: (handler) => controller.register("desktop", handler) };
  const effects = [], refs = []; let cursor = 0;
  const jsx = (type, props) => ({ type, props });
  const dependencies = {
    react: {
      Children: { only: (child) => child }, cloneElement: (child, props) => ({ ...child, props: { ...child.props, ...props } }),
      useRef: (initial) => refs[cursor++] ||= { current: initial }, useCallback: (fn) => fn,
      useEffect: (fn) => { const cleanup = fn(); if (cleanup) effects.push(cleanup); },
      useState: (initial) => [typeof initial === "function" ? initial() : initial, () => {}],
    },
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "react-native": { Text: "Text", View: "View", StyleSheet: { create: (value) => value } },
    "./PageReturnContext": { usePageReturn: () => page },
    "../hooks/useReducedMotion": () => true,
    "../domain/pageReturn.mjs": pageReturn,
    "../domain/webPullRefresh.mjs": webPull,
    "../theme": { colors: {}, radius: {}, shadow: {}, themeIsDark: false },
  };
  const module = { exports: {} };
  new Function("require", "module", "exports", code)((name) => dependencies[name] || require(name), module, module.exports);
  let assigned;
  const child = { type: "FlatList", props: { ref: (value) => assigned = value, onScroll: () => {}, data: [{ id: "original" }] } };
  const tree = module.exports.default({ children: child, onRefresh });
  const scrolls = [];
  const target = { scrollToOffset: (options) => scrolls.push(options) };
  tree.props.ref(target);
  assert.equal(assigned, target, "the existing list ref must still receive the real scroll owner");
  assert.equal(tree.props.onScroll, child.props.onScroll);
  assert.equal(tree.props.data, child.props.data);
  assert.equal(tree.props.dataSet, undefined, "desktop does not install phone pull listeners or markers");
  return { request: () => controller.request("desktop"), scrolls, close: () => effects.splice(0).forEach((cleanup) => cleanup()) };
}

test("desktop title/tab returns scroll and refresh without requiring a touch phone", async () => {
  let reads = 0, resolve;
  const fixture = desktopFixture(() => { reads++; return new Promise((done) => resolve = done); });
  fixture.request(); fixture.request();
  assert.equal(reads, 1); assert.equal(fixture.scrolls.length, 2);
  resolve(); await new Promise(setImmediate);
  fixture.request(); assert.equal(reads, 2); resolve();
  fixture.close(); assert.equal(fixture.request(), false);
});

test("desktop page-return consumes failed refreshes and allows a truthful retry", async () => {
  let reads = 0;
  const fixture = desktopFixture(() => { reads++; return Promise.reject(Error("synthetic failed read")); });
  fixture.request(); await new Promise(setImmediate);
  fixture.request(); await new Promise(setImmediate);
  assert.equal(reads, 2); assert.equal(fixture.scrolls.length, 2); fixture.close();
});
