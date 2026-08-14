function accountId(value) {
  return value == null || value === "" ? null : String(value);
}

export function matchingEmailVerifiedSessionUser(user, expectedAccountId) {
  const expected = accountId(expectedAccountId);
  return expected
    && user
    && typeof user === "object"
    && !Array.isArray(user)
    && accountId(user.id) === expected
    && user.emailVerified === true
    ? user
    : null;
}

export function shouldReconcileEmailVerificationFailure(error, { aborted = false } = {}) {
  if (aborted) return false;
  const status = Number(error?.status) || 0;
  const code = String(error?.code || "");
  return status === 0
    || status >= 500
    || ["PIT-NET-001", "PIT-NET-002", "PIT-API-001"].includes(code);
}

// A confirmation POST can commit before its response disappears. Reconcile only
// against the same active account's no-store /api/me projection; never adopt the
// token owner's private response across an account handoff.
export async function confirmEmailWithReconciliation({
  token,
  accountIdAtStart = null,
  emailVerifiedAtStart,
  signal,
  requestConfirmation,
  readCurrentSession,
  getCurrentAccountId = () => accountIdAtStart,
} = {}) {
  if (typeof requestConfirmation !== "function" || typeof readCurrentSession !== "function") {
    throw new TypeError("Email verification requests are not configured.");
  }

  try {
    const result = await requestConfirmation(token, { signal });
    const currentAccountId = accountId(getCurrentAccountId());
    const verified = result?.verified === true;
    return {
      verified,
      alreadyVerified: result?.alreadyVerified === true,
      reconciled: false,
      user: verified ? matchingEmailVerifiedSessionUser(result?.user, currentAccountId) : null,
    };
  } catch (error) {
    if (!shouldReconcileEmailVerificationFailure(error, { aborted: !!signal?.aborted })) throw error;
    const startedAs = accountId(accountIdAtStart);
    const currentAccountId = accountId(getCurrentAccountId());
    // `/api/me` can prove only that one already-known active account changed
    // from unconfirmed to confirmed. A guest start, an account handoff, or an
    // account that was already confirmed cannot prove this token POST committed.
    if (!startedAs || emailVerifiedAtStart !== false || currentAccountId !== startedAs) throw error;

    let fresh;
    try {
      fresh = await readCurrentSession(currentAccountId, { signal });
    } catch {
      throw error;
    }
    const user = matchingEmailVerifiedSessionUser(fresh?.user, currentAccountId);
    if (!user) throw error;
    return { verified: true, alreadyVerified: true, reconciled: true, user };
  }
}

export function verificationResendState(result) {
  if (result?.verified === true) return "confirmed";
  if (result?.sent === true) return "sent";
  if (result?.reason === "recently-sent") return "recent";
  return "unavailable";
}
