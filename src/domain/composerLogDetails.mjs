import { toIsoDate } from "./dates.mjs";

const RATING_KEYS = ["performance", "setlist", "sound", "venue", "crowd", "experience"];
const rating = (value) => Number.isFinite(Number(value)) ? Math.max(0, Math.min(5, Number(value))) : 0;

// Explicit dimension values, including unrated zeroes, are authoritative. Only
// old posts without dimensions need the legacy aggregate fallback.
export function composerRatingDims(post = {}) {
  const stored = post?.dims && typeof post.dims === "object" ? post.dims : {};
  if (RATING_KEYS.some((key) => Object.hasOwn(stored, key))) {
    return Object.fromEntries(RATING_KEYS.map((key) => [key, rating(stored[key])]));
  }
  const overall = rating(post?.overall);
  const band = post?.band == null ? 0 : rating(post.band);
  const room = post?.room == null ? 0 : rating(post.room);
  return { performance: band, setlist: band, sound: room, venue: room, crowd: 0, experience: overall };
}

export function hasDetailedComposerRatings(dims = {}) {
  return RATING_KEYS.some((key) => key !== "experience" && rating(dims[key]) > 0);
}

// A saved blank date means unknown, never today. Unparseable legacy dates stay
// visible for correction rather than being silently assigned a different day.
export function restoredComposerDate(value) {
  return toIsoDate(value) || String(value || "");
}

export function composerLogRequirement({ artist = "", venue = "", city = "", eventAddress = "", overall = 0 } = {}) {
  if (!artist.trim()) return "Add the artist to log this show.";
  if (!venue.trim() && !city.trim()) return "Add a venue or just the city. You don't need to know the room.";
  if (eventAddress.trim() && !city.trim()) return "Add the city for the event address.";
  if (!(Number(overall) > 0)) return "Add one rating, or use Share for a memory without ratings. You can also save a draft.";
  return "Ready to post. The date, tour, extra ratings and review can stay blank.";
}
