const identity = (value) => String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
const isSetFlag = (value) => value === true || value === 1 || value === "1";
const isDeniedFlag = (value) => value === false || value === 0 || value === "0";

const isExplicitlyHidden = (item) => {
  if (!item || typeof item !== "object") return false;
  if (isSetFlag(item.removed) || isSetFlag(item.deleted) || isSetFlag(item.hidden) || isSetFlag(item.moderated)) return true;
  if (isDeniedFlag(item.public) || isDeniedFlag(item.photosPublic)) return true;
  const visibility = identity(item.visibility);
  if (["private", "hidden", "deleted", "moderated", "rejected"].includes(visibility)) return true;
  const moderationStatus = identity(item.moderationStatus || item.moderation_status);
  return ["hidden", "removed", "deleted", "rejected"].includes(moderationStatus);
};

const isVideoMedia = (item) => {
  if (identity(item?.kind || item?.mediaKind) === "video") return true;
  return /\.(?:mp4|mov|m4v|webm)(?:$|[?#])/i.test(String(item?.uri || ""));
};

const boundedLimit = (value, fallback, maximum) => {
  const requested = Number(value);
  if (!Number.isSafeInteger(requested) || requested < 1) return fallback;
  return Math.min(requested, maximum);
};

export function isArtistGalleryMediaVisible(item) {
  return typeof item?.uri === "string" && !!item.uri.trim() && !isExplicitlyHidden(item);
}

export function artistGalleryIdentityKey(name, artistKey = null) {
  return identity(artistKey) || identity(name);
}

export function postMatchesArtistGallery(post, { name, artistKey = null } = {}) {
  const expectedKey = identity(artistKey);
  if (expectedKey) return identity(post?.artistKey) === expectedKey;
  return identity(post?.artist) === identity(name);
}

export function mergeArtistGalleryMedia(local, server, { blockedIds = [], removedUris = [] } = {}) {
  const blocked = new Set((Array.isArray(blockedIds) ? blockedIds : []).map(String));
  const removed = new Set(Array.isArray(removedUris) ? removedUris : []);
  const seen = new Set();
  return [...(Array.isArray(local) ? local : []), ...(Array.isArray(server) ? server : [])].filter((item) => {
    const uri = typeof item?.uri === "string" ? item.uri : "";
    if (!isArtistGalleryMediaVisible(item) || seen.has(uri) || removed.has(uri) || (item?.ownerId && blocked.has(String(item.ownerId)))) return false;
    seen.add(uri);
    return true;
  });
}

// The profile hero decodes one image at a time, with a deliberately tiny source
// reel. Artist-owned artwork leads, followed by public fan photos and catalogue
// imagery. Videos stay in the full gallery rather than silently autoplaying in
// a decorative banner.
export function artistCinematicMedia({ bannerUri = null, profileUri = null, gallery = [] } = {}, limit = 5) {
  const candidates = [];
  if (typeof bannerUri === "string" && bannerUri.trim()) {
    candidates.push({ uri: bannerUri, source: "artist", role: "banner" });
  }
  for (const item of Array.isArray(gallery) ? gallery : []) candidates.push(item);
  if (typeof profileUri === "string" && profileUri.trim()) {
    candidates.push({ uri: profileUri, source: "artist", role: "profile" });
  }

  const take = boundedLimit(limit, 5, 6);
  const rows = [];
  const seen = new Set();
  for (const item of candidates) {
    if (!isArtistGalleryMediaVisible(item) || isVideoMedia(item) || seen.has(item.uri)) continue;
    seen.add(item.uri);
    rows.push(item);
    if (rows.length >= take) break;
  }
  return rows;
}

export function boundedArtistGalleryMedia(items, limit = 60) {
  const take = boundedLimit(limit, 60, 60);
  const rows = [];
  const seen = new Set();
  for (const item of Array.isArray(items) ? items : []) {
    if (!isArtistGalleryMediaVisible(item) || seen.has(item.uri)) continue;
    seen.add(item.uri);
    rows.push(item);
    if (rows.length >= take) break;
  }
  return rows;
}
