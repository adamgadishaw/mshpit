import { hasPostDiscussion } from "./showDiscussion.mjs";
import { isDiscoverEventBannerMediaEligible } from "./discoverEventBanner.mjs";

export function savedShowRating(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 && value <= 5 ? value : null;
}

// Presentation only: never derive an overall score or count from dimensions,
// artist/venue aggregates, likes, comments, or the number of review excerpts.
export function showPageRating(log = {}) {
  const overall = savedShowRating(log.overall);
  // Persisted reviews also carry archive identity and can enter show navigation
  // as performance events. Their authored score still belongs to that member.
  const individual = hasPostDiscussion(log);
  const count = !individual && Number.isSafeInteger(log.ratingCount) && log.ratingCount >= 0 ? log.ratingCount : null;
  return {
    overall,
    label: individual ? `${log.user?.name || "Fan"}'s overall show rating` : "Overall show rating",
    countLabel: count == null ? null : `${count} ${count === 1 ? "rating" : "ratings"}`,
  };
}

export function showPageEventArtwork(event = {}) {
  const image = event.eventImage;
  if (!image) return null;
  const candidate = { ...image, source: "provider", provider: event.source };
  return isDiscoverEventBannerMediaEligible(candidate) ? {
    ...candidate, by: image.attribution || image.by || image.credit,
  } : null;
}
