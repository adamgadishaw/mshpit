const rowCount = (rows) => Array.isArray(rows) ? rows.length : 0;

const SEARCH_CATEGORY_DEFINITIONS = Object.freeze([
  Object.freeze({ key: "all", label: "All" }),
  Object.freeze({ key: "artists", label: "Artists" }),
  Object.freeze({ key: "shows", label: "Shows" }),
  Object.freeze({ key: "venues", label: "Venues" }),
  Object.freeze({ key: "people", label: "People" }),
  Object.freeze({ key: "clubs", label: "Fan clubs" }),
  Object.freeze({ key: "songs", label: "Songs" }),
]);

export function unifiedSearchCategories({ canSearchPeople = false, canSearchSongs = false } = {}) {
  return SEARCH_CATEGORY_DEFINITIONS.filter((category) => (
    (category.key !== "people" || canSearchPeople)
    && (category.key !== "songs" || canSearchSongs)
  ));
}

export function unifiedSearchPreviewRows(rows, { activeCategory = "all", category, limit = 5 } = {}) {
  const safeRows = Array.isArray(rows) ? rows : [];
  if (activeCategory === "all" && category !== "all") {
    return safeRows.slice(0, Math.max(0, Number(limit) || 0));
  }
  return activeCategory === category ? safeRows : [];
}

export async function settleUnifiedSearchRequests(requests = {}) {
  const entries = Object.entries(requests)
    .filter(([key, request]) => ["people", "artists", "songs"].includes(key) && request);
  const settled = await Promise.allSettled(entries.map(([, request]) => request));
  const result = {
    people: [], artists: [], songs: [], attempted: entries.length, succeeded: 0, failures: [], aborted: false,
  };
  settled.forEach((outcome, index) => {
    const key = entries[index][0];
    if (outcome.status === "fulfilled") {
      result[key] = Array.isArray(outcome.value) ? outcome.value : [];
      result.succeeded += 1;
      return;
    }
    result.failures.push(key);
    if (outcome.reason?.name === "AbortError") result.aborted = true;
  });
  return result;
}

export function unifiedSearchResultCount({ people, artists, songs, venues, events, clubs } = {}) {
  return rowCount(people) + rowCount(artists) + rowCount(songs) + rowCount(venues) + rowCount(events) + rowCount(clubs);
}

export function unifiedSearchState({ query, loading = false, ...sections } = {}) {
  if (!String(query || "").trim()) return "browse";
  if (loading) return "loading";
  return unifiedSearchResultCount(sections) > 0 ? "ready" : "no-results";
}

// Every remote branch of one unified search must share the same cancellation
// signal, including people search. This small helper makes that contract
// explicit and independently testable.
export function unifiedSearchRequestOptions(controller) {
  return controller?.signal ? { signal: controller.signal, throwOnError: true } : { throwOnError: true };
}

const boundedText = (value, maximum) => String(value || "").trim().slice(0, maximum);
const boundedIdentity = (value) => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const normalized = boundedText(value, 240);
  return normalized || null;
};

// Recent searches are durable navigation, not just labels. Keep a small,
// provider-neutral playback descriptor so tapping a recent song reopens the
// exact result instead of running a new fuzzy search that may resolve a
// different recording. The allowlist also prevents arbitrary provider payloads
// from growing local storage without bounds.
export function recentSongTrack(value) {
  const candidate = value?.track && typeof value.track === "object" ? value.track : value;
  let title = boundedText(candidate?.title, 200);
  let artist = boundedText(candidate?.artist, 120);
  if ((!title || !artist) && value?.type === "song") {
    const label = boundedText(value.label, 320);
    const split = label.lastIndexOf(" - ");
    if (split > 0) {
      title ||= label.slice(0, split).trim().slice(0, 200);
      artist ||= label.slice(split + 3).trim().slice(0, 120);
    }
  }
  if (!title || !artist) return null;
  const duration = Number(candidate?.duration);
  return {
    kind: "track",
    title,
    artist,
    id: boundedIdentity(candidate?.id),
    sourceId: boundedIdentity(candidate?.sourceId),
    provider: boundedText(candidate?.provider, 40) || null,
    source: boundedText(candidate?.source, 40) || null,
    videoId: boundedText(candidate?.videoId, 160) || null,
    url: boundedText(candidate?.url, 2048) || null,
    preview: boundedText(candidate?.preview, 2048) || null,
    art: boundedText(candidate?.art, 2048) || null,
    album: boundedText(candidate?.album, 200) || null,
    duration: Number.isFinite(duration) && duration > 0 ? Math.min(Math.trunc(duration), 24 * 60 * 60) : 0,
  };
}

export function recentSongSearchEntry(song) {
  const track = recentSongTrack(song);
  return track ? { type: "song", label: `${track.title} - ${track.artist}`, track } : null;
}

const normalizedQuery = (value) => String(value || "").trim().toLowerCase();
const normalizedIds = (ids) => [...new Set((Array.isArray(ids) ? ids : [])
  .map((id) => String(id || "").trim())
  .filter(Boolean))].sort();

// Search results are safe only for the account and block snapshot that fetched
// them. Including both in the scope makes an account handoff or optimistic block
// invalidate an already-rendered result synchronously, before an effect refetches.
export function unifiedPeopleSearchScope(accountId, blockedIds = []) {
  const account = accountId ? `user:${encodeURIComponent(String(accountId))}` : "guest";
  return `${account}|blocked:${normalizedIds(blockedIds).map(encodeURIComponent).join(",")}`;
}

export function visibleUnifiedPeople(cache, { scope, query, viewerId, blockedIds = [], limit = 20 } = {}) {
  const needle = normalizedQuery(query);
  if (!needle || cache?.scope !== scope || normalizedQuery(cache?.query) !== needle) return [];
  const blocked = new Set(normalizedIds(blockedIds));
  return (Array.isArray(cache?.rows) ? cache.rows : [])
    .filter((user) => user?.id && String(user.id) !== String(viewerId || "") && !blocked.has(String(user.id)))
    .filter((user) => `${user.name || ""} ${user.handle || ""}`.toLowerCase().includes(needle))
    .slice(0, limit);
}

export function withoutBlockedPersonSearches(entries, blockedIds = []) {
  const blocked = new Set(normalizedIds(blockedIds));
  return (Array.isArray(entries) ? entries : [])
    .filter((entry) => entry?.type !== "person" || !blocked.has(String(entry.id || "")));
}
