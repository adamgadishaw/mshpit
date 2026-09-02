import { ApiError } from "./errors.js";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function startsANewMediaUpload(verb, pathname) {
  if (verb !== "POST") return false;
  const path = String(pathname || "");
  return path === "/api/media/assets"
    || path === "/api/media/presign"
    || /^\/api\/media\/assets\/[^/]+\/variants$/u.test(path);
}

/**
 * Email ownership is required before starting a new photo/video upload. It is
 * deliberately not a general mutation gate: reporting, blocking, muting,
 * privacy changes, account rights, text posting, and messaging remain usable.
 * Handlers repeat this check on every writer-minting media path.
 */
export function assertAccountMutationAccess({ method, pathname, user } = {}) {
  const verb = String(method || "GET").toUpperCase();
  if (!user || SAFE_METHODS.has(verb) || Number(user.email_verified_at) > 0 || user.role === "admin") return true;
  if (!startsANewMediaUpload(verb, pathname)) return true;
  throw new ApiError(
    403,
    "Confirm your email before starting a new photo or video upload.",
    "MEDIA_EMAIL_VERIFICATION_REQUIRED",
  );
}
