// Visit-local UI state only. Never persist queries in URLs, storage or analytics.
// BrowserHistory already bounds the number of route snapshots to 80.
const MAX_AGE = 15 * 60 * 1000;
const categories = new Set(["all", "artists", "people", "songs", "venues", "shows", "clubs"]);

export function searchContinuity(value, accountId, now = Date.now()) {
  if (!value || value.accountId !== (accountId || null) || !Number.isFinite(value.at)
    || now - value.at < 0 || now - value.at > MAX_AGE) return null;
  return {
    accountId: accountId || null, at: value.at,
    query: typeof value.query === "string" ? value.query.slice(0, 512) : "",
    category: categories.has(value.category) ? value.category : "all",
    scrollY: Number.isFinite(value.scrollY) ? Math.max(0, Math.min(1_000_000, value.scrollY)) : 0,
  };
}
