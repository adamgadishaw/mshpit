import { api } from "../../lib/api";
import { VENUE_PHOTO_CATALOG_VERSION } from "../../domain/venuePhotos.mjs";

export function fetchVenuePhotos(venueKey, { signal } = {}) {
  return api(`/api/venues/${encodeURIComponent(venueKey)}/photos?v=${VENUE_PHOTO_CATALOG_VERSION}`, {
    signal,
    silent: true,
    context: "Loading venue photos",
  });
}
