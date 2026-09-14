import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { formatErrorOccurrenceTime, formatErrorObservedHour } from "./errorDiagnostics.mjs";

test("error occurrence times include a stable date, precise time, and explicit timezone", () => {
  assert.equal(formatErrorOccurrenceTime(Date.UTC(2026, 8, 9, 19, 1, 2, 123)), "2026-09-09 19:01:02.123 UTC");
  assert.equal(formatErrorOccurrenceTime(0), "1970-01-01 00:00:00.000 UTC");
  for (const missing of [null, undefined, "", "2026-09-09", NaN, Infinity, -1, 1e20, {}, Symbol("missing")]) {
    assert.equal(formatErrorOccurrenceTime(missing), "");
  }
});

test("hourly aggregation timestamps do not imply a precise occurrence time", () => {
  assert.equal(formatErrorObservedHour(Date.UTC(2026, 8, 14, 12, 33)), "2026-09-14 12:00 UTC (hour bucket)");
  assert.equal(formatErrorObservedHour(null), "");
});

test("moderation distinguishes retained totals and exposes untruncated, selectable trace details", () => {
  const screen = readFileSync(new URL("../screens/AdminScreen.jsx", import.meta.url), "utf8");
  const panel = readFileSync(new URL("../components/moderation/AdminErrorPanel.jsx", import.meta.url), "utf8");
  assert.match(screen, /<AdminErrorPanel\s+key=\{artistRequestScope\}/);
  assert.match(screen, /errorLogState\.owner === diagnosticsOwner/);
  assert.match(panel, /const PAGE_SIZE = 8/);
  assert.match(panel, /const MAX_RETAINED_PATTERNS = 50/);
  assert.match(panel, /\{error\.count\} retained total/);
  assert.match(panel, /Last occurred: \{formatErrorOccurrenceTime\(error\.lastSeen\)/);
  assert.match(panel, /<Text selectable style=\{styles\.row\}>Request ID: \{error\.lastRequestId\}/);
  assert.doesNotMatch(panel, /numberOfLines|ellipsizeMode|error releases are not recorded/);
  assert.match(panel, /Retained totals below include older occurrences, not just the last 24 hours/);
  assert.match(panel, /Captured release: \{error\.detail\.release/);
});
