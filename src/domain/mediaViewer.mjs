const READY_STATUS = "readyToPlay";
const ERROR_STATUS = "error";

// Keep the player UI deterministic across expo-video's web and native status
// events. Some platforms report ready before the first-frame callback, while
// failures may arrive either as a status or an attached error payload.
export function videoViewerPhase({ status, hasFirstFrame = false, error = null } = {}) {
  if (status === ERROR_STATUS || error) return "error";
  if (status === READY_STATUS || hasFirstFrame) return "ready";
  return "loading";
}

export function galleryKeyAction({ key, tagName = "", isContentEditable = false } = {}) {
  if (key === "Escape") return "close";
  const interactive = isContentEditable || ["INPUT", "TEXTAREA", "SELECT", "VIDEO", "AUDIO"].includes(String(tagName).toUpperCase());
  if (interactive) return null;
  if (key === "ArrowLeft") return "previous";
  if (key === "ArrowRight") return "next";
  return null;
}
