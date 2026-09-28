import { mapCoordinate } from "../domain/mapCoordinates.mjs";

// Nearby after-show discovery must stay truthful. Pit does not have a live
// Places data source, so it must never manufacture business names, distances,
// or opening hours. These are category searches that hand the decision to live
// Google Maps results around the venue's verified coordinates.
//
// Searches name the venue ("bars near Massey Hall, Toronto") and open the map
// on its coordinates: Google's search links have no center parameter, and a
// bare "near 43.65,-79.38" was often ignored in favour of where the phone is.
// No "open now" either: people plan ahead for a show next week.
export const AFTERPARTY_CATEGORIES = Object.freeze([
  Object.freeze({
    id: "late-food",
    type: "food",
    label: "Late-night food",
    query: "late-night food",
    description: "Check kitchens, closing times, and routes in Maps.",
  }),
  Object.freeze({
    id: "bars",
    type: "bar",
    label: "Bars",
    query: "bars",
    description: "Compare hours for show night, entry details, and walking routes.",
  }),
  Object.freeze({
    id: "clubs",
    type: "club",
    label: "Clubs & live music",
    query: "nightclubs and live music",
    description: "Find listed nightlife near the venue.",
  }),
  Object.freeze({
    id: "activities",
    type: "activity",
    label: "Karaoke & arcades",
    query: "karaoke and arcades",
    description: "Explore activity listings and verify closing times.",
  }),
]);

export function verifiedVenueCoordinate(coord) {
  return mapCoordinate(coord);
}

// `place` is the venue as people search for it ("Massey Hall, Toronto");
// without it the coordinates stand in.
export function mapsSearch(query, coord, place = "") {
  const location = verifiedVenueCoordinate(coord);
  const term = String(query || "").trim();
  if (!location || !term) return null;
  const anchor = String(place || "").replace(/\s+/g, " ").trim().slice(0, 160) || `${location.lat},${location.lng}`;
  return `https://www.google.com/maps/search/${encodeURIComponent(`${term} near ${anchor}`)}/@${location.lat},${location.lng},15z`;
}

export function afterpartySearches(coord, place = "") {
  const location = verifiedVenueCoordinate(coord);
  if (!location) return [];
  return AFTERPARTY_CATEGORIES.map((category) => ({
    ...category,
    url: mapsSearch(category.query, location, place),
  }));
}

export const mapsDir = (lat, lng) => `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
