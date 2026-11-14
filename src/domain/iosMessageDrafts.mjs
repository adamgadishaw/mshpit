// iOS composer state only. Store remains the sole owner of delivery and retries.
// Never persisted, logged, put in navigation URLs, or shared between auth epochs.
export const EMPTY_MESSAGE_DRAFT = Object.freeze({ text: "", sending: false });
const UNAVAILABLE = Object.freeze({ ...EMPTY_MESSAGE_DRAFT, unavailable: true });
const noopSubscribe = () => () => {};
export const unavailableMessageDraft = Object.freeze({
  read: () => UNAVAILABLE, subscribe: noopSubscribe, edit() {}, claim: () => null,
  settle() {}, clearMatching() {},
});

export function createIOSMessageDrafts({ capacity = 32, onAvailable = () => {} } = {}) {
  const limit = Math.max(1, Math.min(128, Math.floor(capacity) || 32));
  let accountId, authEpoch, generation = 0;
  const entries = new Map();
  return {
    account(id, epoch) {
      if (id === accountId && epoch === authEpoch) return;
      accountId = id; authEpoch = epoch; generation += 1;
      // Invalidate synchronously, before an old completion or input can write.
      for (const entry of entries.values()) entry.erase();
      entries.clear();
    },
    lease(recipient) {
      if (!accountId || !recipient) return unavailableMessageDraft;
      if (entries.has(recipient)) {
        const entry = entries.get(recipient);
        entries.delete(recipient); entries.set(recipient, entry);
        return entry.lease;
      }
      if (entries.size >= limit) {
        const victim = [...entries].find(([, entry]) => entry.evictable());
        // Never discard a pending claim just to admit another composer.
        if (!victim) return unavailableMessageDraft;
        victim[1].erase(); entries.delete(victim[0]);
      }
      const token = generation, listeners = new Set();
      let snapshot = EMPTY_MESSAGE_DRAFT, revision = 0, pending = null;
      const live = () => generation === token && entries.get(recipient)?.lease === lease;
      const publish = (value) => {
        snapshot = Object.freeze(value);
        for (const listener of listeners) listener();
      };
      const lease = {
        read: () => live() ? snapshot : EMPTY_MESSAGE_DRAFT,
        subscribe(listener) {
          listeners.add(listener);
          return () => {
            const removed = listeners.delete(listener);
            // A new route can request admission before the old screen's cleanup.
            // Recheck capacity after its last subscriber leaves, but never free
            // a pending claim or notify from a stale/repeated cleanup.
            if (removed && live() && !pending && listeners.size === 0 && entries.size >= limit) onAvailable();
          };
        },
        edit(value) {
          if (!live()) return;
          const text = typeof value === "string" ? value.slice(0, 1000) : "";
          if (text === snapshot.text) return;
          revision += 1;
          publish({ text, sending: !!pending });
        },
        claim() {
          if (!live() || pending || !snapshot.text.trim()) return null;
          pending = Object.freeze({ text: snapshot.text.trim(), revision });
          publish({ ...snapshot, sending: true });
          return pending;
        },
        settle(claim, result) {
          if (!live() || !claim || pending !== claim) return;
          pending = null;
          const clear = result?.ok && revision === claim.revision;
          if (clear) revision += 1;
          publish({ text: clear ? "" : snapshot.text, sending: false });
          if (entries.size >= limit) onAvailable();
        },
        clearMatching(before, deliveredText) {
          if (!live() || pending || snapshot !== before || snapshot.text.trim() !== deliveredText) return;
          revision += 1;
          publish(EMPTY_MESSAGE_DRAFT);
        },
      };
      entries.set(recipient, {
        lease,
        evictable: () => !pending && listeners.size === 0,
        erase() { snapshot = EMPTY_MESSAGE_DRAFT; pending = null; revision += 1; listeners.clear(); },
      });
      return lease;
    },
  };
}
