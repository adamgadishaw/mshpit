import { canonicalVenueKey, normalizeVenueKey } from "../../../src/domain/venueIdentity.mjs";
import { GEO } from "../../../src/domain/geo.mjs";
import { cityIdentity } from "../../../src/domain/cityIdentity.mjs";

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

function cityLocationIndex(venues) {
  const byCity = new Map();
  const names = new Intl.DisplayNames(["en"], { type: "region" });
  const countryCodes = new Map();
  for (let a = 65; a <= 90; a++) for (let b = 65; b <= 90; b++) {
    const code = String.fromCharCode(a, b), name = names.of(code);
    if (name && name !== code) countryCodes.set(normalized(name), code);
  }
  countryCodes.set("united states", "US");
  countryCodes.set("united kingdom", "GB");
  countryCodes.set("south korea", "KR");
  const add = (value, withCoordinates) => {
    if (!value || typeof value !== "object") return;
    const identity = cityIdentity(value.countryCode, value.city, value.region);
    if (!identity) return;
    const city = normalized(identity.city), key = `${identity.countryCode}/${identity.citySlug}`;
    const entries = byCity.get(city) || new Map();
    const existing = entries.get(key) || { ...value, ...identity, qualifiers: new Set(), coordinates: [] };
    for (const part of [value.region, identity.region, value.country, value.countryCode]) {
      if (normalized(part)) existing.qualifiers.add(normalized(part));
    }
    const location = locationFor(value);
    if (withCoordinates && location.lat !== null && location.lng !== null) existing.coordinates.push(location);
    entries.set(key, existing);
    byCity.set(city, entries);
  };
  // Include known homonyms even when only one has a venue coordinate. Missing
  // coverage must not make London, Springfield or Portland falsely unambiguous.
  for (const continent of Object.values(GEO)) for (const [country, regions] of Object.entries(continent)) {
    const countryCode = countryCodes.get(normalized(country));
    if (!countryCode) continue;
    for (const [region, cities] of Object.entries(regions)) for (const city of cities) {
      add({ city, region, country, countryCode }, false);
    }
  }
  for (const venue of venues) add(venue, true);
  const median = (values) => {
    const sorted = values.slice().sort((a, b) => a - b), middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  };
  // Aggregate once while constructing the resolver, not once per review on
  // every profile read. Aliases for one room must not weight a city's point.
  for (const entries of byCity.values()) for (const entry of entries.values()) {
    const points = [...new Map(entry.coordinates.map((point) => [`${point.lat}/${point.lng}`, point])).values()];
    delete entry.coordinates;
    entry.location = null;
    if (!points.length) continue;
    const longitudes = points.map((point) => point.lng);
    const spansDateLine = Math.max(...longitudes) - Math.min(...longitudes) > 180;
    const rawLng = median(spansDateLine ? longitudes.map((lng) => lng < 0 ? lng + 360 : lng) : longitudes);
    const lat = Math.round(median(points.map((point) => point.lat)) * 10) / 10;
    const lng = Math.round((rawLng > 180 ? rawLng - 360 : rawLng) * 10) / 10;
    if (lat === 0 && lng === 0) continue;
    entry.location = { lat, lng, countryCode: entry.countryCode, country: entry.country, locationPrecision: "city" };
  }
  return (value) => {
    const parts = text(value).split(",").map(normalized).filter(Boolean);
    const candidates = [...(byCity.get(parts[0])?.values() || [])]
      .filter((entry) => parts.slice(1).every((part) => entry.qualifiers.has(part)));
    if (candidates.length !== 1 || !candidates[0].location) return { ...EMPTY_CONCERT_LOCATION };
    // Approximate city placement comes only from existing public catalogue
    // facts, rounded deliberately. An authored address is never geocoded.
    return { ...candidates[0].location };
  };
}

/** Resolve catalogue venues or explicit city context; never geocode or infer from home. */
export function createConcertHistoryLocationResolver(venues = []) {
  const byKey = new Map();
  const byName = new Map();
  const add = (index, key, venue) => {
    if (!key) return;
    const candidates = index.get(key) || [];
    candidates.push(venue);
    index.set(key, candidates);
  };
  const catalog = Array.isArray(venues) ? venues : [];
  const resolveCity = cityLocationIndex(catalog);
  for (const venue of catalog) {
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
    if (unique.size === 1) {
      const exact = locationFor(unique.values().next().value);
      if (exact.lat !== null && exact.lng !== null) return exact;
    }
    return resolveCity(post?.city);
  };
}
