// Stable identity for provider-neutral tracks. Artist/profile songs often have no
// URL until playback resolution, so a title-only fallback can merge two different
// artists' songs and resume or select the wrong item.
export function trackTupleKey(title, artist) {
  return JSON.stringify([String(artist || ""), String(title || "")]);
}

// Search-denial results depend on who is listening and whether that account is
// verified. Scoping the short client cache prevents an anonymous/unverified
// denial (or one account's daily cap) from following a newly signed-in user.
export function youtubeLookupCacheKey(title, artist, user = null) {
  const actor = user?.id ? String(user.id) : "anonymous";
  const verification = user?.id && user.emailVerified === true ? "verified" : "unverified";
  return JSON.stringify([actor, verification, String(artist || ""), String(title || "")]);
}

export function trackMetadataKey(title, artist) {
  const clean = (value) => String(value || "").trim().toLowerCase();
  const normalizedArtist = clean(artist);
  const normalizedTitle = clean(title);
  return normalizedArtist || normalizedTitle
    ? `meta:${trackTupleKey(normalizedTitle, normalizedArtist)}`
    : null;
}

export function trackKey(track) {
  if (!track || typeof track !== "object") return null;
  if (track.id != null && String(track.id).trim()) return `id:${String(track.id).trim()}`;
  if (track.videoId && String(track.videoId).trim()) return `youtube:${String(track.videoId).trim()}`;
  if (track.url) return `url:${track.url}`;
  if (track.preview) return `preview:${track.preview}`;
  return trackMetadataKey(track.title, track.artist);
}
