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

// Expo's web VideoView does not consistently emit onFirstFrameRender for a
// paused source, even when its underlying HTMLVideoElement already has decoded
// current-frame data. DOM readiness is therefore the web fallback authority
// for removing a failed/generated poster overlay.
export function videoViewerWebFrameReady(value) {
  return Number(value?.readyState) >= 2
    && Number(value?.videoWidth) > 0
    && Number(value?.videoHeight) > 0;
}

// Short landscape windows benefit from side rails instead of header/footer
// rows. Use the laid-out viewport, not stale screen dimensions or clip metadata.
export function videoViewerUsesSideControls({ width = 0, height = 0 } = {}) {
  return Number.isFinite(width) && Number.isFinite(height)
    && width >= 600 && height > 0 && height <= 600 && width > height;
}

// Safari's native video fullscreen does not always set fullscreenElement.
// While either fullscreen mode owns input, Escape/Tab belong to its controls.
export function galleryVideoIsFullscreen(root, ownerDocument) {
  const element = ownerDocument?.fullscreenElement || ownerDocument?.webkitFullscreenElement;
  if (element && root?.contains?.(element)) return true;
  return Array.from(root?.querySelectorAll?.("video") || []).some((video) => (
    video.webkitDisplayingFullscreen || video.webkitPresentationMode === "fullscreen"
  ));
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

// Touch gestures in the full-screen gallery. A drag belongs to one axis only
// once it has clearly moved. Sideways moves between items; only a downward pull
// dismisses, so an upward flick never closes the viewer by accident.
export const GALLERY_SWIPE_DISTANCE = 60;
export const GALLERY_DISMISS_DISTANCE = 120;
const GALLERY_GESTURE_SLOP = 12;

export function galleryGestureAxis({ dx = 0, dy = 0 } = {}) {
  const x = Math.abs(Number(dx) || 0);
  const y = Math.abs(Number(dy) || 0);
  if (Math.max(x, y) < GALLERY_GESTURE_SLOP) return null;
  if (x > y * 1.2) return "x";
  if (Number(dy) > 0 && y > x * 1.2) return "y";
  return null;
}

export function galleryGestureAction({ axis = null, dx = 0, dy = 0, count = 0 } = {}) {
  if (axis === "y") return Number(dy) >= GALLERY_DISMISS_DISTANCE ? "close" : null;
  if (axis !== "x" || !(Number(count) > 1)) return null;
  if (Number(dx) <= -GALLERY_SWIPE_DISTANCE) return "next";
  if (Number(dx) >= GALLERY_SWIPE_DISTANCE) return "prev";
  return null;
}
