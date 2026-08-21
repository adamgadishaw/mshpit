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
