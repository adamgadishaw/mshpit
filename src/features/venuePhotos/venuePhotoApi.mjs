import { api } from "../../lib/api";
import {
  normalizeVenuePhotoProviderIdentity,
  VENUE_PHOTO_CATALOG_VERSION,
} from "../../domain/venuePhotos.mjs";

export function venuePhotoRequestPath(venueKey, providerIdentity = null) {
  const provider = normalizeVenuePhotoProviderIdentity(providerIdentity);
  const providerQuery = provider
    ? `&source=${encodeURIComponent(provider.source)}&providerVenueId=${encodeURIComponent(provider.providerVenueId)}`
    : "";
  return `/api/venues/${encodeURIComponent(venueKey)}/photos?v=${VENUE_PHOTO_CATALOG_VERSION}${providerQuery}`;
}

export function fetchVenuePhotos(venueKey, { signal, source, providerVenueId } = {}) {
  return api(venuePhotoRequestPath(venueKey, { source, providerVenueId }), {
    signal,
    cache: "no-store",
    silent: true,
    context: "Loading venue photos",
  }).then((payload) => ({
    key: typeof payload?.key === "string" ? payload.key : venueKey,
    photos: Array.isArray(payload?.photos) ? payload.photos : [],
    fanPhotos: Array.isArray(payload?.fanPhotos) ? payload.fanPhotos : [],
  }));
}
