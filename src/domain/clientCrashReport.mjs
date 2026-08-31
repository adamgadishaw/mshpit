const CRASH_CODES = Object.freeze({
  render: "PIT-APP-001",
  runtime: "PIT-APP-002",
  promise: "PIT-APP-003",
});

const PLATFORMS = new Set(["web", "ios", "android", "unknown"]);
const SURFACES = new Set([
  "landing",
  "artist",
  "venue",
  "show",
  "post",
  "artists",
  "venues",
  "events",
  "concerts",
  "search",
  "discover",
  "feed",
  "you",
  "auth",
  "settings",
  "app",
]);

// Convert a URL into one of a few operational buckets before anything leaves
// the device. IDs, handles, search terms, query strings, and fragments never
// become part of a crash report.
export function clientErrorSurface(pathname) {
  let path = "";
  try {
    path = String(pathname || "").split(/[?#]/, 1)[0].toLowerCase();
  } catch {
    return "app";
  }
  if (!path || path === "/") return "landing";
  if (/^\/(?:artist|artists)\//.test(path)) return "artist";
  if (/^\/(?:venue|venues)\//.test(path)) return "venue";
  if (/^\/(?:show|shows|event|events|concert|concerts)\//.test(path)) return "show";
  if (/^\/(?:post|posts)\//.test(path)) return "post";
  if (/^\/artists(?:\/|$)/.test(path)) return "artists";
  if (/^\/venues(?:\/|$)/.test(path)) return "venues";
  if (/^\/events(?:\/|$)/.test(path)) return "events";
  if (/^\/concerts(?:\/|$)/.test(path)) return "concerts";
  if (/^\/search(?:\/|$)/.test(path)) return "search";
  if (/^\/discover(?:\/|$)/.test(path)) return "discover";
  if (/^\/feed(?:\/|$)/.test(path)) return "feed";
  if (/^\/(?:you|profile)(?:\/|$)/.test(path)) return "you";
  if (/^\/(?:login|signup|auth|verify)(?:\/|$)/.test(path)) return "auth";
  if (/^\/settings(?:\/|$)/.test(path)) return "settings";
  return "app";
}

export function normalizeClientCrashReport(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const kind = typeof value.kind === "string" ? value.kind.trim().toLowerCase() : "";
  if (!Object.prototype.hasOwnProperty.call(CRASH_CODES, kind)) return null;
  const rawPlatform = typeof value.platform === "string" ? value.platform.trim().toLowerCase() : "";
  const rawSurface = typeof value.surface === "string" ? value.surface.trim().toLowerCase() : "";
  const platform = PLATFORMS.has(rawPlatform) ? rawPlatform : "unknown";
  const surface = SURFACES.has(rawSurface) ? rawSurface : "app";
  return Object.freeze({ kind, code: CRASH_CODES[kind], platform, surface });
}

export const CLIENT_CRASH_KINDS = Object.freeze(Object.keys(CRASH_CODES));
export const CLIENT_CRASH_SURFACES = Object.freeze([...SURFACES]);
