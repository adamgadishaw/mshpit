// Explicit route patterns, not arbitrary request paths. New POST endpoints do
// not become activity automatically: telemetry and background jobs also POST.
const INTERACTIVE_ROUTES = new Set([
  "PATCH /api/me", "POST /api/me/onboarding/complete", "POST /api/me/export",
  "POST /api/me/email-preferences", "POST /api/me/analytics-consent",
  "POST /api/posts", "PATCH /api/posts/:id", "DELETE /api/posts/:id",
  "POST /api/posts/:id/like", "POST /api/posts/:id/comments", "DELETE /api/posts/:postId/comments/:id",
  "POST /api/users/:id/follow", "POST /api/users/:id/block", "POST /api/users/:id/mute",
  "POST /api/playlists", "PATCH /api/playlists/:id", "DELETE /api/playlists/:id",
  "POST /api/dms/:otherId", "POST /api/fanclubs/:artist/join", "POST /api/fanclubs/:artist/messages",
  "POST /api/lounges/:key/messages", "POST /api/going", "POST /api/ratings", "POST /api/tourdates",
  "POST /api/reports", "POST /api/tracks/report", "POST /api/artist-requests", "POST /api/suggestions",
  "POST /api/venues/:key/reviews", "PATCH /api/artists/:key/profile",
  "POST /api/artists/:key/posts", "DELETE /api/artists/:key/posts/:id",
  "POST /api/feed/preferences/:postId", "DELETE /api/feed/preferences/:postId",
  "POST /api/media/assets", "PATCH /api/media/assets/:id", "DELETE /api/media/assets/:id", "POST /api/media/react",
]);

export function isSuccessfulInteractiveMutation({ method, routePattern, user, result } = {}) {
  if (!user?.id || result?.ok === false || result?.error || result?.redirect) return false;
  return INTERACTIVE_ROUTES.has(`${String(method || "").toUpperCase()} ${routePattern}`);
}

// The user mutation has already committed. Activity bookkeeping and even its
// diagnostic sink must not turn that successful response into a retryable 500.
// Authentication activity is different: createSession still records it inside
// the same transaction as issuing the session, with fail-closed rollback.
export function recordSuccessfulInteractiveMutation({ recordActivity, reportFailure, ...request } = {}) {
  if (!isSuccessfulInteractiveMutation(request)) return false;
  try {
    return recordActivity();
  } catch (error) {
    try {
      reportFailure?.(error);
    } catch {
      console.warn("[pit] account activity failure could not be reported");
    }
    return false;
  }
}
