import { redactDiagnosticText } from "./errorRedaction.mjs";

const CRASH_CODES = Object.freeze({
  render: "PIT-APP-001",
  runtime: "PIT-APP-002",
  promise: "PIT-APP-003",
});

const PLATFORMS = new Set(["web", "ios", "android", "unknown"]);
const ERROR_DIAGNOSES = Object.freeze({
  Error: "unknown", TypeError: "type", ReferenceError: "reference", RangeError: "range",
  SyntaxError: "syntax", URIError: "uri", EvalError: "eval", AggregateError: "aggregate",
  AbortError: "abort", Unknown: "unknown",
});
const REACT_DIAGNOSES = new Set(["react130", "react185", "react301", "react310", "react321"]);
export const CLIENT_WEB_ASSET_RE = /^[A-Za-z_][A-Za-z0-9_-]{0,63}-[a-f0-9]{32}\.js$/;
// The pre-bundle boot script is served unminified from public/, outside the bundle directory.
export const CLIENT_BOOT_ASSET_RE = /^mshpit-web-boot-v\d{1,3}\.js$/;
const MAX_MESSAGE = 240;
const MAX_COORDINATE = 9_999_999;
const REQUEST_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
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

// Stateful SPA navigation deliberately does not give every mounted screen its
// own URL. Project the already-finite analytics screen key into the same coarse,
// privacy-safe buckets used by URL-derived reports. Arbitrary screen text,
// entity ids and handles always collapse to app.
export function clientErrorSurfaceFromScreen(value) {
  const screen = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (screen === "landing") return "landing";
  if (screen === "tab_feed") return "feed";
  if (screen === "tab_search") return "search";
  if (screen === "tab_discover") return "discover";
  if (screen === "tab_you") return "you";
  if (screen === "auth") return "auth";
  if (["artist", "artist_hq", "artist_preview", "artist_gallery", "artist_edit", "artist_archive", "artist_tour", "pick_artists", "request_artist"].includes(screen)) return "artist";
  if (["venue", "venue_review", "nearby"].includes(screen)) return "venue";
  if (screen === "venues") return "venues";
  if (["show", "calendar", "lounge"].includes(screen)) return "show";
  if (["post", "post_edit", "post_create", "media_viewer", "report"].includes(screen)) return "post";
  if (["profile", "profile_edit", "follow_list", "activity", "inbox", "message_thread"].includes(screen)) return "you";
  if (["settings", "account_delete", "privacy", "terms"].includes(screen)) return "settings";
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
  const report = { kind, code: CRASH_CODES[kind], platform, surface };
  if (typeof value.errorType === "string" && Object.hasOwn(ERROR_DIAGNOSES, value.errorType)) {
    report.errorType = value.errorType;
    report.diagnosis = REACT_DIAGNOSES.has(value.diagnosis)
      ? value.diagnosis : ERROR_DIAGNOSES[value.errorType];
  }
  const location = platform === "web" ? normalizeClientCrashLocation(value.location) : null;
  if (location) report.location = location;
  // The server redacts again: a client can send anything.
  const message = typeof value.message === "string" ? redactDiagnosticText(value.message, { max: MAX_MESSAGE }) : "";
  if (message) report.message = message;
  return Object.freeze(report);
}

export function normalizeClientCrashLocation(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (typeof value.asset !== "string"
    || !(CLIENT_WEB_ASSET_RE.test(value.asset) || CLIENT_BOOT_ASSET_RE.test(value.asset))) return null;
  if (![value.line, value.column].every((coordinate) => Number.isInteger(coordinate)
    && coordinate > 0 && coordinate <= MAX_COORDINATE)) return null;
  return Object.freeze({ asset: value.asset, line: value.line, column: value.column });
}

export function clientCrashRequestId(value) {
  return typeof value === "string" && REQUEST_ID_RE.test(value) ? value : null;
}

function errorField(error, field) {
  try { const value = error?.[field]; return typeof value === "string" ? value : ""; }
  catch { return ""; }
}

// Inspect locally. The raw stack, function names and URLs never leave the
// device; the message leaves only after redaction (errorRedaction.mjs).
// React markers are a finite catalogue, never arbitrary numbers from a message.
export function clientCrashDiagnostic(error, { origin } = {}) {
  if (error == null) return {};
  const name = errorField(error, "name");
  const errorType = Object.hasOwn(ERROR_DIAGNOSES, name) ? name : "Unknown";
  const marker = /^Minified React error #(130|185|301|310|321);/.exec(errorField(error, "message").slice(0, 80));
  const diagnostic = { errorType, diagnosis: marker ? `react${marker[1]}` : ERROR_DIAGNOSES[errorType] };
  const message = redactDiagnosticText(errorField(error, "message"), { max: MAX_MESSAGE });
  if (message) diagnostic.message = message;
  if (typeof origin !== "string" || !/^https?:\/\//.test(origin)) return diagnostic;
  const frames = errorField(error, "stack").slice(0, 16_384).split("\n").slice(0, 24);
  for (const frame of frames) {
    // WebKit names top-level frames "global code" and "module code"; every browser on
    // iPhone is WebKit, so a crash during module evaluation has only those frames.
    // The names are matched literally: allowing any spaces would let message text
    // that contains a URL be read as a frame.
    if (!/^\s*at\s+|^(?:[^@\s]*|global code|module code|eval code)@https?:\/\//.test(frame)) continue;
    const match = /(?:\s|\(|@)(https?:\/\/[^\s)]+):(\d{1,7}):(\d{1,7})\)?\s*$/.exec(frame);
    if (!match) continue;
    try {
      const url = new URL(match[1]);
      if (url.origin !== origin || url.username || url.password || url.search || url.hash) continue;
      const prefix = "/_expo/static/js/web/";
      const rootAsset = url.pathname.slice(1);
      const asset = url.pathname.startsWith(prefix)
        ? url.pathname.slice(prefix.length)
        : CLIENT_BOOT_ASSET_RE.test(rootAsset) ? rootAsset : null;
      if (!asset) continue;
      const location = normalizeClientCrashLocation({
        asset, line: Number(match[2]), column: Number(match[3]),
      });
      if (location) return { ...diagnostic, location };
    } catch { /* Malformed or non-first-party frames are not diagnostic locations. */ }
  }
  return diagnostic;
}

export const CLIENT_CRASH_KINDS = Object.freeze(Object.keys(CRASH_CODES));
export const CLIENT_CRASH_SURFACES = Object.freeze([...SURFACES]);
