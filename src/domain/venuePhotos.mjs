import { licensedVenuePhoto } from "./venuePhotoProvenance.mjs";

export const VENUE_PHOTO_CLIENT_CACHE_MAX = 32;
export const VENUE_PHOTO_CLIENT_TTL_MS = 15 * 60 * 1000;
export const VENUE_PHOTO_RESPONSE_MAX = 24;
export const VENUE_PHOTO_CATALOG_VERSION = "licensed-v1";

export function venuePhotoAttemptScope(venueName, photos) {
  const venue = String(venueName || "").normalize("NFKC").trim().toLocaleLowerCase();
  const uris = [];
  for (const photo of Array.isArray(photos) ? photos : []) {
    const uri = typeof photo?.uri === "string" ? photo.uri.trim() : "";
    if (!uri) continue;
    uris.push(uri);
    if (uris.length >= VENUE_PHOTO_RESPONSE_MAX + 12) break;
  }
  return JSON.stringify([venue, uris]);
}

export function venuePhotoStateFor(catalogKey, pools) {
  // User-created/TBA venues have no server seed by definition. They are a
  // completed empty result, not a request that is perpetually waiting to start.
  if (!catalogKey) return { status: "ready", photos: [], error: null };
  return pools?.[catalogKey] || { status: "idle", photos: [], error: null };
}

export function cleanVenuePhotoResponse(value) {
  if (!Array.isArray(value)) return [];
  const out = [];
  const seen = new Set();
  for (const photo of value) {
    const normalized = licensedVenuePhoto(photo);
    if (!normalized || seen.has(normalized.uri)) continue;
    seen.add(normalized.uri);
    out.push(normalized);
    if (out.length >= VENUE_PHOTO_RESPONSE_MAX) break;
  }
  return out;
}

export function withBoundedVenuePhotoCache(cache, key, entry, max = VENUE_PHOTO_CLIENT_CACHE_MAX) {
  const next = new Map(cache || []);
  next.delete(key);
  next.set(key, entry);
  while (next.size > max) next.delete(next.keys().next().value);
  return next;
}

export function isFreshVenuePhotoEntry(entry, at = Date.now()) {
  return entry?.status === "ready"
    && Number.isFinite(entry.loadedAt)
    && at - entry.loadedAt < VENUE_PHOTO_CLIENT_TTL_MS;
}

export function mergeVenuePhotoSources(remote, fan, isRemoved = () => false) {
  const isCommons = (photo) => photo?.provenanceSource === "commons" || photo?.source === "commons";
  const official = (remote || []).filter(isCommons);
  const backfill = (remote || []).filter((photo) => !isCommons(photo));
  const out = [];
  const seen = new Set();
  // The venue gallery belongs to the people who were there. Verified fan media
  // leads when it exists; licensed provider imagery keeps the page useful while
  // a venue's community archive is still growing.
  for (const photo of [...(fan || []), ...official, ...backfill]) {
    if (!photo?.uri || seen.has(photo.uri) || isRemoved(photo.uri)) continue;
    seen.add(photo.uri);
    out.push(photo);
  }
  return out;
}
