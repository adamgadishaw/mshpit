// Back gestures only own an empty edge on read-only detail destinations.
// Forms, authentication, media and moderation always keep their explicit close
// policy and never inherit a generic navigation gesture. Artist and post
// details contain nested report/comment fields. Show tickets and festival
// plans also contain drafts, so those routes keep their existing close controls.
const readableFrames = new Set(["venueName", "profileId", "news", "topRated", "venues", "nearby", "fanClubs", "badges", "festivals", "cityGuide", "artistArchive", "artistTour", "calendar"]);
const protectedFrames = new Set(["artistName", "post", "openLog", "festival", "photos", "logging", "editingPost", "auth", "pickArtists", "editProfile", "editArtist", "signupSetup", "newsroom", "thread", "reporting", "venueReview", "catalogEditor", "admin", "administration", "bulk", "reqArtist", "deleteAccount", "settings", "ownerApproval"]);
export function iosBackGestureAllowed(frame) {
  if (!frame || typeof frame !== "object" || Array.isArray(frame)) return false;
  const keys = Object.keys(frame).filter(key => frame[key]);
  return !keys.some(key => protectedFrames.has(key)) && keys.some(key => readableFrames.has(key));
}
export function iosBackSwipeCommits({ dx, dy, width, canceled = false }) {
  "worklet";
  return !canceled && Number.isFinite(dx) && Number.isFinite(dy) && dx >= Math.max(80, Math.min(130, width * 0.26)) && dx > Math.abs(dy) * 1.8;
}
