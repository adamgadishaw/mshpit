import { calendarDayEndAt, calendarEventTiming } from "./calendarEventTiming.mjs";

const TWELVE_HOURS = 12 * 60 * 60 * 1000;
const text = value => typeof value === "string" ? value.trim().toLowerCase() : "";

/** Planning eligibility, independent of stored attendance and review history.
 * Explicit ends win. With no end time, retain the complete final venue day and
 * at least a twelve-hour window from a known start for overnight concerts.
 * An unknown zone uses the last worldwide end of that date, not device time.
 * No doors/access time, score, or inferred attendance is used as an end time.
 */
export function eventRsvpWindow(event = {}, now = Date.now()) {
  if (!event || typeof event !== "object") event = {};
  const at = Number(now);
  const closed = value => ["cancelled", "canceled", "postponed"].includes(value);
  const statuses = [event.lifecycle, event.eventStatus, event.event_status].map(text);
  const status = statuses.find(closed) || statuses.find(Boolean) || "";
  if (closed(status)) {
    return { phase: status === "canceled" ? "cancelled" : status, canPlan: false, closesAt: null };
  }
  const timing = calendarEventTiming({
    ...event,
    date: event.date || event.localDate,
    startDateTime: event.startsAt || event.startAt || event.startDateTime || event.start_date_time,
    startLocalTime: event.startLocalTime || event.start_local_time,
    eventEndDate: event.eventEndDate || event.event_end_date || event.endDate,
  }, { allowStandaloneEnd: true });
  const startsAt = timing.startAt ? Date.parse(timing.startAt) : null;
  const explicitEnd = timing.endAt ? Date.parse(timing.endAt) : null;
  const finalDayEnd = calendarDayEndAt(timing.endDate, timing.timeZone);
  const closesAt = explicitEnd ?? (finalDayEnd != null || startsAt != null
    ? Math.max(finalDayEnd ?? 0, startsAt == null ? 0 : startsAt + TWELVE_HOURS) : null);
  if ((closesAt != null && at >= closesAt) || (closesAt == null && status === "completed")) {
    return { phase: "completed", canPlan: false, closesAt };
  }
  const phase = startsAt != null && at >= startsAt ? "happening"
    : closesAt != null ? "upcoming" : "unknown";
  // Historical unknown dates remain unknown. The server still validates exact
  // event authority; this guard does not invent a date or rewrite old records.
  return { phase, canPlan: true, closesAt };
}

export function assertEventRsvpAvailable(event, now = Date.now()) {
  const window = eventRsvpWindow(event, now);
  if (window.canPlan) return;
  const error = new Error(window.phase === "completed"
    ? "This show has ended. You can still review it or remove an existing plan."
    : "New plans are not available for this show. You can still remove an existing plan.");
  error.code = "EVENT_RSVP_CLOSED";
  error.userMessage = error.message;
  throw error;
}
