import { localCalendarIso, toIsoDate } from "./dates.mjs";

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
  next.interested = previous.interested === true || incoming.interested === true;
  next.attended = previous.attended === true || incoming.attended === true;
  next.logged = previous.logged === true || incoming.logged === true;
  next.posted = previous.posted === true || incoming.posted === true;
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
  for (const show of rows) (grouped[show.dayKey] ||= []).push(show);
  return grouped;
}

function sortCalendarRows(rows, view) {
  return [...rows].sort((left, right) => {
    const byDate = view === CALENDAR_SHOW_VIEW.PAST
      ? right.dayKey.localeCompare(left.dayKey)
      : left.dayKey.localeCompare(right.dayKey);
    if (byDate) return byDate;
    return text(left.artist).localeCompare(text(right.artist));
  });
}

/**
 * The one derived member-calendar model used by Calendar and Profile.
 *
 * - released catalogue rows are discovery context for Upcoming;
 * - private Going and Here/Went rows are supplied only by owner-scoped callers;
 * - public/owner post rows are projected from canonical post JSON;
 * - one artist + room + night is merged once across every source.
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

  const rows = {
    [CALENDAR_SHOW_VIEW.UPCOMING]: new Map(),
    [CALENDAR_SHOW_VIEW.PAST]: new Map(),
  };
  const add = (show, patch = {}, { pastOnly = false, upcomingOnly = false } = {}) => {
    const dayKey = toIsoDate(show?.date);
    if (!dayKey) return;
    const view = dayKey < todayKey ? CALENDAR_SHOW_VIEW.PAST : CALENDAR_SHOW_VIEW.UPCOMING;
    if ((pastOnly && view !== CALENDAR_SHOW_VIEW.PAST)
      || (upcomingOnly && view !== CALENDAR_SHOW_VIEW.UPCOMING)) return;
    const projected = normalizedShow(show, dayKey, patch);
    const identity = showIdentity(projected, dayKey);
    if (!text(projected.artist) || !text(projected.venue) || !identity) return;
    const withIdentity = { ...projected, calendarKey: identity };
    rows[view].set(identity, mergeShow(rows[view].get(identity), withIdentity));
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

  const upcomingRows = sortCalendarRows([...rows[CALENDAR_SHOW_VIEW.UPCOMING].values()], CALENDAR_SHOW_VIEW.UPCOMING);
  const pastRows = sortCalendarRows([...rows[CALENDAR_SHOW_VIEW.PAST].values()], CALENDAR_SHOW_VIEW.PAST);
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
    view: show.date < todayKey ? CALENDAR_SHOW_VIEW.PAST : CALENDAR_SHOW_VIEW.UPCOMING,
  };
}
