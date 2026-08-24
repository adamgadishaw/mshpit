import { hasPostDiscussion } from "./showDiscussion.mjs";

const validPostId = (value) => {
  if (typeof value === "number") return Number.isSafeInteger(value) && value > 0;
  return typeof value === "string" && value.trim().length > 0;
};

// ShowScreen accepts both persisted Pit review posts and non-post performance
// listings (Ticketmaster dates, artist-created tour dates, and archive
// aggregates). Keep that distinction explicit so only real posts receive
// `/show/:postId` URLs and post-scoped analytics.
export function prepareShowNavigation(log) {
  if (!log || typeof log !== "object" || Array.isArray(log)) return null;

  const archiveAggregate = !!log.key && !validPostId(log.id);
  const adapted = archiveAggregate ? {
    ...log,
    id: log.key,
    archiveShowKey: log.key,
    overall: typeof log.avgRating === "number" ? log.avgRating : null,
    city: log.place || log.city || "",
  } : log;
  const performanceEvent = archiveAggregate
    || adapted.performanceEvent === true
    || !hasPostDiscussion(adapted);

  return Object.freeze({
    destination: performanceEvent && adapted.performanceEvent !== true
      ? { ...adapted, performanceEvent: true }
      : adapted,
    kind: performanceEvent ? "performance" : "post",
    postId: performanceEvent ? null : adapted.id,
  });
}

export function showNavigationPostId(log) {
  if (!log || log.performanceEvent === true || log.archiveShowKey) return null;
  return hasPostDiscussion(log) ? log.id : null;
}
