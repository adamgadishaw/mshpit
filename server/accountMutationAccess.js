import { ApiError } from "./errors.js";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const UNVERIFIED_MUTATION_ALLOWLIST = new Set([
  "POST /api/login",
  "POST /api/logout",
  "POST /api/signup",
  "POST /api/forgot",
  "POST /api/reset",
  "POST /api/verify-email",
  "POST /api/verify-email/resend",
  "POST /api/unsubscribe",
  "POST /api/me/analytics-consent",
  "POST /api/me/email-preferences",
  "POST /api/me/export",
  // Product suggestions are anonymous and never mutate account/public state;
  // an unverified signed-in visitor should have the same feedback path as a guest.
  "POST /api/suggestions",
  "DELETE /api/me",
]);

/**
 * Email ownership is an authorization prerequisite for state-changing product
 * actions. Unverified sessions may browse and exercise account/privacy rights,
 * but cannot publish, message, upload, follow, react, or claim an artist.
 */
export function assertAccountMutationAccess({ method, pathname, user } = {}) {
  const verb = String(method || "GET").toUpperCase();
  if (!user || SAFE_METHODS.has(verb) || Number(user.email_verified_at) > 0) return true;
  if (UNVERIFIED_MUTATION_ALLOWLIST.has(`${verb} ${String(pathname || "")}`)) return true;
  throw new ApiError(
    403,
    "Confirm your email before changing or publishing anything.",
    "EMAIL_VERIFICATION_REQUIRED",
  );
}
