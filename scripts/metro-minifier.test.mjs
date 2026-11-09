import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL("../", import.meta.url));
const defaults = require("expo/metro-config").getDefaultConfig(root).transformer.minifierConfig;
const actual = require("../metro.config.cjs").transformer.minifierConfig;

test("Metro uses two compression passes without replacing Expo's minifier safety options", () => {
  const { compress: expectedCompress, ...expectedPolicy } = defaults;
  const { compress: actualCompress, ...actualPolicy } = actual;
  assert.deepEqual(actualPolicy, expectedPolicy);
  assert.deepEqual(actualCompress, { ...expectedCompress, passes: 2 });
  assert.equal(actualCompress.reduce_funcs, false);
  assert.equal(actual.mangle.toplevel, false);
  assert.equal(actual.toplevel, false);
});
