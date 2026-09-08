// Optional device caches are hints, not a prerequisite for account hydration.
// Never feed an unvalidated parsed JSON value into Set or screen selection.
export function restoredMainTab(value) {
  return ["feed", "search", "discover", "you"].includes(value) ? value : "feed";
}

export function hiddenRecommendationIds(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((id) => typeof id === "string" && id.length > 0
    && id.length <= 240 && !/[\u0000-\u001f\u007f]/u.test(id)))];
}
