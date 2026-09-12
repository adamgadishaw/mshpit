import { canonicalVenueKey, normalizeVenueKey } from "../../../src/domain/venueIdentity.mjs";

const text = (value) => typeof value === "string" ? value.trim() : "";
const normalized = (value) => normalizeVenueKey(text(value));
const identityKey = (value) => text(value).startsWith("provider:")
  ? text(value) : canonicalVenueKey(text(value));

export const EMPTY_CONCERT_LOCATION = Object.freeze({
  lat: null, lng: null, countryCode: null, country: null,
});

function locationFor(venue) {
  const { lat, lng } = venue;
  // Null, empty strings and booleans must never coerce to a pin at (0, 0).
  // Zero on either axis is a legitimate coordinate; the null-island pair is not.
  const coordinatesValid = typeof lat === "number" && typeof lng === "number"
    && Number.isFinite(lat) && Number.isFinite(lng)
    && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180
    && !(lat === 0 && lng === 0);
  const countryCode = text(venue.countryCode).toUpperCase();
  const country = text(venue.country);
  return {
    lat: coordinatesValid ? lat : null,
    lng: coordinatesValid ? lng : null,
    countryCode: /^[A-Z]{2}$/u.test(countryCode) ? countryCode : null,
    country: country.slice(0, 80) || null,
  };
}

function cityMatches(value, venue) {
  const parts = text(value).split(",").map(normalized).filter(Boolean);
  if (!parts.length || parts[0] !== normalized(venue.city)) return false;
  const qualifiers = new Set([venue.region, venue.country, venue.countryCode].map(normalized).filter(Boolean));
  return parts.slice(1).every((part) => qualifiers.has(part));
}

/** Resolve only existing catalog identities; never geocode or infer from home. */
export function createConcertHistoryLocationResolver(venues = []) {
  const byKey = new Map();
  const byName = new Map();
  const add = (index, key, venue) => {
    if (!key) return;
    const candidates = index.get(key) || [];
    candidates.push(venue);
    index.set(key, candidates);
  };
  for (const venue of Array.isArray(venues) ? venues : []) {
    if (!venue || !text(venue.name) || !text(venue.city)) continue;
    add(byKey, identityKey(venue.key), venue);
    add(byName, canonicalVenueKey(venue.name), venue);
  }
  return (post) => {
    const boundKey = identityKey(post?.venueKey ?? post?.venue_key);
    // A supplied binding is authoritative. An unknown binding cannot silently
    // fall back to a different same-named room.
    const candidates = boundKey
      ? byKey.get(boundKey) || []
      : byName.get(canonicalVenueKey(post?.venue)) || [];
    const matches = candidates.filter((venue) => cityMatches(post?.city, venue));
    const unique = new Map(matches.map((venue) => [JSON.stringify([
      identityKey(venue.key), normalized(venue.city), normalized(venue.region),
      normalized(venue.countryCode), venue.lat, venue.lng,
    ]), venue]));
    return unique.size === 1 ? locationFor(unique.values().next().value) : { ...EMPTY_CONCERT_LOCATION };
  };
}
