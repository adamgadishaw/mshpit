export const VENUE_PHOTO_CLIENT_CACHE_MAX = 32;
export const VENUE_PHOTO_CLIENT_TTL_MS = 15 * 60 * 1000;
export const VENUE_PHOTO_RESPONSE_MAX = 24;

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
    const uri = typeof photo?.uri === "string" && /^https?:\/\//i.test(photo.uri) ? photo.uri : null;
    if (!uri || seen.has(uri)) continue;
    seen.add(uri);
    out.push({
      uri,
      by: typeof photo.by === "string" && photo.by.trim() ? photo.by.trim().slice(0, 240) : "Source: web",
      source: ["commons", "openverse", "web"].includes(photo.source) ? photo.source : "web",
    });
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
  const official = (remote || []).filter((photo) => photo.source === "commons");
  const backfill = (remote || []).filter((photo) => photo.source !== "commons");
  const out = [];
  const seen = new Set();
  for (const photo of [...official, ...(fan || []), ...backfill]) {
    if (!photo?.uri || seen.has(photo.uri) || isRemoved(photo.uri)) continue;
    seen.add(photo.uri);
    out.push(photo);
  }
  return out;
}
