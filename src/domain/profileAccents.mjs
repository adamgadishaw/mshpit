// A member's profile accent: one colour of their choosing that visitors see on
// their banner, and around their favorite shows. The ids match the server's
// PROFILE_ACCENTS (server/profileExtras.js).
export const PROFILE_ACCENT_OPTIONS = Object.freeze([
  { id: "amber", label: "Amber", color: "#F2A65A" },
  { id: "rose", label: "Rose", color: "#ED5B8D" },
  { id: "violet", label: "Violet", color: "#9B7BFF" },
  { id: "blue", label: "Blue", color: "#4F8DF7" },
  { id: "teal", label: "Teal", color: "#2EC4B6" },
  { id: "green", label: "Green", color: "#4CC77F" },
  { id: "red", label: "Red", color: "#EF4B4B" },
  { id: "gold", label: "Gold", color: "#E8B65A" },
].map((option) => Object.freeze(option)));

export const PROFILE_FAVORITE_SHOWS_MAX = 4;
export const PROFILE_PRONOUNS_MAX = 24;

export const profileAccentColor = (id) => PROFILE_ACCENT_OPTIONS.find((option) => option.id === id)?.color || null;

// Which of a member's posts can be pinned: their own show reviews, not plain
// posts, news or festival plans.
export const pinnableShow = (post) => !!post?.id && !post.news && post.kind !== "status" && !!(post.artist || post.onlineTitle);

// Tap to pin or unpin, keeping the order they were picked in and at most four.
export function toggleFavoriteShow(current, id) {
  const list = Array.isArray(current) ? current : [];
  if (list.includes(id)) return list.filter((value) => value !== id);
  return list.length >= PROFILE_FAVORITE_SHOWS_MAX ? list : [...list, id];
}
