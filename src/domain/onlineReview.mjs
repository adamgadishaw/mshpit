export const IN_PERSON_REVIEW_EXPERIENCE = "in_person";
export const ONLINE_REVIEW_EXPERIENCE = "online";

const text = (value) => value == null ? "" : String(value).trim();

export function normalizeReviewExperienceType(value) {
  return value === ONLINE_REVIEW_EXPERIENCE
    ? ONLINE_REVIEW_EXPERIENCE
    : IN_PERSON_REVIEW_EXPERIENCE;
}

export function isOnlineReview(value) {
  return !!value && typeof value === "object"
    && normalizeReviewExperienceType(value.experienceType ?? value.experience_type) === ONLINE_REVIEW_EXPERIENCE;
}

export function isInPersonConcertReview(value) {
  if (!value || typeof value !== "object" || isOnlineReview(value)) return false;
  const kind = text(value.kind).toLowerCase();
  if (kind === "status" || kind === "memory") return false;
  return !!text(value.artist) && !!text(value.venue);
}

export function normalizeOnlineRating(value) {
  const rating = Number(value);
  if (!Number.isFinite(rating) || rating <= 0) return 0;
  return Math.min(5, Math.round(rating * 2) / 2);
}

const YOUTUBE_VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com"]);

function pathVideoId(url, hostname = url.hostname) {
  const segments = url.pathname.split("/").filter(Boolean);
  if (hostname === "youtu.be") return segments.length === 1 ? segments[0] : "";
  if (url.pathname === "/watch") return url.searchParams.get("v") || "";
  if (["shorts", "live"].includes(segments[0]) && segments.length === 2) return segments[1] || "";
  return "";
}

/**
 * A quick client-side shape check for links that can identify one YouTube
 * video. The server remains authoritative and canonicalizes the accepted URL.
 */
export function canonicalYouTubeReviewUrl(value, expectedVideoId = "") {
  const candidate = text(value);
  if (!candidate) return "";
  try {
    const url = new URL(candidate);
    if (url.protocol !== "https:" && url.protocol !== "http:") return "";
    if (url.username || url.password || url.port) return "";
    const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
    const isShortHost = hostname === "youtu.be";
    const isYouTubeHost = YOUTUBE_HOSTS.has(hostname);
    if (!isShortHost && !isYouTubeHost) return "";
    const videoId = pathVideoId(url, hostname);
    if (!YOUTUBE_VIDEO_ID.test(videoId)) return "";
    const requiredId = text(expectedVideoId);
    if (requiredId && (!YOUTUBE_VIDEO_ID.test(requiredId) || requiredId !== videoId)) return "";
    return `https://www.youtube.com/watch?v=${videoId}`;
  } catch {
    return "";
  }
}

export function isValidYouTubeSourceUrl(value) {
  return !!canonicalYouTubeReviewUrl(value);
}
