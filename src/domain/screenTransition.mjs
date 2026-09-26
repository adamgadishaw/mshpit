// Which screen is showing, as a short stable key, and which way the move went.
// A new key plays the entrance; the same key (a screen updating in place)
// does not, so a page never re-animates while someone is using it.

const SCREEN_KEYS = Object.freeze([
  "photos", "addToPlaylist", "followList", "auth", "signupSetup", "welcomeGuide", "pickArtists",
  "editingPost", "logging", "reporting", "editProfile", "venueReview", "thread", "inbox",
  "listeningHistory", "notifications", "calendar", "clips", "profileId", "fanClub", "artistHub",
  "artistGallery", "artistPreview", "editArtist", "artistArchive", "artistTour", "artistName",
  "venueName", "nearby", "cityGuide", "venues", "fanClubs", "suggestion", "settings",
  "deleteAccount", "diagnostics", "privacy", "terms", "lounge", "openLog", "post", "badges",
  "topRated", "admin", "bulk", "reqArtist", "menu", "news", "crew", "directory",
]);

function identity(value) {
  if (value == null || value === true) return "";
  if (typeof value !== "object") return String(value);
  return String(value.id ?? value.key ?? value.name ?? value.userId ?? value.tourDateId ?? "");
}

export function screenTransitionKey(frame, activeTab) {
  const screen = frame && typeof frame === "object"
    ? SCREEN_KEYS.find((key) => frame[key] != null && frame[key] !== false)
    : null;
  return screen ? `${screen}:${identity(frame[screen])}` : `tab:${activeTab || ""}`;
}

// Deeper in the stack moves forward, shallower moves back, and a swap at the
// same depth (a tab, a replaced page) is a quiet fade.
export function screenTransitionDirection(previousDepth, depth) {
  if (!Number.isFinite(previousDepth) || !Number.isFinite(depth) || depth === previousDepth) return "fade";
  return depth > previousDepth ? "forward" : "back";
}
