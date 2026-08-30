import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const { transformSync } = require("@babel/core");
const transformJsx = require("@babel/plugin-transform-react-jsx");
const transformModules = require("@babel/plugin-transform-modules-commonjs");
const filename = new URL("../screens/ArtistScreen.jsx", import.meta.url);

function dependencyStub() {
  let callable;
  callable = new Proxy(function stubbedDependency() { return 0; }, {
    get(_target, property) {
      if (property === Symbol.toPrimitive) return () => "";
      return callable;
    },
  });
  const colors = new Proxy({}, { get: () => "#000" });
  return new Proxy({}, {
    get(_target, property) {
      if (property === "__esModule") return true;
      if (property === "StyleSheet") return { create: (styles) => styles, absoluteFill: {} };
      if (property === "colors") return colors;
      if (property === "space") return () => 0;
      if (property === "default") return callable;
      return callable;
    },
  });
}

test("ArtistScreen evaluates its module-level styles without unbound runtime tokens", () => {
  const source = readFileSync(filename, "utf8");
  const compiled = transformSync(source, {
    filename: filename.pathname,
    babelrc: false,
    configFile: false,
    sourceType: "module",
    retainLines: true,
    plugins: [
      [transformJsx, { runtime: "classic" }],
      transformModules,
    ],
  })?.code;
  assert.ok(compiled, "ArtistScreen must compile for focused module evaluation");

  const module = { exports: {} };
  assert.doesNotThrow(() => new vm.Script(compiled, { filename: filename.pathname }).runInNewContext({
    module,
    exports: module.exports,
    require: dependencyStub,
    __DEV__: false,
    console,
    setTimeout,
    clearTimeout,
    AbortController,
  }));
});
