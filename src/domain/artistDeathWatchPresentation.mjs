export const ARTIST_DEATH_WATCH_FILTERS = Object.freeze([
  Object.freeze({ status: "pending", label: "Needs review" }),
  Object.freeze({ status: "dismissed", label: "Dismissed" }),
  Object.freeze({ status: "memorialized", label: "Memorialized" }),
]);

const FILTER_SET = new Set(ARTIST_DEATH_WATCH_FILTERS.map(({ status }) => status));

export function normalizeArtistDeathWatchFilter(value) {
  const status = typeof value === "string" ? value.trim().toLowerCase() : "";
  return FILTER_SET.has(status) ? status : "pending";
}

export function shouldPollArtistDeathWatch({ running = false, resourceStatus = "idle" } = {}) {
  return running === true && resourceStatus === "ready";
}

export function artistDeathWatchProviderWarning(code) {
  const normalized = typeof code === "string" ? code.trim().toLowerCase() : "";
  if (!normalized) return "";
  if (normalized.endsWith("_timeout")) {
    return "One artist-data source was slow during the last check. Catalog progress and confirmed alerts were kept, and the source will be tried again.";
  }
  if (normalized.endsWith("_rate_limited")) {
    return "One artist-data source asked Mshpit to slow down during the last check. Catalog progress and confirmed alerts were kept, and the source will be tried again.";
  }
  return "One artist-data source was unavailable during the last check. Catalog progress and confirmed alerts were kept, and the source will be tried again.";
}

export function artistDeathWatchEmptyMessage(status) {
  const normalized = normalizeArtistDeathWatchFilter(status);
  if (normalized === "dismissed") return "No dismissed artist alerts.";
  if (normalized === "memorialized") return "No artist alerts have been marked memorialized.";
  return "No exact, corroborated artist deaths currently need review.";
}
