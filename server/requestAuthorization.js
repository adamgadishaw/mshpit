import { getSession } from "./auth.js";
import { q } from "./db.js";
import { ApiError } from "./errors.js";
import { assertExpectedAccount } from "./identityBinding.js";
import { assertAccountMutationAccess } from "./accountMutationAccess.js";

function currentUser(token) {
  const session = getSession(token);
  return session ? q.userById.get(session.user_id) || null : null;
}

// Reading a request body can yield to a logout, password reset, expiry, or an
// account restriction. Resolve identity after that await, never from the socket's
// earlier snapshot. Long-running media work also receives a synchronous guard
// to run under its final SQLite write transaction.
export async function readAuthorizedRequest({ token, expectedAccount, method, pathname, readBody }) {
  const body = await readBody();
  const user = currentUser(token);
  assertExpectedAccount(expectedAccount, user);
  assertAccountMutationAccess({ method, pathname, user, body });
  return {
    body,
    user,
    assertCurrentSession({ allowRestrictedAccount = false } = {}) {
      const current = currentUser(token);
      if (!current) throw new ApiError(401, "Log in first.", "AUTH_REQUIRED");
      assertExpectedAccount(user?.id || "guest", current);
      assertExpectedAccount(expectedAccount, current);
      // Handlers may still hold the original ctx.user. Never let that captured
      // authority survive a role change while asynchronous work is running.
      if (current.role !== user.role) {
        throw new ApiError(401, "Your account permissions changed. Log in again.", "AUTH_REQUIRED");
      }
      // Password recovery and account export retain their session-bound rights
      // during moderation restrictions; ordinary social/media guards do not.
      if (!allowRestrictedAccount && current.is_banned) throw new ApiError(403, "This account is banned.", "FORBIDDEN");
      if (!allowRestrictedAccount && current.suspended_until && current.suspended_until > Date.now()) {
        throw new ApiError(403, "This account is suspended.", "FORBIDDEN");
      }
      assertAccountMutationAccess({ method, pathname, user: current, body });
      return current;
    },
  };
}
