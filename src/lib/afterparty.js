import { mapCoordinate } from "../domain/mapCoordinates.mjs";

// Nearby after-show discovery must stay truthful. Pit does not have a live
// Places data source, so it must never manufacture business names, distances,
// or opening hours. These are category searches that hand the decision to live
// Google Maps results at the venue's verified coordinates.
export const AFTERPARTY_CATEGORIES = Object.freeze([
  Object.freeze({
    id: "late-food",
    type: "food",
    label: "Late-night food",
    query: "late-night food open now",
    description: "Check current kitchens, hours, and routes in Maps.",
  }),
  Object.freeze({
    id: "bars",
    type: "bar",
    label: "Bars",
    query: "bars open now",
    description: "Compare live hours, entry details, and walking routes.",
  }),
  Object.freeze({
    id: "clubs",
    type: "club",
    label: "Clubs & live music",
    query: "nightclubs and live music open now",
    description: "Find currently listed nightlife near the venue.",
  }),
  Object.freeze({
    id: "activities",
    type: "activity",
    label: "Karaoke & arcades",
    query: "karaoke and arcades open now",
    description: "Explore live activity listings and verify closing times.",
  }),
]);

export function verifiedVenueCoordinate(coord) {
  return mapCoordinate(coord);
}

export function mapsSearch(query, coord) {
  const location = verifiedVenueCoordinate(coord);
  const term = String(query || "").trim();
  if (!location || !term) return null;
  const nearbyQuery = `${term} near ${location.lat},${location.lng}`;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(nearbyQuery)}`;
}

export function afterpartySearches(coord) {
  const location = verifiedVenueCoordinate(coord);
  if (!location) return [];
  return AFTERPARTY_CATEGORIES.map((category) => ({
    ...category,
    url: mapsSearch(category.query, location),
  }));
}

export const mapsDir = (lat, lng) => `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
