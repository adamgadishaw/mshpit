import { toIsoDate } from "./dates.mjs";

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

// Keep the plain-language countdown useful for a full month of upcoming live
// shows. Beyond this boundary the compact card falls back to an exact date,
// which stays clearer than an increasingly large relative-day number.
export const LIVE_SHOW_COUNTDOWN_DAYS = 30;

const locationKey = (value) => String(value || "")
  .normalize("NFKD")
  .replace(/[\u0300-\u036f]/g, "")
  .trim()
  .toLocaleLowerCase();

const COUNTRY_ALIASES = new Map([
  ["great britain", "United Kingdom"],
  ["u.k", "United Kingdom"],
  ["u.k.", "United Kingdom"],
  ["uk", "United Kingdom"],
  ["united kingdom of great britain and northern ireland", "United Kingdom"],
  ["u.s", "United States"],
  ["u.s.", "United States"],
  ["u.s.a", "United States"],
  ["u.s.a.", "United States"],
  ["us", "United States"],
  ["usa", "United States"],
  ["united states of america", "United States"],
]);

const PLACEHOLDER_CITIES = new Set([
  "location unavailable",
  "region unavailable",
  "tba",
  "tbd",
  "unknown",
  "venue tba",
]);

export function canonicalVenueCountry(value) {
  const text = String(value || "").trim();
  return COUNTRY_ALIASES.get(locationKey(text)) || text;
}

const venuePlaceParts = (value) => {
  const parts = String(value || "").split(",").map((part) => part.trim()).filter(Boolean);
  if (parts.length > 1) parts[parts.length - 1] = canonicalVenueCountry(parts[parts.length - 1]);
  return parts;
};

export function splitVenuePlace(value) {
  const parts = venuePlaceParts(value);
  return {
    city: parts[0] || "Location unavailable",
    region: parts.slice(1).join(", "),
  };
}

// JSON and SQLite both commonly project an absent numeric field as null. Since
// Number(null) is 0, distance labels must reject missing/blank values before
// coercion or a worldwide listing can falsely look like it is 0.0 km away.
export function optionalDistanceKm(value) {
  if (value == null || value === "" || typeof value === "boolean") return null;
  const distance = Number(value);
  return Number.isFinite(distance) && distance >= 0 ? distance : null;
}

// City names are not globally unique. Directory state and React keys must use
// the complete place, otherwise London, Ontario and London, England collapse
// into one misleading card whose region depends on insertion order.
export function venuePlaceIdentity(value) {
  const parts = venuePlaceParts(value);
  const city = parts[0] || "Unknown";
  const region = parts.slice(1).join(", ");
  return {
    id: parts.length ? parts.map(locationKey).join("|") : "unknown",
    city,
    region,
  };
}

export function isVenuePlaceActionable(value) {
  const parts = venuePlaceParts(value);
  return parts.length > 0 && !PLACEHOLDER_CITIES.has(locationKey(parts[0]));
}

// Resolve a LocationPicker selection from exact venue coordinates instead of a
// city-name-only lookup. This is deliberately fail-honest: when no matching
// mapped venue exists, return null coordinates rather than silently borrowing a
// same-named city in another state or country.
export function locationCenterFromVenues(place, venues = []) {
  const city = String(place?.city || "").trim();
  const state = String(place?.state || "").trim();
  const country = String(place?.country || "").trim();
  const wantedCity = locationKey(city);
  const wantedState = locationKey(state);
  const wantedCountry = locationKey(canonicalVenueCountry(country));
  const matches = (Array.isArray(venues) ? venues : []).filter((venue) => {
    const parts = venuePlaceParts(venue?.place).map((part) => locationKey(part));
    if (!venue?.coord || parts[0] !== wantedCity) return false;
    if (wantedState && !parts.slice(1).includes(wantedState)) return false;
    if (wantedCountry && !parts.slice(1).includes(wantedCountry)) return false;
    return Number.isFinite(Number(venue.coord.lat)) && Number.isFinite(Number(venue.coord.lng));
  });
  const label = String(place?.label || [city, state, country].filter(Boolean).join(", ")).trim();
  if (!matches.length) return { city, state, country, label, lat: null, lng: null };
  const sum = matches.reduce((total, venue) => ({
    lat: total.lat + Number(venue.coord.lat),
    lng: total.lng + Number(venue.coord.lng),
  }), { lat: 0, lng: 0 });
  return {
    city,
    state,
    country,
    label,
    lat: sum.lat / matches.length,
    lng: sum.lng / matches.length,
  };
}

export function venueDirectoryTotals(cities = []) {
  return cities.reduce((totals, city) => ({
    cities: totals.cities + 1,
    venues: totals.venues + Math.max(0, Number(city?.count) || 0),
    upcoming: totals.upcoming + Math.max(0, Number(city?.upcoming) || 0),
  }), { cities: 0, venues: 0, upcoming: 0 });
}

export function venueRowWindow(items = [], visibleCount = 0, batchSize = 1) {
  const rows = Array.isArray(items) ? items : [];
  const batch = Math.max(1, Math.trunc(Number(batchSize) || 1));
  const requested = Math.max(batch, Math.trunc(Number(visibleCount) || batch));
  const end = Math.min(rows.length, requested);
  return {
    rows: rows.slice(0, end),
    remaining: rows.length - end,
    nextCount: Math.min(rows.length, end + batch),
  };
}

export function venueHomePlaceId(home, cities = []) {
  const cityName = locationKey(home?.city);
  if (!cityName) return null;
  const candidates = (Array.isArray(cities) ? cities : []).filter((entry) => locationKey(entry?.city) === cityName);
  if (!candidates.length) return null;
  if (candidates.length === 1) return candidates[0].id;

  const exactLabel = String(home?.label || [home?.city, home?.state, home?.country].filter(Boolean).join(", ")).trim();
  if (home?.state || home?.country) {
    const exactId = venuePlaceIdentity(exactLabel).id;
    if (candidates.some((entry) => entry.id === exactId)) return exactId;
  }

  const homeLat = Number(home?.lat);
  const homeLng = Number(home?.lng);
  if (Number.isFinite(homeLat) && Number.isFinite(homeLng)) {
    const ranked = candidates.map((entry) => {
      const coords = (entry.venues || []).map((venue) => venue?.coord).filter((coord) => Number.isFinite(Number(coord?.lat)) && Number.isFinite(Number(coord?.lng)));
      if (!coords.length) return { id: entry.id, distance: Infinity };
      const center = coords.reduce((sum, coord) => ({ lat: sum.lat + Number(coord.lat), lng: sum.lng + Number(coord.lng) }), { lat: 0, lng: 0 });
      center.lat /= coords.length;
      center.lng /= coords.length;
      const lngScale = Math.cos((homeLat * Math.PI) / 180);
      return { id: entry.id, distance: (center.lat - homeLat) ** 2 + ((center.lng - homeLng) * lngScale) ** 2 };
    }).sort((a, b) => a.distance - b.distance || String(a.id).localeCompare(String(b.id)));
    if (Number.isFinite(ranked[0]?.distance)) return ranked[0].id;
  }
  return candidates.slice().sort((a, b) => String(a.id).localeCompare(String(b.id)))[0]?.id || null;
}

export function eventDateMeta(value, now = new Date()) {
  const iso = toIsoDate(value);
  if (!iso) return { iso: "", month: "TBA", day: "--", year: "", timing: "Date to be announced" };
  const [year, month, day] = iso.split("-").map(Number);
  const currentUtc = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const eventUtc = Date.UTC(year, month - 1, day);
  const daysAway = Math.round((eventUtc - currentUtc) / 86_400_000);
  const timing = daysAway === 0
    ? "Tonight"
    : daysAway === 1
      ? "Tomorrow"
      : daysAway > 1 && daysAway <= LIVE_SHOW_COUNTDOWN_DAYS
        ? `In ${daysAway} days`
        : `${MONTHS[month - 1]} ${day}`;
  return {
    iso,
    month: MONTHS[month - 1],
    day: String(day).padStart(2, "0"),
    year: String(year),
    timing,
  };
}

export function nearestMapPoints(points = [], limit = 60) {
  const safeLimit = Math.max(1, Number(limit) || 1);
  return points
    .filter((point) => point && point.lat != null && point.lng != null)
    .slice()
    .sort((a, b) => (Number(a.distanceKm) || 0) - (Number(b.distanceKm) || 0))
    .slice(0, safeLimit);
}
