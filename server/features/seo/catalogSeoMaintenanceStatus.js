const DATASETS = Object.freeze(["artists", "venues", "events", "cities", "concerts", "posts", "profiles", "pages"]);
const timestamp = (value) => Number.isSafeInteger(value) && value >= 0 ? value : null;
const count = (value) => Number.isSafeInteger(value) && value >= 0 ? value : 0;

// A moderation read must never scan/rebuild the catalog or contact Google.
// This projects the in-memory snapshot manager's already-computed aggregates.
export function projectCatalogSeoMaintenanceStatus(health = {}, { env = process.env } = {}) {
  const configured = Number(env.SITEMAP_REFRESH_INTERVAL_MS);
  const intervalMs = Number.isFinite(configured)
    ? Math.max(60_000, Math.min(86_400_000, Math.floor(configured))) : 900_000;
  const lastBuiltAt = timestamp(health.generatedAt);
  const ageMs = timestamp(health.ageMs);
  const available = health.available === true && lastBuiltAt != null;
  const state = health.refreshing ? "refreshing" : !available ? "pending"
    : Number(health.consecutiveFailures) > 0 ? "retrying"
      : ageMs != null && ageMs > intervalMs * 2 ? "stale" : "ready";
  let origin = "https://www.mshpit.com";
  try {
    const url = new URL(env.PUBLIC_ORIGIN || origin);
    if (url.protocol === "https:" && !url.username && !url.password) origin = url.origin;
  } catch { /* Invalid optional display configuration retains the canonical default. */ }
  return Object.freeze({
    state, lastBuiltAt, ageSeconds: ageMs == null ? null : Math.floor(ageMs / 1_000),
    nextRefreshMinutes: intervalMs / 60_000,
    counts: Object.freeze(Object.fromEntries(DATASETS.map(name => [name, count(health.datasetCounts?.[name])]))),
    totalUrls: count(health.totalUrls), retryAt: timestamp(health.nextRetryAt),
    indexingState: "not_measured", sitemapUrl: `${origin}/sitemap.xml`,
  });
}
