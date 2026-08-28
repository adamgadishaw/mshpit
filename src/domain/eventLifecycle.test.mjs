import assert from "node:assert/strict";
import test from "node:test";

import {
  LIVE_EVENT_PHASE,
  compareCurrentAndUpcomingLiveEvents,
  isCurrentOrUpcomingLiveEvent,
  liveEventPhase,
  liveEventQueryFloorDate,
  liveEventTimeZone,
} from "./eventLifecycle.mjs";

const NOW = new Date(2026, 7, 27, 12).getTime();

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
