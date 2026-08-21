const YOUTUBE_VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

export function directPlayerVideoId(track) {
  const value = String(track?.videoId || "").trim();
  return YOUTUBE_VIDEO_ID.test(value) ? value : null;
}

export function embeddedPlayerPreview(track) {
  const value = typeof track?.preview === "string" ? track.preview.trim() : "";
  return /^https?:\/\//i.test(value) ? value : null;
}

export function initialPlayerSources({ key, track, directVideoId = undefined } = {}) {
  const videoId = directVideoId === undefined ? directPlayerVideoId(track) : directVideoId;
  return {
    key: key || null,
    videoId,
    preview: embeddedPlayerPreview(track),
    youtubeStatus: null,
    youtubePending: false,
    youtubeSettled: !!videoId,
    previewPending: !!track,
  };
}

// A restored queue is intentionally paused and minimized. Do not spend a cold
// YouTube resolver request until the listener explicitly restores or plays it.
// Exact IDs already stored on the track hydrate locally and need no route call.
export function shouldResolvePlayerYouTube({ web, minimized, directVideoId, resolvedVideoId } = {}) {
  return !!web && !minimized && !directVideoId && !resolvedVideoId;
}

// Provider promises may settle after the listener has skipped to another song.
// Keep that late result from overwriting the current track.
export function patchPlayerSources(current, key, patch) {
  if (!current || !key || current.key !== key) return current;
  return { ...current, ...patch };
}

// A cold track deliberately starts with no resolved URL while its independent
// YouTube and preview lookups run. That empty *pending* state is not a playback
// failure. Only call the track unavailable once both providers have settled and
// neither the YouTube engine nor preview fallback can play it.
export function playerSourcesUnavailable({
  forCurrentTrack,
  youtubeActive,
  youtubeConnecting,
  preview,
  youtubePending,
  youtubeRequired,
  youtubeSettled,
  previewPending,
} = {}) {
  return !!forCurrentTrack
    && !youtubeActive
    && !youtubeConnecting
    && !preview
    && !youtubePending
    && (!youtubeRequired || youtubeSettled)
    && !previewPending;
}

export function playerProvidersSettled({
  web,
  directVideoId,
  youtubeSettled,
  youtubePending,
  youtubeConnecting,
  previewPending,
} = {}) {
  return !previewPending
    && !youtubePending
    && (!web || !!directVideoId || youtubeSettled)
    && !youtubeConnecting;
}

// Do not alarm the listener for one failed fallback while another viable engine
// is still resolving. Once every applicable provider has settled, preserve real
// engine errors and genuine empty-source failures with the existing media code.
export function playerPlaybackFailure({
  providersSettled,
  audioErrorKind,
  youtubeErrorKind,
  unavailable,
  resolverNotice,
} = {}) {
  if (!providersSettled) return null;
  const sourceUnavailable = !!unavailable && !resolverNotice;
  const kind = audioErrorKind || youtubeErrorKind || (sourceUnavailable ? "unavailable" : null);
  if (!kind) return null;
  return {
    kind,
    source: audioErrorKind ? "audio-preview" : "youtube-player",
    toast: sourceUnavailable || (!!audioErrorKind && audioErrorKind !== "permission"),
  };
}
