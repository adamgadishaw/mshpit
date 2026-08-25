import { calendarDateKey } from "./dataPolicy.mjs";

export const ARTIST_UPCOMING_PREVIEW_LIMIT = 3;

const dateKey = (show) => calendarDateKey(show?.date) ?? Number.MAX_SAFE_INTEGER;

// Artist profiles need the nearest dates first even while a newly submitted
// batch is still in local state. The server normally returns this order, but
// sorting a copy here keeps the compact preview deterministic without mutating
// the store's canonical tour-date snapshot.
export function selectArtistUpcomingShows(value, { expanded = false } = {}) {
  const ordered = Array.isArray(value) ? [...value] : [];
  ordered.sort((left, right) => {
    const byDate = dateKey(left) - dateKey(right);
    if (byDate) return byDate;
    return String(left?.id || "").localeCompare(String(right?.id || ""));
  });

  const total = ordered.length;
  const hasOverflow = total > ARTIST_UPCOMING_PREVIEW_LIMIT;
  const isExpanded = hasOverflow && expanded === true;

  return {
    shows: isExpanded ? ordered : ordered.slice(0, ARTIST_UPCOMING_PREVIEW_LIMIT),
    total,
    overflowCount: Math.max(0, total - ARTIST_UPCOMING_PREVIEW_LIMIT),
    hasOverflow,
    expanded: isExpanded,
  };
}
