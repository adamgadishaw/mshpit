// "Last write wins" ordering for concurrent requests that target the same key.
//
// Several places in the app fire more than one request against one piece of
// state — a GET that loads a value and a POST that changes it. Responses can
// arrive in any order, so without ordering the SLOWER request wins, which shows
// up as a value that visibly reverts a moment after the user changed it.
//
// Each request claims a ticket before it starts. When it resolves it may only
// write if its ticket is still the newest for that key. This also covers the
// rollback path: a failed OLD request must not undo a newer successful one.

export function createTicketRegistry() {
  const tickets = new Map();

  return {
    /** Claim the next ticket for `key`. Call this BEFORE starting the request. */
    claim(key) {
      const next = (tickets.get(key) || 0) + 1;
      tickets.set(key, next);
      return next;
    },

    /** True only if `ticket` is still the newest claim for `key`. */
    isCurrent(key, ticket) {
      const current = tickets.get(key);
      // An unclaimed key reads back as undefined, so a bare `===` would report
      // an undefined ticket as current and let a write through unordered.
      return current !== undefined && current === ticket;
    },

    /** Forget a key (e.g. on sign-out) so tickets cannot leak across sessions. */
    release(key) {
      tickets.delete(key);
    },

    /** Drop everything — used when the whole cache is reset. */
    clear() {
      tickets.clear();
    },

    get size() {
      return tickets.size;
    },
  };
}
