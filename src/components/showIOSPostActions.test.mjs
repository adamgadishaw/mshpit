import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { transformSync } from "@babel/core";
import showIOSPostActions from "./showIOSPostActions.js";

const require = createRequire(import.meta.url);
const read = name => readFileSync(new URL(name, import.meta.url), "utf8");

test("shared post card and default bridge never import the React Native Web root", () => {
  for (const filename of ["TicketStub.jsx", "showIOSPostActions.js"]) {
    const source = read(filename);
    assert.doesNotMatch(source, /import\s*\{[^}]*ActionSheetIOS[^}]*\}\s*from\s*["']react-native["']/);
    const { code } = transformSync(source, {
      filename, babelrc: false, configFile: false,
      presets: [require.resolve("babel-preset-expo")],
      caller: { name: "metro", platform: "web", isDev: false, isServer: false, bundler: "metro", supportsStaticESM: true },
    });
    assert.doesNotMatch(code, /["']react-native-web(?:\/dist(?:\/index)?)?["']/,
      `${filename} must preserve leaf imports rather than pull all RNW controls`);
  }
  assert.equal(showIOSPostActions({}, () => assert.fail("non-iOS bridge must not invoke actions")), undefined);
});

test("iOS bridge forwards the exact native options and selection owner", () => {
  const source = read("showIOSPostActions.ios.js");
  const { code } = transformSync(source, { babelrc: false, configFile: false,
    plugins: [require("@babel/plugin-transform-modules-commonjs")],
  });
  const calls = [], module = { exports: {} };
  new Function("require", "module", "exports", code)(name => {
    assert.equal(name, "react-native");
    return { ActionSheetIOS: { showActionSheetWithOptions: (...args) => calls.push(args) } };
  }, module, module.exports);
  const options = { options: ["Report post", "Cancel"], cancelButtonIndex: 1 }, select = () => {};
  module.exports.default(options, select);
  assert.deepEqual(calls, [[options, select]]);
});
