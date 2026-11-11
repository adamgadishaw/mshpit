import { createScopedReadCoordinator } from "./scopedReadCoordinator.mjs";

export function accountScopeFor(session) {
  return session?.id ? String(session.id) : null;
}

// Orders account-private reads across refreshes and authentication changes.
// `epoch` prevents the classic sign-out/sign-back-in collision where both the
// abandoned request and a fresh request happen to own ticket 1.
export function createAccountReadCoordinator() {
  const coordinator = createScopedReadCoordinator(accountScopeFor);
  const claim = coordinator.claim;
  let ordinal = 0;
  // A single issue order also lets consumers reconcile snapshots of the same
  // data returned through different lanes (for example Inbox and thread GETs).
  coordinator.claim = (...args) => {
    const ticket = claim(...args);
    return ticket ? { ...ticket, ordinal: ++ordinal } : null;
  };
  return coordinator;
}
