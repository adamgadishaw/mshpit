import { mediaDisplayItems, mediaDisplayKind, mediaPosterUri } from "./postMediaDisplay.mjs";

const text = (value) => value == null ? "" : String(value).trim();
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function artistEventIdentity({ artistKey = null, name = null } = {}) {
  return (text(artistKey) || text(name)).toLowerCase().replace(/\s+/g, " ");
}

export function archiveDateLabel(value, fallback = "Date to be announced") {
  const match = ISO_DATE.exec(text(value));
  if (!match) return fallback;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return fallback;
  return `${match[1]} · ${match[2]} · ${match[3]}`;
}

export function archiveDateRangeLabel(firstDate, lastDate) {
  const first = archiveDateLabel(firstDate, "");
  const last = archiveDateLabel(lastDate, "");
  if (!first && !last) return "Dates unavailable";
  if (!first || first === last) return first || last;
  return `${first} — ${last}`;
}

export function compactArchiveCount(value) {
  const count = Math.max(0, Number(value) || 0);
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(count >= 10_000_000 ? 0 : 1).replace(/\.0$/, "")}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(count >= 100_000 ? 0 : 1).replace(/\.0$/, "")}K`;
  return String(Math.trunc(count));
}

export function archiveRatingLabel(value, count = 0) {
  const rating = Number(value);
  return Number.isFinite(rating) && Number(count) > 0 ? rating.toFixed(1) : "New";
}

export function archiveCoverMedia(cover) {
  const uri = text(cover?.uri || cover?.url);
  if (!uri) return null;
  return Object.freeze({
    ...cover,
    uri,
    kind: mediaDisplayKind(cover),
    posterUri: mediaPosterUri(cover),
    by: text(cover?.by) || "A Pit fan",
    userId: text(cover?.userId) || null,
    postId: text(cover?.postId) || null,
  });
}

export function archiveReviewMedia(review) {
  const author = text(review?.user?.name) || "A Pit fan";
  return mediaDisplayItems(review).map((item) => Object.freeze({
    ...item,
    uri: text(item.uri),
    by: author,
    userId: text(review?.userId) || null,
    postId: text(review?.id) || null,
  }));
}

export function showsForArchiveTour(archive, tourKey) {
  const key = text(tourKey);
  if (!key) return [];
  return (Array.isArray(archive?.shows) ? archive.shows : [])
    .filter((show) => text(show?.tourKey) === key)
    .slice()
    .sort((left, right) => text(right?.date).localeCompare(text(left?.date)) || text(left?.key).localeCompare(text(right?.key)));
}

export function selectArchiveTour(archive, tourKey) {
  const key = text(tourKey);
  return (Array.isArray(archive?.tours) ? archive.tours : []).find((tour) => text(tour?.key) === key) || null;
}

export function findArchiveShowForReview(shows, review) {
  const date = text(review?.date);
  const venueKey = text(review?.venueKey).toLowerCase();
  const venue = text(review?.venue).toLowerCase();
  return (Array.isArray(shows) ? shows : []).find((show) => {
    if (text(show?.date) !== date) return false;
    if (venueKey && text(show?.venueKey).toLowerCase() === venueKey) return true;
    return !!venue && text(show?.venue).toLowerCase() === venue;
  }) || null;
}
