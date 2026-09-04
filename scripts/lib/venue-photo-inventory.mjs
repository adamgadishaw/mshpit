import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  canonicalVenueKey,
  resolveVenueCatalogKey,
  venueIdentityFingerprint,
} from "../../src/domain/venueIdentity.mjs";
import { providerVenuePhotoCatalogKey } from "../../server/venuePhotoCatalogIdentity.js";
import { hasLicensedVenuePhoto } from "./venue-photo-record.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_DATABASE_PATH = join(HERE, "..", "..", "server", "data", "pit.db");
const DEFAULT_ROW_LIMIT = 100_000;
const MAX_ROW_LIMIT = 250_000;

const clean = (value) => String(value ?? "").normalize("NFKC").trim().replace(/\s+/gu, " ");
const normalized = (value) => clean(value).toLocaleLowerCase("en");

function coordinate(value, minimum, maximum) {
  if (value == null || (typeof value === "string" && !value.trim())) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= minimum && number <= maximum ? number : null;
}

function safeLimit(value) {
  const limit = Number(value);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_ROW_LIMIT) {
    throw new Error(`venue inventory limit must be an integer from 1 to ${MAX_ROW_LIMIT}.`);
  }
  return limit;
}

export function resolveVenuePhotoDatabasePath(databasePath, { env = process.env } = {}) {
  const explicit = clean(databasePath);
  if (explicit) return resolve(explicit);
  const dataDirectory = clean(env?.PIT_DATA_DIR);
  return resolve(dataDirectory ? join(dataDirectory, "pit.db") : DEFAULT_DATABASE_PATH);
}

export function readTourDateVenueRows(databasePath, { limit = DEFAULT_ROW_LIMIT } = {}) {
  const path = resolveVenuePhotoDatabasePath(databasePath);
  if (!existsSync(path)) {
    return Object.freeze({ available: false, reason: "database-missing", rows: Object.freeze([]) });
  }
  const bounded = safeLimit(limit);
  let database;
  try {
    database = new DatabaseSync(path, { readOnly: true });
    database.exec("PRAGMA query_only=ON");
    const hasTourDates = database.prepare(
      "SELECT 1 AS present FROM sqlite_master WHERE type='table' AND name='tour_dates'",
    ).get()?.present === 1;
    if (!hasTourDates) {
      return Object.freeze({ available: false, reason: "tour-dates-missing", rows: Object.freeze([]) });
    }
    const columns = new Set(database.prepare("PRAGMA table_info(tour_dates)").all().map((row) => row.name));
    const required = [
      "venue", "source", "venue_provider_id", "place", "venue_city", "venue_region",
      "venue_country_code", "venue_country", "lat", "lng", "updated_at",
    ];
    if (required.some((column) => !columns.has(column))) {
      return Object.freeze({ available: false, reason: "tour-dates-schema-incomplete", rows: Object.freeze([]) });
    }
    const rows = database.prepare(`SELECT
        venue,source,venue_provider_id,
        MAX(NULLIF(TRIM(place),'')) AS place,
        venue_city,MAX(NULLIF(TRIM(venue_region),'')) AS venue_region,
        venue_country_code,MAX(NULLIF(TRIM(venue_country),'')) AS venue_country,
        MAX(lat) AS lat,MAX(lng) AS lng,MAX(updated_at) AS updated_at
      FROM tour_dates
      WHERE TRIM(COALESCE(venue,''))<>''
      GROUP BY LOWER(TRIM(venue)),LOWER(TRIM(COALESCE(source,''))),
        LOWER(TRIM(COALESCE(venue_provider_id,''))),
        LOWER(TRIM(COALESCE(venue_city,''))),UPPER(TRIM(COALESCE(venue_country_code,'')))
      ORDER BY LOWER(TRIM(venue)),LOWER(TRIM(COALESCE(source,''))),
        LOWER(TRIM(COALESCE(venue_provider_id,'')))
      LIMIT ?`).all(bounded + 1);
    if (rows.length > bounded) {
      throw new Error(`tour-date venue inventory exceeded the safe ${bounded}-row bound.`);
    }
    return Object.freeze({ available: true, reason: null, rows: Object.freeze(rows.map(Object.freeze)) });
  } finally {
    try { database?.close(); } catch {}
  }
}

function structuredPlace(row) {
  const parts = [row?.venue_city, row?.venue_region, row?.venue_country]
    .map(clean).filter(Boolean);
  return parts.length ? parts.join(", ") : clean(row?.place) || null;
}

function candidateLocation(row) {
  const city = normalized(row?.venue_city || String(row?.place || "").split(",")[0]);
  const country = normalized(row?.venue_country_code || row?.venue_country);
  return { city, country };
}

function candidateScore(row) {
  const lat = coordinate(row?.lat, -90, 90);
  const lng = coordinate(row?.lng, -180, 180);
  return Number(Boolean(clean(row?.venue_city))) * 8
    + Number(Boolean(clean(row?.venue_country_code || row?.venue_country))) * 4
    + Number(lat != null && lng != null) * 2
    + Number(Boolean(clean(row?.place)));
}

function venueCandidate(row) {
  const name = clean(row?.venue || row?.name);
  if (!name) return null;
  const providerKey = providerVenuePhotoCatalogKey(row?.source, row?.venue_provider_id);
  const key = providerKey || canonicalVenueKey(name);
  if (!key) return null;
  return {
    key,
    name,
    place: structuredPlace(row),
    lat: coordinate(row?.lat, -90, 90),
    lng: coordinate(row?.lng, -180, 180),
    source: clean(row?.source) || null,
    providerVenueId: clean(row?.venue_provider_id) || null,
    location: candidateLocation(row),
    score: candidateScore(row),
  };
}

function groupIsAmbiguous(candidates) {
  const names = new Set(candidates.map((item) =>
    venueIdentityFingerprint(canonicalVenueKey(item.name))).filter(Boolean));
  const cities = new Set(candidates.map((item) => item.location.city).filter(Boolean));
  const countries = new Set(candidates.map((item) => item.location.country).filter(Boolean));
  return names.size > 1 || cities.size > 1 || countries.size > 1;
}

function fillMissing(base, candidate, origins) {
  return {
    ...base,
    name: clean(base?.name) || candidate.name,
    place: clean(base?.place) || candidate.place,
    lat: coordinate(base?.lat, -90, 90) ?? candidate.lat,
    lng: coordinate(base?.lng, -180, 180) ?? candidate.lng,
    _inventoryOrigins: Object.freeze([...origins].sort()),
  };
}

export function buildVenuePhotoInventory(catalogVenues = {}, tourDateRows = []) {
  const inventory = new Map();
  const origins = new Map();
  for (const [rawKey, venue] of Object.entries(catalogVenues || {})) {
    const key = canonicalVenueKey(rawKey) || normalized(rawKey);
    const name = clean(venue?.name || rawKey);
    if (!key || !name || inventory.has(key)) continue;
    inventory.set(key, { ...venue, name, _inventoryOrigins: Object.freeze(["catalog"]) });
    origins.set(key, new Set(["catalog"]));
  }

  const groups = new Map();
  for (const row of Array.isArray(tourDateRows) ? tourDateRows : []) {
    const candidate = venueCandidate(row);
    if (!candidate) continue;
    const group = groups.get(candidate.key) || [];
    group.push(candidate);
    groups.set(candidate.key, group);
  }

  const ambiguousKeys = [];
  let addedFromTourDates = 0;
  for (const [key, candidates] of groups) {
    if (groupIsAmbiguous(candidates)) {
      ambiguousKeys.push(key);
      continue;
    }
    const candidate = [...candidates].sort((left, right) =>
      right.score - left.score || left.name.localeCompare(right.name))[0];
    const current = inventory.get(key);
    const keyOrigins = origins.get(key) || new Set();
    keyOrigins.add("tour_dates");
    inventory.set(key, fillMissing(current || {}, candidate, keyOrigins));
    origins.set(key, keyOrigins);
    if (!current) addedFromTourDates += 1;
  }

  const entries = Object.freeze([...inventory.entries()]);
  return Object.freeze({
    entries,
    stats: Object.freeze({
      catalogVenues: Object.keys(catalogVenues || {}).length,
      tourDateRows: Array.isArray(tourDateRows) ? tourDateRows.length : 0,
      tourDateIdentities: groups.size,
      addedFromTourDates,
      ambiguousVenueIdentities: ambiguousKeys.length,
      ambiguousKeys: Object.freeze(ambiguousKeys.slice(0, 20)),
      totalInventory: entries.length,
    }),
  });
}

function percentage(count, total) {
  return total ? Number((count * 100 / total).toFixed(1)) : 100;
}

export function venuePhotoCoverageReport(inventory, verifiedInventory = {}) {
  const entries = Array.isArray(inventory?.entries) ? inventory.entries : [];
  const verifiedKeys = Object.keys(verifiedInventory || {});
  let exactCovered = 0;
  let servedCovered = 0;
  let tourTotal = 0;
  let tourExactCovered = 0;
  let tourServedCovered = 0;
  for (const [key, venue] of entries) {
    const exact = hasLicensedVenuePhoto(verifiedInventory?.[key]) || hasLicensedVenuePhoto(venue);
    const providerScoped = String(key || "").startsWith("provider:");
    const nameKey = resolveVenueCatalogKey(venue?.name, verifiedKeys);
    // Match the runtime boundary: a provider venue may use only its exact
    // provider catalog row. Name/alias fallback remains valid for name-only
    // legacy identities, where there is no provider scope to disambiguate.
    const fallback = !providerScoped && !exact && nameKey
      ? hasLicensedVenuePhoto(verifiedInventory[nameKey])
      : false;
    const isTourVenue = venue?._inventoryOrigins?.includes("tour_dates");
    exactCovered += Number(exact);
    servedCovered += Number(exact || fallback);
    if (isTourVenue) {
      tourTotal += 1;
      tourExactCovered += Number(exact);
      tourServedCovered += Number(exact || fallback);
    }
  }
  return Object.freeze({
    total: entries.length,
    exactCovered,
    exactMissing: entries.length - exactCovered,
    exactCoveragePercent: percentage(exactCovered, entries.length),
    servedCovered,
    servedMissing: entries.length - servedCovered,
    servedCoveragePercent: percentage(servedCovered, entries.length),
    tourDateVenues: tourTotal,
    tourDateExactCovered: tourExactCovered,
    tourDateExactMissing: tourTotal - tourExactCovered,
    tourDateExactCoveragePercent: percentage(tourExactCovered, tourTotal),
    tourDateServedCovered: tourServedCovered,
    tourDateServedMissing: tourTotal - tourServedCovered,
    tourDateServedCoveragePercent: percentage(tourServedCovered, tourTotal),
  });
}
