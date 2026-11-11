import { calendarReadDate } from "./calendarDates.mjs";
import { liveEventTimeZone } from "./eventLifecycle.mjs";

const DAY_MS = 86_400_000;
const text = (value) => typeof value === "string" ? value.trim() : "";
const pad = (value) => String(value).padStart(2, "0");
const formatters = new Map();
// A venue date at either browsing boundary can cross into the adjacent UTC
// day. This permits the instant, without widening selectable calendar dates.
const instantDate = (value) => calendarReadDate(value) || (["1899-12-31", "2101-01-01"].includes(value) ? value : "");

export function nextCalendarDay(date) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + DAY_MS).toISOString().slice(0, 10);
}

function absoluteTime(value) {
  if (value instanceof Date || (typeof value === "number" && Number.isFinite(value) && value !== 0)) {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) && instantDate(date.toISOString().slice(0, 10)) ? date.toISOString() : null;
  }
  const candidate = text(value);
  // Offset-less ISO strings must never acquire the viewer's device timezone.
  if (!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?(?:Z|[+-](?:[01]\d|2[0-3]):?[0-5]\d)$/i.test(candidate)
    || !instantDate(candidate.slice(0, 10))) return null;
  const date = new Date(candidate);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function localClock(value, date) {
  const match = text(value).match(/^(?:(\d{4}-\d{2}-\d{2})[T ])?([01]?\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?\s*(AM|PM)?$/i);
  if (!match || (match[1] && match[1] !== date)) return null;
  let hour = Number(match[2]);
  if (match[5]) {
    if (hour < 1 || hour > 12) return null;
    hour = hour % 12 + (match[5].toUpperCase() === "PM" ? 12 : 0);
  }
  return `${pad(hour)}:${match[3]}:${match[4] || "00"}`;
}

function zoneParts(timestamp, timeZone) {
  if (!formatters.has(timeZone)) {
    if (formatters.size >= 64) formatters.delete(formatters.keys().next().value);
    formatters.set(timeZone, new Intl.DateTimeFormat("en-GB", {
      timeZone, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
    }));
  }
  const values = formatters.get(timeZone).formatToParts(new Date(timestamp));
  const parts = Object.fromEntries(values.map(({ type, value }) => [type, value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
}

// Resolve only a unique wall-clock instant. Sampling offsets on both sides of
// the date handles DST and non-hour offsets; a gap or repeated clock remains
// unresolved instead of silently shifting it or choosing one occurrence.
function localInstant(date, clock, timeZone) {
  if (!date || !clock || !timeZone) return null;
  const desired = `${date}T${clock}`;
  const wall = Date.parse(`${desired}Z`);
  const offsets = new Set();
  for (const delta of [-2, -1, 0, 1, 2]) {
    const probe = wall + delta * DAY_MS;
    offsets.add(Date.parse(`${zoneParts(probe, timeZone)}Z`) - probe);
  }
  const matches = [...offsets].map((offset) => wall - offset)
    .filter((instant) => zoneParts(instant, timeZone) === desired);
  return matches.length === 1 ? new Date(matches[0]).toISOString() : null;
}

function firstAbsolute(values) {
  return values.map(absoluteTime).find(Boolean) || null;
}

/** Venue timing only: doors/access/countdown defaults are never show starts. */
export function calendarEventTiming(event = {}) {
  const date = calendarReadDate(event.date || event.localDate);
  const proposedEnd = calendarReadDate(event.eventEndDate || event.endDate);
  // Bound malformed spans before the calendar expands them into day cells.
  const span = Date.parse(proposedEnd) - Date.parse(date);
  const endDate = proposedEnd && span >= 0 && span <= 366 * DAY_MS ? proposedEnd : date;
  const timeZone = liveEventTimeZone(event);
  const startInputs = [event.startDateTime, event.showStartDateTime, event.startsAt, event.startAt];
  const localInputs = [event.startLocalTime, event.showStartTime, event.startTime, ...startInputs];
  let startAt = firstAbsolute(startInputs);
  let startLocalTime = localInputs.map((value) => localClock(value, date)).find(Boolean) || null;
  let conflictingDate = false;
  let offsetClock = null;
  let offsetLabel = null;
  if (startAt && timeZone) {
    const local = zoneParts(Date.parse(startAt), timeZone);
    // A stale timestamp on a rescheduled date is not a confirmed start.
    if (date && local.slice(0, 10) !== date) { startAt = null; conflictingDate = true; }
    else startLocalTime = local.slice(11);
  } else if (startAt) {
    // Without a venue zone the UTC date can differ by one day, but cannot be
    // years away (for example a missing-time epoch sentinel).
    if (date && Math.abs(Date.parse(startAt.slice(0, 10)) - Date.parse(date)) > DAY_MS) {
      startAt = null;
      conflictingDate = true;
    } else {
      const offsetSource = startInputs.find((value) => typeof value === "string" && absoluteTime(value));
      if (offsetSource && offsetSource.slice(0, 10) === date) {
        offsetClock = localClock(offsetSource.replace(/(?:Z|[+-]\d{2}:?\d{2})$/i, ""), date);
        const offset = offsetSource.match(/(?:Z|[+-]\d{2}:?\d{2})$/i)?.[0];
        offsetLabel = offset?.toUpperCase() === "Z" ? "UTC" : `UTC${offset}`;
      }
    }
  }
  if (!startAt && !conflictingDate) startAt = localInstant(date, startLocalTime, timeZone);
  const endInputs = [event.endDateTime, event.eventEndDateTime, event.endsAt, event.endAt];
  let endAt = firstAbsolute(endInputs);
  if (!endAt) {
    const endClock = [event.endLocalTime, event.endTime, ...endInputs]
      .map((value) => localClock(value, endDate)).find(Boolean);
    endAt = localInstant(endDate, endClock, timeZone);
  }
  if (!startAt || !endAt || endAt <= startAt) endAt = null;
  if (endAt && endDate > date) {
    const finalDay = timeZone ? zoneParts(Date.parse(endAt), timeZone).slice(0, 10) : endAt.slice(0, 10);
    if (finalDay < endDate) endAt = null;
  }
  const hasTimeInput = [...startInputs, ...localInputs].some((value) => value != null && value !== "");
  const status = startAt ? "timed" : hasTimeInput ? "unresolved" : "unknown";
  let startLabel = null;
  const displayClock = startLocalTime || offsetClock;
  if (displayClock) {
    const hour = Number(displayClock.slice(0, 2));
    startLabel = `${hour % 12 || 12}:${displayClock.slice(3, 5)} ${hour >= 12 ? "PM" : "AM"}${!startLocalTime && offsetLabel ? ` (${offsetLabel})` : ""}`;
  }
  return { date, endDate, timeZone, startAt, endAt, startLocalTime, startLabel, status };
}
