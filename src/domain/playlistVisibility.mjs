export const PLAYLIST_VISIBILITY_OPTIONS = Object.freeze([
  Object.freeze({
    value: "public",
    label: "Public",
    description: "Shown on your profile and shareable by link.",
  }),
  Object.freeze({
    value: "unlisted",
    label: "Unlisted",
    description: "Hidden from your public profile; anyone with the link can listen.",
  }),
  Object.freeze({
    value: "private",
    label: "Private",
    description: "Only you can open it; sharing stays disabled.",
  }),
]);

const VISIBILITIES = new Set(PLAYLIST_VISIBILITY_OPTIONS.map((option) => option.value));

export function normalizePlaylistVisibility(value, fallback = "public") {
  const normalizedFallback = VISIBILITIES.has(fallback) ? fallback : "public";
  return VISIBILITIES.has(value) ? value : normalizedFallback;
}

export function playlistVisibilityOption(value) {
  const normalized = normalizePlaylistVisibility(value);
  return PLAYLIST_VISIBILITY_OPTIONS.find((option) => option.value === normalized);
}
