import { concertPath, eventPath } from "./urls.mjs";
import { isCityOnlyReview } from "./showNavigation.mjs";
import { isOnlineReview } from "./onlineReview.mjs";

// The saved post id never doubles as a provider event id. Archive keys on
// author reviews identify the event link, not the review's own destination.
export function reviewEventPath(post) {
  if (!post || isOnlineReview(post) || isCityOnlyReview(post)) return null;
  if (post.archiveShowKey) return concertPath(post.archiveShowKey);
  const eventId = post.tourDateId || post.attendanceTicket?.tourDateId;
  return eventId ? eventPath(eventId) : null;
}

export function reviewIsUnavailable(post, blockedIds = [], removedIds = []) {
  return !post || blockedIds.some(id => String(id) === String(post.userId ?? post.user?.id))
    || removedIds.some(id => String(id) === String(post.id));
}

// Only edits newer than the authoritative read may replace its content.
export function currentReview(post, feedPost) {
  return feedPost && Number(feedPost.version) > Number(post.version || 0) ? feedPost : post;
}
