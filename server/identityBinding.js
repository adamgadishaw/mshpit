import { ApiError } from "./errors.js";

// HttpOnly cookies are origin-wide but app state is tab-local. A caller that has
// already established an identity must name it on every subsequent request.
// This guard runs before route handlers, preventing a stale tab from reading or
// mutating whichever account another tab most recently put in the shared cookie.
export function assertExpectedAccount(expectedAccount, user) {
  if (!expectedAccount) return;
  const actualAccount = user?.id || "guest";
  if (String(expectedAccount) !== actualAccount) {
    throw new ApiError(409, "Your signed-in account changed in another tab. Refresh and try again.", "IDENTITY_CHANGED");
  }
}
