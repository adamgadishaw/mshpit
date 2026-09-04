// Seeded venue photography is third-party inventory, so it fails closed unless
// every row carries enough provenance to verify and display its reuse terms.
// These SPDX-style identifiers intentionally cover only common, redistributable
// Creative Commons/public-domain grants. Additions require a rights review.
export const VENUE_PHOTO_LICENSES = Object.freeze({
  "CC0-1.0": Object.freeze({ label: "CC0 1.0", url: "https://creativecommons.org/publicdomain/zero/1.0/" }),
  "PDM-1.0": Object.freeze({ label: "Public Domain Mark 1.0", url: "https://creativecommons.org/publicdomain/mark/1.0/" }),
  "CC-BY-2.0": Object.freeze({ label: "CC BY 2.0", url: "https://creativecommons.org/licenses/by/2.0/" }),
  "CC-BY-SA-2.0": Object.freeze({ label: "CC BY-SA 2.0", url: "https://creativecommons.org/licenses/by-sa/2.0/" }),
  "CC-BY-3.0": Object.freeze({ label: "CC BY 3.0", url: "https://creativecommons.org/licenses/by/3.0/" }),
  "CC-BY-SA-3.0": Object.freeze({ label: "CC BY-SA 3.0", url: "https://creativecommons.org/licenses/by-sa/3.0/" }),
  "CC-BY-4.0": Object.freeze({ label: "CC BY 4.0", url: "https://creativecommons.org/licenses/by/4.0/" }),
  "CC-BY-SA-4.0": Object.freeze({ label: "CC BY-SA 4.0", url: "https://creativecommons.org/licenses/by-sa/4.0/" }),
});

const PROVENANCE_SOURCES = new Set(["commons", "openverse", "licensed"]);
const GENERIC_CREATORS = new Set(["source: web", "web", "unknown", "anonymous", "n/a", "own work"]);

function cleanText(value, max) {
  const text = typeof value === "string" ? value.normalize("NFKC").trim() : "";
  if (!text || text.length > max || /[\u0000-\u001f\u007f]/u.test(text)) return null;
  return text;
}

export function verifiedHttpsUrl(value) {
  const text = cleanText(value, 2000);
  if (!text) return null;
  try {
    const url = new URL(text);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function sameCanonicalUrl(value, canonical) {
  const candidate = verifiedHttpsUrl(value);
  if (!candidate) return false;
  try {
    const left = new URL(candidate);
    const right = new URL(canonical);
    const trimSlash = (path) => path.replace(/\/+$/u, "");
    return left.origin === right.origin
      && trimSlash(left.pathname) === trimSlash(right.pathname)
      && !left.search;
  } catch {
    return false;
  }
}

export function licensedVenuePhoto(entry) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
  const uri = verifiedHttpsUrl(entry.uri);
  const sourcePage = verifiedHttpsUrl(entry.sourcePage);
  const title = cleanText(entry.title, 240);
  const creator = cleanText(entry.creator, 240);
  const license = cleanText(entry.license, 40)?.toUpperCase() || null;
  const definition = license ? VENUE_PHOTO_LICENSES[license] : null;
  // Normalized records deliberately expose a generic public source while
  // retaining the actual provider separately. Reading that provider first keeps
  // validation idempotent instead of turning Commons/Openverse into "licensed"
  // every time the same record crosses another server/client boundary.
  const claimedProvenance = cleanText(entry.provenanceSource ?? entry.source, 30)?.toLowerCase() || "";
  // A short-lived migration produced otherwise-complete Commons records with
  // the generic normalized label in both source fields. Recover only the
  // provider identity from Commons' canonical source-page host; no creator,
  // license, or reuse right is inferred from the hostname.
  let provenanceSource = claimedProvenance;
  if (claimedProvenance === "licensed") {
    try {
      if (new URL(sourcePage).hostname.toLowerCase() === "commons.wikimedia.org") {
        provenanceSource = "commons";
      }
    } catch {
      return null;
    }
  }
  if (!uri || !sourcePage || !creator || GENERIC_CREATORS.has(creator.toLowerCase())) return null;
  if (!definition || !sameCanonicalUrl(entry.licenseUrl, definition.url)) return null;
  if (!PROVENANCE_SOURCES.has(provenanceSource)) return null;

  const modificationNotice = cleanText(entry.modificationNotice, 240);
  return {
    uri,
    by: `${creator} · ${definition.label}`,
    source: "licensed",
    provenanceSource,
    ...(title ? { title } : {}),
    creator,
    license,
    licenseUrl: definition.url,
    sourcePage,
    ...(modificationNotice ? { modificationNotice } : {}),
  };
}

// Presentation code gets an allowlisted projection rather than reading raw
// provider records. This keeps source/license links behind the same provenance
// validation that decides whether the photo may be published at all.
export function venuePhotoAttribution(entry) {
  const photo = licensedVenuePhoto(entry);
  if (!photo) return null;
  const definition = VENUE_PHOTO_LICENSES[photo.license];
  if (!definition) return null;
  return {
    creator: photo.creator,
    license: definition.label,
    sourcePage: photo.sourcePage,
    licenseUrl: photo.licenseUrl,
    ...(photo.modificationNotice ? { modificationNotice: photo.modificationNotice } : {}),
  };
}

export function venueMapPhotoPresentation(entry, expectedUri) {
  const photo = licensedVenuePhoto(entry);
  const attribution = venuePhotoAttribution(entry);
  const requestedUri = verifiedHttpsUrl(expectedUri);
  if (!photo || !attribution || !requestedUri || photo.uri !== requestedUri) return null;
  return { uri: photo.uri, attribution };
}

// The compact venue catalog predates the provenance schema used by the photo
// endpoint. Never treat a human-written `photoCredit` string as proof of rights:
// only explicit, separately stored license/creator/source-page fields can make a
// directory-card image eligible.
export function venueCatalogPhotoFields(entry) {
  const licensed = licensedVenuePhoto({
    uri: entry?.photo,
    sourcePage: entry?.photoSourcePage ?? entry?.sourcePage,
    creator: entry?.photoCreator ?? entry?.creator,
    license: entry?.photoLicense ?? entry?.license,
    licenseUrl: entry?.photoLicenseUrl ?? entry?.licenseUrl,
    source: entry?.photoSource ?? entry?.source,
    modificationNotice: entry?.photoModificationNotice ?? entry?.modificationNotice,
  });
  return licensed
    ? { photo: licensed.uri, photoCredit: licensed.by, photoProvenance: licensed }
    : { photo: null, photoCredit: null, photoProvenance: null };
}
