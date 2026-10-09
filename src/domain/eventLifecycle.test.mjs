import assert from "node:assert/strict";
import test from "node:test";

import {
  LIVE_EVENT_PHASE,
  createLiveEventEvaluator,
  compareCurrentAndUpcomingLiveEvents,
  isCurrentOrUpcomingLiveEvent,
  liveEventPhase,
  liveEventQueryFloorDate,
  liveEventTimeZone,
} from "./eventLifecycle.mjs";

const NOW = new Date(2026, 7, 27, 12).getTime();

test("cancelled listings leave upcoming discovery without changing their calendar phase", () => {
  for (const eventStatus of ["cancelled", "canceled", " CANCELLED ", "Canceled"]) {
    for (const event of [{ date: "2026-08-28" }, { date: "2026-08-21", eventEndDate: "2026-09-07" }]) {
      const cancelled = { ...event, eventStatus };
      assert.equal(isCurrentOrUpcomingLiveEvent(cancelled, NOW), false);
      assert.equal(liveEventPhase(cancelled, NOW), liveEventPhase(event, NOW), "calendar/history semantics remain unchanged");
    }
  }
  for (const eventStatus of [undefined, null, "", "scheduled", "Scheduled", "rescheduled", "postponed"]) {
    assert.equal(isCurrentOrUpcomingLiveEvent({ date: "2026-08-28", eventStatus }, NOW), true);
  }
});

test("request lifecycle matches individual reads across local midnight, DST, invalid zones and cancellation", () => {
  for (const at of ["2026-09-08T03:30:00Z", "2026-09-08T04:30:00Z", "2026-11-01T05:30:00Z", "2026-11-01T06:30:00Z"]) {
    const timestamp = Date.parse(at);
    const evaluator = createLiveEventEvaluator(timestamp);
    for (const eventTimezone of ["America/Toronto", "America/Los_Angeles", "Asia/Tokyo", "UTC", "Bad/Zone", null]) {
      for (const date of ["2026-09-07", "2026-09-08", "2026-11-01", "invalid"]) {
        for (const eventEndDate of [null, "2026-09-08", "2026-11-03", "invalid"]) {
          for (const eventStatus of [null, "cancelled", " Canceled ", "scheduled"]) {
            const event = { date, eventEndDate, eventTimezone, eventStatus };
            assert.deepEqual(evaluator.classify(event), {
              phase: liveEventPhase(event, timestamp),
              currentOrUpcoming: isCurrentOrUpcomingLiveEvent(event, timestamp),
            });
          }
        }
      }
    }
  }
});

test("request lifecycle computes a shared timezone date once and never retains an event decision", () => {
  const original = Intl.DateTimeFormat.prototype.formatToParts;
  let calls = 0;
  Intl.DateTimeFormat.prototype.formatToParts = function (...args) { calls++; return original.apply(this, args); };
  try {
    const at = Date.parse("2026-09-08T03:30:00Z");
    const evaluator = createLiveEventEvaluator(at);
    const event = { date: "2026-09-07", eventTimezone: "America/Toronto" };
    for (let i = 0; i < 5000; i++) assert.equal(evaluator.isCurrentOrUpcoming(event), true);
    assert.equal(calls, 1);
    event.eventStatus = "cancelled";
    assert.equal(evaluator.isCurrentOrUpcoming(event), false);
    event.date = "2026-09-06";
    assert.equal(evaluator.phase(event), LIVE_EVENT_PHASE.PAST);
    const later = createLiveEventEvaluator(Date.parse("2026-09-08T04:30:00Z"));
    assert.equal(later.phase({ date: "2026-09-07", eventTimezone: "America/Toronto" }), LIVE_EVENT_PHASE.PAST);
    assert.equal(calls, 2, "a subsequent read recomputes local day");
  } finally { Intl.DateTimeFormat.prototype.formatToParts = original; }
});

test("multi-day events remain active through their inclusive end date", () => {
  const cne = {
    id: "cne",
    date: "2026-08-21",
    eventEndDate: "2026-09-07",
    eventTimezone: "America/Toronto",
  };
  assert.equal(liveEventPhase(cne, NOW), LIVE_EVENT_PHASE.ACTIVE);
  assert.equal(isCurrentOrUpcomingLiveEvent(cne, NOW), true);
  assert.equal(liveEventPhase(cne, Date.parse("2026-09-08T03:30:00.000Z")), LIVE_EVENT_PHASE.ACTIVE,
    "the event remains active at 11:30 p.m. on its final Toronto day");
  assert.equal(liveEventPhase(cne, Date.parse("2026-09-08T04:30:00.000Z")), LIVE_EVENT_PHASE.PAST);
});

test("a past one-day show does not become active without a real provider end date", () => {
  assert.equal(liveEventPhase({ date: "2026-08-26" }, NOW), LIVE_EVENT_PHASE.PAST);
  assert.equal(liveEventPhase({ date: "2026-08-26", eventEndDate: "not-a-date" }, NOW), LIVE_EVENT_PHASE.PAST);
  assert.equal(isCurrentOrUpcomingLiveEvent({ date: "2026-08-26" }, NOW), false);
});

test("active events pin ahead of future events and remain deterministic", () => {
  const rows = [
    { id: "future", date: "2026-08-28" },
    { id: "long-active", date: "2026-08-21", eventEndDate: "2026-09-07" },
    { id: "soon-active", date: "2026-08-25", eventEndDate: "2026-08-29" },
  ];
  rows.sort((left, right) => compareCurrentAndUpcomingLiveEvents(left, right, NOW));
  assert.deepEqual(rows.map(({ id }) => id), ["soon-active", "long-active", "future"]);
});

test("invalid and single-day ranges do not masquerade as active multi-day events", () => {
  assert.equal(liveEventPhase({}, NOW), LIVE_EVENT_PHASE.UNKNOWN);
  assert.equal(liveEventPhase({ date: "2026-08-27", eventEndDate: "2026-08-27" }, NOW), LIVE_EVENT_PHASE.UPCOMING);
  assert.equal(liveEventPhase({ date: "2026-08-28", eventEndDate: "2026-08-27" }, NOW), LIVE_EVENT_PHASE.UPCOMING);
});

test("event timezone normalization and the server query floor fail safely", () => {
  assert.equal(liveEventTimeZone({ event_timezone: "America/Toronto" }), "America/Toronto");
  assert.equal(liveEventTimeZone({ eventTimezone: "Not/A_Real_Zone" }), null);
  assert.equal(liveEventTimeZone({ eventTimezone: "America/Toronto\u0000" }), null);
  assert.equal(liveEventQueryFloorDate(Date.parse("2026-09-08T01:30:00.000Z")), "2026-09-07");
});
