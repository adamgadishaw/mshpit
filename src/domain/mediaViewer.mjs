const ERROR_STATUS = "error";

// Keep the player UI deterministic across expo-video's web and native status
// events. `readyToPlay` means metadata/buffer readiness, not that a frame has
// reached the screen. Hiding the cover on that event is what exposed a black
// decoder surface on slower desktop loads.
export function videoViewerPhase({ status, hasFirstFrame = false, error = null } = {}) {
  if (status === ERROR_STATUS || error) return "error";
  if (hasFirstFrame) return "ready";
  return "loading";
}

// The poster protects the decoder surface only until VideoView confirms that a
// real frame painted. Keeping it mounted until playback begins hides a healthy
// paused frame behind a failed legacy-poster fallback.
export function videoViewerPosterVisible({ phase } = {}) {
  return phase === "loading";
}

export function videoViewerDecodedSize(value) {
  const width = Math.round(Number(value?.videoWidth ?? value?.width) || 0);
  const height = Math.round(Number(value?.videoHeight ?? value?.height) || 0);
  return width > 0 && height > 0 ? { width, height } : null;
}

// Expo 56's web VideoView does not consistently emit onFirstFrameRender for a
// paused source, even when its underlying HTMLVideoElement already has decoded
// current-frame data. DOM readiness is therefore the web fallback authority
// for removing a failed/generated poster overlay.
export function videoViewerWebFrameReady(value) {
  return Number(value?.readyState) >= 2
    && Number(value?.videoWidth) > 0
    && Number(value?.videoHeight) > 0;
}

export function videoViewerViewportSize({
  containerWidth = 0,
  containerHeight = 0,
  videoWidth = 0,
  videoHeight = 0,
  maxWidth = 1280,
  fallbackAspectRatio = 9 / 16,
} = {}) {
  const boundsWidth = Number(containerWidth);
  const boundsHeight = Number(containerHeight);
  const widthLimit = Number(maxWidth);
  if (![boundsWidth, boundsHeight, widthLimit].every((value) => Number.isFinite(value) && value > 0)) return null;
  let mediaWidth = Number(videoWidth);
  let mediaHeight = Number(videoHeight);
  if (![mediaWidth, mediaHeight].every((value) => Number.isFinite(value) && value > 0)) {
    const fallback = Number(fallbackAspectRatio);
    if (!Number.isFinite(fallback) || fallback <= 0) return null;
    // Legacy posts predate stored dimensions and are overwhelmingly phone
    // clips. Keep their loading/error cover portrait-sized until loadeddata
    // publishes the real dimensions; landscape metadata replaces this value.
    mediaWidth = fallback;
    mediaHeight = 1;
  }
  const scale = Math.min(boundsWidth / mediaWidth, boundsHeight / mediaHeight, widthLimit / mediaWidth);
  return {
    width: Math.max(1, Math.round(mediaWidth * scale)),
    height: Math.max(1, Math.round(mediaHeight * scale)),
  };
}

export function galleryKeyAction({ key, tagName = "", isContentEditable = false } = {}) {
  if (key === "Escape") return "close";
  const interactive = isContentEditable || ["INPUT", "TEXTAREA", "SELECT", "BUTTON", "VIDEO", "AUDIO"].includes(String(tagName).toUpperCase());
  if (interactive) return null;
  if (key === "ArrowLeft") return "previous";
  if (key === "ArrowRight") return "next";
  return null;
}

export function normalizedGalleryIndex(index, count) {
  const length = Math.max(0, Math.trunc(Number(count) || 0));
  if (!length) return 0;
  const parsed = Math.trunc(Number(index) || 0);
  return Math.min(length - 1, Math.max(0, parsed));
}

// Galleries assembled from profiles and discovery can span several posts.
// The currently displayed descriptor owns attribution; the opener's post id is
// only a compatibility fallback for a single-post array of legacy URL strings.
export function galleryItemPostId(item, fallbackPostId = null) {
  const itemPostId = item && typeof item === "object" && typeof item.postId === "string"
    ? item.postId.trim()
    : "";
  if (itemPostId) return itemPostId;
  const fallback = typeof fallbackPostId === "string" ? fallbackPostId.trim() : "";
  return fallback || null;
}

export function trappedGalleryFocusIndex({ currentIndex = -1, count = 0, shiftKey = false } = {}) {
  const total = Math.max(0, Math.trunc(Number(count) || 0));
  if (!total) return null;
  const current = Number.isInteger(currentIndex) && currentIndex >= 0 && currentIndex < total
    ? currentIndex
    : (shiftKey ? 0 : -1);
  return shiftKey ? (current - 1 + total) % total : (current + 1) % total;
}
