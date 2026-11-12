import assert from "node:assert/strict";
import test from "node:test";
import { eventRsvpWindow, assertEventRsvpAvailable } from "./eventRsvp.mjs";
import { showPresentationModel } from "./showDocument.mjs";
import { writeShowAttendance } from "../features/showSocial/showSocialApi.mjs";

const at = value => Date.parse(value);
const available = (event, now) => eventRsvpWindow(event, at(now)).canPlan;

test("explicit absolute end closes at the exact boundary, including an overnight event", () => {
  const show = { date: "2026-11-12", eventTimezone: "America/Toronto",
    startDateTime: "2026-11-12T23:00:00-05:00", endDateTime: "2026-11-13T03:00:00-05:00" };
  assert.equal(available(show, "2026-11-13T07:59:59.999Z"), true);
  assert.equal(available(show, "2026-11-13T08:00:00Z"), false);
  assert.throws(() => assertEventRsvpAvailable(show, at("2026-11-13T08:00:00Z")), { code: "EVENT_RSVP_CLOSED" });
  assert.equal(available({ endAt: "2026-11-13T08:00:00Z" }, "2026-11-13T08:00:00Z"), false, "end-only evidence is sufficient");
});

test("date-only events use the event's final day, never the viewer's timezone", () => {
  const west = { date: "2026-11-12", eventTimezone: "Pacific/Honolulu" };
  const east = { date: "2026-11-12", eventTimezone: "Pacific/Kiritimati" };
  assert.equal(available(west, "2026-11-13T09:59:59Z"), true);
  assert.equal(available(west, "2026-11-13T10:00:00Z"), false);
  assert.equal(available(east, "2026-11-12T09:59:59Z"), true);
  assert.equal(available(east, "2026-11-12T10:00:00Z"), false);
  for (const eventTimezone of [null, "Not/AZone"]) {
    assert.equal(available({ date: "2026-11-12", eventTimezone }, "2026-11-13T11:59:59Z"), true);
    assert.equal(available({ date: "2026-11-12", eventTimezone }, "2026-11-13T12:00:00Z"), false);
  }
});

test("multi-day and overnight start-only events do not close at opening-day midnight", () => {
  const event = { date: "2026-11-10", eventEndDate: "2026-11-15", eventTimezone: "America/Toronto",
    startDateTime: "2026-11-10T20:00:00-05:00", lifecycle: "completed" };
  assert.equal(available(event, "2026-11-16T04:59:59Z"), true, "stale opening-night lifecycle does not shorten a real range");
  assert.equal(available(event, "2026-11-16T05:00:00Z"), false);
  const night = { date: "2026-11-12", startDateTime: "2026-11-12T23:30:00-05:00", eventTimezone: "America/Toronto" };
  assert.equal(available(night, "2026-11-13T08:30:00Z"), true);
  assert.equal(available(night, "2026-11-13T16:30:00Z"), false);
});

test("DST, local end clocks, malformed spans and rescheduling do not use device Date parsing", () => {
  const day = { date: "2026-11-01", eventTimezone: "America/New_York" };
  assert.equal(eventRsvpWindow(day, at("2026-11-01T00:00:00Z")).closesAt, at("2026-11-02T05:00:00Z"));
  const local = { date: "2026-11-12", startLocalTime: "18:00", endLocalTime: "22:00", eventTimezone: "Asia/Kathmandu" };
  assert.equal(eventRsvpWindow(local).closesAt, at("2026-11-12T16:15:00Z"));
  const ambiguous = { date: "2026-11-01", startLocalTime: "00:30", endLocalTime: "01:30", eventTimezone: "America/New_York" };
  assert.equal(available(ambiguous, "2026-11-01T06:15:00Z"), true, "repeated end clock is not guessed");
  const moved = { date: "2026-11-20", startsAt: at("2026-11-20T23:00:00Z"),
    startDateTime: "2026-11-01T23:00:00Z", eventTimezone: "America/Toronto" };
  assert.equal(available(moved, "2026-11-19T00:00:00Z"), true, "current canonical start overrides stale navigation start");
  assert.equal(available({date:"2026-11-20",eventTimezone:"America/Toronto",endDateTime:"2026-11-01T22:00:00-05:00"},"2026-11-19T00:00:00Z"),true,"a stale standalone end cannot close a rescheduled date");
  assert.equal(available({ date: "2020-01-01", eventEndDate: "2099-01-01" }, "2026-11-12T12:00:00Z"), false);
  assert.equal(eventRsvpWindow({ date: "2026-02-31" }).phase, "unknown");
  assert.equal(available({date:"2099-01-01",eventStatus:"active",lifecycle:"cancelled"},"2026-11-12T00:00:00Z"),false,"canonical cancellation overrides stale navigation status");
  for (const eventStatus of ["cancelled", "canceled", "postponed"])
    assert.equal(available({ date: "2099-01-01", eventStatus }, "2026-11-12T00:00:00Z"), false);
});

test("archive and completed presentation cannot invite a new Going", () => {
  assert.equal(showPresentationModel({ upcoming: false, trusted: false }).allowGoing, false);
  assert.equal(showPresentationModel({ lifecycle: "completed", trusted: true }).allowGoing, false);
});

test("typed transport blocks expired planning while preserving removal, history and privacy changes", async () => {
  const id = "show_" + "a".repeat(64), show = { id, date: "2020-01-01" };
  const calls = [];
  const services = { now: () => at("2026-11-12T00:00:00Z"), apiCall: async (path, options) => {
    calls.push({path, options});
    return { showId: id, attendance: options.body.state ? { showId: id, state: options.body.state, visibility: options.body.visibility || "private" } : null };
  } };
  for (const state of ["going", "interested"]) await assert.rejects(
    writeShowAttendance({ showId: id, accountId: "member", state, show }, services), { code: "EVENT_RSVP_CLOSED" });
  assert.equal(calls.length, 0);
  await writeShowAttendance({ showId: id, accountId: "member", state: null, show }, services);
  await writeShowAttendance({ showId: id, accountId: "member", state: "went", show }, services);
  await writeShowAttendance({ showId: id, accountId: "member", state: "going", show, currentAttendance: {state:"going"}, visibility:"private" }, services);
  assert.deepEqual(calls.map(x=>x.options.body.state), [null, "went", "going"]);
  assert.equal(Object.hasOwn(calls[2].options.body, "currentAttendance"), false, "client snapshot never becomes server authority");
});

