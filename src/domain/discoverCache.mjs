const normalizePart = (value) => String(value || "").trim().toLocaleLowerCase();

export function discoverOverviewCacheKey({ by = "popularity", country = "Worldwide" } = {}) {
  return `${by === "plays" ? "plays" : "popularity"}\u0000${normalizePart(country) || "worldwide"}`;
}

export function discoverGenreCacheKey({ genre = "", country = "Worldwide", limit = 12 } = {}) {
  const safeLimit = Math.min(60, Math.max(3, Number.isFinite(Number(limit)) ? Math.trunc(Number(limit)) : 12));
  return `${normalizePart(genre)}\u0000${normalizePart(country) || "worldwide"}\u0000${safeLimit}`;
}

// Small session-only LRU for public Discover responses. Values are immutable
// server snapshots; errors and aborted requests never enter this structure.
export function createDiscoverCache({ maxEntries = 12, ttlMs = 60_000, clock = Date.now } = {}) {
  const entries = new Map();
  const revisions = new Map();
  const capacity = Math.max(1, Math.trunc(Number(maxEntries)) || 1);
  const ttl = Math.max(0, Number(ttlMs) || 0);

  const touch = (key, entry) => {
    entries.delete(key);
    entries.set(key, entry);
    while (entries.size > capacity) entries.delete(entries.keys().next().value);
  };

  return {
    get(key) {
      const entry = entries.get(key);
      if (!entry) return null;
      if (clock() - entry.loadedAt >= ttl) {
        entries.delete(key);
        return null;
      }
      touch(key, entry);
      return entry.value;
    },

    claim(key) {
      const revision = (revisions.get(key) || 0) + 1;
      revisions.set(key, revision);
      return revision;
    },

    commit(key, revision, value) {
      if (revisions.get(key) !== revision) return false;
      touch(key, { value, loadedAt: clock() });
      return true;
    },

    invalidate(key) {
      entries.delete(key);
      revisions.set(key, (revisions.get(key) || 0) + 1);
    },

    clear() {
      entries.clear();
      revisions.clear();
    },

    get size() {
      return entries.size;
    },
  };
}
