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

const EXPLANATIONS = {
  followed_creator: "You follow this member. Following stays chronological; Discover can also surface their strongest recent posts.",
  artist_affinity: "You have engaged with this artist or related concert posts. Pit uses that signal without exposing anyone else's activity.",
  genre_affinity: "This matches genres saved on your profile or reflected in your recent activity.",
  local: "This concert is connected to your saved home city.",
  global_momentum: "This recent post is receiving likes and discussion across Pit.",
  fresh_global: "This is a recent community post added to keep discovery from becoming repetitive.",
};

export function recommendationDisclosure(recommendation) {
  if (!recommendation || typeof recommendation !== "object") return null;
  const reason = typeof recommendation.reason === "string" && recommendation.reason.trim()
    ? recommendation.reason.trim()
    : "Recommended by Pit";
  const reasonCode = typeof recommendation.reasonCode === "string" ? recommendation.reasonCode : "";
  return {
    label: reason,
    detail: EXPLANATIONS[reasonCode] || "Pit ranks recent community posts, then adds bounded taste and diversity signals.",
    personalized: recommendation.personalized === true,
    algorithm: typeof recommendation.algorithm === "string" ? recommendation.algorithm : null,
  };
}
