import { localCalendarIso, toIsoDate } from "./dates.mjs";
import { calendarEventTiming, nextCalendarDay } from "./calendarEventTiming.mjs";
import { calendarPerformanceGroups, calendarPerformanceKey, calendarSourceIds } from "./calendarPerformanceIdentity.mjs";

export const CALENDAR_SHOW_VIEW = Object.freeze({
  UPCOMING: "upcoming",
  PAST: "past",
});

const text = (value) => String(value || "").trim();

function calendarDay(value) {
  return value instanceof Date || typeof value === "number"
    ? localCalendarIso(value)
    : toIsoDate(value);
}

function mergeShow(previous, incoming) {
  if (!previous) return incoming;
  const next = { ...previous };
  for (const [key, value] of Object.entries(incoming)) {
    if (value !== null && value !== undefined && value !== "") next[key] = value;
  }
  next.going = previous.going === true || incoming.going === true;
  next.interested = previous.interested === true || incoming.interested === true;
  next.attended = previous.attended === true || incoming.attended === true;
  next.logged = previous.logged === true || incoming.logged === true;
  next.posted = previous.posted === true || incoming.posted === true;
  const previousIds = calendarSourceIds(previous);
  const incomingIds = calendarSourceIds(incoming);
  next.calendarSourceIds = Object.fromEntries(Object.keys(previousIds).map((key) => [
    key, [...new Set([...previousIds[key], ...incomingIds[key]])].sort(),
  ]));
  return next;
}

function attendanceTicketFromPost(post) {
  const ticket = post?.attendanceTicket;
  return ticket && typeof ticket === "object" && !Array.isArray(ticket) ? ticket : null;
}

/**
 * Project a server/optimistic post into the same concert shape as Going and
 * attendance. Ordinary text/photo statuses deliberately return null: a post
 * needs a real artist, room, and date before it belongs on a show calendar.
 */
export function calendarShowFromPost(post) {
  if (!post || typeof post !== "object" || Array.isArray(post)) return null;
  // An online concert review is social activity, not proof that the member
  // attended a physical performance. It must never create a calendar night.
  if (text(post.experienceType || post.experience_type).toLocaleLowerCase() === "online") return null;
  const kind = text(post.kind || "review").toLocaleLowerCase();
  const ticket = attendanceTicketFromPost(post);
  const source = ticket || post;
  const artist = text(source.artist || post.artist);
  const venue = text(source.venue || post.venue);
  const date = toIsoDate(source.date || post.date);
  if (!artist || !venue || !date) return null;
  if (kind !== "review" && kind !== "status") return null;

  const logged = kind === "review";
  return {
    ...source,
    id: ticket?.tourDateId || post.id || source.id,
    postId: post.id || null,
    kind,
    artist,
    venue,
    city: text(source.city || source.place || post.city),
    date,
    tour: text(source.tourName || source.tour || post.tour) || null,
    eventName: text(source.eventName || post.eventName) || null,
    tourDateId: text(source.tourDateId || post.tourDateId) || null,
    posted: true,
    logged,
    attended: logged,
    goingPost: kind === "status" && source.state === "going",
    // This object is a projection of the exact event, not the surrounding
    // status post. The marker keeps every navigation surface on the Show page
    // while ordinary statuses continue to open their comments.
    ...(ticket?.tourDateId ? { performanceEvent: true } : {}),
  };
}

function rowsByDay(rows) {
  const grouped = {};
  for (const show of rows) {
    // The model keeps one event; only the day index contains occurrences.
    for (let dayKey = show.date; dayKey <= show.endDate; dayKey = nextCalendarDay(dayKey)) {
      (grouped[dayKey] ||= []).push(dayKey === show.dayKey ? show : { ...show, dayKey });
    }
  }
  return grouped;
}

function sortCalendarRows(rows, view) {
  return [...rows].sort((left, right) => {
    const byDate = view === CALENDAR_SHOW_VIEW.PAST
      ? right.dayKey.localeCompare(left.dayKey)
      : left.dayKey.localeCompare(right.dayKey);
    if (byDate) return byDate;
    const leftTime = left.calendarTiming.startLocalTime || "99:99";
    const rightTime = right.calendarTiming.startLocalTime || "99:99";
    return leftTime.localeCompare(rightTime)
      || text(left.artist).localeCompare(text(right.artist))
      || left.calendarKey.localeCompare(right.calendarKey);
  });
}

/**
 * The one derived member-calendar model used by Calendar and Profile.
 *
 * - released catalogue rows are discovery context for Upcoming;
 * - private Going and Here/Went rows are supplied only by owner-scoped callers;
 * - public/owner post rows are projected from canonical post JSON;
 * - exact performances stay distinct; legacy sources merge only unambiguously.
 */
export function memberCalendarModel({
  today,
  upcoming = [],
  going = [],
  attendance = [],
  posts,
  logs = [],
} = {}) {
  const todayKey = calendarDay(today);
  if (!todayKey) {
    return {
      today: null,
      upcoming: [],
      past: [],
      byDay: {
        [CALENDAR_SHOW_VIEW.UPCOMING]: {},
        [CALENDAR_SHOW_VIEW.PAST]: {},
      },
    };
  }

  const entries = [];
  const add = (show, patch = {}, scope = {}) => {
    const dayKey = toIsoDate(show?.date || show?.localDate);
    if (!dayKey || !text(show?.artist) || !text(show?.venue)) return;
    const row = { ...show, date: dayKey, dayKey, calendarSourceIds: calendarSourceIds(show) };
    entries.push({ row, patch, scope, order: entries.length });
  };

  const authoredPosts = Array.isArray(posts) ? posts : Array.isArray(logs) ? logs : [];
  // Profile history is newest-first. Merge oldest to newest so the latest post
  // owns display metadata while boolean provenance remains cumulative.
  for (const post of [...authoredPosts].reverse()) {
    const show = calendarShowFromPost(post);
    if (show) add(show);
  }
  for (const show of Array.isArray(upcoming) ? upcoming : []) add(show, { catalogued: true }, { upcomingOnly: true });
  for (const show of Array.isArray(going) ? going : []) add(show, { going: true }, { upcomingOnly: true });
  for (const show of Array.isArray(attendance) ? attendance : []) {
    const state = text(show?.state).toLocaleLowerCase();
    if (state === "interested" || state === "going") {
      add(show, {
        interested: state === "interested",
        going: state === "going",
        attendanceState: state,
      }, { upcomingOnly: true });
      continue;
    }
    if (state === "here" || state === "went") {
      add(show, { attended: true, attendanceState: state }, { pastOnly: true });
    }
  }

  const entryFor = new Map(entries.map((entry) => [entry.row, entry]));
  const rows = { [CALENDAR_SHOW_VIEW.UPCOMING]: [], [CALENDAR_SHOW_VIEW.PAST]: [] };
  for (const group of calendarPerformanceGroups(entries.map(({ row }) => row))) {
    const sources = group.map((row) => entryFor.get(row)).sort((a, b) => a.order - b.order);
    // Released event metadata wins over older private plan snapshots. Post and
    // attendance provenance remain separate from the event's navigation ID.
    const metadata = [...sources].sort((a, b) => Number(!!a.patch.catalogued) - Number(!!b.patch.catalogued));
    const timingFields = ["startDateTime", "showStartDateTime", "startsAt", "startAt", "startLocalTime", "showStartTime", "startTime", "endDateTime", "eventEndDateTime", "endsAt", "endAt", "endLocalTime", "endTime", "eventEndDate", "endDate", "eventTimezone", "event_timezone", "timeZone", "timezone"];
    let merged = metadata.reduce((previous, { row, patch }) => {
      if (previous && patch.catalogued && (previous.date !== row.date || timingFields.some((key) => Object.hasOwn(row, key)))) {
        previous = { ...previous };
        for (const key of timingFields) delete previous[key];
      }
      return mergeShow(previous, row);
    }, null);
    const timing = calendarEventTiming(merged);
    const view = timing.endDate < todayKey ? CALENDAR_SHOW_VIEW.PAST : CALENDAR_SHOW_VIEW.UPCOMING;
    const eligible = sources.filter(({ scope }) => !(scope.pastOnly && view !== CALENDAR_SHOW_VIEW.PAST)
      && !(scope.upcomingOnly && view !== CALENDAR_SHOW_VIEW.UPCOMING));
    if (!eligible.length) continue;
    // A stale Going record may help identify a reviewed performance, but its
    // planning state must never become evidence of attendance in Past.
    const flags = eligible.reduce((previous, { row, patch }) => mergeShow(previous, { ...row, ...patch }), null);
    for (const key of ["going", "interested", "attended", "logged", "posted", "catalogued", "attendanceState"]) {
      delete merged[key];
      if (flags[key] !== undefined) merged[key] = flags[key];
    }
    merged = { ...merged, date: timing.date, dayKey: timing.date, endDate: timing.endDate, calendarTiming: timing };
    merged.calendarKey = calendarPerformanceKey(merged);
    if (merged.calendarSourceIds.tourDateIds.length) {
      merged.id = merged.calendarSourceIds.tourDateIds[0];
      merged.tourDateId = merged.id;
      merged.kind = "event";
      merged.performanceEvent = true;
    }
    rows[view].push(merged);
  }
  const upcomingRows = sortCalendarRows(rows[CALENDAR_SHOW_VIEW.UPCOMING], CALENDAR_SHOW_VIEW.UPCOMING);
  const pastRows = sortCalendarRows(rows[CALENDAR_SHOW_VIEW.PAST], CALENDAR_SHOW_VIEW.PAST);
  return {
    today: todayKey,
    upcoming: upcomingRows,
    past: pastRows,
    byDay: {
      [CALENDAR_SHOW_VIEW.UPCOMING]: rowsByDay(upcomingRows),
      [CALENDAR_SHOW_VIEW.PAST]: rowsByDay(pastRows),
    },
  };
}

/**
 * Calendar is a personal planning/history surface, not a second global archive.
 * Upcoming combines the released live catalogue with the member's Interested
 * and Going rows.
 * Past combines durable Here/Went attendance with the member's own concert logs.
 * A stale past Going/Interested row is not silently promoted to attendance.
 */
export function calendarShowsForView({
  view = CALENDAR_SHOW_VIEW.UPCOMING,
  ...sources
} = {}) {
  const wantedView = view === CALENDAR_SHOW_VIEW.PAST
    ? CALENDAR_SHOW_VIEW.PAST
    : CALENDAR_SHOW_VIEW.UPCOMING;
  const model = memberCalendarModel(sources);
  return wantedView === CALENDAR_SHOW_VIEW.PAST ? model.past : model.upcoming;
}

export function calendarShowsByDay(options) {
  const view = options?.view === CALENDAR_SHOW_VIEW.PAST
    ? CALENDAR_SHOW_VIEW.PAST
    : CALENDAR_SHOW_VIEW.UPCOMING;
  return memberCalendarModel(options).byDay[view];
}

export function calendarFocusForPost(post, today = new Date()) {
  const show = calendarShowFromPost(post);
  const todayKey = calendarDay(today);
  if (!show || !todayKey) return null;
  return {
    date: show.date,
    view: calendarEventTiming(show).endDate < todayKey ? CALENDAR_SHOW_VIEW.PAST : CALENDAR_SHOW_VIEW.UPCOMING,
  };
}
