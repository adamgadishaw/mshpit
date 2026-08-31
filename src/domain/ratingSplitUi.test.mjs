import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../components/RatingSplit.jsx", import.meta.url), "utf8");

test("legacy missing rating dimensions render as unsaved instead of a false zero", () => {
  assert.match(source, /Number\.isFinite\(score\) && score > 0/);
  assert.match(source, /saved \? score\.toFixed\(1\) : "—"/);
  assert.match(source, /saved \? \(score \/ 5\) \* 100 : 0/);
});
