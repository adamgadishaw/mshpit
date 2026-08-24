import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { profileHistoryScope } from "./profileHistoryState.mjs";
import { profileHistoryStore } from "./profileHistoryClient.mjs";

export function useProfileHistory({ accountId = null, targetId = null, enabled = true } = {}) {
  const params = useMemo(() => ({ accountId: accountId || null, targetId: targetId || null }), [accountId, targetId]);
  const scope = profileHistoryScope(params.accountId, params.targetId);
  const subscribe = useCallback((listener) => profileHistoryStore.subscribe(scope, listener), [scope]);
  const getSnapshot = useCallback(() => profileHistoryStore.getSnapshot(scope), [scope]);
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  useEffect(() => {
    if (enabled && params.targetId) void profileHistoryStore.ensure(params);
  }, [enabled, params, scope]);

  return {
    ...state,
    ...(state.data || {}),
    retry: () => profileHistoryStore.refresh(params),
    loadMore: () => profileHistoryStore.loadMore(params),
    removePost: (postId) => profileHistoryStore.removePost(params, postId),
    updatePost: (postId, updater) => profileHistoryStore.updatePost(params, postId, updater),
  };
}
