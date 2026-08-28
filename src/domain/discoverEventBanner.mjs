import { liveEventTitle } from "./liveDiscovery.mjs";
import { liveEventPhase } from "./eventLifecycle.mjs";

const normalize = (value, max = 240) => typeof value === "string"
  ? value.replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim().slice(0, max)
  : "";

const identity = (value) => normalize(value).toLocaleLowerCase();
const isSetFlag = (value) => value === true || value === 1 || value === "1";
const isDeniedFlag = (value) => value === false || value === 0 || value === "0";
const VIDEO_PATH = /\.(?:mp4|mov|m4v|webm)(?:$|[?#])/i;

const safeHttpsUrl = (value) => {
  const source = normalize(value, 2_000);
  if (!source) return null;
  try {
    const url = new URL(source);
    return url.protocol === "https:" && !url.username && !url.password ? url.toString() : null;
  } catch {
    return null;
  }
};

const boundedLimit = (value, fallback = 6, maximum = 8) => {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback;
};

const eventTuple = (value) => {
  const artist = identity(value?.artist);
  const venue = identity(value?.venue);
  const date = normalize(value?.date, 40);
  return artist && venue && date ? `${artist}|${venue}|${date}` : "";
};

export function discoverEventIdentity(event) {
  const explicit = normalize(event?.id || event?.eventId || event?.showId, 320);
  return explicit ? `id:${explicit}` : eventTuple(event) ? `show:${eventTuple(event)}` : "";
}

function eventIdentityKeys(value, { media = false } = {}) {
  const explicit = normalize(media
    ? value?.eventId || value?.showId
    : value?.id || value?.eventId || value?.showId, 320);
  const tuple = eventTuple(value);
  return [
    explicit ? `id:${explicit}` : "",
    tuple ? `show:${tuple}` : "",
  ].filter(Boolean);
}

function isExplicitlyUnavailable(media) {
  if (!media || typeof media !== "object") return true;
  if (isSetFlag(media.removed) || isSetFlag(media.deleted) || isSetFlag(media.hidden) || isSetFlag(media.moderated)) return true;
  if (isDeniedFlag(media.public) || isDeniedFlag(media.photosPublic)) return true;
  const visibility = identity(media.visibility);
  if (["private", "hidden", "deleted", "moderated", "rejected"].includes(visibility)) return true;
  const moderation = identity(media.moderationStatus || media.moderation_status);
  return ["hidden", "removed", "deleted", "rejected"].includes(moderation);
}

function isImageMedia(media) {
  const kind = identity(media?.kind || media?.mediaKind || media?.mediaType || media?.type);
  const mime = identity(media?.mimeType || media?.contentType);
  if (kind === "video" || mime.startsWith("video/")) return false;
  const uri = normalize(media?.uri || media?.url || media?.sourceUrl, 2_000);
  return kind === "image" || mime.startsWith("image/") || !VIDEO_PATH.test(uri);
}

function fanMediaIsEligible(media) {
  return identity(media?.source) === "fan"
    && (isSetFlag(media.photosPublic) || isSetFlag(media.public))
    && !isExplicitlyUnavailable(media);
}

function licensedMediaIsEligible(media) {
  const source = identity(media?.source || media?.provenanceSource);
  if (source === "artist" || source === "organizer" || source === "venue") {
    return isSetFlag(media.rightsApproved) && !isExplicitlyUnavailable(media);
  }
  return ["licensed", "commons", "openverse"].includes(source)
    && !!normalize(media?.creator, 180)
    && !!normalize(media?.license, 100)
    && !!safeHttpsUrl(media?.licenseUrl)
    && !!safeHttpsUrl(media?.sourcePage)
    && !isExplicitlyUnavailable(media);
}

function providerMediaIsEligible(media) {
  const source = identity(media?.source);
  const provider = identity(media?.provider);
  const attribution = normalize(media?.attribution || media?.by || media?.credit, 500);
  const width = media?.width;
  const height = media?.height;
  return source === "provider"
    && provider === "ticketmaster"
    && !!attribution
    && !!safeHttpsUrl(media?.sourcePage)
    && Number.isSafeInteger(width) && width > 0 && width <= 16_384
    && Number.isSafeInteger(height) && height > 0 && height <= 16_384
    && !isExplicitlyUnavailable(media);
}

export function isDiscoverEventBannerMediaEligible(media) {
  const uri = safeHttpsUrl(media?.uri || media?.url || media?.sourceUrl);
  if (!uri || !isImageMedia(media)) return false;
  return fanMediaIsEligible(media) || licensedMediaIsEligible(media) || providerMediaIsEligible(media);
}

function normalizeMedia(media) {
  const source = identity(media.source || media.provenanceSource);
  const fan = source === "fan";
  const creator = normalize(media.creator || media.by || media.credit || media.attribution, 500);
  return {
    uri: safeHttpsUrl(media.uri || media.url || media.sourceUrl),
    source: fan ? "fan" : source,
    provider: normalize(media.provider, 80).toLocaleLowerCase() || null,
    by: creator || (fan ? "MSHpit community" : "Rights-approved event media"),
    altText: normalize(media.altText || media.alt, 320) || null,
    postId: normalize(media.postId || media.logId, 240) || null,
    ownerId: normalize(media.ownerId || media.userId, 240) || null,
    sourcePage: safeHttpsUrl(media.sourcePage),
    license: normalize(media.license, 100) || null,
    licenseUrl: safeHttpsUrl(media.licenseUrl),
    width: Number.isSafeInteger(media.width) ? media.width : null,
    height: Number.isSafeInteger(media.height) ? media.height : null,
  };
}

// Discover is a high-visibility promotional surface, so media eligibility fails
// closed. Fan photos must be explicitly public and linked to the exact show;
// third-party or artist-owned media must carry an explicit rights contract.
// One photo per event keeps the reel diverse and limits network/decode work.
export function buildDiscoverEventBannerSlides({
  events = [],
  media = [],
  blockedIds = [],
  removedUris = [],
  limit = 6,
} = {}) {
  const blocked = new Set((Array.isArray(blockedIds) ? blockedIds : []).map(String));
  const removed = new Set((Array.isArray(removedUris) ? removedUris : []).map((value) => normalize(value, 2_000)));
  const mediaByEvent = new Map();

  for (const candidate of Array.isArray(media) ? media : []) {
    const eventKeys = eventIdentityKeys(candidate, { media: true });
    const uri = safeHttpsUrl(candidate?.uri || candidate?.url || candidate?.sourceUrl);
    const ownerId = candidate?.ownerId || candidate?.userId;
    if (!eventKeys.length || !uri || removed.has(uri) || (ownerId && blocked.has(String(ownerId))) || !isDiscoverEventBannerMediaEligible(candidate)) continue;
    for (const eventKey of eventKeys) {
      const rows = mediaByEvent.get(eventKey) || [];
      rows.push(candidate);
      mediaByEvent.set(eventKey, rows);
    }
  }

  const slides = [];
  const seenEvents = new Set();
  const seenUris = new Set();
  for (const event of Array.isArray(events) ? events : []) {
    const eventKey = discoverEventIdentity(event);
    if (!eventKey || seenEvents.has(eventKey)) continue;
    seenEvents.add(eventKey);
    const candidateSeen = new Set();
    const candidates = eventIdentityKeys(event).flatMap((key) => mediaByEvent.get(key) || []).filter((item) => {
      const uri = safeHttpsUrl(item?.uri || item?.url || item?.sourceUrl);
      if (!uri || candidateSeen.has(uri)) return false;
      candidateSeen.add(uri);
      return true;
    });
    const selected = [...candidates].sort((left, right) => {
      const leftFan = identity(left?.source) === "fan" ? 1 : 0;
      const rightFan = identity(right?.source) === "fan" ? 1 : 0;
      return rightFan - leftFan || Math.max(0, Number(right?.likes) || 0) - Math.max(0, Number(left?.likes) || 0);
    }).find((item) => {
      const uri = safeHttpsUrl(item?.uri || item?.url || item?.sourceUrl);
      return uri && !seenUris.has(uri);
    });
    const normalizedMedia = selected ? normalizeMedia(selected) : null;
    if (normalizedMedia?.uri) seenUris.add(normalizedMedia.uri);
    slides.push({
      id: eventKey,
      event,
      title: liveEventTitle(event),
      venue: normalize(event?.venue, 180) || null,
      place: normalize(event?.place || event?.city, 220) || null,
      date: normalize(event?.date, 40) || null,
      endDate: normalize(event?.eventEndDate || event?.endDate, 40) || null,
      phase: liveEventPhase(event),
      media: normalizedMedia,
    });
    if (slides.length >= boundedLimit(limit)) break;
  }
  return slides;
}
