import test from "node:test";
import assert from "node:assert/strict";
import { calendarReadDate } from "./calendarDates.mjs";
import { toIsoDate } from "./dates.mjs";
import { memberCalendarModel } from "./calendarShows.mjs";
import { calendarEventTiming } from "./calendarEventTiming.mjs";
import { buildCalendarDocument } from "./calendarExport.mjs";

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

test("far-future calendar rows and identities retain their separate real dates", () => {
  for (const year of [2029, 2100]) {
    const event = { artist: "Band", venue: "Hall", city: "London", eventTimezone: "Europe/London" };
    const model = memberCalendarModel({ today: `${year}-11-01`, upcoming: [
      { ...event, date: `${year}-11-20`, startLocalTime: "19:00" },
      { ...event, date: `${year}-11-21`, startLocalTime: "19:00" },
      { ...event, date: `${year}-02-31` },
    ] });
    assert.equal(model.today, `${year}-11-01`);
    assert.equal(model.upcoming.length, 2);
    assert.notEqual(model.upcoming[0].calendarKey, model.upcoming[1].calendarKey);
    assert.deepEqual(Object.keys(model.byDay.upcoming), [`${year}-11-20`, `${year}-11-21`]);
    const document = buildCalendarDocument(model.upcoming, { now: "2026-11-11T12:00:00Z" });
    assert.match(document, new RegExp(`DTSTART:${year}1120T190000Z`));
    assert.match(document, new RegExp(`DTSTART:${year}1121T190000Z`));
  }
});

test("boundary venue dates retain valid UTC instants outside the selectable date range", () => {
  const late = { artist: "Band", date: "2100-12-31", startDateTime: "2101-01-01T07:30:00Z", eventTimezone: "America/Los_Angeles" };
  assert.equal(calendarEventTiming(late).startAt, "2101-01-01T07:30:00.000Z");
  assert.match(buildCalendarDocument(late), /DTSTART:21010101T073000Z/);
  const early = { artist: "Band", date: "1900-01-01", startDateTime: "1900-01-01T08:00:00Z" };
  assert.equal(calendarEventTiming({ ...early, startDateTime: undefined, startAt: Date.parse(early.startDateTime) }).startAt, "1900-01-01T08:00:00.000Z");
});
