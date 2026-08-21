const AUTHORITATIVE_UNAVAILABLE_STATUSES = new Set([403, 404, 410]);
const AUTHORITATIVE_UNAVAILABLE_CODES = new Set(["FORBIDDEN", "NOT_FOUND"]);

export const PROFILE_STALE_MESSAGE = "Could not refresh this profile. Showing saved profile data.";
export const PROFILE_LOAD_ERROR = "This profile could not be loaded. Check your connection and try again.";

export function unavailableProfileOutcome(reason = "unavailable") {
  return { status: "missing", reason, evict: true, user: null, error: "" };
}

export function profileFailureOutcome(error, { hasCachedProfile = false } = {}) {
  const status = Number(error?.status) || 0;
  const serverCode = typeof error?.serverCode === "string" ? error.serverCode.toUpperCase() : "";
  if (AUTHORITATIVE_UNAVAILABLE_STATUSES.has(status) || AUTHORITATIVE_UNAVAILABLE_CODES.has(serverCode)) {
    return unavailableProfileOutcome(status === 403 || serverCode === "FORBIDDEN" ? "restricted" : "missing");
  }
  return hasCachedProfile
    ? { status: "stale", reason: "refresh-failed", evict: false, user: null, error: PROFILE_STALE_MESSAGE }
    : { status: "error", reason: "load-failed", evict: false, user: null, error: PROFILE_LOAD_ERROR };
}

export function withoutUnavailableProfile(rows, userId) {
  const list = Array.isArray(rows) ? rows : [];
  return list.filter((row) => row?.id !== userId);
}

export function withoutUnavailableProfilePosts(rows, userId) {
  const list = Array.isArray(rows) ? rows : [];
  return list.filter((row) => row?.userId !== userId);
}

// A successful profile-post response is a bounded authoritative wall snapshot.
// Remove old confirmed rows absent from it, while retaining an in-flight local
// post until its own mutation reconciles.
export function reconcileProfilePostSnapshot(rows, userId, serverPosts) {
  const list = Array.isArray(rows) ? rows : [];
  if (!Array.isArray(serverPosts)) return list;
  const confirmedIds = new Set(serverPosts.map((post) => post?.id).filter(Boolean));
  return list.filter((post) => post?.userId !== userId
    || confirmedIds.has(post?.id)
    || post?.pending
    || String(post?.id || "").startsWith("p_local_"));
}
