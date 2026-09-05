import { licensedVenuePhoto, verifiedHttpsUrl } from "./venuePhotoProvenance.mjs";

export const VENUE_PHOTO_CLIENT_CACHE_MAX = 32;
export const VENUE_PHOTO_CLIENT_TTL_MS = 15 * 60 * 1000;
export const VENUE_PHOTO_RESPONSE_MAX = 24;
export const VENUE_FAN_PHOTO_RESPONSE_MAX = 12;
export const VENUE_PHOTO_CATALOG_VERSION = "licensed-v4";

const cleanProviderIdentityPart = (value, max) => {
  const text = typeof value === "string" ? value.normalize("NFKC").trim() : "";
  if (!text || [...text].length > max || /[\u0000-\u001f\u007f]/u.test(text)) return null;
  return text;
};

// Provider venue ids distinguish same-named rooms in different cities. Keep
// this identity paired and bounded so a partial provider hint can never poison
// the client cache or be sent to the server as a misleading lookup.
export function normalizeVenuePhotoProviderIdentity(value = {}) {
  const source = cleanProviderIdentityPart(value?.source, 40);
  const providerVenueId = cleanProviderIdentityPart(
    value?.providerVenueId ?? value?.venue_provider_id,
    180,
  );
  return source && providerVenueId ? { source, providerVenueId } : null;
}

export function venuePhotoRequestIdentity(venueKey, providerIdentity = null) {
  const venue = String(venueKey || "").normalize("NFKC").trim().toLocaleLowerCase("en");
  if (!venue) return null;
  const provider = normalizeVenuePhotoProviderIdentity(providerIdentity);
  const providerPart = provider
    ? `|provider:${encodeURIComponent(provider.source.toLocaleLowerCase("en"))}:${encodeURIComponent(provider.providerVenueId.toLocaleLowerCase("en"))}`
    : "";
  return `venue:${encodeURIComponent(venue)}${providerPart}`;
}

const normalizedPrivacyIds = (ids) => [...new Set((Array.isArray(ids) ? ids : [])
  .map((id) => String(id || "").trim())
  .filter(Boolean))].sort();

// Fan venue photos are viewer-personalized by the two-way block graph. Bind a
// cache entry to the exact account, optimistic block snapshot, and lifecycle
// epoch that fetched it. The epoch deliberately changes on both block and
// unblock, so returning to the same list cannot resurrect a pre-boundary pool.
export function venuePhotoViewerScope(accountId, blockedIds = [], privacyEpoch = 0) {
  const normalizedAccountId = String(accountId || "").trim();
  const account = normalizedAccountId ? `user:${encodeURIComponent(normalizedAccountId)}` : "guest";
  const blocked = normalizedPrivacyIds(blockedIds).map(encodeURIComponent).join(",");
  const epoch = Number.isSafeInteger(privacyEpoch) && privacyEpoch >= 0 ? privacyEpoch : 0;
  return `${account}|blocked:${blocked}|epoch:${epoch}`;
}

export function venuePhotoScopedCacheKey(venueKey, viewerScope, providerIdentity = null) {
  const venue = venuePhotoRequestIdentity(venueKey, providerIdentity);
  const scope = String(viewerScope || "").trim();
  return venue && scope ? `${scope}|${venue}` : null;
}

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

function cleanFanMediaId(value) {
  const text = typeof value === "string" ? value.trim() : "";
  return text && text.length <= 120 && !/[\u0000-\u001f\u007f]/u.test(text) ? text : null;
}

export function cleanVenueFanPhotoResponse(value) {
  if (!Array.isArray(value)) return [];
  const out = [];
  const seen = new Set();
  for (const photo of value) {
    if (!photo || typeof photo !== "object" || Array.isArray(photo) || photo.source !== "fan") continue;
    const uri = verifiedHttpsUrl(photo.uri);
    const origin = photo.origin === "post" || photo.origin === "venue-review" ? photo.origin : null;
    const postId = origin === "post" ? cleanFanMediaId(photo.postId) : null;
    const venueReviewId = origin === "venue-review" ? cleanFanMediaId(photo.venueReviewId) : null;
    const ownerId = cleanFanMediaId(photo.ownerId);
    const createdAt = Number(photo.createdAt);
    if (!uri || !origin
      || (origin === "post" && !postId)
      || (origin === "venue-review" && !venueReviewId)
      || !Number.isSafeInteger(createdAt) || createdAt < 0 || seen.has(uri)) continue;
    seen.add(uri);
    out.push({
      uri,
      source: "fan",
      origin,
      ...(ownerId ? { ownerId } : {}),
      ...(postId ? { postId } : {}),
      ...(venueReviewId ? { venueReviewId } : {}),
      createdAt,
    });
    if (out.length >= VENUE_FAN_PHOTO_RESPONSE_MAX) break;
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
