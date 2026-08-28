import { licensedVenuePhoto } from "../../src/domain/venuePhotoProvenance.mjs";

const NON_PHOTO_TITLE = /\b(?:atlas|cartograph\w*|diagram|drawing|floor\s*plan|illustration|logo|map|plan|route\s*map|seating\s*chart|site\s*plan)\b|\b\w*karte\b/iu;

// Publication never reconstructs rights or relevance from legacy credit text.
// Only complete records emitted by the corrected provider ingestors survive.
export function recoverLicensedVenuePhoto(entry) {
  return licensedVenuePhoto(entry);
}

export function licensedVenuePool(entry, limit = 24) {
  const licensed = (Array.isArray(entry?.galleryPool) ? entry.galleryPool : [])
    .filter((photo) => !NON_PHOTO_TITLE.test(String(photo?.providerTitle || "")))
    .filter((photo) => !/\.(?:svg|tiff?)$/iu.test(String(photo?.providerTitle || "")))
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

// Raw `photo`, `photos`, or `galleryPool` fields predate the provenance policy
// and cannot prove that an image is publishable. Pipeline decisions must pass
// through the same validator as the public endpoint or legacy URLs can make a
// venue look complete while the endpoint correctly returns an empty gallery.
export function hasLicensedVenuePhoto(entry) {
  return licensedVenuePool(entry, 1).length > 0;
}

export function needsLicensedVenuePhoto(entry) {
  return !hasLicensedVenuePhoto(entry);
}

export function needsLicensedVenuePhotoAcross(...entries) {
  return !entries.some(hasLicensedVenuePhoto);
}
