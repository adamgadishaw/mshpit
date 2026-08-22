import { createTicketRegistry } from "./latestWins.mjs";

// Shared ordering primitive for account- and role-scoped reads. The caller owns
// the scope policy; this coordinator owns only per-kind latest-wins tickets and
// a monotonic reset epoch so an abandoned request can never become current
// again after sign-out/sign-in resets the ticket registry.
export function createScopedReadCoordinator(scopeFor) {
  if (typeof scopeFor !== "function") {
    throw new TypeError("A scoped read coordinator requires a scope function");
  }

  const tickets = createTicketRegistry();
  let epoch = 0;
  const keyFor = (kind, scope) => `${kind}\u0000${scope}`;

  return {
    claim(kind, subject) {
      const scope = scopeFor(subject);
      if (!scope) return null;
      const key = keyFor(kind, scope);
      return { epoch, key, scope, ticket: tickets.claim(key) };
    },

    isCurrent(claim, subject) {
      return !!claim
        && claim.epoch === epoch
        && claim.scope === scopeFor(subject)
        && tickets.isCurrent(claim.key, claim.ticket);
    },

    invalidate(kind, subject) {
      const scope = scopeFor(subject);
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
