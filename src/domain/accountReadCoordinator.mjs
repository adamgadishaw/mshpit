import { createScopedReadCoordinator } from "./scopedReadCoordinator.mjs";

export function accountScopeFor(session) {
  return session?.id ? String(session.id) : null;
}

// Orders account-private reads across refreshes and authentication changes.
// `epoch` prevents the classic sign-out/sign-back-in collision where both the
// abandoned request and a fresh request happen to own ticket 1.
export function createAccountReadCoordinator() {
  return createScopedReadCoordinator(accountScopeFor);
}
