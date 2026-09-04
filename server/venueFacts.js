import { venuePlacesMatch } from "../src/domain/venueGuide.mjs";
import { arenaVenues } from "../src/domain/majorVenueFacts.mjs";

const normalizeName = (value) => String(value || "").replace(/\s+/gu, " ").trim().toLocaleLowerCase("en");

/**
 * Return only hand-verified venue facts. A provider-scoped venue must also
 * match the curated city and country so a same-named room cannot inherit
 * another building's capacity or coordinates.
 */
export function publicVenueFacts({ name, place = null, providerVenueId = null } = {}) {
  const fact = arenaVenues[normalizeName(name)];
  if (!fact) return null;
  if (place && !venuePlacesMatch(place, fact.place)) return null;
  if (providerVenueId && !place) return null;
  return Object.freeze({
    place: fact.place,
    capacity: fact.capacity,
    coord: Object.freeze({ lat: fact.lat, lng: fact.lng }),
  });
}
