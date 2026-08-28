export const CALENDAR_HISTORY_PAGE_SIZE = 30;

function normalizedVisibleLimit(value) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < CALENDAR_HISTORY_PAGE_SIZE) {
    return CALENDAR_HISTORY_PAGE_SIZE;
  }
  return parsed;
}

/**
 * Calendar reveals history in bounded pages even when another screen has already
 * warmed more of the shared profile-history cache. A server cursor remains the
 * authority for whether still-older rows can be requested.
 */
export function calendarHistoryWindow(posts, visibleLimit, nextCursor = null) {
  const rows = Array.isArray(posts) ? posts : [];
  const limit = normalizedVisibleLimit(visibleLimit);
  const visiblePosts = rows.slice(0, limit);
  const hasBufferedPage = rows.length > visiblePosts.length;
  const hasServerPage = typeof nextCursor === "string" && nextCursor.length > 0;

  return Object.freeze({
    posts: visiblePosts,
    visibleLimit: limit,
    hasBufferedPage,
    hasServerPage,
    hasMore: hasBufferedPage || hasServerPage,
    complete: !hasBufferedPage && !hasServerPage,
  });
}

export function nextCalendarHistoryLimit(currentLimit) {
  return normalizedVisibleLimit(currentLimit) + CALENDAR_HISTORY_PAGE_SIZE;
}
