// Stable identities for provider-neutral tracks and player occurrences. This is
// pure domain policy: networking and playback engines consume the keys, but do
// not define them.

export function trackTupleKey(title, artist) {
  return JSON.stringify([String(artist || ""), String(title || "")]);
}

// Search-denial results depend on who is listening and whether that account is
// verified. Scoping the short client cache prevents an anonymous/unverified
// denial (or one account's daily cap) from following a newly signed-in user.
export function youtubeLookupCacheKey(title, artist, account = null, source = null) {
  const actor = account?.id ? String(account.id) : "anonymous";
  const verification = account?.id && account.emailVerified === true ? "verified" : "unverified";
  const provider = String(source?.provider || "").trim().toLowerCase();
  const sourceId = String(source?.sourceId || "").trim();
  return JSON.stringify([actor, verification, String(artist || ""), String(title || ""), provider, sourceId]);
}

export function trackMetadataKey(title, artist) {
  const clean = (value) => String(value || "").trim().toLowerCase();
  const normalizedArtist = clean(artist);
  const normalizedTitle = clean(title);
  return normalizedArtist || normalizedTitle
    ? `meta:${trackTupleKey(normalizedTitle, normalizedArtist)}`
    : null;
}

function trackSourceKey(provider, sourceId) {
  // Provider names are labels, while provider IDs are opaque and can be
  // case-sensitive (for example, Spotify base62 IDs). Normalize whitespace and
  // provider casing without changing the source ID's meaning.
  const normalizedProvider = String(provider ?? "").trim().toLowerCase();
  const normalizedSourceId = String(sourceId ?? "").trim();
  return normalizedProvider && normalizedSourceId
    ? `source:${JSON.stringify([normalizedProvider, normalizedSourceId])}`
    : null;
}

export function trackKey(track) {
  if (!track || typeof track !== "object") return null;
  if (track.videoId && String(track.videoId).trim()) return `youtube:${String(track.videoId).trim()}`;
  const sourceKey = trackSourceKey(track.provider, track.sourceId);
  if (sourceKey) return sourceKey;
  if (track.id != null && String(track.id).trim()) return `id:${String(track.id).trim()}`;
  if (track.url) return `url:${track.url}`;
  if (track.preview) return `preview:${track.preview}`;
  return trackMetadataKey(track.title, track.artist);
}

// Player resolution is scoped to one queue occurrence, not only one recording.
// Adjacent copies therefore get independent engine generations and listening
// history events instead of inheriting the first copy's terminal state.
export function playerResolutionKey({ track, account = null, user = account } = {}) {
  const actor = user?.id || "anonymous";
  const verification = user?.id && user.emailVerified === true ? "verified" : "unverified";
  const occurrence = typeof track?.queueEntryId === "string" && track.queueEntryId.trim()
    ? track.queueEntryId.trim().slice(0, 120)
    : "unscoped";
  return JSON.stringify([actor, verification, trackKey(track), occurrence]);
}
