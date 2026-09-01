import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const storeSource = readFileSync(new URL("../store.js", import.meta.url), "utf8");

test("artist summary drops blocked authors before deriving review aggregates", () => {
  assert.match(
    storeSource,
    /const liveLogs = feed\.filter\(\(l\) => isInPersonConcertReview\(l\)[\s\S]*?!removedIds\.includes\(l\.id\)[\s\S]*?!blockedIds\.includes\(l\.userId\)[\s\S]*?norm\(l\.artist\) === key\)/,
  );
});
