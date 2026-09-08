// Cookie-writing requests outlive forms. Fence adoption and queue revocation;
// aborting fetch alone cannot undo a session cookie already sent by the server.
export const AUTH_INTENT_KEY = "pit.auth.intent.v1";
export const staleAuthentication = () => ({ kind: "cancelled", stale: true });

export function createAuthTransitions({ read, write, revoke, exclusive = (work) => work(), nonce = () => `${Date.now()}-${Math.random()}` }) {
  let tail = Promise.resolve();
  let active = null;
  const retryListeners = new Set();
  const snapshot = () => read() || null;
  const revision = () => snapshot()?.revision || null;
  const blocked = () => ["pending", "signed-out"].includes(snapshot()?.phase);
  const current = (ticket) => revision() === ticket.revision;
  const record = (phase) => {
    const ticket = { revision: nonce(), phase };
    write(ticket);
    return ticket;
  };
  const enqueue = (work) => {
    const result = tail.then(() => exclusive(work));
    tail = result.catch(() => {
      // architecture: allow-empty-catch -- callers own failures; an unsuccessful request must not poison the serialization queue.
    });
    return result;
  };
  const revokeCurrent = async (ticket) => {
    if (!current(ticket) || !blocked()) return { kind: "superseded", stale: true };
    try {
      await revoke();
      // Keep intent after acknowledgment: a closing old tab can still receive a
      // cookie. Only a deliberate successful sign-in unlocks cookie adoption.
      return { kind: "revoked" };
    } catch (error) {
      for (const retry of retryListeners) retry();
      return { kind: "pending", cause: error };
    }
  };
  const signOut = () => {
    const ticket = record("signed-out");
    active = null;
    return enqueue(() => revokeCurrent(ticket));
  };
  const reconcile = () => {
    const ticket = snapshot();
    if (!ticket || !blocked()) return Promise.resolve({ kind: "skipped" });
    return enqueue(() => revokeCurrent(ticket));
  };
  const run = ({ request, accept, signal, onCancel = () => {}, onUncertain = () => {} }) => {
    if (signal?.aborted) return Promise.resolve(staleAuthentication());
    const previous = snapshot();
    const ticket = record("pending");
    active = ticket;
    const cancel = () => {
      if (!current(ticket) || snapshot()?.phase !== "pending") return;
      // The owner clears private projections and calls signOut. Never await its
      // queued revocation while holding this request's cookie-write lock.
      onCancel();
      if (current(ticket)) void signOut();
    };
    signal?.addEventListener("abort", cancel, { once: true });
    return enqueue(async () => {
      if (!current(ticket) || signal?.aborted) return staleAuthentication();
      try {
        const data = await request();
        if (!current(ticket) || signal?.aborted) return staleAuthentication();
        // Account-choice responses do not issue a session. Preserve prior intent
        // while rotating its revision to supersede older validation reads.
        write({ revision: ticket.revision, phase: data?.user?.id ? "signed-in" : previous?.phase || "signed-in" });
        return accept(data);
      } catch (error) {
        if (!current(ticket) || signal?.aborted) return staleAuthentication();
        if (error?.status >= 400 && error.status < 500) {
          write({ revision: ticket.revision, phase: previous?.phase || "signed-in" });
        } else {
          // Unknown network outcomes may already have changed the cookie.
          onUncertain();
          if (current(ticket)) void signOut();
        }
        throw error;
      }
    }).finally(() => {
      signal?.removeEventListener("abort", cancel);
      if (active === ticket) active = null;
    });
  };
  return {
    snapshot, revision, blocked, signOut, reconcile, run,
    pending: () => !!active && current(active),
    onPendingRevocation(listener) { retryListeners.add(listener); return () => retryListeners.delete(listener); },
  };
}
