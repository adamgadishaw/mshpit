import { projectLoadState } from "../../domain/loadState.mjs";
import { accountTargetScope } from "../../domain/screenScope.mjs";

export const EMPTY_ARTIST_RECOMMENDATIONS = Object.freeze({
  recommendations: Object.freeze([]),
  personalized: false,
  signalCount: 0,
});

export function artistRecommendationScope(accountId = null, profileRevision = 0) {
  const revision = Number.isFinite(Number(profileRevision)) ? Math.max(0, Math.floor(Number(profileRevision))) : 0;
  return accountTargetScope(accountId, `artist-recommendations:${revision}`);
}

export function projectArtistRecommendationResource(resource, accountId = null, profileRevision = 0) {
  return projectLoadState(resource, artistRecommendationScope(accountId, profileRevision), EMPTY_ARTIST_RECOMMENDATIONS);
}
