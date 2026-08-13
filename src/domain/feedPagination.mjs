export function filteredFeedNextAction({ filter, visibleCount, loadedMatchCount, hasMore, loadingMore }) {
  if (filter === "everyone") return "none";
  if (visibleCount < loadedMatchCount) return "reveal";
  if (hasMore && !loadingMore) return "fetch";
  return "none";
}
