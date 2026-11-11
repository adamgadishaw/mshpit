import { claimIOSProfileRead } from "./iosProfileReadFence.ios.js";
import { invalidateIOSDetailPrivacy } from "./iosDetailPrivacy.ios.js";

// Separate owner namespace: a post ID can never retire a profile metadata read.
const owners = new WeakMap();
export function claimIOSCommentRead(owner, postId, accountCurrent, signal) {
  let namespace = owners.get(owner);
  if (!namespace) { namespace = { get current() { return owner.current; } }; owners.set(owner, namespace); }
  const claim = claimIOSProfileRead(namespace, postId);
  const current = () => !signal?.aborted && accountCurrent() && claim.current();
  return {
    current,
    reject(error, clear) {
      if (!current()) return "stale";
      if ([403, 404, 410].includes(Number(error?.status))) {
        claim.quarantine();
        invalidateIOSDetailPrivacy();
        clear();
        return "denied";
      }
      return "error";
    },
    accept(rows, existing) {
      if (!current()) return false;
      const visible = new Map(rows.map(row => [row.id, row]));
      if (existing.some(row => !row.pending && (!visible.has(row.id)
        || (!row.deleted && visible.get(row.id).deleted)))) {
        claim.quarantine();
        invalidateIOSDetailPrivacy();
      }
      return true;
    },
  };
}
