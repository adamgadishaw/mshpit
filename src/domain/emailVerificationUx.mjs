const PROMPT_COPY = Object.freeze({
  post: Object.freeze({
    title: "Confirm before you post",
    body: "Email confirmation protects your name, photos, and reviews from being published by someone using an address they do not own.",
  }),
  review: Object.freeze({
    title: "Confirm before you review",
    body: "Confirm your email before adding a concert or venue review to the community.",
  }),
  message: Object.freeze({
    title: "Confirm before you message",
    body: "Confirm your email before sending messages or joining a conversation.",
  }),
  interact: Object.freeze({
    title: "Confirm before you join in",
    body: "Confirm your email before following, reacting, or changing recommendations.",
  }),
  profile: Object.freeze({
    title: "Confirm before you edit",
    body: "Confirm your email before changing the public profile attached to this account.",
  }),
  artist: Object.freeze({
    title: "Confirm before managing an artist",
    body: "Confirm your email before requesting access, publishing a campaign, or changing an artist page.",
  }),
  playlist: Object.freeze({
    title: "Confirm before saving",
    body: "Confirm your email before creating or changing playlists and artist picks.",
  }),
  report: Object.freeze({
    title: "Confirm before sending a report",
    body: "Confirm your email before submitting a community safety report. If someone is in immediate danger, contact local emergency services.",
  }),
  default: Object.freeze({
    title: "Confirm your email to continue",
    body: "You can keep exploring Pit now. Confirm your email before publishing, messaging, following, reacting, or changing public information.",
  }),
});

/**
 * Client-side affordance only. The server remains the authorization boundary.
 * Undefined verification state is allowed through so an older rolling client
 * cannot make an account unusable; the server will still enforce its own row.
 */
export function verifiedMutationDecision(session) {
  if (!session?.id) return "authenticate";
  if (session.emailVerified === false) return "verify";
  return "allow";
}

export function verificationPromptCopy(intent) {
  return PROMPT_COPY[intent] || PROMPT_COPY.default;
}
