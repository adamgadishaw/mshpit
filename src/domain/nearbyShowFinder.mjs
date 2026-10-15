import { toIsoDate } from "./dates.mjs";
import { createLiveEventEvaluator, liveEventTimeZone } from "./eventLifecycle.mjs";
import { mapCoordinate } from "./mapCoordinates.mjs";
const dayMs = 86400000;
const formatters = new Map();
export function nearbyToday(now = Date.now(), zone = "UTC") {
  let formatter = formatters.get(zone);
  if (!formatter) {
    try {
      formatter = new Intl.DateTimeFormat("en-CA", {
        timeZone: zone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
      });
    } catch {
      return nearbyToday(now, "UTC");
    }
    if (formatters.size >= 64) formatters.delete(formatters.keys().next().value);
    formatters.set(zone, formatter);
  }
  const parts = Object.fromEntries(formatter.formatToParts(new Date(now)).map(p => [p.type, p.value]));
  return parts.year + "-" + parts.month + "-" + parts.day;
}
const shift = (iso, days) => new Date(Date.parse(iso + "T12:00:00Z") + days * dayMs).toISOString().slice(0, 10);
export function nearbyDateWindow(mode, picked, now, zone) {
  const today = nearbyToday(now, zone);
  if (mode === "tonight") return {
    from: today,
    to: today
  };
  if (mode === "date") {
    const date = toIsoDate(picked);
    return date ? {
      from: date,
      to: date
    } : null;
  }
  if (mode === "weekend") {
    const day = new Date(today + "T12:00:00Z").getUTCDay();
    const friday = shift(today, day === 0 ? -2 : 5 - day);
    return {
      from: friday,
      to: shift(friday, 2)
    };
  }
  return null;
}
export function nearbyShowResults(rows, {
  mode = "all",
  picked = "",
  now = Date.now()
} = {}) {
  const evaluate = createLiveEventEvaluator(now),
    windows = new Map(),
    seen = new Set();
  return (Array.isArray(rows) ? rows : []).filter(event => {
    if (!evaluate.isCurrentOrUpcoming(event) || !(event.releaseAt <= now)) return false;
    const start = toIsoDate(event.date),
      end = toIsoDate(event.eventEndDate) || start;
    if (!start) return false;
    const zone = liveEventTimeZone(event) || "UTC";
    if (!windows.has(zone)) windows.set(zone, nearbyDateWindow(mode, picked, now, zone));
    const w = windows.get(zone);
    if (mode === "date" && !w) return false;
    if (w && (start > w.to || end < w.from)) return false;
    const key = event.id || event.providerEventId || [event.artist, event.venue, start].join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((a, b) => toIsoDate(a.date).localeCompare(toIsoDate(b.date)) || String(a.startLocalTime || "").localeCompare(String(b.startLocalTime || "")) || String(a.venue || "").localeCompare(String(b.venue || "")));
}
const text = v => String(v || "").normalize("NFKC").trim().toLowerCase();
export function nearbyPlaceMatches(row, center) {
  const parts = String(row?.place || "").split(",").map(text).filter(Boolean),
    city = text(row?.venueCity || parts[0]);
  if (!text(center?.city) || city !== text(center.city)) return false;
  const state = text(center.state),
    country = text(center.country);
  if (state && !parts.includes(state) && text(row.venueRegion) !== state) return false;
  if (country && !parts.includes(country) && text(row.venueCountry) !== country) return false;
  return true;
}
export function nearbyDirectionsUrl(venue) {
  const coordinate = mapCoordinate(venue) || mapCoordinate(venue?.coord);
  const destination = coordinate ? coordinate.lat + "," + coordinate.lng : [venue?.venue || venue?.name, venue?.place].filter(Boolean).join(", ");
  return destination ? "https://www.google.com/maps/dir/?api=1&destination=" + encodeURIComponent(destination) : null;
}
export function nearbyEventImage(event) {
  if (typeof event?.eventImage !== "string") return null;
  try {
    const url = new URL(event.eventImage);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}
export function nearbyEventDate(event) {
  const date = toIsoDate(event?.date);
  if (!date) return "Date to be announced";
  const [year, month, day] = date.split("-").map(Number);
  const label = new Intl.DateTimeFormat("en", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(new Date(Date.UTC(year, month - 1, day)));
  const endDate = toIsoDate(event?.eventEndDate);
  const range = endDate > date ? " through " + new Intl.DateTimeFormat("en", {timeZone:"UTC",month:"short",day:"numeric",year:"numeric"}).format(new Date(endDate+"T12:00:00Z")) : "";
  const time = String(event?.startLocalTime || "").match(/^(\d{2}):(\d{2})(?::\d{2})?$/);
  const valid = time && +time[1] < 24 && +time[2] < 60;
  return label + range + (valid ? " · " + (+time[1] % 12 || 12) + ":" + time[2] + (+time[1] >= 12 ? " PM" : " AM") : "");
}

// The legacy coordinate catalog is keyed by city name. Only use a point when
// that name identifies exactly one qualified place in the picker catalog.
export function nearbyManualCenter(place, geo, coordinates) {
  const matches = [];
  for (const [continent, countries] of Object.entries(geo || {}))
    for (const [country, states] of Object.entries(countries))
      for (const [state, cities] of Object.entries(states))
        if (cities.includes(place.city)) matches.push({ continent, country, state });
  const match = matches.length === 1 && matches[0];
  const point = match && match.country === place.country && match.state === place.state
    ? mapCoordinate(coordinates?.[place.city]) : null;
  return { ...place, lat: point?.lat ?? null, lng: point?.lng ?? null };
}
