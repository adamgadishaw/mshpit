import {
  IN_PERSON_REVIEW_EXPERIENCE,
  ONLINE_REVIEW_EXPERIENCE,
  canonicalYouTubeReviewUrl,
} from "../src/domain/onlineReview.mjs";

const YOUTUBE_VIDEO_ID = /^[A-Za-z0-9_-]{11}$/u;

export const IN_PERSON_EXPERIENCE = IN_PERSON_REVIEW_EXPERIENCE;
export const ONLINE_EXPERIENCE = ONLINE_REVIEW_EXPERIENCE;

export function storedExperienceType(value) {
  return value === ONLINE_EXPERIENCE ? ONLINE_EXPERIENCE : IN_PERSON_EXPERIENCE;
}

export function cleanExperienceType(value, fallback = IN_PERSON_EXPERIENCE) {
  if (value == null || value === "") return storedExperienceType(fallback);
  return value === IN_PERSON_EXPERIENCE || value === ONLINE_EXPERIENCE ? value : null;
}

/**
 * Accept only an exact YouTube video id or a supported youtube.com/youtu.be
 * watch, Shorts, or Live URL. The stored URL never retains tracking parameters.
 */
export function canonicalYouTubeReviewLink({ youtubeUrl = null, youtubeVideoId = null } = {}) {
  const rawUrl = typeof youtubeUrl === "string" ? youtubeUrl.trim() : youtubeUrl;
  const rawId = typeof youtubeVideoId === "string" ? youtubeVideoId.trim() : youtubeVideoId;
  if ((rawUrl == null || rawUrl === "") && (rawId == null || rawId === "")) return null;
  if (rawUrl != null && typeof rawUrl !== "string") return undefined;
  if (rawId != null && typeof rawId !== "string") return undefined;

  if (rawId && !YOUTUBE_VIDEO_ID.test(rawId)) return undefined;
  const canonical = rawUrl
    ? canonicalYouTubeReviewUrl(
      YOUTUBE_VIDEO_ID.test(rawUrl) ? `https://www.youtube.com/watch?v=${rawUrl}` : rawUrl,
      rawId || "",
    )
    : canonicalYouTubeReviewUrl(`https://www.youtube.com/watch?v=${rawId}`, rawId);
  if (!canonical) return undefined;
  const videoId = new URL(canonical).searchParams.get("v");
  return Object.freeze({
    youtubeVideoId: videoId,
    youtubeUrl: canonical,
  });
}

export function projectedOnlineReviewFields(row) {
  const experienceType = storedExperienceType(row?.experience_type ?? row?.experienceType);
  if (experienceType !== ONLINE_EXPERIENCE) {
    return { experienceType, onlineTitle: null, youtubeUrl: null, youtubeVideoId: null };
  }
  const link = canonicalYouTubeReviewLink({
    youtubeUrl: row?.youtube_url ?? row?.youtubeUrl,
    youtubeVideoId: row?.youtube_video_id ?? row?.youtubeVideoId,
  });
  const rawTitle = row?.online_title ?? row?.onlineTitle;
  return {
    experienceType,
    onlineTitle: typeof rawTitle === "string" ? rawTitle.trim().slice(0, 160) || null : null,
    youtubeUrl: link?.youtubeUrl || null,
    youtubeVideoId: link?.youtubeVideoId || null,
  };
}

// Safe for template interpolation with a source-controlled SQL alias only.
export function inPersonReviewSql(alias = "p") {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(alias)) throw new TypeError("Invalid SQL alias");
  return `COALESCE(${alias}.kind,'review')='review' AND COALESCE(${alias}.experience_type,'in_person')='in_person'`;
}
