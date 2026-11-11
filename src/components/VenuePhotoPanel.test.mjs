import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { transformSync } from "@babel/core";
import { venuePhotoFrameHeight } from "./venuePhotoFrame.mjs";

const require = createRequire(import.meta.url);
const compiled = transformSync(readFileSync(new URL("./VenuePhotoPanel.web.jsx", import.meta.url), "utf8"), {
  filename: "VenuePhotoPanel.web.jsx", babelrc: false, configFile: false,
  plugins: [[require("@babel/plugin-transform-react-jsx"), { runtime: "automatic" }], require("@babel/plugin-transform-modules-commonjs")],
}).code;
const jsx = (type, props) => ({ type, props });
function fixture() {
  const loads = [];
  const modules = {
    react: { Component: class { constructor(props) { this.props = props; } setState(next) { this.state = { ...this.state, ...next }; } }, Suspense: "Suspense", lazy: load => { const renderer = { load }; loads.push(renderer); return renderer; } },
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "react-native": { ActivityIndicator: "ActivityIndicator", Pressable: "Pressable", Text: "Text", View: "View", StyleSheet: { create: x => x }, useWindowDimensions: () => ({ width: 900 }) },
    "../theme": { colors: {}, focusRing: {} },
    "../lib/lazyWithRetry": { loadChunk: () => { throw Error("Rendering must not start a background import"); } },
    "./venuePhotoFrame.mjs": { venuePhotoFrameHeight },
  };
  const module = { exports: {} };
  new Function("require", "module", "exports", compiled)(name => { assert.ok(name in modules, name); return modules[name]; }, module, module.exports);
  const view = module.exports.default({ venueName: "Old venue", photos: [{ uri: "old" }], compact: true });
  return { boundary: new view.type(view.props), loads };
}

test("optional photo failure and explicit retry stay in the reserved frame and use latest props", () => {
  const { boundary, loads } = fixture();
  const initial = boundary.render();
  assert.equal(initial.type, "Suspense");
  assert.equal(initial.props.fallback.props.style[1].height, 214);
  boundary.setState(boundary.constructor.getDerivedStateFromError(new Error("private transport detail")));
  const failed = boundary.render();
  assert.equal(failed.type, "View");
  assert.equal(failed.props.style[1].height, 214);
  assert.doesNotMatch(JSON.stringify(failed), /private transport detail|old/);
  const retry = failed.props.children[1];
  assert.equal(retry.props.accessibilityRole, "button");
  boundary.props = { height: 190, panelProps: { venueName: "Current venue", photos: [{ uri: "current" }] } };
  retry.props.onPress();
  const restored = boundary.render();
  assert.equal(restored.props.children.type, loads[1], "retry replaces React.lazy's rejected renderer");
  assert.deepEqual(restored.props.children.props, boundary.props.panelProps, "an import cannot capture old photo or account-scoped props");
  assert.equal(restored.props.fallback.props.style[1].height, 190);
});

test("photo placeholder dimensions match existing compact and full responsive frames", () => {
  assert.deepEqual([500, 760, 900, 1180].map(width => venuePhotoFrameHeight(width)), [190, 260, 260, 300]);
  assert.deepEqual([500, 899, 900, 1180].map(width => venuePhotoFrameHeight(width, true)), [180, 180, 214, 214]);
});
