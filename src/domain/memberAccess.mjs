// Public discovery stays readable. Account workspaces and community surfaces
// must not mount (or start their effects) for a guest, including restored frames.
const MEMBER_TABS = new Set(["feed", "you"]);
const MEMBER_FRAMES = [
  "signupSetup", "welcomeGuide", "pickArtists", "editingPost",
  "logging", "editProfile", "reporting", "inbox", "notifications", "calendar",
  "listeningHistory", "clips", "thread", "venueReview", "artistHub",
  "artistPreview", "artistGallery", "editArtist", "fanClub", "fanClubs",
  "settings", "deleteAccount", "diagnostics", "lounge", "admin", "catalogEditor", "bulk",
  "reqArtist", "addToPlaylist",
];

export function memberTabRequiresAccount(tab) {
  return MEMBER_TABS.has(tab);
}

export function visibleMainTab(tab, accountId) {
  return !accountId && memberTabRequiresAccount(tab) ? "discover" : tab;
}

export function memberFrameRequiresAccount(frame, platform = "web") {
  const nativeNews = platform !== "web" && !!frame && (frame.news || frame.newsroom || frame.post?.news || String(frame.post?.id || "").startsWith("news_"));
  return !!nativeNews || (!!frame && MEMBER_FRAMES.some((key) => !!frame[key]));
}

export function navigationFrameForAccount(frame, accountId, platform = "web") {
  if (accountId || !memberFrameRequiresAccount(frame, platform)) return frame;
  // Resume only read-only News after confirmed login; never replay mutations.
  if (platform !== "web" && frame.news === true) {
    const liveSlug = typeof frame.liveSlug === "string" && /^[a-z0-9-]{1,80}$/u.test(frame.liveSlug) ? frame.liveSlug : null;
    return { auth: true, authReturn: { news: true, ...(liveSlug ? { liveSlug } : {}) } };
  }
  return { auth: true };
}
