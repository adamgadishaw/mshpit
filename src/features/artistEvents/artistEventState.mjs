import { artistEventIdentity } from "../../domain/artistEventArchive.mjs";
import { projectLoadState } from "../../domain/loadState.mjs";
import { accountTargetScope } from "../../domain/screenScope.mjs";

const EMPTY_LIST = Object.freeze([]);

export const EMPTY_ARTIST_EVENT_ARCHIVE = Object.freeze({
  artist: Object.freeze({ key: null, name: "" }),
  topShows: EMPTY_LIST,
  tours: EMPTY_LIST,
  shows: EMPTY_LIST,
  upcoming: EMPTY_LIST,
  totals: Object.freeze({ shows: 0, ratings: 0, reviews: 0, tours: 0, upcoming: 0 }),
  truncated: false,
});

export const EMPTY_ARTIST_EVENT_REVIEWS = Object.freeze({
  reviews: EMPTY_LIST,
  nextCursor: null,
  total: 0,
  loadingMore: false,
});

export function artistEventArchiveScope({ accountId = null, artistKey = null, name = null } = {}) {
  return accountTargetScope(accountId, `artist-events:${artistEventIdentity({ artistKey, name })}`);
}

export function artistEventReviewsScope({ accountId = null, artistKey = null, name = null, showKey = null, tourKey = null } = {}) {
  const selection = showKey ? `show:${String(showKey).trim()}` : `tour:${String(tourKey || "").trim()}`;
  return accountTargetScope(accountId, `artist-event-reviews:${artistEventIdentity({ artistKey, name })}:${selection}`);
}

export function projectArtistEventArchive(resource, options = {}) {
  return projectLoadState(resource, artistEventArchiveScope(options), EMPTY_ARTIST_EVENT_ARCHIVE);
}

export function projectArtistEventReviews(resource, options = {}) {
  return projectLoadState(resource, artistEventReviewsScope(options), EMPTY_ARTIST_EVENT_REVIEWS);
}

export function mergeArtistEventReviewPage(current, incoming) {
  const byId = new Map();
  for (const review of [...(Array.isArray(current) ? current : []), ...(Array.isArray(incoming) ? incoming : [])]) {
    const id = review?.id == null ? "" : String(review.id);
    if (id) byId.set(id, review);
  }
  return [...byId.values()];
}
