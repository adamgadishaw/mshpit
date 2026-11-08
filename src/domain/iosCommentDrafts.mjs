import { createChatClientMutationId } from "./chatDelivery.mjs";

// Root-owned, bounded, memory-only. Retain identifiers, never parent content or identity.
export const EMPTY_COMMENT_DRAFT = Object.freeze({ text: "", parentId: null, invalidReply: false, revision: 0, sending: false, retry: false, error: "" });
const UNAVAILABLE = Object.freeze({ ...EMPTY_COMMENT_DRAFT, unavailable: true });
export const unavailableCommentDraft = Object.freeze({ read: () => UNAVAILABLE, subscribe: () => () => {}, edit() {}, reply() {}, claim: () => null, settle() {}, failedAttempt: () => null, discardAttempt() {} });
const validId = value => typeof value === "string" && value.length > 0 && value.length <= 200 && value.trim() === value;
const failure = "Your comment could not be confirmed. Retry the previous comment or discard its unconfirmed attempt before sending another. Any newer draft will stay here.";
export function createIOSCommentDrafts({ capacity = 32, onAvailable = () => {} } = {}) {
  const limit = Math.max(1, Math.min(128, Math.floor(capacity) || 32));
  let accountId, authEpoch, generation = 0;
  const entries = new Map();
  return {
    account(id, epoch) {
      if (id === accountId && epoch === authEpoch) return;
      accountId = id; authEpoch = epoch; generation++;
      for (const entry of entries.values()) entry.erase();
      entries.clear();
    },
    lease(postId) {
      if (!accountId || !validId(postId)) return unavailableCommentDraft;
      if (entries.has(postId)) {
        const entry = entries.get(postId); entries.delete(postId); entries.set(postId, entry); return entry.lease;
      }
      if (entries.size >= limit) {
        const victim = [...entries].find(([, entry]) => entry.evictable());
        if (!victim) return unavailableCommentDraft;
        victim[1].erase(); entries.delete(victim[0]);
      }
      const token = generation, listeners = new Set();
      let snapshot = EMPTY_COMMENT_DRAFT, pending = null, intent = null;
      const live = () => token === generation && entries.get(postId)?.lease === lease;
      const publish = patch => { snapshot = Object.freeze({ ...snapshot, ...patch }); for (const listener of listeners) listener(); };
      const available = () => { if (live() && entries.size >= limit) onAvailable(); };
      const lease = {
        read: () => live() ? snapshot : EMPTY_COMMENT_DRAFT,
        subscribe(listener) {
          listeners.add(listener);
          return () => { if (listeners.delete(listener) && !pending && !listeners.size) available(); };
        },
        edit(value) {
          if (!live()) return;
          const text = typeof value === "string" ? value.slice(0, 1000) : "";
          if (text !== snapshot.text) publish({ text, revision: snapshot.revision + 1, error: intent ? snapshot.error : "" });
        },
        reply(value) {
          if (!live()) return;
          const parentId = validId(value) ? value : null;
          const invalidReply = value !== null && !validId(value);
          if (parentId !== snapshot.parentId || invalidReply !== snapshot.invalidReply) publish({ parentId, invalidReply, revision: snapshot.revision + 1, error: intent ? snapshot.error : "" });
        },
        claim(parentAvailable) {
          if (!live() || pending) return null;
          if (intent?.parentId && !parentAvailable) {
            publish({ error: "The previous reply target is unavailable in this thread. Refresh the thread to retry, or discard the unconfirmed attempt. Its original delivery details are still saved." });
            return null;
          }
          if (!intent) {
            if (!snapshot.text.trim()) return null;
            if (snapshot.invalidReply || (snapshot.parentId && !parentAvailable)) {
              publish({ error: "This reply target is unavailable in this thread. Clear it or choose another comment before sending." });
              return null;
            }
            intent = Object.freeze({ text: snapshot.text.trim(), parentId: snapshot.parentId, clientMutationId: createChatClientMutationId("comment"), revision: snapshot.revision });
          }
          // An attempted delivery retains its exact payload/key. If its original
          // parent is unavailable, block: the first attempt may not have committed.
          // Deletion after this local check remains a server-owned race.
          pending = Object.freeze({ intent });
          publish({ sending: true, retry: false, error: "" });
          return pending;
        },
        failedAttempt: () => live() && !pending && snapshot.retry ? intent : null,
        discardAttempt(expected) {
          if (!live() || pending || !intent || intent !== expected) return;
          intent = null; publish({ retry: false, error: "" }); available();
        },
        settle(claim, result) {
          if (!live() || !claim || claim !== pending) return;
          pending = null;
          if (result?.ok) {
            const clear = snapshot.revision === intent.revision;
            intent = null;
            publish({ ...(clear ? { text: "", parentId: null, invalidReply: false, revision: snapshot.revision + 1 } : {}), sending: false, retry: false, error: "" });
          } else publish({ sending: false, retry: true, error: failure });
          available();
        },
      };
      entries.set(postId, { lease, evictable: () => !pending && !intent && !listeners.size,
        erase() { snapshot = EMPTY_COMMENT_DRAFT; pending = null; intent = null; listeners.clear(); },
      });
      return lease;
    },
  };
}
