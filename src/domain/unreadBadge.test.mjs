import assert from "node:assert/strict";
import test from "node:test";
import { unreadBadgeCount, unreadBadgeText } from "./unreadBadge.mjs";
test("badges hide invalid totals and retain exact integers with a visual 99+ cap", () => {
  for (const value of [null, undefined, -1, NaN, Infinity, "3", 0]) assert.equal(unreadBadgeCount(value), 0);
  for (const count of [1, 3, 99]) assert.equal(unreadBadgeText(count), String(count));
  for (const count of [100, 1234]) { assert.equal(unreadBadgeCount(count), count); assert.equal(unreadBadgeText(count), "99+"); }
  assert.equal(unreadBadgeCount(3.8), 3);
});
