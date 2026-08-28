import { toIsoDate } from "./dates.mjs";

export const CALENDAR_SHOW_VIEW = Object.freeze({
  UPCOMING: "upcoming",
  PAST: "past",
});

const text = (value) => String(value || "").trim();

function showIdentity(show, dayKey) {
  // Attendance rows and review posts use different storage ids for the same
  // performance. The calendar identity must therefore remain artist + room +
  // night, matching the product's concert identity rather than either row id.
  return [show?.artist, show?.venue, dayKey].map((part) => text(part).toLocaleLowerCase()).join("|");
}

function normalizedShow(show, dayKey, patch = {}) {
  return { ...show, ...patch, date: dayKey, dayKey };
}

function mergeShow(previous, incoming) {
  if (!previous) return incoming;
  const next = { ...previous };
  for (const [key, value] of Object.entries(incoming)) {
    if (value !== null && value !== undefined && value !== "") next[key] = value;
  }
  next.going = previous.going === true || incoming.going === true;
  next.attended = previous.attended === true || incoming.attended === true;
  next.logged = previous.logged === true || incoming.logged === true;
  return next;
}

/**
 * Calendar is a personal planning/history surface, not a second global archive.
 * Upcoming combines the released live catalogue with the member's Going rows.
 * Past combines durable Here/Went attendance with the member's own concert logs.
 * A stale past Going/Interested row is not silently promoted to attendance.
 */
export function calendarShowsForView({
  view = CALENDAR_SHOW_VIEW.UPCOMING,
  today,
  upcoming = [],
  going = [],
  attendance = [],
  logs = [],
} = {}) {
  const todayKey = toIsoDate(today);
  if (!todayKey) return [];
  const wantedView = view === CALENDAR_SHOW_VIEW.PAST
    ? CALENDAR_SHOW_VIEW.PAST
    : CALENDAR_SHOW_VIEW.UPCOMING;
  const rows = new Map();

  const add = (show, patch) => {
    const dayKey = toIsoDate(show?.date);
    if (!dayKey) return;
    const isPast = dayKey < todayKey;
    if ((wantedView === CALENDAR_SHOW_VIEW.PAST) !== isPast) return;
    const projected = normalizedShow(show, dayKey, patch);
    const identity = showIdentity(projected, dayKey);
    if (!text(projected.artist) || !text(projected.venue) || !identity) return;
    rows.set(identity, mergeShow(rows.get(identity), projected));
  };

  if (wantedView === CALENDAR_SHOW_VIEW.UPCOMING) {
    for (const show of Array.isArray(upcoming) ? upcoming : []) add(show, { going: false });
    for (const show of Array.isArray(going) ? going : []) add(show, { going: true });
  } else {
    for (const show of Array.isArray(attendance) ? attendance : []) {
      const state = text(show?.state).toLocaleLowerCase();
      if (state !== "here" && state !== "went") continue;
      add(show, { attended: true, attendanceState: state });
    }
    for (const show of Array.isArray(logs) ? logs : []) {
      if ((show?.kind || "review") !== "review") continue;
      add(show, { attended: true, logged: true });
    }
  }

  return [...rows.values()].sort((left, right) => {
    const byDate = wantedView === CALENDAR_SHOW_VIEW.PAST
      ? right.dayKey.localeCompare(left.dayKey)
      : left.dayKey.localeCompare(right.dayKey);
    if (byDate) return byDate;
    return text(left.artist).localeCompare(text(right.artist));
  });
}

export function calendarShowsByDay(options) {
  const grouped = {};
  for (const show of calendarShowsForView(options)) {
    (grouped[show.dayKey] ||= []).push(show);
  }
  return grouped;
}
