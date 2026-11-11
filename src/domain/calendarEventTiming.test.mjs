import test from "node:test";
import assert from "node:assert/strict";
import { calendarEventTiming } from "./calendarEventTiming.mjs";

test("explicit offsets and venue dates are independent of viewer timezone", () => {
  const timing = calendarEventTiming({ date: "2026-11-10", startDateTime: "2026-11-10T23:30:00-08:00", eventTimezone: "America/Los_Angeles" });
  assert.equal(timing.date, "2026-11-10");
  assert.equal(timing.startAt, "2026-11-11T07:30:00.000Z");
  assert.equal(timing.startLocalTime, "23:30:00");
  assert.equal(timing.status, "timed");
});

test("venue wall time resolves across DST and fractional timezone offsets", () => {
  const cases = [
    ["2026-01-10", "America/New_York", "19:30", "2026-01-11T00:30:00.000Z"],
    ["2026-07-10", "America/New_York", "19:30", "2026-07-10T23:30:00.000Z"],
    ["2026-07-10", "Asia/Kathmandu", "19:30", "2026-07-10T13:45:00.000Z"],
    ["2026-04-05", "Australia/Lord_Howe", "03:00", "2026-04-04T16:30:00.000Z"],
  ];
  for (const [date, eventTimezone, startLocalTime, expected] of cases) {
    assert.equal(calendarEventTiming({ date, eventTimezone, startLocalTime }).startAt, expected);
  }
});

test("DST gaps and repeated clocks remain unconfirmed unless an absolute offset disambiguates", () => {
  for (const [date, startLocalTime] of [["2026-03-08", "02:30"], ["2026-11-01", "01:30"]]) {
    const timing = calendarEventTiming({ date, startLocalTime, eventTimezone: "America/New_York" });
    assert.equal(timing.startAt, null);
    assert.equal(timing.status, "unresolved");
  }
  assert.equal(calendarEventTiming({ date: "2026-11-01", startDateTime: "2026-11-01T01:30:00-05:00", eventTimezone: "America/New_York" }).startAt, "2026-11-01T06:30:00.000Z");
});

test("unknown timezone, invalid clock and access time cannot fabricate a show start", () => {
  for (const event of [
    { startLocalTime: "19:00" },
    { startLocalTime: "19:00", eventTimezone: "Not/AZone" },
    { startLocalTime: "25:00", eventTimezone: "Europe/London" },
    { startDateTime: "2026-11-10T19:00:00" },
    { startDateTime: "2026-02-30T19:00:00Z" },
  ]) {
    const timing = calendarEventTiming({ date: "2026-11-10", ...event });
    assert.equal(timing.startAt, null);
    assert.equal(timing.status, "unresolved");
  }
  assert.equal(calendarEventTiming({ date: "2026-11-10", doorsAt: "2026-11-10T18:00:00Z", accessStartDateTime: "2026-11-10T18:00:00Z" }).status, "unknown");
});

test("only a real later end becomes a timed duration; malformed spans remain bounded", () => {
  const event = { date: "2026-11-10", startDateTime: "2026-11-10T19:00:00Z" };
  assert.equal(calendarEventTiming(event).endAt, null);
  assert.equal(calendarEventTiming({ ...event, endDateTime: "2026-11-10T18:00:00Z" }).endAt, null);
  assert.equal(calendarEventTiming({ ...event, endDateTime: "2026-11-10T21:00:00Z" }).endAt, "2026-11-10T21:00:00.000Z");
  assert.equal(calendarEventTiming({ ...event, eventEndDate: "2028-11-10" }).endDate, event.date);
});

test("epoch sentinels and stale absolute dates do not become show starts", () => {
  for (const startAt of [0, 1, new Date("1970-01-01T00:00:00Z")]) {
    assert.equal(calendarEventTiming({ date: "2026-11-10", startAt }).startAt, null);
  }
  const mismatch = calendarEventTiming({ date: "2026-11-12", startDateTime: "2026-11-10T19:00:00Z", startLocalTime: "19:00", eventTimezone: "Europe/London" });
  assert.equal(mismatch.startAt, null);
  assert.equal(mismatch.status, "unresolved");
  const offset = calendarEventTiming({ date: "2026-11-10", startDateTime: "2026-11-10T19:30:00+01:00" });
  assert.equal(offset.startLabel, "7:30 PM (UTC+01:00)");
  assert.equal(offset.startLocalTime, null, "an offset timestamp is not proof of the venue timezone");
  assert.equal(calendarEventTiming({ date: "2026-11-10", startDateTime: "2026-11-10T19:30:00Z" }).startLabel, "7:30 PM (UTC)");
});

test("an inconsistent end timestamp cannot shorten a festival's declared date span", () => {
  const timing = calendarEventTiming({ date: "2026-11-10", eventEndDate: "2026-11-12", startDateTime: "2026-11-10T19:00:00Z", endDateTime: "2026-11-10T21:00:00Z" });
  assert.equal(timing.endDate, "2026-11-12");
  assert.equal(timing.endAt, null);
});
