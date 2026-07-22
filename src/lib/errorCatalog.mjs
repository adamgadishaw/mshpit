// Stable, public error references for Pit. Keep these codes durable: support,
// screenshots, and diagnostics history use them to identify a failure class.
// User-facing copy is intentionally useful first and lightly themed second.
export const ERROR_CATALOG = Object.freeze({
  "PIT-NET-001": Object.freeze({
    category: "connectivity",
    severity: "warning",
    title: "The signal dropped",
    message: "Pit could not reach the venue. Check your connection and try again.",
    failurePoint: "Network connection",
    guidance: "Reconnect, then retry the action.",
    retryable: true,
  }),
  "PIT-NET-002": Object.freeze({
    category: "connectivity",
    severity: "warning",
    title: "The soundcheck timed out",
    message: "That took longer than expected. Nothing else needs to change before you retry.",
    failurePoint: "Request timeout",
    guidance: "Wait a moment and retry.",
    retryable: true,
  }),
  "PIT-AUTH-001": Object.freeze({
    category: "authentication",
    severity: "warning",
    title: "Your wristband expired",
    message: "Sign in again to keep reviewing, posting, and joining the conversation.",
    failurePoint: "Account session",
    guidance: "Sign in again, then repeat the action.",
    retryable: false,
  }),
  "PIT-AUTH-002": Object.freeze({
    category: "permission",
    severity: "warning",
    title: "This door is restricted",
    message: "Your account does not have access to that part of Pit.",
    failurePoint: "Permission check",
    guidance: "Use an authorized account or return to the previous screen.",
    retryable: false,
  }),
  "PIT-AUTH-003": Object.freeze({
    category: "authentication",
    severity: "warning",
    title: "That wristband did not match",
    message: "The account details did not match. Nothing was changed.",
    failurePoint: "Credential check",
    guidance: "Check the email and password, then try again.",
    retryable: false,
  }),
  "PIT-CHAT-001": Object.freeze({
    category: "permission",
    severity: "warning",
    title: "Join the crowd first",
    message: "Join this fan club before jumping into its conversation.",
    failurePoint: "Fan-club membership",
    guidance: "Tap Join, then send the message again.",
    retryable: true,
  }),
  "PIT-CHAT-002": Object.freeze({
    category: "permission",
    severity: "warning",
    title: "Save your spot first",
    message: "Join this show's Going list before posting in the lounge.",
    failurePoint: "Concert-lounge attendance",
    guidance: "Enter the lounge again, then resend the message.",
    retryable: true,
  }),
  "PIT-REQ-001": Object.freeze({
    category: "validation",
    severity: "warning",
    title: "That set needs a quick edit",
    message: "One or more details could not be accepted. Review them and try again.",
    failurePoint: "Submitted details",
    guidance: "Check the highlighted or recently edited fields.",
    retryable: false,
  }),
  "PIT-REQ-002": Object.freeze({
    category: "not_found",
    severity: "warning",
    title: "That act left the stage",
    message: "This item is no longer available, or the link is out of date.",
    failurePoint: "Requested record",
    guidance: "Go back and refresh the latest list.",
    retryable: false,
  }),
  "PIT-REQ-003": Object.freeze({
    category: "conflict",
    severity: "warning",
    title: "The encore is already queued",
    message: "Pit found a newer or duplicate change. Refresh before trying again.",
    failurePoint: "Conflicting update",
    guidance: "Refresh the item, review its latest state, then retry.",
    retryable: true,
  }),
  "PIT-RATE-001": Object.freeze({
    category: "rate_limit",
    severity: "warning",
    title: "Give the crowd a beat",
    message: "Too many requests arrived at once. Your next try should work after a short pause.",
    failurePoint: "Request limit",
    guidance: "Wait briefly before retrying.",
    retryable: true,
  }),
  "PIT-SVC-001": Object.freeze({
    category: "service",
    severity: "error",
    title: "Backstage hit a snag",
    message: "Pit could not finish that action. Your error reference is ready for support.",
    failurePoint: "Pit service",
    guidance: "Retry once. If it repeats, share the error code and request ID.",
    retryable: true,
  }),
  "PIT-SVC-002": Object.freeze({
    category: "provider",
    severity: "warning",
    title: "A guest performer missed the cue",
    message: "A music or ticket provider is temporarily unavailable.",
    failurePoint: "External provider",
    guidance: "Try again later; the rest of Pit should remain available.",
    retryable: true,
  }),
  "PIT-API-001": Object.freeze({
    category: "response",
    severity: "error",
    title: "The setlist came back scrambled",
    message: "Pit received a response it could not safely read.",
    failurePoint: "API response",
    guidance: "Reload and retry. Report the error reference if it repeats.",
    retryable: true,
  }),
  "PIT-UPLOAD-001": Object.freeze({
    category: "upload",
    severity: "error",
    title: "The photo booth is offline",
    message: "Pit cannot store photos right now. Your local photo has not been published.",
    failurePoint: "Media storage",
    guidance: "Keep the original photo and try again later.",
    retryable: true,
  }),
  "PIT-UPLOAD-002": Object.freeze({
    category: "upload",
    severity: "warning",
    title: "That format missed the guest list",
    message: "Pit does not support this type of media yet.",
    failurePoint: "Media validation",
    guidance: "Choose a supported image format and try again.",
    retryable: false,
  }),
  "PIT-UPLOAD-003": Object.freeze({
    category: "upload",
    severity: "warning",
    title: "That photo is too big for the booth",
    message: "Choose a smaller file and try the upload again.",
    failurePoint: "Media size limit",
    guidance: "Resize or compress the file before retrying.",
    retryable: false,
  }),
  "PIT-UPLOAD-004": Object.freeze({
    category: "upload",
    severity: "error",
    title: "The photo did not make the wall",
    message: "The upload failed before Pit could publish it.",
    failurePoint: "Media upload",
    guidance: "Check your connection and retry with the original file.",
    retryable: true,
  }),
  "PIT-MEDIA-001": Object.freeze({
    category: "playback",
    severity: "warning",
    title: "Playback missed its cue",
    message: "This track could not start here, but the rest of Pit is still ready.",
    failurePoint: "Media playback",
    guidance: "Try again or choose another track.",
    retryable: true,
  }),
  "PIT-MEDIA-002": Object.freeze({
    category: "playback",
    severity: "warning",
    title: "The full track is between sets",
    message: "Pit reached a temporary YouTube lookup limit and kept the safer fallback instead of guessing a video.",
    failurePoint: "YouTube resolver capacity",
    guidance: "Try again later. A moderator can also pin the correct YouTube link for this song.",
    retryable: true,
  }),
  "PIT-STORE-001": Object.freeze({
    category: "storage",
    severity: "warning",
    title: "The saved copy missed a beat",
    message: "Pit could not save this change on this device.",
    failurePoint: "Device storage",
    guidance: "Check available storage, then retry.",
    retryable: true,
  }),
  "PIT-APP-001": Object.freeze({
    category: "application",
    severity: "fatal",
    title: "The stage lights went out",
    message: "This screen stopped unexpectedly. Your account data remains on the server.",
    failurePoint: "App rendering",
    guidance: "Try the screen again, reload, or share the error reference.",
    retryable: true,
  }),
  "PIT-UNK-001": Object.freeze({
    category: "unknown",
    severity: "error",
    title: "Something missed the beat",
    message: "Pit could not complete that action, and saved a diagnostic reference.",
    failurePoint: "Unknown client failure",
    guidance: "Retry once. If it repeats, share the error reference.",
    retryable: true,
  }),
});

export const SERVER_CODE_MAP = Object.freeze({
  AUTH_REQUIRED: "PIT-AUTH-001",
  AUTH_INVALID: "PIT-AUTH-003",
  FORBIDDEN: "PIT-AUTH-002",
  FAN_CLUB_MEMBERSHIP_REQUIRED: "PIT-CHAT-001",
  LOUNGE_ATTENDANCE_REQUIRED: "PIT-CHAT-002",
  VALIDATION_FAILED: "PIT-REQ-001",
  NOT_FOUND: "PIT-REQ-002",
  CONFLICT: "PIT-REQ-003",
  RATE_LIMITED: "PIT-RATE-001",
  MEDIA_STORAGE_UNAVAILABLE: "PIT-UPLOAD-001",
  MEDIA_TYPE_UNSUPPORTED: "PIT-UPLOAD-002",
  MEDIA_TOO_LARGE: "PIT-UPLOAD-003",
  MEDIA_UPLOAD_FAILED: "PIT-UPLOAD-004",
  PROVIDER_UNAVAILABLE: "PIT-SVC-002",
  INTERNAL_ERROR: "PIT-SVC-001",
});

const STATUS_CODE_MAP = Object.freeze({
  400: "PIT-REQ-001",
  408: "PIT-NET-002",
  401: "PIT-AUTH-001",
  403: "PIT-AUTH-002",
  404: "PIT-REQ-002",
  409: "PIT-REQ-003",
  413: "PIT-UPLOAD-003",
  415: "PIT-UPLOAD-002",
  422: "PIT-REQ-001",
  429: "PIT-RATE-001",
});

export function catalogEntry(code = "PIT-UNK-001") {
  return ERROR_CATALOG[code] || ERROR_CATALOG["PIT-UNK-001"];
}

export function catalogueCode({ code, serverCode, status, kind } = {}) {
  if (code && ERROR_CATALOG[code]) return code;
  if (serverCode && SERVER_CODE_MAP[serverCode]) return SERVER_CODE_MAP[serverCode];
  if (kind === "timeout" || kind === "abort") return "PIT-NET-002";
  if (kind === "network") return "PIT-NET-001";
  if (kind === "invalid_response") return "PIT-API-001";
  if (STATUS_CODE_MAP[status]) return STATUS_CODE_MAP[status];
  if (Number(status) >= 500) return "PIT-SVC-001";
  return "PIT-UNK-001";
}

export function safeRouteTemplate(path = "") {
  const pathname = String(path).split(/[?#]/, 1)[0] || "/api/unknown";
  const parts = pathname.split("/").filter(Boolean);
  const resourcesWithPrivateKeys = new Set([
    "users", "posts", "playlists", "dms", "lounges", "fanclubs", "venues",
    "artists", "reports", "comments",
  ]);
  return `/${parts.map((part, index) => {
    const previous = parts[index - 1];
    if (resourcesWithPrivateKeys.has(previous)) return ":id";
    if (/^\d+$/.test(part) || /^[0-9a-f]{16,}$/i.test(part) || part.length > 48) return ":id";
    return part.replace(/[^a-zA-Z0-9._~-]/g, "_").slice(0, 48);
  }).join("/")}`;
}
