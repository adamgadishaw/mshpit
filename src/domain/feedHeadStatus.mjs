// Presentation receipts only. This observer never owns requests or feed data.
const snapshot = (status, verified, scope) => Object.freeze({ status, verified, scope });
export function createFeedHeadStatus() {
  let scope = {};
  let state = snapshot("idle", false, scope);
  let pending = null;
  const listeners = new Set();
  const publish = (next) => { state = next; for (const listener of listeners) listener(); };
  return {
    getSnapshot: () => state,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    reset() {
      scope = {};
      pending = null;
      publish(snapshot("idle", false, scope));
    },
    begin() {
      const ticket = { previous: state, scope };
      pending = ticket;
      publish(snapshot("loading", state.verified, scope));
      return ticket;
    },
    settle(ticket, outcome) {
      if (pending !== ticket || ticket.scope !== scope) return;
      pending = null;
      publish(outcome === "ready" ? snapshot("ready", true, scope)
        : outcome === "error" ? snapshot("error", state.verified, scope)
        : ticket.previous);
    },
  };
}
// A truthy/malformed payload is not evidence that an empty feed was loaded.
// Both feed endpoints explicitly return posts + string/null nextCursor.
// This is not per-post schema/privacy certification; the existing Store remains
// the sole data authority. Do not retain post or account information.
export function hasFeedHeadReceipt(payload) {
  return !!payload && Array.isArray(payload.posts)
    && (payload.nextCursor === null || typeof payload.nextCursor === "string")
    && payload.posts.every(post => !!post && typeof post.id === "string" && !!post.id);
}
