import { clean, clampRating, LIMITS } from "../lib/validate.js";

// Artist suggestions carry a catalog key that is distinct from the display
// name. Keep that identity explicit at the client boundary so punctuation and
// same-named acts do not silently fall back to display-text matching.
export function cleanArtistKey(value) {
  return clean(value, { max: 120 }) || null;
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
    photos: post.photos,
    photosPublic: post.photosPublic ? 1 : 0,
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
    photos: Array.isArray(changes.photos) ? changes.photos.filter((item) => typeof item === "string").slice(0, 8) : [],
    photosPublic: !!changes.photosPublic,
    setlist: Array.isArray(changes.setlist) ? changes.setlist.filter((item) => typeof item === "string").slice(0, 40) : [],
    tour: clean(changes.tour, { max: 80 }) || null,
    tags: Array.isArray(changes.tags) ? changes.tags.filter((item) => typeof item === "string").slice(0, 5) : [],
    song: changes.song?.videoId ? changes.song : null,
  };
}
