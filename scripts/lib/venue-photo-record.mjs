import { licensedVenuePhoto } from "../../src/domain/venuePhotoProvenance.mjs";

// Publication never reconstructs rights or relevance from legacy credit text.
// Only complete records emitted by the corrected provider ingestors survive.
export function recoverLicensedVenuePhoto(entry) {
  return licensedVenuePhoto(entry);
}

export function licensedVenuePool(entry, limit = 24) {
  const licensed = (Array.isArray(entry?.galleryPool) ? entry.galleryPool : [])
    .filter((photo) => !/\b(?:map|logo|diagram|plan|drawing|illustration)\b/iu.test(String(photo?.providerTitle || "")))
    .filter((photo) => !/\.(?:png|svg|tiff?)$/iu.test(String(photo?.providerTitle || "")))
    .map(licensedVenuePhoto).filter(Boolean);
  const byUri = new Map(licensed.map((photo) => [photo.uri, photo]));
  const preferred = (Array.isArray(entry?.photos) ? entry.photos : [])
    .map((uri) => byUri.get(uri)).filter(Boolean);
  const out = [];
  const seen = new Set();
  for (const photo of [...preferred, ...licensed]) {
    if (seen.has(photo.uri)) continue;
    seen.add(photo.uri);
    out.push(photo);
    if (out.length >= limit) break;
  }
  return out;
}
