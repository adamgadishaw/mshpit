import { calendarDateKey } from "./dataPolicy.mjs";

export const LIVE_EVENT_PHASE = Object.freeze({
  ACTIVE: "active",
  UPCOMING: "upcoming",
  PAST: "past",
  UNKNOWN: "unknown",
});

const DAY_MS = 24 * 60 * 60 * 1_000;
const EVENT_TIME_ZONE_CACHE_LIMIT = 64;
const eventTimeZoneFormatters = new Map();

function eventTimeZoneFormatter(value) {
  const timeZone = typeof value === "string" ? value.trim() : "";
  if (!timeZone || timeZone.length > 100 || /[\u0000-\u001f\u007f]/.test(timeZone)) return null;
  if (eventTimeZoneFormatters.has(timeZone)) return eventTimeZoneFormatters.get(timeZone);
  let formatter = null;
  try {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  } catch {
    formatter = null;
  }
  if (eventTimeZoneFormatters.size >= EVENT_TIME_ZONE_CACHE_LIMIT) {
    eventTimeZoneFormatters.delete(eventTimeZoneFormatters.keys().next().value);
  }
  eventTimeZoneFormatters.set(timeZone, formatter);
  return formatter;
}

export function liveEventTimeZone(event) {
  const value = event?.eventTimezone ?? event?.event_timezone ?? event?.timeZone ?? event?.timezone;
  const timeZone = typeof value === "string" ? value.trim() : "";
  return eventTimeZoneFormatter(timeZone) ? timeZone : null;
}

const todayKey = (now, event) => {
  const at = Number.isFinite(Number(now)) ? Number(now) : Date.now();
  const today = new Date(at);
  const formatter = eventTimeZoneFormatter(liveEventTimeZone(event));
  if (formatter) {
    const parts = Object.fromEntries(formatter.formatToParts(today)
      .filter((part) => part.type === "year" || part.type === "month" || part.type === "day")
      .map((part) => [part.type, Number(part.value)]));
    if (Number.isSafeInteger(parts.year) && Number.isSafeInteger(parts.month) && Number.isSafeInteger(parts.day)) {
      return parts.year * 10000 + parts.month * 100 + parts.day;
    }
  }
  // UTC is deterministic across Render, browsers, and native devices. Provider
  // events normally carry their venue timezone; this is the fail-safe for
  // legacy or staff-authored rows where one was not persisted.
  return today.getUTCFullYear() * 10000 + (today.getUTCMonth() + 1) * 100 + today.getUTCDate();
};

// Server queries intentionally include one prior UTC calendar day, then apply
// liveEventPhase per row. That bounded overlap prevents a negative-offset event
// from being filtered before its local final day has actually ended.
export function liveEventQueryFloorDate(now = Date.now()) {
  const at = Number.isFinite(Number(now)) ? Number(now) : Date.now();
  return new Date(at - DAY_MS).toISOString().slice(0, 10);
}

export function liveEventPhase(event, now = Date.now()) {
  const startKey = calendarDateKey(event?.date);
  if (startKey == null) return LIVE_EVENT_PHASE.UNKNOWN;
  const currentKey = todayKey(now, event);
  const endKey = calendarDateKey(event?.eventEndDate);
  if (endKey != null && endKey > startKey && startKey <= currentKey && endKey >= currentKey) {
    return LIVE_EVENT_PHASE.ACTIVE;
  }
  if (startKey >= currentKey) return LIVE_EVENT_PHASE.UPCOMING;
  return LIVE_EVENT_PHASE.PAST;
}

export function isCurrentOrUpcomingLiveEvent(event, now = Date.now()) {
  const phase = liveEventPhase(event, now);
  return phase === LIVE_EVENT_PHASE.ACTIVE || phase === LIVE_EVENT_PHASE.UPCOMING;
}

// Active multi-day events remain pinned ahead of future dates. Within that
// pinned group, the event ending soonest leads; future events remain
// chronological. Equal dates retain their already-deterministic source order.
export function compareCurrentAndUpcomingLiveEvents(left, right, now = Date.now()) {
  const leftPhase = liveEventPhase(left, now);
  const rightPhase = liveEventPhase(right, now);
  const rank = (phase) => phase === LIVE_EVENT_PHASE.ACTIVE ? 0
    : phase === LIVE_EVENT_PHASE.UPCOMING ? 1
      : phase === LIVE_EVENT_PHASE.PAST ? 2 : 3;
  const phaseDifference = rank(leftPhase) - rank(rightPhase);
  if (phaseDifference) return phaseDifference;

  const leftDate = leftPhase === LIVE_EVENT_PHASE.ACTIVE
    ? calendarDateKey(left?.eventEndDate) : calendarDateKey(left?.date);
  const rightDate = rightPhase === LIVE_EVENT_PHASE.ACTIVE
    ? calendarDateKey(right?.eventEndDate) : calendarDateKey(right?.date);
  const dateDifference = (leftDate ?? Number.MAX_SAFE_INTEGER) - (rightDate ?? Number.MAX_SAFE_INTEGER);
  if (dateDifference) return dateDifference;
  return 0;
}
