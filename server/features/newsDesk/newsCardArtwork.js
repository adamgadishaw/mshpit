import { publicArtistPhoto } from "../../artistPhotoCatalog.js";
import { photoCreditForId, photoCreditPathFromArtwork } from "../../photoCredits.js";
import { trustedShareArtworkUrl } from "../socialSharing/socialShareArtwork.js";
import { readNewsCardPhotoChoice } from "./newsCardPhotos.js";

const MBID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const EMPTY = Object.freeze({ fallbackArtwork: Object.freeze([]), artworkContext: "" });
// No photo means a clean headline card. The old generic illustration had
// nothing to do with the story, so it is never used.
const TEXT_ONLY = EMPTY;
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
// The share card photo for a story: the news team's pick if there is one,
// otherwise the first artist in the story with a photo. An artist's own
// profile photo (owned media) comes first, then a licensed catalog photo.
export function createNewsCardArtworkResolver({ database, env = process.env, resolvePhoto = publicArtistPhoto, resolveProfilePhoto = null } = {}) {
  let lookup;
  const artistArtwork = (key) => {
    lookup ||= database.prepare("SELECT norm,name,mbid FROM artists WHERE norm=? COLLATE BINARY");
    const row = lookup.get(key);
    const name = boundedText(row?.name, 200);
    if (row?.norm !== key || !name) return null;
    if (typeof resolveProfilePhoto === "function") {
      const url = trustedShareArtworkUrl({ url: resolveProfilePhoto({ artistKey: key, artist: name }), source: "owned-media" }, { env });
      if (url) return { candidate: Object.freeze({ url, source: "owned-media" }), name };
    }
    if (typeof row.mbid !== "string" || !MBID.test(row.mbid)) return null;
    const candidate = licensedCandidate(resolvePhoto(key, { artistMbid: row.mbid, mediaPublicBaseUrl: env?.MEDIA_PUBLIC_BASE_URL }), key, env);
    return candidate ? { candidate, name } : null;
  };
  return story => {
    if (!story || typeof story !== "object" || Array.isArray(story)) return EMPTY;
    try {
      if (!Array.isArray(story.artists) || !database?.prepare || typeof resolvePhoto !== "function") return TEXT_ONLY;
      const pick = readNewsCardPhotoChoice(database, story.postId);
      if (pick.choice === "none") return TEXT_ONLY;
      const keys = pick.choice === "artist" ? [pick.artistKey] : story.artists.slice(0, 3).map((artist) => boundedText(artist?.key, 200));
      for (const key of [...new Set(keys.filter(Boolean))]) {
        const found = artistArtwork(key);
        // Never offer another artist's photo as a fallback.
        if (found) return Object.freeze({ fallbackArtwork: Object.freeze([found.candidate]), artworkContext: `Artist photo: ${found.name.slice(0, 80)}` });
      }
      return TEXT_ONLY;
    } catch {
      // architecture: allow-ambiguous-result -- optional artwork fails closed; a missing registry/database must not expose unchecked media or break a news card.
      return TEXT_ONLY;
    }
  };
}

// What the news team can choose from for a story: each of its artists that
// has a usable photo, with the image to preview.
export function newsCardPhotoOptions(story, resolver) {
  return (Array.isArray(story?.artists) ? story.artists : []).slice(0, 6).flatMap((artist) => {
    const key = boundedText(artist?.key, 200);
    if (!key) return [];
    const picked = resolver({ ...story, artists: [{ key }], postId: "__preview__" });
    const url = picked.fallbackArtwork?.[0]?.url;
    return url ? [{ artistKey: key, name: boundedText(artist.name, 200) || key, url }] : [];
  });
}
