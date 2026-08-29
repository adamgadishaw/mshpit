export const COMPOSER_ARTIST_SEARCH_LIMIT = 8;
export const ARTIST_SEARCH_MAX_LIMIT = 40;

const ARTIST_SEARCH_CACHE_TTL_MS = 2 * 60 * 1000;
const ARTIST_SEARCH_CACHE_MAX_ENTRIES = 48;
const settledCachesByClient = new WeakMap();

const cleanQuery = (value) => String(value || "").trim().slice(0, 80);
const cleanLimit = (value) => Math.min(
  ARTIST_SEARCH_MAX_LIMIT,
  Math.max(1, Number.isFinite(Number(value)) ? Math.trunc(Number(value)) : 20),
);

function boundedArtists(value, limit) {
  const rows = Array.isArray(value) ? value : [];
  const seen = new Set();
  const out = [];
  for (const artist of rows) {
    const name = String(artist?.name || "").trim();
    if (!name) continue;
    const identity = String(artist?.key || artist?.norm || name).trim().toLowerCase();
    if (!identity || seen.has(identity)) continue;
    seen.add(identity);
    out.push(artist);
    if (out.length >= limit) break;
  }
  return out;
}

// Search summaries intentionally omit deep release data while the player is
// paused. Never let a later type-ahead response downgrade richer metadata that
// an artist page already resolved; a full response still replaces/augments a
// previously cached summary in the normal direction.
export function mergeArtistSearchCacheEntry(current, incoming) {
  if (!incoming || typeof incoming !== "object") return current || incoming;
  if (!current || typeof current !== "object") return incoming;
  const merged = { ...current, ...incoming };
  if (incoming.searchSummary === true) {
    for (const field of ["albums", "topTracks"]) {
      const currentRows = Array.isArray(current[field]) ? current[field] : [];
      const incomingRows = Array.isArray(incoming[field]) ? incoming[field] : [];
      if (currentRows.length > incomingRows.length) merged[field] = currentRows;
    }
    if (current.searchSummary !== true) delete merged.searchSummary;
  } else {
    delete merged.searchSummary;
  }
  return merged;
}

function abortError(signal) {
  if (signal?.reason instanceof Error) return signal.reason;
  const error = new Error("Artist search was cancelled.");
  error.name = "AbortError";
  return error;
}

function cacheFor(apiClient) {
  let cache = settledCachesByClient.get(apiClient);
  if (!cache) {
    cache = new Map();
    settledCachesByClient.set(apiClient, cache);
  }
  return cache;
}

function readCached(cache, key) {
  const cached = cache.get(key);
  if (!cached) return null;
  if (Date.now() - cached.at >= ARTIST_SEARCH_CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  cache.delete(key);
  cache.set(key, cached);
  return cached.rows;
}

function remember(cache, key, rows) {
  cache.delete(key);
  cache.set(key, { at: Date.now(), rows });
  while (cache.size > ARTIST_SEARCH_CACHE_MAX_ENTRIES) {
    cache.delete(cache.keys().next().value);
  }
}

// The database remains the fast first answer. Composer lookup alone may make
// one bounded MusicBrainz resolution when that catalog has no match, which is
// what lets a real artist be attached before the next catalog ingestion run.
// Both requests share the caller's AbortSignal, so typing another character or
// leaving the composer makes the obsolete work ineligible to update the UI.
export async function fetchArtistSuggestions(query, {
  signal,
  limit = 20,
  remoteFallback = false,
  force = false,
  apiClient,
} = {}) {
  if (typeof apiClient !== "function") throw new TypeError("Artist search requires an API client.");
  if (signal?.aborted) throw abortError(signal);
  const term = cleanQuery(query);
  const boundedLimit = cleanLimit(limit);
  const cache = cacheFor(apiClient);
  const cacheKey = (remoteFallback ? "remote:" : "catalog:") + boundedLimit + ":" + term.toLowerCase();
  const cached = force ? null : readCached(cache, cacheKey);
  if (cached) return cached;
  const requestOptions = {
    signal,
    silent: true,
    timeoutMs: 8_000,
    context: remoteFallback ? "Finding an artist for this post" : "Searching artists",
  };
  const local = await apiClient(
    `/api/artists?q=${encodeURIComponent(term)}&limit=${boundedLimit}`,
    requestOptions,
  );
  const localArtists = boundedArtists(local?.artists, boundedLimit);
  if (localArtists.length || !remoteFallback || term.length < 3) {
    if (signal?.aborted) throw abortError(signal);
    remember(cache, cacheKey, localArtists);
    return localArtists;
  }

  const resolved = await apiClient(
    `/api/artists/resolve?name=${encodeURIComponent(term)}`,
    requestOptions,
  );
  if (signal?.aborted) throw abortError(signal);
  const rows = boundedArtists(
    resolved?.artist ? [{ ...resolved.artist, transient: resolved.transient === true }] : [],
    boundedLimit,
  );
  remember(cache, cacheKey, rows);
  return rows;
}

export async function attachArtistSuggestion(artist, {
  signal,
  apiClient,
} = {}) {
  if (typeof apiClient !== "function") throw new TypeError("Artist attachment requires an API client.");
  if (signal?.aborted) throw abortError(signal);
  const name = cleanQuery(artist?.name);
  if (!name) throw new TypeError("Choose one artist before attaching it.");
  const mbid = String(artist?.mbid || "").trim().toLowerCase();
  const response = await apiClient("/api/artists/resolve", {
    method: "POST",
    body: { name, ...(mbid ? { mbid } : {}) },
    signal,
    silent: true,
    timeoutMs: 8_000,
    context: "Attaching an artist to this post",
  });
  if (signal?.aborted) throw abortError(signal);
  const persisted = response?.artist;
  const key = String(persisted?.key || persisted?.norm || "").trim();
  const persistedName = String(persisted?.name || "").trim();
  if (!key || !persistedName) throw new Error("Pit did not return a durable artist identity.");
  settledCachesByClient.get(apiClient)?.clear();
  return { ...persisted, key, name: persistedName, transient: false };
}
