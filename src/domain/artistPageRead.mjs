import { rejectLoadState, resolveLoadState } from "./loadState.mjs";
import { isAppErrorLike } from "./commandResult.mjs";

export function artistPageAccessDenied(error) {
  return /^PIT-AUTH-/.test(String(error?.code || ""))
    || [401, 403].includes(Number(error?.status))
    || ["AUTH_REQUIRED", "AUTH_INVALID", "FORBIDDEN", "IDENTITY_CHANGED"].includes(error?.serverCode);
}

// Page reads use the shared CommandResult envelope. In particular, legacy
// policy proof lives in result.value, never on the outer success marker.
export function settleArtistPageRead(current, { scope, result, invalidResponseError } = {}) {
  if (current?.scope !== scope) return current;
  if (!result?.ok) {
    const error = isAppErrorLike(result?.error) ? result.error : invalidResponseError;
    return rejectLoadState(current, { scope, error, retainData: !artistPageAccessDenied(error) });
  }
  const page = result.value;
  if (!page || typeof page.legacyProfile !== "boolean") {
    return rejectLoadState(current, { scope, error: invalidResponseError });
  }
  return resolveLoadState({ scope, data: {
    legacyProfile: page.legacyProfile,
    profile: page.profile || null,
    posts: Array.isArray(page.posts) ? page.posts : [],
  }, updatedAt: page.loadedAt });
}
