import { venueCapacity, venueCoordinates, venuePlacesMatch } from "../src/domain/venueGuide.mjs";
import { isVenuePlaceActionable } from "../src/domain/venueDiscovery.mjs";
import { arenaVenues } from "../src/domain/majorVenueFacts.mjs";

const normalizeName = (value) => String(value || "").replace(/\s+/gu, " ").trim().toLocaleLowerCase("en");

// Prefer the provider's complete structured locality over its display label.
// A city alone must never stand in for proof of which same-named room this is.
export function publicVenuePlace(row = {}) {
  const clean = (value) => typeof value === "string" ? value.replace(/\s+/gu, " ").trim() : "";
  const city = clean(row?.venue_city);
  const country = clean(row?.venue_country) || clean(row?.venue_country_code);
  return city && country
    ? [city, clean(row?.venue_region), country].filter(Boolean).join(", ")
    : clean(row?.place) || null;
}

// Calendar availability is not the only useful venue content. Require real,
// validated visitor facts; generated Maps links or an image alone do not count.
// Both sitemap selection and the rendered page use this exact rule.
export function hasSubstantiveVenueGuide(venue = {}) {
  return Boolean(normalizeName(venue?.name)
    && venue?.guideLocationVerified === true
    && isVenuePlaceActionable(venue?.place)
    && venueCapacity(venue?.capacity)
    && venueCoordinates(venue?.coord));
}

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
