import assert from "node:assert/strict";
import test from "node:test";

import { showDateMs } from "./showTime.js";

test("showDateMs preserves an explicit provider start instead of inventing 8pm", () => {
  assert.equal(showDateMs("2032-05-10T23:30:00.000Z"), Date.parse("2032-05-10T23:30:00.000Z"));
  assert.equal(showDateMs("2032-05-10T19:30:00"), Date.parse("2032-05-10T19:30:00"));
});

test("showDateMs keeps 8pm only as a legacy date-only fallback", () => {
  const value = new Date(showDateMs("2032-05-10"));
  assert.equal(value.getFullYear(), 2032);
  assert.equal(value.getMonth(), 4);
  assert.equal(value.getDate(), 10);
  assert.equal(value.getHours(), 20);
  assert.equal(value.getMinutes(), 0);
  assert.equal(showDateMs("not a date"), null);
});
