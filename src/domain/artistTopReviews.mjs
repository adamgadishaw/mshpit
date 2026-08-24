import { toIsoDate } from "./dates.mjs";

const finiteCount = (value) => {
  const count = Number(value);
  return Number.isFinite(count) ? Math.max(0, count) : 0;
};

const showTime = (review) => {
  const iso = toIsoDate(review?.date);
  return iso ? Date.parse(`${iso}T00:00:00.000Z`) : 0;
};

const postTime = (review) => {
  const createdAt = Number(review?.createdAt ?? review?.updatedAt ?? 0);
  return Number.isFinite(createdAt) ? Math.max(0, createdAt) : 0;
};

const stableIdCompare = (left, right) => {
  const a = String(left?.id || "");
  const b = String(right?.id || "");
  if (a === b) return 0;
  return a < b ? -1 : 1;
};

export const artistReviewEngagement = (review) =>
  finiteCount(review?.likes) + finiteCount(review?.comments);

export function isEligibleArtistTopReview(review) {
  if (!review || typeof review !== "object") return false;
  if (review.kind && review.kind !== "review") return false;
  if (String(review.date || "").trim().toLowerCase() === "aggregate") return false;
  if (review.removed === true || Number(review.removed) === 1) return false;
  return String(review.review || "").trim().length > 0;
}

// Rank the real fan writing already available on an artist page. Engagement is
// the strongest signal; score and the performance date break ties before the
// immutable post id makes identical rows deterministic across clients.
export function topArtistReviews(reviews, { limit = 3 } = {}) {
  const take = Math.max(0, Math.min(10, Math.trunc(Number(limit) || 0)));
  if (!take || !Array.isArray(reviews)) return [];

  return reviews
    .filter(isEligibleArtistTopReview)
    .slice()
    .sort((a, b) => {
      const engagement = artistReviewEngagement(b) - artistReviewEngagement(a);
      if (engagement) return engagement;

      const score = finiteCount(b.overall) - finiteCount(a.overall);
      if (score) return score;

      const performanceRecency = showTime(b) - showTime(a);
      if (performanceRecency) return performanceRecency;

      const publicationRecency = postTime(b) - postTime(a);
      if (publicationRecency) return publicationRecency;

      return stableIdCompare(a, b);
    })
    .slice(0, take);
}
