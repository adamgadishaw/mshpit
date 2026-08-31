export const MAX_SUGGESTED_PITTERS = 5;

const boundedLimit = (value) => Math.max(
  0,
  Math.min(MAX_SUGGESTED_PITTERS, Number.isFinite(Number(value)) ? Math.floor(Number(value)) : MAX_SUGGESTED_PITTERS),
);

export function visibleSuggestedPitters(
  suggestions,
  { isFollowing, isBlocked, limit = MAX_SUGGESTED_PITTERS } = {},
) {
  const maximum = boundedLimit(limit);
  if (!maximum) return [];
  const rows = [];
  const seen = new Set();
  for (const suggestion of Array.isArray(suggestions) ? suggestions : []) {
    const id = String(suggestion?.user?.id || "").trim();
    if (!id || seen.has(id) || isFollowing?.(id) || isBlocked?.(id)) continue;
    seen.add(id);
    rows.push(suggestion);
    if (rows.length >= maximum) break;
  }
  return rows;
}

export function suggestedPittersIntro(homeCity) {
  return String(homeCity || "").trim()
    ? "Picked using location and music taste."
    : "Picked using music taste and activity.";
}
