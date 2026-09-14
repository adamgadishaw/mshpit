// Static labels only: never put search text, message text, or member identity
// into private page metadata. Server entry and client transitions share these.
export const APP_PAGE_TITLES = Object.freeze({
  "/feed": "Your feed", "/you": "Your profile", "/login": "Log in", "/signup": "Create an account",
  "/settings": "Settings", "/inbox": "Inbox", "/messages": "Messages", "/notifications": "Notifications",
  "/moderation": "Moderation", "/admin": "Administration", "/new": "Make a post", "/menu": "Menu",
  "/calendar": "Your calendar", "/nearby": "Nearby shows", "/tour": "Tour", "/playlist": "Playlist",
  "/playlists": "Playlists", "/badges": "Badges", "/clips": "Clips",
});

export const appPageTitle = (pathname) => {
  const label = APP_PAGE_TITLES[String(pathname || "").split(/[?#]/)[0]];
  return label ? `${label} | Mshpit` : null;
};
