import test from "node:test";
import assert from "node:assert/strict";
import { calendarReadDate } from "./calendarDates.mjs";
import { toIsoDate } from "./dates.mjs";

test("calendar read dates span 1900–2100 without broadening canonical writes", () => {
  assert.equal(calendarReadDate("1900-01-01"), "1900-01-01");
  assert.equal(calendarReadDate("2100 · 12 · 31"), "2100-12-31");
  assert.equal(calendarReadDate("2029/11/20"), "2029-11-20");
  assert.equal(toIsoDate(`${new Date().getFullYear() + 3}-11-20`), "", "composer write horizon is unchanged");
  for (const value of ["1899-12-31", "2101-01-01", "2029-02-31", "1900-02-29", "2100-02-29", "2029-13-01", "2029-00-01"]) {
    assert.equal(calendarReadDate(value), "", value);
  }
  assert.equal(calendarReadDate("2000-02-29"), "2000-02-29");
});
