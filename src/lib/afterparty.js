import { mapCoordinate } from "../domain/mapCoordinates.mjs";
import { calendarReadDate } from "../domain/calendarDates.mjs";

const clean = (value, limit = 160) => typeof value === "string" ? value.replace(/\s+/gu, " ").trim().slice(0, limit) : "";

// Search intents only: no business data, hours, rankings or checked-at times.
export const AFTER_SHOW_INTENTS = Object.freeze([
  Object.freeze({ id: "food", label: "Food", icon: "food", note: "Check kitchen hours for when you arrive. A place can stay open after food service ends." }),
  Object.freeze({ id: "stay-out", label: "Stay out", icon: "drink", note: "Check last entry, tickets and age rules with the place. Closing time is not the last time you can get in." }),
  Object.freeze({ id: "get-home", label: "Get home", icon: "map", note: "Set your departure time in Maps and check the last service. Routes, accessibility and ride availability can change." }),
]);

export const AFTERPARTY_CATEGORIES = Object.freeze([
  Object.freeze({ id: "late-food", intent: "food", type: "food", label: "Late-night food", query: "late-night food", description: "Find a bite after the set." }),
  Object.freeze({ id: "coffee", intent: "food", type: "food", label: "Coffee & dessert", query: "cafes and dessert", description: "Somewhere to wind down." }),
  Object.freeze({ id: "bars", intent: "stay-out", type: "bar", label: "Bars", query: "bars", description: "Find somewhere for another round." }),
  Object.freeze({ id: "clubs", intent: "stay-out", type: "club", label: "Clubs & live music", query: "nightclubs and live music", description: "See where the night could go next." }),
  Object.freeze({ id: "activities", intent: "stay-out", type: "activity", label: "Karaoke & arcades", query: "karaoke and arcades", description: "Keep the crew together." }),
]);

export const AFTER_SHOW_TRAVEL_MODES = Object.freeze([
  Object.freeze({ id: "transit", label: "Transit", note: "Set your departure time in Maps and check the last service. A nearby stop doesn’t mean a service is running." }),
  Object.freeze({ id: "walking", label: "Walking", note: "Check the actual walking route and access in Maps. Nearby on a map doesn’t always mean a short walk." }),
  Object.freeze({ id: "driving", label: "Driving", note: "Check the route and venue pickup rules. Driving directions don’t confirm ride availability." }),
]);

// Compatibility name: validation is not independent venue verification.
// The caller owns the venue-to-coordinate identity match.
export function verifiedVenueCoordinate(coord) {
  return mapCoordinate(coord);
}

export function mapsSearch(query, coord, place = "") {
  const location = verifiedVenueCoordinate(coord);
  const term = clean(query);
  if (!location || !term) return null;
  const anchor = clean(place) || `${location.lat},${location.lng}`;
  // Documented universal URL. A category query is a location hint, not a radius
  // guarantee. No unsupported viewport, departure-time or open-at filter.
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${term} near ${anchor}`)}`;
}

export function afterpartySearches(coord, place = "", intent = null) {
  if (!verifiedVenueCoordinate(coord)) return [];
  return AFTERPARTY_CATEGORIES.filter((category) => !intent || category.intent === intent)
    .map((category) => ({ ...category, url: mapsSearch(category.query, coord, place) }));
}

export function afterShowDirections(coord, destination, mode = "transit") {
  const location = verifiedVenueCoordinate(coord);
  const target = clean(destination, 200);
  if (!location || !target || !AFTER_SHOW_TRAVEL_MODES.some(({ id }) => id === mode)) return null;
  return `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(`${location.lat},${location.lng}`)}&destination=${encodeURIComponent(target)}&travelmode=${mode}`;
}

const dateLabel = (date) => new Intl.DateTimeFormat("en", {
  weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC",
}).format(new Date(`${date}T12:00:00Z`));

export function afterShowContext(log = {}, coord, lifecycle = "unknown") {
  const location = verifiedVenueCoordinate(coord);
  const venue = clean(log?.venue);
  const city = clean(log?.city);
  const place = [venue, city].filter(Boolean).join(", ");
  // A calendar date is not an instant. Never reinterpret it in the device zone,
  // use the legacy 8pm countdown fallback, or derive a finish from a duration.
  const date = calendarReadDate(log?.localDate) || calendarReadDate(log?.date);
  const proposedEnd = calendarReadDate(log?.eventEndDate || log?.endDate);
  const end = proposedEnd > date && date ? proposedEnd : null;
  const showDate = date ? `${dateLabel(date)}${end ? ` – ${dateLabel(end)}` : ""}` : null;
  const neutral = ["completed", "cancelled", "postponed"].includes(lifecycle);
  return {
    location, place, venue: venue || "the venue", showDate, neutral,
    title: neutral ? "AROUND THE VENUE" : "AFTER THE SHOW",
    scope: JSON.stringify([log?.showId || log?.id || null, venue, city, date, end, location, lifecycle]),
    timingNote: neutral
      ? "Map results describe current listings, not availability on this show’s date."
      : end
        ? "Choose the night you’re heading out. Check arrival-day hours, including after midnight."
        : "Check hours for the date you’ll arrive, including after midnight. Show finish time isn’t confirmed here.",
  };
}

// Existing widget contract: directions TO the venue, not away from it.
export { mapsDir } from "./mapsDirections.mjs";
