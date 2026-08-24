import { localCalendarIso, toIsoDate } from "./dates.mjs";

function timestamp(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function timestampDay(value) {
  const parsed = timestamp(value);
  return parsed == null ? "" : localCalendarIso(parsed);
}

export function isConcertReview(post) {
  if (!post || typeof post !== "object") return false;
  return (post.kind || "review") === "review";
}

export function selectConcertReviews(posts) {
  return Array.isArray(posts) ? posts.filter(isConcertReview) : [];
}

function timelineEntry(post, index) {
  const createdAt = timestamp(post?.createdAt ?? post?.at);
  const showDate = isConcertReview(post) ? toIsoDate(post?.date) : "";

  // Reviews live on the night the show happened. Status posts have no show
  // night, so they live on their publication day and can still surface as a
  // recent profile update. Undated legacy reviews use that same publication
  // fallback instead of jumping unpredictably around the diary.
  return {
    post,
    index,
    day: showDate || timestampDay(createdAt),
    createdAt: createdAt || 0,
    id: String(post?.id || ""),
  };
}

// A profile is a mixed timeline: concert reviews are chronological by the
// actual show-held date, while status posts are chronological by publication
// date. The remaining keys make ties deterministic without mutating the feed.
export function selectProfileTimeline(posts) {
  if (!Array.isArray(posts) || posts.length === 0) return [];
  return posts
    .map(timelineEntry)
    .sort((left, right) => right.day.localeCompare(left.day)
      || right.createdAt - left.createdAt
      || left.id.localeCompare(right.id)
      || left.index - right.index)
    .map((entry) => entry.post);
}
