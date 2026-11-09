import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import useIOSDetailPresentation from "../../hooks/useIOSDetailPresentation";
import { profileHistoryScope } from "./profileHistoryState.mjs";
import { profileHistoryStore } from "./profileHistoryClient.ios.mjs";

export function useProfileHistory({ accountId = null, targetId = null, enabled = true } = {}) {
  const presentation = useIOSDetailPresentation();
  const { active, current, guard } = presentation;
  const canAct = presentation.canAct || current;
  const params = useMemo(() => ({ accountId: accountId || null, targetId: targetId || null }), [accountId, targetId]);
  const scope = profileHistoryScope(params.accountId, params.targetId);
  const subscribe = useCallback((listener) => profileHistoryStore.subscribe(scope, listener), [scope]);
  const getSnapshot = useCallback(() => profileHistoryStore.getSnapshot(scope), [scope]);
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  // This is a shared account+target cache, not this occurrence's transport.
  // Keep its live subscription while covered: another active occurrence may
  // share an admitted page read. Cover blocks new starts, not that receipt.
  useEffect(() => {
    if (active && canAct() && enabled && params.targetId) void profileHistoryStore.ensure(params);
  }, [active, current, enabled, params, scope]);

  return {
    ...state,
    ...(state.data || {}),
    retry: guard(() => profileHistoryStore.refresh(params)),
    loadMore: guard(() => profileHistoryStore.loadMore(params)),
    removePost: (postId) => profileHistoryStore.removePost(params, postId),
    updatePost: (postId, updater) => profileHistoryStore.updatePost(params, postId, updater),
  };
}
