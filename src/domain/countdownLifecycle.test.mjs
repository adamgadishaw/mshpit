import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../components/Countdown.jsx", import.meta.url), "utf8");

test("the shared concert countdown stops waking the profile after reaching zero", () => {
  assert.match(source, /if \(!active \|\| target == null\) return undefined/);
  assert.match(source, /const currentTime = Date\.now\(\)/);
  assert.match(source, /if \(notifyIfComplete\(currentTime\)\) return undefined/);
  assert.match(source, /if \(notifyIfComplete\(tickTime\)\) clearInterval\(id\)/);
  assert.match(source, /\}, \[active, target\]\)/);
});

test("the shared countdown reports completion once without coupling the timer to callback identity", () => {
  assert.match(source, /const onCompleteRef = useRef\(onComplete\)/);
  assert.match(source, /onCompleteRef\.current = onComplete/);
  assert.match(source, /completedTargetRef\.current === target/);
  assert.match(source, /completedTargetRef\.current = target/);
  assert.match(source, /onCompleteRef\.current\?\.\(\)/);
  assert.doesNotMatch(source, /\[active, target, onComplete\]/);
});
