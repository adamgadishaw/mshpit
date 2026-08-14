import { createTicketRegistry } from "./latestWins.mjs";

export function staffScopeFor(session) {
  if (!session?.id || (session.role !== "admin" && session.role !== "moderator")) return null;
  return `${session.id}\u0000${session.role}`;
}

// Orders private staff reads independently from public Store hydration. The
// epoch is intentionally monotonic across reset: clearing a ticket map alone
// could let an old request's ticket `1` become current again after the same
// account signs back in and claims a fresh ticket `1`.
export function createStaffReadCoordinator() {
  const tickets = createTicketRegistry();
  let epoch = 0;

  const keyFor = (kind, scope) => `${kind}\u0000${scope}`;

  return {
    claim(kind, session) {
      const scope = staffScopeFor(session);
      if (!scope) return null;
      const key = keyFor(kind, scope);
      return { epoch, key, scope, ticket: tickets.claim(key) };
    },

    isCurrent(claim, session) {
      return !!claim
        && claim.epoch === epoch
        && claim.scope === staffScopeFor(session)
        && tickets.isCurrent(claim.key, claim.ticket);
    },

    invalidate(kind, session) {
      const scope = staffScopeFor(session);
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
