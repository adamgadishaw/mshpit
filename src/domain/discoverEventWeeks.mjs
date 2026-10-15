// Discover's list view: upcoming shows grouped into weeks (Monday first) and
// days, so people can page through a month week by week instead of pressing
// "load more" over and over. Festivals have their own tab and stay out.

import { isFestivalListing } from "./liveDiscovery.mjs";

export { isFestivalListing };

const DAY_MS = 86_400_000;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DATE = /^\d{4}-\d{2}-\d{2}$/u;

const toUtc = (key) => Date.UTC(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, Number(key.slice(8, 10)));
const toKey = (ms) => new Date(ms).toISOString().slice(0, 10);
const addDays = (key, days) => toKey(toUtc(key) + days * DAY_MS);
const mondayOf = (key) => addDays(key, -((new Date(toUtc(key)).getUTCDay() + 6) % 7));
const monthDay = (key) => { const at = new Date(toUtc(key)); return `${MONTHS[at.getUTCMonth()]} ${at.getUTCDate()}`; };

// The viewer's calendar day.
export function localDateKey(now = Date.now()) {
  const at = new Date(now);
  return toKey(Date.UTC(at.getFullYear(), at.getMonth(), at.getDate()));
}

function dayLabel(key, today) {
  if (key === today) return "Today";
  if (key === addDays(today, 1)) return "Tomorrow";
  return `${WEEKDAYS[new Date(toUtc(key)).getUTCDay()]}, ${monthDay(key)}`;
}

function weekLabel(monday, thisMonday) {
  if (monday === thisMonday) return "This week";
  if (monday === addDays(thisMonday, 7)) return "Next week";
  const sunday = addDays(monday, 6);
  return monday.slice(5, 7) === sunday.slice(5, 7)
    ? `${monthDay(monday)} to ${Number(sunday.slice(8, 10))}`
    : `${monthDay(monday)} to ${monthDay(sunday)}`;
}

// events: already filtered and ordered. A show that started before today but
// is still on (a residency, a multi-night run) is listed under today.
// Returns [{ key, label, count, days: [{ key, label, events }] }].
export function discoverEventWeeks(events, { now = Date.now() } = {}) {
  const today = localDateKey(now);
  const thisMonday = mondayOf(today);
  const weeks = new Map();
  for (const event of Array.isArray(events) ? events : []) {
    const date = typeof event?.date === "string" && DATE.test(event.date) ? event.date : null;
    if (!date) continue;
    const day = date < today ? today : date;
    const monday = mondayOf(day);
    if (!weeks.has(monday)) weeks.set(monday, new Map());
    const days = weeks.get(monday);
    if (!days.has(day)) days.set(day, []);
    days.get(day).push(event);
  }
  return [...weeks.keys()].sort().map((monday) => {
    const days = [...weeks.get(monday).entries()].sort(([left], [right]) => left.localeCompare(right))
      .map(([key, list]) => ({ key, label: dayLabel(key, today), events: list }));
    return { key: monday, label: weekLabel(monday, thisMonday), count: days.reduce((sum, day) => sum + day.events.length, 0), days };
  });
}
