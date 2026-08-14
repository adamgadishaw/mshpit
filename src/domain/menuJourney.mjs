export const JOURNEY_TAGLINE = "Your life's musical journey";

export function landingSlideUri(uri, viewportWidth) {
  const source = typeof uri === "string" ? uri : "";
  if (!source) return "";
  const width = Number(viewportWidth);
  const requestedWidth = Number.isFinite(width) && width < 700 ? 900 : Number.isFinite(width) && width < 1200 ? 1440 : 2000;
  return source
    .replace(/([?&])w=\d+/i, `$1w=${requestedWidth}`)
    .replace(/([?&])q=\d+/i, `$1q=${requestedWidth === 2000 ? 85 : 78}`);
}

export function landingVisibleSlideIndices(index, total, hasAdvanced = false) {
  const size = Math.max(0, Math.trunc(Number(total) || 0));
  if (!size) return [];
  const current = ((Math.trunc(Number(index) || 0) % size) + size) % size;
  if (!hasAdvanced || size === 1) return [current];
  return [(current - 1 + size) % size, current];
}

const count = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.trunc(number)) : 0;
};

const homeCity = (session) => {
  const city = typeof session?.home?.city === "string" ? session.home.city.trim() : "";
  return city.slice(0, 80);
};

// Menu destinations live in one pure model so redesigns cannot accidentally
// strand a staff or artist-only route. MenuScreen only attaches callbacks.
export function journeyMenuModel({ session = null, inboxUnread = 0, notifications = 0, includeActivity = true } = {}) {
  const city = homeCity(session);
  const unread = count(inboxUnread);
  const notificationCount = count(notifications);
  const role = session?.role;

  const account = session ? [
    { key: "editProfile", icon: "edit", title: "Appearance & profile", detail: "Theme, photo, music, and banner" },
    ...(role === "admin" || role === "moderator"
      ? [{ key: "admin", icon: "shield", title: "Moderation", detail: "Reports, members, and content" }]
      : []),
    ...(role === "admin" || role === "artist"
      ? [{ key: "tourDates", icon: "calendar", title: "Post tour dates", detail: "Publish and schedule shows" }]
      : []),
    ...(role === "fan"
      ? [{ key: "requestArtist", icon: "shield", title: "Claim an artist profile", detail: "Start artist verification" }]
      : []),
  ] : [];

  return {
    discover: [
      { key: "near", icon: "pin", title: "Near you", detail: city ? `Shows and scenes around ${city}` : "Local shows and scenes", accent: "good" },
      { key: "venues", icon: "search", title: "Find a venue", detail: "Explore rooms by city and lineup", accent: "cool" },
      { key: "fanClubs", icon: "comment", title: "Fan clubs", detail: "Join artist communities", accent: "magenta" },
      { key: "topRated", icon: "trophy", title: "Crowd favorites", detail: "Top-rated nights close to home", accent: "gold" },
    ],
    connection: [
      ...(includeActivity ? [{ key: "activity", icon: "bell", title: "Activity", detail: notificationCount ? `${notificationCount} new` : "Follows, likes, and replies", badge: notificationCount }] : []),
      { key: "inbox", icon: "mail", title: "Inbox", detail: unread ? `${unread} unread` : "Your messages", badge: unread },
    ],
    account,
  };
}
