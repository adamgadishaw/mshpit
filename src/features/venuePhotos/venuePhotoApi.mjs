import { api } from "../../lib/api";
import { VENUE_PHOTO_CATALOG_VERSION } from "../../domain/venuePhotos.mjs";

export function fetchVenuePhotos(venueKey, { signal } = {}) {
  return api(`/api/venues/${encodeURIComponent(venueKey)}/photos?v=${VENUE_PHOTO_CATALOG_VERSION}`, {
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
