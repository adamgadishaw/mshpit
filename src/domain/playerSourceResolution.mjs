const YOUTUBE_VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

export function directPlayerVideoId(track) {
  const value = String(track?.videoId || "").trim();
  return YOUTUBE_VIDEO_ID.test(value) ? value : null;
}

export function embeddedPlayerPreview(track) {
  const value = typeof track?.preview === "string" ? track.preview.trim() : "";
  return /^https?:\/\//i.test(value) ? value : null;
}

export function initialPlayerSources({ key, track } = {}) {
  return {
    key: key || null,
    videoId: directPlayerVideoId(track),
    preview: embeddedPlayerPreview(track),
    youtubePending: false,
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
