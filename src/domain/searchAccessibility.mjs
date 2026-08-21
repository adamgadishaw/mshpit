const text = (value) => typeof value === "string" ? value.trim() : "";

export function searchResultSummary(groups = {}) {
  const counts = Object.values(groups).map((value) => Array.isArray(value) ? value.length : 0);
  return { total: counts.reduce((sum, count) => sum + count, 0), categories: counts.filter((count) => count > 0).length };
}

export function searchLiveAnnouncement({ query, state, error, groups } = {}) {
  const term = text(query).slice(0, 80);
  if (!term) return "";
  if (text(error)) return text(error);
  if (state === "loading") return `Searching Pit for ${term}.`;
  const { total, categories } = searchResultSummary(groups);
  if (!total || state === "no-results") return `No matches for ${term}.`;
  return `${total} ${total === 1 ? "result" : "results"} across ${categories} ${categories === 1 ? "category" : "categories"} for ${term}.`;
}
