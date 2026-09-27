import { publicArtistPhoto } from "../../artistPhotoCatalog.js";
import { photoCreditForId, photoCreditPathFromArtwork } from "../../photoCredits.js";
import { NEWS_ILLUSTRATION_ARTWORK, NEWS_ILLUSTRATION_CONTEXT } from "../../newsIllustration.js";
import { trustedShareArtworkUrl } from "../socialSharing/socialShareArtwork.js";

const MBID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const EMPTY = Object.freeze({ fallbackArtwork: Object.freeze([]), artworkContext: "" });
const ILLUSTRATED = Object.freeze({ fallbackArtwork: Object.freeze([NEWS_ILLUSTRATION_ARTWORK]), artworkContext: NEWS_ILLUSTRATION_CONTEXT });
const ATTRIBUTION = ["title", "creator", "license", "licenseUrl", "sourcePage", "modificationNotice"];

function boundedText(value, max) {
  return typeof value === "string" && value.length > 0 && value.length <= max
    && !/[\u0000-\u001f\u007f-\u009f]/u.test(value) ? value : null;
}

function licensedCandidate(photo, artistKey, env) {
  if (!photo || typeof photo !== "object" || Array.isArray(photo)) return null;
  const url = trustedShareArtworkUrl({ url: photo.uri, source: "licensed-media" }, { env });
  if (!url || ATTRIBUTION.some(field => !boundedText(photo[field], 2048))) return null;
  const candidate = { url, source: "licensed-media" };
  for (const field of ATTRIBUTION) candidate[field] = photo[field];
  const creditPath = photoCreditPathFromArtwork(candidate);
  const registered = creditPath ? photoCreditForId(creditPath.split("/").at(-1)) : null;
  // A valid licence for somebody else's portrait is not this artist's photo.
  if (!registered || registered.artistKey !== artistKey) return null;
  candidate.creditPath = creditPath;
  const point = photo.focalPoint;
  if (point && typeof point.x === "number" && typeof point.y === "number"
    && Number.isFinite(point.x) && Number.isFinite(point.y)
    && point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1) {
    candidate.focalPoint = Object.freeze({ x: point.x, y: point.y });
  }
  return Object.freeze(candidate);
}

// Public licensed inventory and one bundled illustration only: no RSS/provider images, member uploads,
// fuzzy name resolution, network work, or persisted/cache copies of artwork.
export function createNewsCardArtworkResolver({ database, env = process.env, resolvePhoto = publicArtistPhoto } = {}) {
  let lookup;
  return story => {
    if (!story || typeof story !== "object" || Array.isArray(story)) return EMPTY;
    try {
      if (!Array.isArray(story.artists) || !database?.prepare || typeof resolvePhoto !== "function") return ILLUSTRATED;
      lookup ||= database.prepare("SELECT norm,name,mbid FROM artists WHERE norm=? COLLATE BINARY");
      const seen = new Set();
      for (const artist of story.artists.slice(0, 3)) {
        const key = boundedText(artist?.key, 200);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        const row = lookup.get(key);
        const name = boundedText(row?.name, 200);
        if (row?.norm !== key || !name || typeof row.mbid !== "string" || !MBID.test(row.mbid)) continue;
        const photo = resolvePhoto(key, { artistMbid: row.mbid, mediaPublicBaseUrl: env?.MEDIA_PUBLIC_BASE_URL });
        const candidate = licensedCandidate(photo, key, env);
        if (!candidate) continue;
        // Never offer another artist's photo as a fallback. The renderer uses
        // the illustration's own context if it accepts the bundled candidate.
        return Object.freeze({ fallbackArtwork: Object.freeze([candidate, NEWS_ILLUSTRATION_ARTWORK]), artworkContext: `Artist photo: ${name.slice(0, 80)}` });
      }
      return ILLUSTRATED;
    } catch {
      // architecture: allow-ambiguous-result -- optional artwork fails closed; a missing registry/database must not expose unchecked media or break a news card.
      return ILLUSTRATED;
    }
  };
}
