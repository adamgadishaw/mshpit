// Back gestures only own an empty edge on read-only detail destinations.
// Forms, authentication, media and moderation always keep their explicit close
// policy and never inherit a generic navigation gesture. Artist and Show
// disable the edge locally while their inline report/ticket editor is open or
// busy. Post comments already retain their Root-owned draft across Back.
// Festival plans retain explicit close controls.
const readableFrames = new Set(["artistName", "post", "openLog", "followList", "privacy", "terms", "venueName", "profileId", "news", "topRated", "venues", "nearby", "fanClubs", "badges", "festivals", "cityGuide", "artistArchive", "artistTour", "calendar"]);
const protectedFrames = new Set(["festival", "photos", "logging", "editingPost", "auth", "pickArtists", "editProfile", "editArtist", "signupSetup", "newsroom", "thread", "reporting", "venueReview", "catalogEditor", "admin", "administration", "bulk", "reqArtist", "deleteAccount", "settings", "ownerApproval"]);
export function iosBackGestureAllowed(frame) {
  if (!frame || typeof frame !== "object" || Array.isArray(frame)) return false;
  const keys = Object.keys(frame).filter(key => frame[key]);
  return !keys.some(key => protectedFrames.has(key)) && keys.some(key => readableFrames.has(key));
}
export function iosBackSwipeCommits({ dx, dy, width, canceled = false }) {
  "worklet";
  return !canceled && Number.isFinite(dx) && Number.isFinite(dy) && dx >= Math.max(80, Math.min(130, width * 0.26)) && dx > Math.abs(dy) * 1.8;
}
