import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { formatErrorOccurrenceTime } from "./errorDiagnostics.mjs";

test("error occurrence times include a stable date, precise time, and explicit timezone", () => {
  assert.equal(formatErrorOccurrenceTime(Date.UTC(2026, 8, 9, 19, 1, 2, 123)), "2026-09-09 19:01:02.123 UTC");
  assert.equal(formatErrorOccurrenceTime(0), "1970-01-01 00:00:00.000 UTC");
  for (const missing of [null, undefined, "", "2026-09-09", NaN, Infinity, -1, 1e20, {}, Symbol("missing")]) {
    assert.equal(formatErrorOccurrenceTime(missing), "");
  }
});

test("moderation distinguishes retained totals and exposes untruncated, selectable trace details", () => {
  const screen = readFileSync(new URL("../screens/AdminScreen.jsx", import.meta.url), "utf8");
  const start = screen.indexOf("(errorLog.errors || []).slice(0, 8).map");
  const end = screen.indexOf("<View style={styles.errActions}>", start);
  assert.ok(start >= 0 && end > start, "keep the diagnostic list bounded to eight rows");
  const rows = screen.slice(start, end);
  assert.match(rows, /\{e\.count\} retained total/);
  assert.match(rows, /\{e\.method\} \{e\.route/);
  assert.match(rows, /e\.cause/);
  assert.match(rows, /Last occurred: \{formatErrorOccurrenceTime\(e\.lastSeen\)/);
  assert.match(rows, /<Text selectable style=\{styles\.errRow\}>Request ID: \{e\.lastRequestId\}/);
  assert.doesNotMatch(rows, /numberOfLines|ellipsizeMode/);
  assert.match(screen, /Retained totals below include older occurrences, not just the last 24 hours/);
  assert.match(screen, /Current release: \{health\.commit\} \(error releases are not recorded\)/);
});
