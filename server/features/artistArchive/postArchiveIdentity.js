import { archiveShowKey, isArchiveDate } from "./artistArchiveKeys.js";

const text = (value) => typeof value === "string" ? value.trim() : "";

/**
 * Add an exact-show identity to ordinary post projections without persisting a
 * second copy. Status posts and incomplete legacy rows deliberately stay null.
 */
export function archiveShowKeyForPost(post) {
  if (!post || (post.kind || "review") === "status" || !isArchiveDate(post.date)) return null;
  const artistIdentity = text(post.artist_key) || text(post.artist);
  const venueIdentity = text(post.venue_key) || text(post.venue);
  if (!artistIdentity || !venueIdentity) return null;
  return archiveShowKey({ artistIdentity, venueIdentity, date: post.date });
}
