import { isTransientYouTubeLookupStatus } from "./playback.mjs";

const LOOKUP_NOTICES = Object.freeze({
  search_deferred: Object.freeze({
    kind: "catalogue_only",
    message: "Full-track YouTube search has not started.",
  }),
  search_login_required: Object.freeze({
    kind: "sign_in",
    message: "Sign in for full-track YouTube lookup.",
  }),
  search_verification_required: Object.freeze({
    kind: "verify_email",
    message: "Verify your email for full-track YouTube lookup.",
  }),
  search_actor_budget_exhausted: Object.freeze({
    kind: "account_limit",
    message: "You have reached your YouTube search limit. Try again later.",
  }),
  unconfigured: Object.freeze({
    kind: "configuration",
    message: "Full-track YouTube lookup is unavailable right now.",
  }),
  search_budget_exhausted: Object.freeze({
    kind: "global_limit",
    message: "Mshpit has reached its shared YouTube search limit. Try again later.",
  }),
  provider_paused: Object.freeze({
    kind: "provider_unavailable",
    message: "YouTube full-track lookup is temporarily paused.",
  }),
  recording_proof_unavailable: Object.freeze({
    kind: "recording_verification",
    message: "Mshpit could not confirm a YouTube match for this exact recording.",
  }),
  quota_or_forbidden: Object.freeze({
    kind: "provider_unavailable",
    message: "YouTube full-track lookup is temporarily unavailable.",
  }),
});

const TEMPORARY_LOOKUP_NOTICE = Object.freeze({
  kind: "temporary",
  message: "YouTube lookup is temporarily busy. Try again shortly.",
});

// Player-only display policy lives beside the lazy PlayerBar chunk so paused
// playback copy cannot leak into the initial application bundle.
export function playerYouTubeLookupNotice(status) {
  const normalized = typeof status === "string" ? status.trim() : "";
  if (!normalized) return null;
  return LOOKUP_NOTICES[normalized]
    || (isTransientYouTubeLookupStatus(normalized) ? TEMPORARY_LOOKUP_NOTICE : null);
}

export function playerYouTubeStatusMessage(notice, { preview = false, previewState = "available" } = {}) {
  const message = typeof notice?.message === "string" ? notice.message.trim() : "";
  if (!message) return null;
  if (!preview || notice?.kind === "catalogue_only") return message;
  const previewMessage = previewState === "playing"
    ? "Preview playing."
    : previewState === "requires_gesture"
      ? "Preview ready. Press Play."
      : "Preview available.";
  return `${message} ${previewMessage}`;
}
