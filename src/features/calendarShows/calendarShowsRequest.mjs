import { discoverCountryCode } from "../../domain/discoverEventRange.mjs";
import { discoverCountryIdentity, discoverRowCountryLabel } from "../../domain/discoverScene.mjs";
import { calendarReadDate } from "../../domain/calendarDates.mjs";

export const CALENDAR_SHOW_PAGE_SIZE = 100;
const pad = (value) => String(value).padStart(2, "0");
const clean = (value, max) => typeof value === "string"
  ? value.replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim().slice(0, max) : "";

export function calendarLocalEvent(event, { homeCity, homeCountry, countryForCity } = {}) {
  const wantedCity = clean(homeCity, 120).normalize("NFKC").toLocaleLowerCase();
  if (!wantedCity) return false;
  const city = clean(event?.venueCity || event?.venue_city || event?.city || clean(event?.place, 240).split(",")[0], 120)
    .split(",")[0].trim().normalize("NFKC").toLocaleLowerCase();
  if (city !== wantedCity) return false;
  const wantedCountry = discoverCountryIdentity(homeCountry);
  if (!wantedCountry) return true;
  const country = discoverCountryIdentity(discoverRowCountryLabel(event, { countryForCity }));
  return !!country && country === wantedCountry;
}

export function calendarMonthBounds(cursor) {
  const year = cursor?.y, month = cursor?.m;
  if (!Number.isSafeInteger(year) || year < 1900 || year > 2100 || !Number.isSafeInteger(month) || month < 0 || month > 11) {
    throw new TypeError("Choose a valid calendar month.");
  }
  const key = `${year}-${pad(month + 1)}`;
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return { month: key, from: `${key}-01`, through: `${key}-${pad(last)}`, days: last };
}

const realDate = (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && calendarReadDate(value) === value;

export function calendarShowsQuery({ cursor, selected, presentation = "month", scope = "all", homeCity, homeCountry,
  accountId = null, authEpoch = null, enabled = true } = {}) {
  const bounds = calendarMonthBounds(cursor);
  const mode = presentation === "agenda" ? "agenda" : "month";
  const city = scope === "local" ? clean(homeCity, 120) || null : null;
  const country = scope === "local" ? discoverCountryCode(clean(homeCountry, 80)) || null : null;
  const needsLocation = scope === "local" && !city;
  if (!["all", "local", "plans"].includes(scope)) throw new TypeError("Choose a valid calendar scope.");
  if (!realDate(selected) || selected < bounds.from || selected > bounds.through) throw new TypeError("Choose a date in this calendar month.");
  const date = mode === "month" ? selected : null;
  const fromDate = mode === "agenda" ? selected : null;
  const monthKey = JSON.stringify([accountId, authEpoch, bounds.month, scope, city, country]);
  return { ...bounds, date, fromDate, city, country, scope, accountId, authEpoch, needsLocation,
    enabled: enabled && scope !== "plans" && !needsLocation,
    monthKey, key: JSON.stringify([monthKey, date, fromDate]),
  };
}

export function calendarShowsRequest(query, { after = null, limit = CALENDAR_SHOW_PAGE_SIZE } = {}) {
  if (after !== null && (typeof after !== "string" || !after || after.length > 2400)) throw new TypeError("Invalid calendar page cursor.");
  const size = Number.isSafeInteger(limit) && limit > 0 ? Math.min(500, limit) : CALENDAR_SHOW_PAGE_SIZE;
  const params = new URLSearchParams({ month: query.month, limit: String(size) });
  if (query.date) params.set("date", query.date);
  if (query.fromDate) params.set("fromDate", query.fromDate);
  if (query.city) params.set("city", query.city);
  if (query.country) params.set("country", query.country);
  if (after) params.set("after", after);
  return { path: `/api/tourdates?${params}`, expectedAccountId: query.accountId ?? null, limit: size };
}

const invalidResponse = () => Object.assign(new TypeError("Calendar month coverage is unavailable. Please try again."), { code: "CALENDAR_RANGE_UNAVAILABLE" });

export function calendarShowsFromResponse(payload, query, { limit = CALENDAR_SHOW_PAGE_SIZE } = {}) {
  const range = payload?.range;
  const summary = payload?.monthSummary;
  const nextCursor = payload?.nextCursor;
  // Older servers ignore unknown query parameters. Missing echoed bounds and
  // coverage must fail closed instead of laundering a startup page into a month.
  if (!range || !summary || !Array.isArray(payload?.tourDates) || payload.tourDates.length > limit
    || !["month", "from", "through", "city", "country", "date", "fromDate"].every((key) => range[key] === query[key])
    || typeof payload.complete !== "boolean" || typeof summary.complete !== "boolean"
    || (nextCursor !== null && (typeof nextCursor !== "string" || !nextCursor || nextCursor.length > 2400))
    || payload.complete !== (nextCursor === null)
    || !summary.dayPresence || typeof summary.dayPresence !== "object" || Array.isArray(summary.dayPresence)) throw invalidResponse();
  const presence = Object.entries(summary.dayPresence);
  if (presence.some(([day, value]) => !realDate(day) || day < query.from || day > query.through || typeof value !== "boolean")
    || (summary.complete && presence.length !== query.days)) throw invalidResponse();
  const lower = query.date || query.fromDate || query.from;
  const upper = query.date || query.through;
  for (const row of payload.tourDates) {
    const end = realDate(row?.eventEndDate) && row.eventEndDate >= row.date ? row.eventEndDate : row?.date;
    if (!row || typeof row !== "object" || Array.isArray(row) || typeof row.id !== "string" || !row.id
      || !clean(row.artist, 240) || !clean(row.venue, 240)
      || !realDate(row.date) || row.date > upper || !end || end < lower) throw invalidResponse();
  }
  return { events: payload.tourDates, nextCursor, complete: payload.complete,
    monthSummary: { dayPresence: { ...summary.dayPresence }, complete: summary.complete },
    range: { ...range },
  };
}
