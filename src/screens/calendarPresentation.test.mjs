import assert from "node:assert/strict";
import test from "node:test";
import { calendarAgendaGroups, calendarDateLabel, calendarDaysForScope, calendarJumpSelection, calendarMonthCount, calendarMonthGeometry, calendarMonthLabel, calendarMonthSelection, calendarShowName, calendarShowStatus, calendarTimeLabel, calendarPlaceLabel, calendarArtistSubtitle, calendarDayAvailability } from "./calendarPresentation.mjs";

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
  assert.equal(calendarJumpSelection("2050", 1, "2049-01-31").selected, "2050-02-28");
  assert.equal(calendarMonthSelection({ y: 2050, m: 0 }, 1, "2050-01-31").selected, "2050-02-28");
  assert.equal(calendarDateLabel("2050-01-31", { year: "numeric" }, "en-US"), "Monday, January 31, 2050");
  assert.equal(calendarDateLabel("2050-02-31"), "Date unavailable");
});
test("month geometry keeps every date once and seven adequate targets with either week start", () => {
  for (const width of [320, 390, 768]) for (const fontScale of [1, 1.2, 2, 3.1]) for (const weekStart of [0, 1]) {
    for (let m = 0; m < 12; m++) {
      const grid = calendarMonthGeometry({ y: 2028, m, width, fontScale, weekStart, locale: "en-GB" });
      assert.ok([28, 35, 42].includes(grid.cells.length));
      assert.ok(grid.cells.slice(-7).some(Boolean), "no entirely blank final week");
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

test("agenda paging reaches every loaded performance past 2000 with meaningful remaining counts", () => {
  const rows = Array.from({ length: 2041 }, (_, i) => ({ calendarKey: `show-${i}` }));
  const days = { "2028-01-31": rows.slice(0, 2001), "2028-02-01": rows.slice(2001) };
  for (let limit = 40; limit <= 2080; limit += 40) {
    const page = calendarAgendaGroups(days, { selected: "2028-01-31", limit });
    assert.equal(page.count, Math.min(limit, rows.length));
    assert.equal(page.remaining, Math.max(0, rows.length - limit));
    assert.deepEqual(page.groups.flatMap(g => g.events), rows.slice(0, limit));
  }
  for (const limit of [NaN, Infinity, -1, 0, 40.5, "80"]) assert.equal(calendarAgendaGroups(days, { selected: "2028-01-31", limit }).count, 40);
});

test("localized month and full dates retain Gregorian grid identity in non-Gregorian locales", () => {
  for (const locale of ["th-TH", "ar-SA", "fa-IR", "en-US-u-ca-hebrew"]) {
    const date = new Date(2028, 0, 31, 12);
    assert.equal(calendarDateLabel("2028-01-31", { year: "numeric" }, locale),
      new Intl.DateTimeFormat(locale, { weekday: "long", month: "long", day: "numeric", year: "numeric", calendar: "gregory" }).format(date));
    assert.equal(calendarMonthLabel(2028, 0, locale),
      new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", calendar: "gregory" }).format(date));
    assert.equal(calendarMonthLabel(2028, 0, locale, false),
      new Intl.DateTimeFormat(locale, { month: "long", calendar: "gregory" }).format(date));
  }
});

test("spoken show identity includes the visible event and distinct artist without repetition", () => {
  assert.equal(calendarShowName({ eventName: "Festival", artist: "Headliner" }), "Festival, Headliner");
  assert.equal(calendarShowName({ eventName: "Festival" }), "Festival");
  assert.equal(calendarShowName({ eventName: "Headliner", artist: "Headliner" }), "Headliner");
});

test("display locations abbreviate long country names without losing city or region", () => {
  const event = { city: "San Antonio, Texas, United States Of America", country: "United States" };
  assert.equal(calendarPlaceLabel(event), "San Antonio, Texas, US");
  assert.equal(event.city, "San Antonio, Texas, United States Of America");
  assert.equal(calendarPlaceLabel({ city: "Springfield, Illinois", country: "United States" }), "Springfield, Illinois, US");
  assert.equal(calendarPlaceLabel({ city: "Paris", country: "France" }), "Paris, France");
  assert.equal(calendarArtistSubtitle({ eventName: "Periphery - A Pale White Dot US Tour", artist: "Periphery" }), "");
  assert.equal(calendarArtistSubtitle({ eventName: "Winter Festival", artist: "Headliner" }), "Headliner");
});

test("spoken counts distinguish loaded, complete, present-but-unloaded and unknown dates", () => {
  assert.equal(calendarDayAvailability(313, { publicShows: true }), "313 loaded shows");
  assert.equal(calendarDayAvailability(1, { publicShows: true, complete: true }), "1 show");
  assert.equal(calendarDayAvailability(0, { publicShows: true, presence: true }), "Shows listed, count not loaded");
  assert.equal(calendarDayAvailability(0, { publicShows: true }), "Availability not loaded");
  assert.equal(calendarDayAvailability(0, { publicShows: true, presence: false }), "0 shows listed");
});
