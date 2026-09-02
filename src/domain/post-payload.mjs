import { MEDIA_POST_MAX_ATTACHMENTS } from "./mediaUploadPolicy.mjs";
import { clean, clampRating, LIMITS } from "./validation.mjs";
import { taggedUserIdsFromPeople } from "./postFriendTags.mjs";
import {
  IN_PERSON_REVIEW_EXPERIENCE,
  ONLINE_REVIEW_EXPERIENCE,
  canonicalYouTubeReviewUrl,
  isOnlineReview,
} from "./onlineReview.mjs";

// Artist suggestions carry a catalog key that is distinct from the display
// name. Keep that identity explicit at the client boundary so punctuation and
// same-named acts do not silently fall back to display-text matching.
export function cleanArtistKey(value) {
  return clean(value, { max: 120 }) || null;
}

export function cleanMediaAssetIds(value) {
  if (!Array.isArray(value)) return [];
  const ids = [];
  for (const item of value) {
    if (typeof item !== "string" || !/^ma_[A-Za-z0-9_-]{8,80}$/.test(item) || ids.includes(item)) continue;
    ids.push(item);
    if (ids.length >= MEDIA_POST_MAX_ATTACHMENTS) break;
  }
  return ids;
}

export function buildReviewCreateBody(post) {
  const online = isOnlineReview(post);
  return {
    clientMutationId: post.id,
    experienceType: online ? ONLINE_REVIEW_EXPERIENCE : IN_PERSON_REVIEW_EXPERIENCE,
    artist: post.artist,
    artistKey: cleanArtistKey(post.artistKey),
    venue: online ? "" : post.venue,
    city: online ? "" : post.city,
    date: online ? "" : post.date,
    overall: post.overall,
    band: online ? null : post.band,
    room: online ? null : post.room,
    dims: online ? {} : post.dims,
    onlineTitle: online ? clean(post.onlineTitle, { max: 160 }) || null : null,
    youtubeUrl: online ? canonicalYouTubeReviewUrl(post.youtubeUrl, post.youtubeVideoId) : null,
    review: post.review,
    taggedUserIds: taggedUserIdsFromPeople(post.taggedPeople),
    photos: post.photos,
    ...(Array.isArray(post.mediaAssetIds) ? { mediaAssetIds: cleanMediaAssetIds(post.mediaAssetIds) } : {}),
    photosPublic: post.photosPublic ? 1 : 0,
    landingShowcase: !online && post.photosPublic && post.landingShowcase ? 1 : 0,
    setlist: online ? [] : post.setlist,
    tour: online ? null : post.tour || null,
    // Descriptive post tags are retired. Concert companion tagging remains a
    // separate, structured user relationship in taggedUserIds.
    tags: [],
    song: online ? null : post.song || null,
  };
}

export function buildReviewEditBody(changes) {
  const online = isOnlineReview(changes);
  return {
    experienceType: online ? ONLINE_REVIEW_EXPERIENCE : IN_PERSON_REVIEW_EXPERIENCE,
    artist: clean(changes.artist, { max: 80 }),
    artistKey: cleanArtistKey(changes.artistKey),
    venue: online ? "" : clean(changes.venue, { max: 80 }),
    city: online ? "" : clean(changes.city, { max: 60 }),
    date: online ? "" : clean(changes.date, { max: 20 }),
    overall: clampRating(changes.overall),
    band: online || changes.band == null ? null : clampRating(changes.band),
    room: online || changes.room == null ? null : clampRating(changes.room),
    dims: !online && changes.dims && typeof changes.dims === "object" ? changes.dims : {},
    onlineTitle: online ? clean(changes.onlineTitle, { max: 160 }) || null : null,
    youtubeUrl: online ? canonicalYouTubeReviewUrl(changes.youtubeUrl, changes.youtubeVideoId) : null,
    review: clean(changes.review, { max: LIMITS.review, newlines: true }),
    taggedUserIds: taggedUserIdsFromPeople(changes.taggedPeople),
    photos: Array.isArray(changes.photos) ? changes.photos.filter((item) => typeof item === "string").slice(0, MEDIA_POST_MAX_ATTACHMENTS) : [],
    ...(Array.isArray(changes.mediaAssetIds) ? { mediaAssetIds: cleanMediaAssetIds(changes.mediaAssetIds) } : {}),
    photosPublic: !!changes.photosPublic,
    landingShowcase: !online && !!changes.photosPublic && !!changes.landingShowcase,
    setlist: !online && Array.isArray(changes.setlist) ? changes.setlist.filter((item) => typeof item === "string").slice(0, 40) : [],
    tour: online ? null : clean(changes.tour, { max: 80 }) || null,
    tags: [],
    song: !online && changes.song?.videoId ? changes.song : null,
  };
}
