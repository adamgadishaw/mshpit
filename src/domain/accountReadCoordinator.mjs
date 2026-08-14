import { createTicketRegistry } from "./latestWins.mjs";

export function accountScopeFor(session) {
  return session?.id ? String(session.id) : null;
}

// Orders account-private reads across refreshes and authentication changes.
// `epoch` prevents the classic sign-out/sign-back-in collision where both the
// abandoned request and a fresh request happen to own ticket 1.
export function createAccountReadCoordinator() {
  const tickets = createTicketRegistry();
  let epoch = 0;
  const keyFor = (kind, scope) => `${kind}\u0000${scope}`;

  return {
    claim(kind, session) {
      const scope = accountScopeFor(session);
      if (!scope) return null;
      const key = keyFor(kind, scope);
      return { epoch, key, scope, ticket: tickets.claim(key) };
    },

    isCurrent(claim, session) {
      return !!claim
        && claim.epoch === epoch
        && claim.scope === accountScopeFor(session)
        && tickets.isCurrent(claim.key, claim.ticket);
    },

    invalidate(kind, session) {
      const scope = accountScopeFor(session);
      if (!scope) return false;
      tickets.claim(keyFor(kind, scope));
      return true;
    },

    reset() {
      epoch += 1;
      tickets.clear();
    },

    get epoch() {
      return epoch;
    },
  };
}
