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

export function replaceVenueReviewSnapshot(groups, venueKey, rows) {
  if (!venueKey || !Array.isArray(rows)) return groups || {};
  return { ...(groups || {}), [venueKey]: rows };
}
