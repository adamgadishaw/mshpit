import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../components/Countdown.jsx", import.meta.url), "utf8");

test("the shared concert countdown stops waking the profile after reaching zero", () => {
  assert.match(source, /if \(!active \|\| target == null\) return undefined/);
  assert.match(source, /if \(target - Date\.now\(\) <= 0\) return undefined/);
  assert.match(source, /const currentTime = Date\.now\(\)/);
  assert.match(source, /if \(currentTime >= target\) clearInterval\(id\)/);
  assert.match(source, /\}, \[active, target\]\)/);
});
