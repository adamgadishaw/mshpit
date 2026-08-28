import { venuePhotoMirrorConfigured } from "./venue-photo-mirror.mjs";

export function verifiedVenuePhotoBackfillConfigured(env = process.env) {
  return venuePhotoMirrorConfigured(env);
}
