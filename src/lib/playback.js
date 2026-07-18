// Stable identity for provider-neutral tracks. Artist/profile songs often have no
// URL until playback resolution, so a title-only fallback can merge two different
// artists' songs and resume or select the wrong item.
export function trackKey(track) {
  if (!track || typeof track !== "object") return null;
  if (track.id != null && String(track.id).trim()) return `id:${String(track.id).trim()}`;
  if (track.videoId && String(track.videoId).trim()) return `youtube:${String(track.videoId).trim()}`;
  if (track.url) return `url:${track.url}`;
  if (track.preview) return `preview:${track.preview}`;
  const clean = (value) => String(value || "").trim().toLowerCase();
  const artist = clean(track.artist);
  const title = clean(track.title);
  return artist || title ? `meta:${artist}|${title}` : null;
}
