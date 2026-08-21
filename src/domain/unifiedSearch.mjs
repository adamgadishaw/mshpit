const rowCount = (rows) => Array.isArray(rows) ? rows.length : 0;

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
  return controller?.signal ? { signal: controller.signal } : {};
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
