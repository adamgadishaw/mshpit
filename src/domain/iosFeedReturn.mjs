// UI-only, one current Feed navigation lifetime. Never retains posts or results.
export const FEED_RETURN_LIMIT = 64;
export function createIOSFeedReturnStore() {
  let account, epoch, base, entry, serial = 0;
  return {
    reconcile(id, authEpoch, frame) {
      if (id !== account || authEpoch !== epoch || frame !== base) {
        account = id; epoch = authEpoch; base = frame; entry = null;
      }
      if (!frame || !id) return null;
      if (!entry) {
        const owner = { snapshot: null };
        const current = () => entry === owner;
        owner.lease = {
          key: `feed-return-${++serial}`, current,
          read: filter => current() && owner.snapshot?.filter === filter ? owner.snapshot : null,
          save: value => {
            if (!current()) return;
            if (!["everyone", "local"].includes(value.filter) || !Number.isInteger(value.count) || value.count < 8 || value.count > FEED_RETURN_LIMIT
              || typeof value.order !== "string" || value.order.length > 20000) { owner.snapshot = null; return; }
            owner.snapshot = {
              filter: value.filter, count: value.count, order: value.order,
              anchor: typeof value.anchor === "string" && value.anchor.length <= 240 ? value.anchor : null,
              offset: Number.isFinite(value.offset) ? Math.max(0, Math.min(100000, value.offset)) : 0,
              width: value.width, fontScale: value.fontScale,
            };
          },
          clear: () => { if (current()) owner.snapshot = null; },
        };
        entry = owner;
      }
      return entry.lease;
    },
  };
}
