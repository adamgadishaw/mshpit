import { clean, clampRating, LIMITS } from "./validation.mjs";
import { taggedUserIdsFromPeople } from "./postFriendTags.mjs";

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
    if (ids.length >= 8) break;
  }
  return ids;
}

export function buildReviewCreateBody(post) {
  return {
    clientMutationId: post.id,
    artist: post.artist,
    artistKey: cleanArtistKey(post.artistKey),
    venue: post.venue,
    city: post.city,
    date: post.date,
    overall: post.overall,
    band: post.band,
    room: post.room,
    dims: post.dims,
    review: post.review,
    taggedUserIds: taggedUserIdsFromPeople(post.taggedPeople),
    photos: post.photos,
    ...(Array.isArray(post.mediaAssetIds) ? { mediaAssetIds: cleanMediaAssetIds(post.mediaAssetIds) } : {}),
    photosPublic: post.photosPublic ? 1 : 0,
    landingShowcase: post.photosPublic && post.landingShowcase ? 1 : 0,
    setlist: post.setlist,
    tour: post.tour || null,
    tags: Array.isArray(post.tags) ? post.tags : [],
    song: post.song || null,
  };
}

export function buildReviewEditBody(changes) {
  return {
    artist: clean(changes.artist, { max: 80 }),
    artistKey: cleanArtistKey(changes.artistKey),
    venue: clean(changes.venue, { max: 80 }),
    city: clean(changes.city, { max: 60 }),
    date: clean(changes.date, { max: 20 }),
    overall: clampRating(changes.overall),
    band: changes.band == null ? null : clampRating(changes.band),
    room: changes.room == null ? null : clampRating(changes.room),
    dims: changes.dims && typeof changes.dims === "object" ? changes.dims : {},
    review: clean(changes.review, { max: LIMITS.review, newlines: true }),
    taggedUserIds: taggedUserIdsFromPeople(changes.taggedPeople),
    photos: Array.isArray(changes.photos) ? changes.photos.filter((item) => typeof item === "string").slice(0, 8) : [],
    ...(Array.isArray(changes.mediaAssetIds) ? { mediaAssetIds: cleanMediaAssetIds(changes.mediaAssetIds) } : {}),
    photosPublic: !!changes.photosPublic,
    landingShowcase: !!changes.photosPublic && !!changes.landingShowcase,
    setlist: Array.isArray(changes.setlist) ? changes.setlist.filter((item) => typeof item === "string").slice(0, 40) : [],
    tour: clean(changes.tour, { max: 80 }) || null,
    tags: Array.isArray(changes.tags) ? changes.tags.filter((item) => typeof item === "string").slice(0, 5) : [],
    song: changes.song?.videoId ? changes.song : null,
  };
}
