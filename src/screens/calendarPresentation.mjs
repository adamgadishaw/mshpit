export const CALENDAR_AGENDA_PAGE = 40;
export const CALENDAR_MIN_YEAR = 1900;
export const CALENDAR_MAX_YEAR = 2100;
const pad = value => String(value).padStart(2, "0");
export const calendarDateKey = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;
export function calendarLocalDate(key) {
  // Browsing years is wider than the canonical performance-write window.
  // Validate the day itself without applying a device-relative tour-date cutoff.
  if (typeof key !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(key)) return null;
  const [y, m, d] = key.split("-").map(Number);
  if (y < 1000 || m < 1 || m > 12 || d < 1) return null;
  const date = new Date(y, m - 1, d, 12);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d ? date : null;
}
export function calendarDateLabel(key, options = {}, locale) {
  const date = calendarLocalDate(key);
  return date ? date.toLocaleDateString(locale, { weekday: "long", month: "long", day: "numeric", ...options, calendar: "gregory" }) : "Date unavailable";
}
export const calendarMonthLabel = (year, month, locale, includeYear = true) => new Date(year, month, 1, 12)
  .toLocaleDateString(locale, { month: "long", ...(includeYear ? { year: "numeric" } : {}), calendar: "gregory" });
export const calendarShowName = event => [event.eventName || event.artist || "Show",
  event.eventName && event.artist && event.eventName !== event.artist ? event.artist : ""].filter(Boolean).join(", ");
export const calendarMoreLabel = event => `More actions for ${calendarShowName(event)}, ${calendarTimeLabel(event)}, ${event.venue || "Venue TBA"}, ${calendarDateLabel(event.dayKey || event.date, { year: "numeric" })}`;
export function calendarDayAvailability(count, { publicShows, presence, complete } = {}) {
  if (count) return `${count} ${complete ? "" : "loaded "}${count === 1 ? "show" : "shows"}`;
  if (presence === true) return "Shows listed, count not loaded";
  return publicShows && presence !== false && !complete ? "Availability not loaded" : "0 shows listed";
}
export function calendarWeekStart(locale) {
  try {
    const resolved = locale || new Intl.DateTimeFormat().resolvedOptions().locale;
    const value = new Intl.Locale(resolved);
    const info = typeof value.getWeekInfo === "function" ? value.getWeekInfo() : value.weekInfo;
    return Number.isInteger(info?.firstDay) ? info.firstDay % 7 : 0;
  } catch { return 0; }
}
export function calendarMonthGeometry({ y, m, width = 390, fontScale = 1, locale, weekStart = calendarWeekStart(locale) }) {
  const start = ((weekStart % 7) + 7) % 7;
  const days = new Date(y, m + 1, 0).getDate();
  const leading = (new Date(y, m, 1).getDay() - start + 7) % 7;
  const scale = Number.isFinite(fontScale) ? Math.max(1, fontScale) : 1;
  const cell = Math.ceil(44 * scale);
  return {
    // Only render weeks containing this month. A phantom sixth week pushes
    // the selected day's shows offscreen on otherwise compact months.
    cells: Array.from({ length: Math.ceil((leading + days) / 7) * 7 }, (_, i) => i >= leading && i < leading + days ? i - leading + 1 : null),
    weekdays: Array.from({ length: 7 }, (_, i) => new Date(2026, 10, 1 + (start + i) % 7).toLocaleDateString(locale, { weekday: "short", calendar: "gregory" })),
    width: Math.max(cell * 7, Math.min(560, Math.max(0, width - 8))),
    cellHeight: cell,
  };
}
export function calendarMonthSelection(cursor, delta, selected) {
  const date = new Date(cursor.y, cursor.m + delta, 1, 12);
  const y = date.getFullYear(), m = date.getMonth();
  if (y < CALENDAR_MIN_YEAR || y > CALENDAR_MAX_YEAR) return null;
  const day = calendarLocalDate(selected)?.getDate() || 1;
  return { cursor: { y, m }, selected: calendarDateKey(y, m, Math.min(day, new Date(y, m + 1, 0).getDate())) };
}
export function calendarJumpSelection(yearText, month, selected) {
  if (!/^\d{4}$/.test(String(yearText)) || !Number.isInteger(month) || month < 0 || month > 11) return null;
  const y = Number(yearText);
  if (y < CALENDAR_MIN_YEAR || y > CALENDAR_MAX_YEAR) return null;
  return calendarMonthSelection({ y, m: month }, 0, selected);
}
export const isPersonalCalendarShow = event => !!(event?.going || event?.interested || event?.attended || event?.logged || event?.posted);
// Display-only abbreviations. Keep city/region context and the untouched full
// location in the row's spoken label and show detail/action payload.
export function calendarPlaceLabel(event) {
  const compact = value => ({
    "united states of america": "US", "united states": "US", "usa": "US",
    "united kingdom": "UK", "great britain": "UK",
  })[value.toLowerCase()] || value;
  const parts = String(event.city || event.place || "").split(",").map(part => part.trim()).filter(Boolean);
  const country = String(event.country || "").trim();
  if (country && !parts.some(part => compact(part).toLowerCase() === compact(country).toLowerCase())) parts.push(country);
  return [...new Set(parts.map(compact))].join(", ");
}
export function calendarArtistSubtitle(event) {
  const comparable = value => value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  const title = comparable(String(event.eventName || ""));
  const artist = String(event.artist || "").trim();
  // Event names commonly already contain the headliner. Do not repeat that
  // line, but retain a distinct artist and the complete accessibility label.
  return title && artist && !title.includes(comparable(artist)) ? artist : "";
}
export function calendarDaysForScope(byDay = {}, scope = "all") {
  if (scope !== "plans") return byDay;
  return Object.fromEntries(Object.entries(byDay).map(([key, rows]) => [key, rows.filter(isPersonalCalendarShow)]).filter(([, rows]) => rows.length));
}
export function calendarAgendaGroups(byDay, { selected, view = "upcoming", limit = CALENDAR_AGENDA_PAGE } = {}) {
  const past = view === "past";
  const keys = Object.keys(byDay).filter(key => past ? key <= selected : key >= selected).sort();
  if (past) keys.reverse();
  const size = Number.isSafeInteger(limit) && limit > 0 ? limit : CALENDAR_AGENDA_PAGE;
  let used = 0, remaining = 0;
  const groups = [];
  for (const date of keys) {
    const rows = byDay[date];
    const take = Math.max(0, Math.min(rows.length, size - used));
    if (take) { groups.push({ date, events: rows.slice(0, take) }); used += take; }
    remaining += rows.length - take;
  }
  return { groups, remaining, count: used };
}
export function calendarMonthCount(byDay, cursor) {
  const prefix = `${cursor.y}-${pad(cursor.m + 1)}-`;
  const identities = new Set();
  for (const [day, rows] of Object.entries(byDay)) if (day.startsWith(prefix)) {
    for (const event of rows) identities.add(event.calendarKey || `${event.artist}|${event.venue}|${event.date}`);
  }
  return identities.size;
}
export function calendarTimeLabel(event, locale) {
  if (event.dayKey > event.date && event.dayKey <= (event.endDate || event.eventEndDate || event.date)) return "Continues";
  const timing = event.calendarTiming;
  if (timing?.status === "unresolved") return "Time unconfirmed";
  if (timing?.startAt && timing.timeZone) {
    try { return new Date(timing.startAt).toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit", timeZone: timing.timeZone }); } catch { /* use an explicitly supplied wall time below */ }
  }
  // Without a venue zone, the domain label explicitly names UTC/the supplied
  // offset. Never silently format that instant in the phone's current zone.
  if (timing?.status === "timed" && !timing.timeZone && timing.startLabel) return timing.startLabel;
  const wall = timing?.startLocalTime;
  if (typeof wall === "string" && /^\d{2}:\d{2}/.test(wall)) {
    const [h, m] = wall.split(":").map(Number);
    if (h < 24 && m < 60) return new Date(2000, 0, 1, h, m).toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });
  }
  return "Time TBA";
}
export function calendarShowStatus(event, view) {
  const lifecycle = String(event.eventStatus || event.lifecycle || "").toLowerCase();
  if (["cancelled", "canceled"].includes(lifecycle)) return "Cancelled";
  if (lifecycle === "postponed") return "Postponed";
  if (lifecycle === "rescheduled") return "Rescheduled";
  if (view === "past") return event.logged ? "Logged" : event.attended ? "Went" : "";
  return event.going ? "Going" : event.interested ? "Interested" : event.logged ? "Logged" : event.posted ? "Posted" : "";
}
