import { projectLoadState } from "../../domain/loadState.mjs";
import { artistGalleryIdentityKey } from "../../domain/artistGalleryMedia.mjs";
import { accountTargetScope } from "../../domain/screenScope.mjs";
import { topArtistReviews } from "../../domain/artistTopReviews.mjs";

export const EMPTY_ARTIST_REVIEWS = Object.freeze([]);

export function artistReviewsIdentity({ name = null, artistKey = null } = {}) {
  return artistGalleryIdentityKey(name, artistKey);
}

export function artistReviewsScope({ accountId = null, name = null, artistKey = null } = {}) {
  return accountTargetScope(accountId, `artist-reviews:${artistReviewsIdentity({ name, artistKey })}`);
}

export function projectArtistReviewsResource(resource, options = {}) {
  return projectLoadState(resource, artistReviewsScope(options), EMPTY_ARTIST_REVIEWS);
}

export function selectArtistReviewsPresentation(resource, hydratedReviews, { limit = 3, memorialMode = false } = {}) {
  const hasAuthoritativeSnapshot = resource?.updatedAt != null;
  const requested = Math.trunc(Number(limit) || 0);
  const take = Math.max(0, Math.min(10, requested));
  const authoritative = Array.isArray(resource?.data) ? resource.data.slice(0, take) : EMPTY_ARTIST_REVIEWS;
  return Object.freeze({
    reviews: hasAuthoritativeSnapshot
      ? authoritative
      : topArtistReviews(hydratedReviews, { limit: take, memorialMode }),
    source: hasAuthoritativeSnapshot ? "authoritative" : "hydrated",
    initialError: resource?.status === "error" && !hasAuthoritativeSnapshot,
    refreshError: resource?.status === "error" && hasAuthoritativeSnapshot,
  });
}
