import { calendarDateKey } from "./dataPolicy.mjs";
import {
  compareCurrentAndUpcomingLiveEvents,
  isCurrentOrUpcomingLiveEvent,
} from "./eventLifecycle.mjs";
import { discoverRowMatchesRegion } from "./discoverScene.mjs";

export const DISCOVER_RANGE_DAYS = Object.freeze([30, 60, 90]);
export const DISCOVER_RANGE_BATCH = 4;
export const DISCOVER_RANGE_REQUEST_LIMIT = 250;
export const DISCOVER_RANGE_MAX_EVENTS = 500;

const COUNTRY_CODES = Object.freeze({
  Argentina: "AR", Australia: "AU", Brazil: "BR", Canada: "CA", France: "FR",
  Germany: "DE", Ireland: "IE", Japan: "JP", Mexico: "MX", Netherlands: "NL",
  "New Zealand": "NZ", Singapore: "SG", "South Korea": "KR", Spain: "ES",
  Sweden: "SE", "United Kingdom": "GB", "United States": "US",
});

const clean = (value, max = 180) => typeof value === "string"
  ? value.replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim().slice(0, max)
  : "";

const boundedInteger = (value, fallback, min, max) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.floor(number))) : fallback;
};

const utcDateKeyAfterDays = (now, days) => {
  const date = new Date(now);
  const through = new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate() + days,
  ));
  return through.getUTCFullYear() * 10000 + (through.getUTCMonth() + 1) * 100 + through.getUTCDate();
};

const canonicalCalendarDate = (value) => {
  const date = clean(value, 40);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && calendarDateKey(date) != null ? date : null;
};

const eventIdentity = (event) => clean(event?.id, 240)
  || [event?.artist, event?.venue, event?.date].map((value) => clean(value).toLocaleLowerCase()).join("|");

export function discoverCountryCode(value) {
  const country = clean(value, 80);
  if (country.toLocaleLowerCase() === "worldwide") return null;
  if (/^[a-z]{2}$/i.test(country)) return country.toLocaleUpperCase();
  return COUNTRY_CODES[country] || country || null;
}

export function tourDateRangeRequestPath({ days = 30, limit = DISCOVER_RANGE_REQUEST_LIMIT, after, country } = {}) {
  const params = new URLSearchParams({
    days: String(boundedInteger(days, 30, 1, 90)),
    limit: String(boundedInteger(limit, DISCOVER_RANGE_REQUEST_LIMIT, 1, 500)),
  });
  const cursor = clean(after, 1000);
  const countryCode = discoverCountryCode(country);
  if (cursor) params.set("after", cursor);
  if (countryCode) params.set("country", countryCode);
  return `/api/tourdates?${params.toString()}`;
}

export function discoverySidebarRangeRequestPath({ days = 30, limit = DISCOVER_RANGE_MAX_EVENTS } = {}) {
  const params = new URLSearchParams({
    days: String(boundedInteger(days, 30, 1, 90)),
    limit: String(boundedInteger(limit, DISCOVER_RANGE_MAX_EVENTS, 1, DISCOVER_RANGE_MAX_EVENTS)),
  });
  return `/api/discovery/sidebar?${params.toString()}`;
}

export function parseTourDateRangeResponse(payload) {
  const rows = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.tourDates)
      ? payload.tourDates
      : Array.isArray(payload?.items)
        ? payload.items
        : Array.isArray(payload?.upcomingEvents)
          ? payload.upcomingEvents
          : [];
  const nextCursor = clean(payload?.nextCursor, 1000) || null;
  const through = canonicalCalendarDate(payload?.range?.through);
  return {
    tourDates: rows.filter((row) => row && typeof row === "object"),
    nextCursor,
    through,
  };
}

export function mergeDiscoverRangePages(current, incoming, { limit = DISCOVER_RANGE_MAX_EVENTS } = {}) {
  const maximum = boundedInteger(limit, DISCOVER_RANGE_MAX_EVENTS, 1, DISCOVER_RANGE_MAX_EVENTS);
  const merged = [];
  const seen = new Set();
  for (const event of [...(Array.isArray(current) ? current : []), ...(Array.isArray(incoming) ? incoming : [])]) {
    if (!event || typeof event !== "object") continue;
    const identity = eventIdentity(event);
    if (!identity || seen.has(identity)) continue;
    seen.add(identity);
    merged.push(event);
    if (merged.length >= maximum) break;
  }
  return merged;
}

// The response is provider ordered, but the view still sorts its bounded local
// window so active multi-day events remain first and paging cannot reshuffle it.
export function selectDiscoverRangeEvents(rows, {
  days = 30,
  through = null,
  region = "Worldwide",
  city = "",
  countryForCity,
  now = Date.now(),
  limit = DISCOVER_RANGE_MAX_EVENTS,
} = {}) {
  const at = Number.isFinite(Number(now)) ? Number(now) : Date.now();
  const maximum = boundedInteger(limit, DISCOVER_RANGE_MAX_EVENTS, 0, DISCOVER_RANGE_MAX_EVENTS);
  if (!maximum) return [];
  const throughKey = calendarDateKey(canonicalCalendarDate(through))
    ?? utcDateKeyAfterDays(at, boundedInteger(days, 30, 1, 90));
  const cityIdentity = clean(city, 120).toLocaleLowerCase();
  const seen = new Set();
  const selected = [];
  let scanned = 0;
  for (const event of Array.isArray(rows) ? rows : []) {
    if (scanned >= DISCOVER_RANGE_MAX_EVENTS) break;
    scanned += 1;
    if (!event || typeof event !== "object") continue;
    if (!discoverRowMatchesRegion(event, region, { countryForCity })) continue;
    if (cityIdentity && clean(event.venueCity || event.venue_city || event.city, 120).toLocaleLowerCase() !== cityIdentity) continue;
    const releaseAt = Number(event.releaseAt);
    if (Number.isFinite(releaseAt) && releaseAt > at) continue;
    if (!isCurrentOrUpcomingLiveEvent(event, at)) continue;
    const startKey = calendarDateKey(event.date);
    if (startKey == null || startKey > throughKey) continue;
    const identity = eventIdentity(event);
    if (!identity || seen.has(identity)) continue;
    seen.add(identity);
    selected.push(event);
  }
  return selected
    .sort((left, right) => compareCurrentAndUpcomingLiveEvents(left, right, at) || eventIdentity(left).localeCompare(eventIdentity(right)))
    .slice(0, maximum);
}
