const FILTERS = new Set(["following", "local", "everyone"]);

export function feedFilterStorageKey(accountId) {
  const scope = typeof accountId === "string" && accountId.trim() ? accountId.trim() : "guest";
  return `pit.feed.filter.v1.${scope}`;
}

export function normalizeFeedFilter(value, { loggedIn = true } = {}) {
  if (!loggedIn) return "everyone";
  return FILTERS.has(value) ? value : "everyone";
}

export function feedFooterState({ visibleCount = 0, loadedCount = 0, hasMore = false, loading = false } = {}) {
  if (loading) return { kind: "loading", label: "Loading older posts..." };
  if (visibleCount < loadedCount) return { kind: "reveal", label: "Show more posts" };
  if (hasMore) return { kind: "fetch", label: "Load older posts" };
  if (loadedCount > 0) return { kind: "caught-up", label: "You're caught up" };
  return { kind: "empty", label: "" };
}

const SUGGESTED_POST_LABEL = "Suggested post";
const SUGGESTED_POST_DETAIL = "Pit mixes recent posts from across the community to keep your feed fresh. Suggestions change over time.";

export function recommendationDisclosure(recommendation) {
  if (!recommendation || typeof recommendation !== "object") return null;
  return {
    label: SUGGESTED_POST_LABEL,
    detail: SUGGESTED_POST_DETAIL,
    personalized: recommendation.personalized === true,
    algorithm: typeof recommendation.algorithm === "string" ? recommendation.algorithm : null,
  };
}
