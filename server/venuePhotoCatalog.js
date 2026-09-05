import { readFileSync } from "node:fs";
import { licensedVenuePhoto } from "../src/domain/venuePhotoProvenance.mjs";
import {
  canonicalVenueKey,
  normalizeVenueKey,
  venueIdentityFingerprint,
} from "../src/domain/venueIdentity.mjs";
import {
  providerVenuePhotoCatalogKey,
} from "./venuePhotoCatalogIdentity.js";
import { venuePhotoCatalogBinding } from "./venuePhotoCatalogBindings.js";

const VENUE_PHOTO_SOURCE = new URL("../src/seed/catalog.venue-photos.json", import.meta.url);
const DEFAULT_LIMIT = 3;
const MAX_LIMIT = 24;

let cachedCatalog;
let cachedIndex;

function venuePhotoCatalog() {
  if (cachedCatalog !== undefined) return cachedCatalog;
  try {
    const parsed = JSON.parse(readFileSync(VENUE_PHOTO_SOURCE, "utf8"));
    cachedCatalog = parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed : Object.freeze({});
  } catch {
    // A public document must remain renderable when the optional catalogue is
    // unavailable. The client/API can retry its photo request independently.
    cachedCatalog = Object.freeze({});
  }
  return cachedCatalog;
}

function boundedLimit(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0
    ? Math.min(parsed, MAX_LIMIT) : DEFAULT_LIMIT;
}

function addUnique(map, identity, catalogKey) {
  if (!identity) return;
  const previous = map.get(identity);
  if (previous === undefined) map.set(identity, catalogKey);
  else if (previous !== catalogKey) map.set(identity, null);
}

function normalizedPhotoPool(row) {
  const gallery = Array.isArray(row?.galleryPool) ? row.galleryPool : [];
  const preferred = new Set(Array.isArray(row?.photos) ? row.photos : []);
  const licensed = gallery.map(licensedVenuePhoto).filter(Boolean);
  licensed.sort((left, right) =>
    Number(preferred.has(right.uri)) - Number(preferred.has(left.uri)));
  const result = [];
  const seen = new Set();
  for (const photo of licensed) {
    if (seen.has(photo.uri)) continue;
    seen.add(photo.uri);
    result.push(Object.freeze(photo));
    if (result.length >= MAX_LIMIT) break;
  }
  return Object.freeze(result);
}

function buildCatalogIndex(catalog) {
  const pools = new Map();
  const exact = new Map();
  const fingerprints = new Map();
  const articleless = new Map();
  for (const [catalogKey, row] of Object.entries(catalog || {})) {
    pools.set(catalogKey, normalizedPhotoPool(row));
    if (catalogKey.startsWith("provider:")) continue;
    const canonical = canonicalVenueKey(catalogKey);
    const fingerprint = venueIdentityFingerprint(canonical);
    addUnique(exact, normalizeVenueKey(catalogKey), catalogKey);
    addUnique(fingerprints, fingerprint, catalogKey);
    addUnique(articleless, fingerprint.replace(/^the\s+/u, ""), catalogKey);
  }
  return Object.freeze({
    pools,
    resolveName(value) {
      const canonical = canonicalVenueKey(value);
      if (!canonical) return null;
      const direct = exact.get(canonical);
      if (direct !== undefined) return direct;
      const fingerprint = venueIdentityFingerprint(canonical);
      const normalizedMatch = fingerprints.get(fingerprint);
      if (normalizedMatch !== undefined) return normalizedMatch;
      return articleless.get(fingerprint.replace(/^the\s+/u, "")) || null;
    },
  });
}

function venuePhotoCatalogIndex() {
  if (cachedIndex !== undefined) return cachedIndex;
  cachedIndex = buildCatalogIndex(venuePhotoCatalog());
  return cachedIndex;
}

/**
 * Return only rights-verified, mirrored venue photography for an exact venue
 * identity (including the explicit rename aliases owned by venueIdentity).
 * Raw search-engine images and legacy human-written credits never cross this
 * boundary.
 */
export function publicVenuePhotoPool(venueName, {
  limit = DEFAULT_LIMIT,
  catalog = null,
  providerBindings = null,
  source: providerSource = null,
  providerVenueId = null,
} = {}) {
  const customCatalog = catalog && typeof catalog === "object" && !Array.isArray(catalog)
    ? catalog : null;
  const index = customCatalog ? buildCatalogIndex(customCatalog) : venuePhotoCatalogIndex();
  const providerKey = providerVenuePhotoCatalogKey(providerSource, providerVenueId);
  const catalogKey = index.resolveName(venueName);
  const verifiedProviderNameKey = venuePhotoCatalogBinding(
    providerSource,
    providerVenueId,
    providerBindings,
  );
  const verifiedProviderCatalogKey = verifiedProviderNameKey
    && canonicalVenueKey(verifiedProviderNameKey) === canonicalVenueKey(venueName)
    ? index.resolveName(verifiedProviderNameKey)
    : null;
  // Provider identity is authoritative. Falling back from one provider venue
  // to a name-only row can put a same-named room from another city on the page.
  // The only exception is a narrow, verified provider-to-catalog crosswalk for
  // a known renamed building. An explicit provider row (including an empty row
  // after a rights removal) always remains authoritative.
  const hasProviderPool = !!providerKey && index.pools.has(providerKey);
  const licensed = providerKey
    ? (hasProviderPool
      ? (index.pools.get(providerKey) || [])
      : (index.pools.get(verifiedProviderCatalogKey) || []))
    : (index.pools.get(catalogKey) || []);

  const seen = new Set();
  const result = [];
  for (const photo of licensed) {
    if (seen.has(photo.uri)) continue;
    seen.add(photo.uri);
    result.push(Object.freeze(photo));
    if (result.length >= boundedLimit(limit)) break;
  }
  return Object.freeze(result);
}

export function publicVenuePhotoCatalogSize() {
  return venuePhotoCatalogIndex().pools.size;
}
