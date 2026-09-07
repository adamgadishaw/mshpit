import { ApiError } from "./errors.js";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const ACCOUNT_RIGHTS = new Set([
  "POST /api/signup", "POST /api/login", "POST /api/logout", "POST /api/forgot", "POST /api/reset",
  "POST /api/verify-email", "POST /api/verify-email/resend", "POST /api/signup/cancel",
  "POST /api/me/password", "POST /api/me/onboarding/complete", "POST /api/me/export",
  "POST /api/me/email-preferences", "POST /api/me/analytics-consent", "POST /api/unsubscribe",
  "POST /api/me/accounts/connect", "POST /api/me/accounts/switch", "DELETE /api/me",
  "POST /api/reports", "POST /api/tracks/report",
]);
const PRIVATE_PROFILE_FIELDS = new Set([
  "theme", "profileAudience", "directMessagePolicy", "searchIndexingOptOut", "ageBand",
]);

function privateProfilePatch(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return false;
  const prototype = Object.getPrototypeOf(body);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const keys = Object.keys(body);
  return keys.length > 0 && keys.every((key) => PRIVATE_PROFILE_FIELDS.has(key));
}

function preservesAccountRights(verb, pathname, body) {
  if (ACCOUNT_RIGHTS.has(`${verb} ${pathname}`)) return true;
  if (verb === "PATCH" && pathname === "/api/me") return privateProfilePatch(body);
  if (verb === "POST" && /^\/api\/users\/[^/]+\/(?:block|mute)$/u.test(pathname)) return true;
  // The deletion handler still requires ownership. This exception cannot mint,
  // edit, or finalize media; it only lets a restricted account remove its assets.
  return verb === "DELETE" && /^\/api\/media\/assets\/[^/]+$/u.test(pathname);
}

function startsANewMediaUpload(verb, pathname) {
  if (verb !== "POST") return false;
  const path = String(pathname || "");
  return path === "/api/media/assets"
    || path === "/api/media/presign"
    || /^\/api\/media\/assets\/[^/]+\/variants$/u.test(path);
}

/**
 * Default-deny public/social mutations for unverified or dormant accounts.
 * Narrow recovery, privacy, and safety exceptions retain their handler-level
 * authentication, ownership, password, and payload checks. In particular a
 * privacy setting cannot accompany a bio, handle, or other public profile edit.
 * The HTTP caller must provide the parsed body before dispatching the route.
 * Staff roles do not bypass verification or dormancy; the trusted lifecycle
 * service is responsible for exempting the locked Owner from dormancy.
 */
export function assertAccountMutationAccess({ method, pathname, user, body } = {}) {
  const verb = String(method || "GET").toUpperCase();
  const path = String(pathname || "");
  if (!user || SAFE_METHODS.has(verb)) return true;
  const dormant = Number(user.dormant_at) > 0;
  if (!dormant && Number(user.email_verified_at) > 0) return true;
  if (preservesAccountRights(verb, path, body)) return true;
  if (dormant) throw new ApiError(403, "Log in again to reactivate your account before making changes.", "FORBIDDEN");
  if (startsANewMediaUpload(verb, path)) {
    throw new ApiError(403, "Confirm your email before starting a new photo or video upload.", "MEDIA_EMAIL_VERIFICATION_REQUIRED");
  }
  throw new ApiError(403, "Confirm your email before publishing, interacting, or changing your public profile.", "EMAIL_VERIFICATION_REQUIRED");
}
