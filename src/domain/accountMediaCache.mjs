export function mediaReactionsForAccountTransition(reactions, previousAccountId, nextAccountId) {
  if (String(previousAccountId || "") === String(nextAccountId || "")) return reactions || {};
  return Object.fromEntries(Object.entries(reactions || {}).map(([url, reaction]) => [
    url,
    { ...(reaction || {}), mine: false },
  ]));
}

export function venueReviewStorageKey(accountId) {
  return `pit.venueReviews.v2.${encodeURIComponent(String(accountId || "guest"))}`;
}

export function withoutVenueReviewsByUser(groups, userId) {
  const blocked = String(userId || "");
  if (!blocked) return groups || {};
  return Object.fromEntries(Object.entries(groups || {}).map(([venue, rows]) => [
    venue,
    Array.isArray(rows)
      ? rows.filter((row) => String(row?.userId || row?.user_id || "") !== blocked)
      : [],
  ]));
}

export function withoutVenueReviewsByUsers(groups, userIds = []) {
  const blocked = new Set((Array.isArray(userIds) ? userIds : [])
    .map((value) => String(value || ""))
    .filter(Boolean));
  if (!blocked.size) return groups || {};
  return Object.fromEntries(Object.entries(groups || {}).map(([venue, rows]) => [
    venue,
    Array.isArray(rows)
      ? rows.filter((row) => !blocked.has(String(row?.userId || row?.user_id || "")))
      : [],
  ]));
}

// Persisted venue reviews are continuity data, not privacy authority. A signed-in
// viewer may only read them after /api/me/blocked has confirmed the current
// account's block graph. Account mismatch and a pending graph both fail closed.
export function venueReviewsForPrivacyScope(groups, venueKey, {
  cacheAccountId = null,
  viewerAccountId = null,
  blockGraphAuthoritative = false,
  blockedIds = [],
} = {}) {
  const key = String(venueKey || "");
  if (!key || String(cacheAccountId || "") !== String(viewerAccountId || "")) return [];
  if (viewerAccountId && !blockGraphAuthoritative) return [];
  const rows = Array.isArray(groups?.[key]) ? groups[key] : [];
  const blocked = new Set((Array.isArray(blockedIds) ? blockedIds : [])
    .map((value) => String(value || ""))
    .filter(Boolean));
  return blocked.size
    ? rows.filter((row) => !blocked.has(String(row?.userId || row?.user_id || "")))
    : rows;
}

export function replaceVenueReviewSnapshot(groups, venueKey, rows) {
  if (!venueKey || !Array.isArray(rows)) return groups || {};
  return { ...(groups || {}), [venueKey]: rows };
}
