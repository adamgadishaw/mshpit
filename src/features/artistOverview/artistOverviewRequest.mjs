import { artistOverviewLocation } from "../../domain/artistOverviewLocation.mjs";
export { artistOverviewLocation } from "../../domain/artistOverviewLocation.mjs";

export function artistOverviewRequest({ artistKey, accountId = null, limit = 12, after = null, publicPreview = false, ...location } = {}) {
  const key = typeof artistKey === "string" ? artistKey.trim() : "";
  if (!key || key.length > 180 || /[\u0000-\u001f]/.test(key)) throw new TypeError("An artist identity is required.");
  if (after !== null && (typeof after !== "string" || !after || after.length > 2400)) throw new TypeError("Invalid show cursor.");
  const count = Number(limit);
  const bounded = Number.isSafeInteger(count) && count > 0 ? Math.min(50, count) : 12;
  const filters = artistOverviewLocation(location);
  const query = new URLSearchParams({ limit: String(bounded) });
  if (publicPreview) query.set("publicPreview", "1");
  if (after) query.set("after", after);
  if (filters.countryCode) query.set("countryCode", filters.countryCode);
  if (filters.city) query.set("city", filters.city);
  return { path: `/api/artists/${encodeURIComponent(key)}/live-summary?${query}`, expectedAccountId: accountId ? String(accountId) : null };
}

const COVERAGE = new Set(["fresh", "stale", "partial", "unknown", "unavailable", "disabled"]);
const count = (value) => Number.isSafeInteger(value) && value >= 0;
export function artistOverviewFromResponse(payload) {
  const schedule = payload?.schedule;
  const reputation = payload?.reputation;
  if (!payload?.artist?.key || !payload.artist.name || !reputation || !schedule
    || !Array.isArray(schedule.items) || schedule.items.length > 50 || !count(schedule.total)
    || typeof schedule.hasMore !== "boolean" || typeof schedule.legacy !== "boolean"
    || !COVERAGE.has(schedule.coverage?.status)
    || !["ratingCount", "reviewCount", "showCount"].every((key) => count(reputation[key]))
    || (reputation.avgRating !== null && (!Number.isFinite(reputation.avgRating) || reputation.avgRating < 0 || reputation.avgRating > 5))
    || (schedule.nextCursor !== null && (typeof schedule.nextCursor !== "string" || !schedule.nextCursor))
    || schedule.hasMore !== Boolean(schedule.nextCursor)
    || schedule.items.some((item) => !item || typeof item.id !== "string" || !item.id || typeof item.date !== "string")) {
    throw new TypeError("Artist live summary response is invalid.");
  }
  // Legacy profiles cannot regain live controls through a stale cached schedule.
  const projected = schedule.legacy ? { ...schedule, items: [], total: 0, nextCursor: null, hasMore: false } : schedule;
  return { ...payload, reputation: { ...reputation, average: reputation.avgRating }, schedule: projected };
}
