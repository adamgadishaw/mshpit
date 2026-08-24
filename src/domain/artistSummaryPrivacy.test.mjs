import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const storeSource = readFileSync(new URL("../store.js", import.meta.url), "utf8");

test("artist summary drops blocked authors before deriving review aggregates", () => {
  assert.match(
    storeSource,
    /const liveLogs = feed\.filter\(\(l\) => !removedIds\.includes\(l\.id\) && !blockedIds\.includes\(l\.userId\) && norm\(l\.artist\) === key\)/,
  );
});
