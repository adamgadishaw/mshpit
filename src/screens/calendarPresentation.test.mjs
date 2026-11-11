import assert from "node:assert/strict";
import test from "node:test";
import { calendarAgendaGroups, calendarDaysForScope, calendarJumpSelection, calendarMonthCount, calendarMonthGeometry, calendarMonthSelection, calendarShowStatus, calendarTimeLabel } from "./calendarPresentation.mjs";

test("month navigation preserves chosen day with explicit end-of-month clamp", () => {
  assert.deepEqual(calendarMonthSelection({ y: 2028, m: 0 }, 1, "2028-01-31"), { cursor: { y: 2028, m: 1 }, selected: "2028-02-29" });
  assert.deepEqual(calendarMonthSelection({ y: 2027, m: 0 }, 1, "2027-01-31"), { cursor: { y: 2027, m: 1 }, selected: "2027-02-28" });
  assert.deepEqual(calendarMonthSelection({ y: 2027, m: 0 }, -1, "2027-01-10"), { cursor: { y: 2026, m: 11 }, selected: "2026-12-10" });
  assert.equal(calendarMonthSelection({ y: 1900, m: 0 }, -1, "1900-01-01"), null);
});
test("jump validation refuses partial or outside-range input without normalizing it into another year", () => {
  for (const year of ["", "20", "2e03", "2026x", "1899", "2101", "NaN"]) assert.equal(calendarJumpSelection(year, 1, "2026-01-31"), null);
  for (const month of [-1, 12, NaN, 1.2]) assert.equal(calendarJumpSelection("2028", month, "2026-01-31"), null);
  assert.equal(calendarJumpSelection("2028", 1, "2026-01-31").selected, "2028-02-29");
});
test("month geometry keeps every date once and seven adequate targets with either week start", () => {
  for (const width of [320, 390, 768]) for (const fontScale of [1, 1.2, 2, 3.1]) for (const weekStart of [0, 1]) {
    for (let m = 0; m < 12; m++) {
      const grid = calendarMonthGeometry({ y: 2028, m, width, fontScale, weekStart, locale: "en-GB" });
      assert.equal(grid.cells.length, 42);
      assert.deepEqual(grid.cells.filter(Boolean), Array.from({ length: new Date(2028, m + 1, 0).getDate() }, (_, i) => i + 1));
      assert.ok(grid.width / 7 >= 44 * fontScale);
      assert.ok(grid.cellHeight >= 44 * fontScale);
      assert.equal(grid.weekdays[0], weekStart ? "Mon" : "Sun");
    }
  }
});
test("scope and bounded agenda preserve exact performance identity across days and history", () => {
  const early = { calendarKey: "early", going: true }, late = { calendarKey: "late", interested: true }, discovery = { calendarKey: "discovery" };
  const days = { "2026-11-10": [early, late, discovery], "2026-11-13": [{ calendarKey: "festival", going: true }], "2026-11-14": [{ calendarKey: "festival", going: true }] };
  const plans = calendarDaysForScope(days, "plans");
  assert.deepEqual(plans["2026-11-10"].map(e => e.calendarKey), ["early", "late"]);
  assert.equal(calendarDaysForScope(days, "all"), days);
  assert.equal(calendarMonthCount(plans, { y: 2026, m: 10 }), 3, "festival counted once in month summary");
  const first = calendarAgendaGroups(plans, { selected: "2026-11-10", limit: 3 });
  assert.deepEqual(first.groups.flatMap(g => g.events.map(e => e.calendarKey)), ["early", "late", "festival"]);
  assert.equal(first.remaining, 1);
  const past = calendarAgendaGroups(plans, { selected: "2026-11-13", view: "past" });
  assert.deepEqual(past.groups.map(g => g.date), ["2026-11-13", "2026-11-10"]);
});
test("time labels preserve venue time, uncertainty and festival continuation", () => {
  const event = { date: "2026-11-13", dayKey: "2026-11-13", endDate: "2026-11-15", calendarTiming: { status: "timed", startAt: "2026-11-13T19:00:00Z", timeZone: "Europe/London" } };
  assert.match(calendarTimeLabel(event, "en-GB"), /19:00/);
  assert.equal(calendarTimeLabel({ ...event, dayKey: "2026-11-14" }), "Continues");
  assert.equal(calendarTimeLabel({ date: "2026-11-10", calendarTiming: { status: "unresolved", startLocalTime: "01:30" } }), "Time unconfirmed");
  assert.equal(calendarTimeLabel({ date: "2026-11-10" }), "Time TBA");
  assert.equal(calendarTimeLabel({ date: "2026-11-10", calendarTiming: { status: "timed", startAt: "2026-11-10T19:00:00Z", timeZone: null, startLabel: "7:00 PM (UTC)" } }), "7:00 PM (UTC)");
  assert.equal(calendarShowStatus({ going: true, eventStatus: "cancelled" }, "upcoming"), "Cancelled");
});
