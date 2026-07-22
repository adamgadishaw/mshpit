import assert from "node:assert/strict";
import test from "node:test";

import { toIsoDate, isValidDate, formatDate, todayIso } from "./dates.mjs";

test("every stored date shape in the wild collapses to one ISO identity", () => {
  // The formats actually found in the database: ISO, the DatePicker's display
  // form, provider payloads, and the mangled row that forked The Fillmore.
  for (const value of ["2026-06-21", "2026 · 06 · 21", "2026 � 06 � 21", "2026/06/21", "2026.6.21", "  2026-6-21  "]) {
    assert.equal(toIsoDate(value), "2026-06-21", `expected ${JSON.stringify(value)} to canonicalize`);
  }
});

test("a date that is not a real calendar day is refused, never guessed", () => {
  for (const value of [
    "2026-02-31", // rolls over to March
    "2026-13-01",
    "2026-00-10",
    "2026-06-00",
    "0219-06-21", // mistyped year
    "tomorrow night",
    "2026",
    "",
    null,
    undefined,
    {},
  ]) {
    assert.equal(toIsoDate(value), "", `expected ${JSON.stringify(value)} to be refused`);
    assert.equal(isValidDate(value), false);
  }
});

test("leap days are real dates and are kept", () => {
  assert.equal(toIsoDate("2028 · 02 · 29"), "2028-02-29");
  assert.equal(toIsoDate("2027-02-29"), ""); // 2027 is not a leap year
});

test("display formatting keeps the existing look and never shows mojibake", () => {
  assert.equal(formatDate("2026-06-21"), "2026 · 06 · 21");
  assert.equal(formatDate("2026 � 06 � 21"), "2026 · 06 · 21");
  assert.equal(formatDate("", "TBA"), "TBA");
  assert.equal(formatDate("not a date", "TBA"), "TBA");
});

test("today uses local calendar components, so a late-night log is not tomorrow", () => {
  const lateNight = new Date(2026, 5, 21, 23, 30);
  assert.equal(todayIso(lateNight), "2026-06-21");
  assert.match(todayIso(), /^\d{4}-\d{2}-\d{2}$/);
});

test("canonicalizing is idempotent, so re-running the migration cannot drift", () => {
  const once = toIsoDate("2026 · 06 · 21");
  assert.equal(toIsoDate(once), once);
  assert.equal(toIsoDate(formatDate(once)), once);
});
