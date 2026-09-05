import { canonicalVenueKey } from "../../src/domain/venueIdentity.mjs";
import { providerVenuePhotoCatalogKey } from "../../server/venuePhotoCatalogIdentity.js";
import { hasLicensedVenuePhoto } from "./venue-photo-record.mjs";

export const MAX_PROVIDER_VENUE_BINDING_DISTANCE_METERS = 500;

const clean = (value) => String(value ?? "").normalize("NFKC").trim().replace(/\s+/gu, " ");

function coordinate(value, minimum, maximum) {
  if (value == null || (typeof value === "string" && !value.trim())) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= minimum && number <= maximum ? number : null;
}

const radians = (value) => value * Math.PI / 180;

export function venuePhotoBindingDistanceMeters(left, right) {
  const coordinates = [
    coordinate(left?.lat, -90, 90), coordinate(left?.lng, -180, 180),
    coordinate(right?.lat, -90, 90), coordinate(right?.lng, -180, 180),
  ];
  if (coordinates.some((value) => value == null)) return null;
  const [leftLat, leftLng, rightLat, rightLng] = coordinates;
  const dLat = radians(rightLat - leftLat);
  const dLng = radians(rightLng - leftLng);
  const haversine = Math.sin(dLat / 2) ** 2
    + Math.cos(radians(leftLat)) * Math.cos(radians(rightLat)) * Math.sin(dLng / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function catalogCandidates(catalogVenues, photoCatalog) {
  const candidates = [];
  for (const [catalogKey, photoRow] of Object.entries(photoCatalog || {})) {
    if (catalogKey.startsWith("provider:") || !hasLicensedVenuePhoto(photoRow)) continue;
    const venue = catalogVenues?.[catalogKey];
    const lat = coordinate(venue?.lat, -90, 90);
    const lng = coordinate(venue?.lng, -180, 180);
    if (!venue || lat == null || lng == null) continue;
    const names = new Set([
      canonicalVenueKey(catalogKey),
      canonicalVenueKey(venue.name),
    ].filter(Boolean));
    if (!names.size) continue;
    candidates.push(Object.freeze({ catalogKey, lat, lng, names }));
  }
  return Object.freeze(candidates.sort((left, right) => left.catalogKey.localeCompare(right.catalogKey)));
}

function providerGroups(tourDateRows) {
  const groups = new Map();
  for (const row of Array.isArray(tourDateRows) ? tourDateRows : []) {
    const providerKey = providerVenuePhotoCatalogKey(row?.source, row?.venue_provider_id);
    if (!providerKey) continue;
    const rows = groups.get(providerKey) || [];
    rows.push(row);
    groups.set(providerKey, rows);
  }
  return [...groups.entries()].sort(([left], [right]) => left.localeCompare(right));
}

/**
 * Build provider-ID -> licensed name-pool bindings without guessing identity.
 * A binding requires one explicit canonical name and location evidence from
 * every observed provider row. Both the provider rows and the catalogue venue
 * must land within a tight radius. Any missing or conflicting evidence fails
 * closed. Exact provider photo rows are deliberately excluded because they are
 * authoritative even when empty after a rights removal.
 */
export function buildVenuePhotoProviderBindings(
  catalogVenues = {},
  tourDateRows = [],
  photoCatalog = {},
  { maxDistanceMeters = MAX_PROVIDER_VENUE_BINDING_DISTANCE_METERS } = {},
) {
  if (!Number.isFinite(maxDistanceMeters) || maxDistanceMeters <= 0 || maxDistanceMeters > 2_000) {
    throw new Error("provider venue binding distance must be between 1 and 2000 metres.");
  }
  const candidates = catalogCandidates(catalogVenues, photoCatalog);
  const bindings = {};
  const rejected = {
    exactProviderRow: 0,
    missingLocation: 0,
    ambiguousProviderIdentity: 0,
    noCatalogMatch: 0,
    ambiguousCatalogMatch: 0,
  };

  const groups = providerGroups(tourDateRows);
  for (const [providerKey, rows] of groups) {
    if (Object.prototype.hasOwnProperty.call(photoCatalog || {}, providerKey)) {
      rejected.exactProviderRow += 1;
      continue;
    }
    const providerNames = new Set(rows.map((row) => canonicalVenueKey(clean(row?.venue))).filter(Boolean));
    if (providerNames.size !== 1) {
      rejected.ambiguousProviderIdentity += 1;
      continue;
    }
    const locatedRows = rows.map((row) => ({
      lat: coordinate(row?.lat, -90, 90),
      lng: coordinate(row?.lng, -180, 180),
    }));
    if (locatedRows.some((row) => row.lat == null || row.lng == null)) {
      rejected.missingLocation += 1;
      continue;
    }
    const locationConflict = locatedRows.some((left, leftIndex) =>
      locatedRows.slice(leftIndex + 1).some((right) =>
        venuePhotoBindingDistanceMeters(left, right) > maxDistanceMeters));
    if (locationConflict) {
      rejected.ambiguousProviderIdentity += 1;
      continue;
    }
    const providerName = [...providerNames][0];
    const matches = candidates.filter((candidate) => {
      if (!candidate.names.has(providerName)) return false;
      return locatedRows.every((row) => {
        const distance = venuePhotoBindingDistanceMeters(row, candidate);
        return distance != null && distance <= maxDistanceMeters;
      });
    });
    if (matches.length === 0) {
      rejected.noCatalogMatch += 1;
      continue;
    }
    if (matches.length !== 1) {
      rejected.ambiguousCatalogMatch += 1;
      continue;
    }
    bindings[providerKey] = matches[0].catalogKey;
  }

  return Object.freeze({
    bindings: Object.freeze(bindings),
    stats: Object.freeze({
      providerIdentities: groups.length,
      eligibleCatalogVenues: candidates.length,
      bound: Object.keys(bindings).length,
      rejected: Object.freeze(rejected),
    }),
  });
}

export function serializeVenuePhotoProviderBindings(bindings) {
  const ordered = Object.fromEntries(Object.entries(bindings || {})
    .sort(([left], [right]) => left.localeCompare(right)));
  return `${JSON.stringify(ordered, null, 2)}\n`;
}
