// Counts describe the rows already available, never an unbounded catalogue total.
export function availableSearchCategories(categories = [], groups = {}) {
  const rows = categories.filter((category) => category.key !== "all").map((category) => ({
    ...category,
    count: Array.isArray(groups[category.key === "shows" ? "events" : category.key])
      ? groups[category.key === "shows" ? "events" : category.key].length : 0,
  }));
  const total = rows.reduce((count, category) => count + category.count, 0);
  return categories.map((category) => category.key === "all"
    ? { ...category, count: total }
    : rows.find((row) => row.key === category.key));
}

export function discoverEventRecovery({ status = "idle", count = 0, days = 30, ranges = [], local = false, region = "Worldwide" } = {}) {
  if (count > 0) return null;
  if (["idle", "loading", "refreshing"].includes(status)) {
    return { kind: "loading", message: "Finding events for your area and dates…", nextDays: null, worldwide: false };
  }
  if (status === "error") {
    return { kind: "error", message: "Events could not load. Your area and dates are unchanged.", nextDays: null, worldwide: false };
  }
  const nextDays = [...new Set(ranges)].filter((value) => Number.isFinite(value) && value > days).sort((a, b) => a - b)[0] || null;
  return {
    kind: "empty",
    message: `No events are listed ${local ? "near your home area" : `for ${region}`} over the next ${days} days.`,
    nextDays,
    worldwide: local || region !== "Worldwide",
  };
}
