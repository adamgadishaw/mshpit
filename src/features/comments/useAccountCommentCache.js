import { useRef, useState } from "react";

import { ENABLE_DEMO_DATA } from "../../config/runtime.mjs";
import {
  commentCacheStorageKey,
  createCommentAccountCoordinator,
  resolveAccountCommentCache,
  withoutPendingComments,
} from "../../domain/commentCache.mjs";
import { sanitizePersistedStoreValue } from "../../domain/dataPolicy.mjs";
import { load, save } from "../../lib/persist";

const DEMO_COMMENTS = {
  log_1: [
    { id: "c1", userId: "u_devon", name: "Devon Ash", initials: "DA", text: "The two-step during HEALING was unreal. Worth the bruises.", likes: 5 },
    { id: "c2", userId: "u_priya", name: "Priya N.", initials: "PN", text: "Back of the room sound was rough but the pit didn't care.", likes: 2 },
  ],
};

const loadAccountComments = (accountId) => resolveAccountCommentCache({
  accountId,
  demoEnabled: ENABLE_DEMO_DATA,
  demoSeed: DEMO_COMMENTS,
  read: load,
  write: save,
  sanitize: (value) => sanitizePersistedStoreValue(commentCacheStorageKey(accountId), value, ENABLE_DEMO_DATA),
});

// This feature owns both the persisted projection and its request bookkeeping.
// Call adoptAccount synchronously whenever the authenticated identity changes;
// the epoch fence then rejects even an A -> B -> A late response.
export function useAccountCommentCache(initialAccountId = null) {
  const stateRef = useRef(null);
  if (!stateRef.current) {
    const comments = loadAccountComments(initialAccountId);
    stateRef.current = {
      coordinator: createCommentAccountCoordinator(initialAccountId),
      comments,
      inflight: new Map(),
      loadedAt: new Map(),
    };
  }
  const [comments, setCommentSnapshot] = useState(() => stateRef.current.comments);
  stateRef.current.comments = comments;

  const update = (updater) => {
    const current = stateRef.current.comments;
    const candidate = typeof updater === "function" ? updater(current) : updater;
    const next = candidate && typeof candidate === "object" && !Array.isArray(candidate) ? candidate : {};
    if (next === current) return current;
    stateRef.current.comments = next;
    save(commentCacheStorageKey(stateRef.current.coordinator.accountId()), next);
    setCommentSnapshot(next);
    return next;
  };

  const adoptAccount = (nextAccountId) => {
    const transition = stateRef.current.coordinator.adopt(nextAccountId);
    if (!transition.changed) return transition;
    save(
      commentCacheStorageKey(transition.previousAccountId),
      withoutPendingComments(stateRef.current.comments),
    );
    stateRef.current.inflight.clear();
    stateRef.current.loadedAt.clear();
    const next = loadAccountComments(transition.accountId);
    stateRef.current.comments = next;
    setCommentSnapshot(next);
    return transition;
  };

  return {
    comments,
    update,
    adoptAccount,
    clearAccount: (accountId) => save(commentCacheStorageKey(accountId), {}),
    capture: () => stateRef.current.coordinator.capture(),
    isCurrent: (claim, renderedAccountId) => stateRef.current.coordinator.isCurrent(claim, renderedAccountId),
    isScopedTo: (accountId) => stateRef.current.coordinator.accountId() === (accountId || null),
    pendingRequest: (key) => stateRef.current.inflight.get(key),
    requestIsFresh: (key, maxAgeMs) => Date.now() - (stateRef.current.loadedAt.get(key) || 0) < maxAgeMs,
    markRequestFresh: (key) => stateRef.current.loadedAt.set(key, Date.now()),
    trackRequest: (key, request) => stateRef.current.inflight.set(key, request),
    releaseRequest: (key, request) => {
      if (stateRef.current.inflight.get(key) === request) stateRef.current.inflight.delete(key);
    },
  };
}
