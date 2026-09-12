// Public discovery stays readable. Account workspaces and community surfaces
// must not mount (or start their effects) for a guest, including restored frames.
const MEMBER_TABS = new Set(["feed", "you"]);
const MEMBER_FRAMES = [
  "followList", "signupSetup", "welcomeGuide", "pickArtists", "editingPost",
  "logging", "editProfile", "reporting", "inbox", "notifications", "calendar",
  "listeningHistory", "clips", "thread", "venueReview", "artistHub",
  "artistPreview", "artistGallery", "editArtist", "fanClub", "fanClubs",
  "settings", "deleteAccount", "diagnostics", "lounge", "admin", "bulk",
  "reqArtist", "addToPlaylist",
];

export function memberTabRequiresAccount(tab) {
  return MEMBER_TABS.has(tab);
}

export function visibleMainTab(tab, accountId) {
  return !accountId && memberTabRequiresAccount(tab) ? "discover" : tab;
}

export function memberFrameRequiresAccount(frame) {
  return !!frame && MEMBER_FRAMES.some((key) => !!frame[key]);
}

export function navigationFrameForAccount(frame, accountId) {
  return !accountId && memberFrameRequiresAccount(frame) ? { auth: true } : frame;
}
