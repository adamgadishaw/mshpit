// Product policy for the paused built-in music player. Keep this module pure so
// the Expo client, Node server, background jobs, and regression tests all make
// the same decision without importing platform-specific configuration.
export const MUSIC_PLAYER_ENABLED = false;

const MUSIC_PLAYER_NAVIGATION_KEYS = Object.freeze([
  "addToPlaylist",
  "listeningHistory",
]);

const EXACT_PLAYER_API_REQUESTS = new Set([
  "GET /api/deezer/track",
  "GET /api/me/plays",
  "GET /api/plays/friends",
  "GET /api/youtube/track",
  "POST /api/plays",
  "POST /api/playlists",
  "POST /api/tracks/report",
  "POST /api/youtube/invalidate",
  "POST /api/youtube/track/resolve",
]);

const DYNAMIC_PLAYER_API_REQUESTS = Object.freeze([
  Object.freeze({ method: "GET", path: /^\/api\/users\/[^/]+\/playlists$/ }),
  Object.freeze({ method: "GET", path: /^\/api\/playlists\/[^/]+$/ }),
  Object.freeze({ method: "PATCH", path: /^\/api\/playlists\/[^/]+$/ }),
  Object.freeze({ method: "DELETE", path: /^\/api\/playlists\/[^/]+$/ }),
  Object.freeze({ method: "GET", path: /^\/api\/posts\/[^/]+\/playlist$/ }),
]);

function requestPath(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const withoutQuery = raw.split(/[?#]/, 1)[0];
  return withoutQuery.length > 1 ? withoutQuery.replace(/\/+$/, "") : withoutQuery;
}

export function isMusicPlayerNavigationFrame(frame) {
  return !!frame
    && typeof frame === "object"
    && MUSIC_PLAYER_NAVIGATION_KEYS.some((key) => frame[key] != null && frame[key] !== false);
}

export function sanitizeDisabledMusicPlayerNavigationFrame(frame) {
  if (MUSIC_PLAYER_ENABLED || !isMusicPlayerNavigationFrame(frame)) return frame;
  const sanitized = { ...frame };
  for (const key of MUSIC_PLAYER_NAVIGATION_KEYS) delete sanitized[key];
  return sanitized;
}

export function isDisabledMusicPlayerApiRequest(method, pathname, query = null) {
  if (MUSIC_PLAYER_ENABLED) return false;
  const verb = String(method || "GET").trim().toUpperCase();
  const path = requestPath(pathname);
  if (EXACT_PLAYER_API_REQUESTS.has(`${verb} ${path}`)) return true;
  if (verb === "GET"
    && (path === "/api/discover/chart" || path === "/api/discover/overview")
    && String(query?.by || "").trim().toLowerCase() === "plays") return true;
  return DYNAMIC_PLAYER_API_REQUESTS.some((route) => route.method === verb && route.path.test(path));
}
