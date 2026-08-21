function normalizedVideoId(value) {
  const candidate = String(value || "").trim();
  return /^[A-Za-z0-9_-]{11}$/.test(candidate) ? candidate : null;
}

export function youtubeVideoIdFromPlayer(player) {
  try {
    const raw = String(player?.getVideoUrl?.() || "").trim();
    if (!raw) return null;
    const url = new URL(raw, "https://www.youtube.com");
    const direct = normalizedVideoId(url.searchParams.get("v"));
    if (direct) return direct;
    const segments = url.pathname.split("/").filter(Boolean);
    if (url.hostname === "youtu.be") return normalizedVideoId(segments[0]);
    const marker = segments.findIndex((part) => part === "embed" || part === "shorts" || part === "live");
    return marker >= 0 ? normalizedVideoId(segments[marker + 1]) : null;
  } catch {
    return null;
  }
}

export function youtubePlayerEventBelongsToLoad({ event, player, load } = {}) {
  if (!load || !player) return false;
  // A destroyed generation can still deliver one last queued callback. YouTube
  // identifies the emitting player as event.target, so reject another engine's
  // callback before reading any mutable current-track state.
  if (event?.target && event.target !== player) return false;
  const eventVideoId = youtubeVideoIdFromPlayer(event?.target || player);
  // getVideoUrl() is empty while an invalid/non-embeddable ID is failing. In
  // that case the load lease is the only identity available. When YouTube does
  // expose an ID, it must agree with the active lease.
  return !eventVideoId || eventVideoId === load.videoId;
}

export function createYouTubePlayerLoadLease({ token, videoId, mediaKey, loadNumber = 1 } = {}) {
  return {
    token,
    videoId,
    mediaKey,
    // The first load belongs to a fresh iframe generation, so generation/target
    // identity is already categorical and browsers may legitimately emit an
    // error or PLAYING before -1/5. Only an in-place reload must cross a new
    // UNSTARTED/CUED boundary before callbacks are accepted.
    armed: loadNumber <= 1,
    started: false,
    ended: false,
  };
}

export function youtubePlayerCanReceiveCommands({ ready, host, player } = {}) {
  if (!ready || !host?.isConnected || !player) return false;
  try {
    const iframe = player.getIframe?.();
    if (!iframe?.isConnected) return false;
    // Both nodes can be connected while React has replaced the host and the old
    // iframe is stranded elsewhere in the document. Commands only belong to an
    // iframe that is still owned by this exact host generation.
    return typeof host.contains !== "function" || host.contains(iframe);
  } catch {
    return false;
  }
}

export function createYouTubePlayerDisposer() {
  let disposed = false;
  return ({ player, mount } = {}) => {
    if (disposed) return false;
    disposed = true;
    // destroy() is the documented operation that removes the iframe. Call it
    // even if React already detached the host: skipping it leaks the API player
    // and its postMessage listeners. The lease makes cleanup idempotent.
    try { player?.pauseVideo?.(); } catch {}
    try { player?.destroy?.(); } catch {}
    try { mount?.remove?.(); } catch {}
    return true;
  };
}
