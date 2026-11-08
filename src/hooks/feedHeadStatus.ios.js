import { useLayoutEffect, useRef, useSyncExternalStore } from "react";
export { createFeedHeadStatus, hasFeedHeadReceipt } from "../domain/feedHeadStatus.mjs";
const subscribe = () => () => {};
const getSnapshot = () => null;
export function useFeedHeadStatus(owner) {
  const state = useSyncExternalStore(owner?.subscribe || subscribe, owner?.getSnapshot || getSnapshot, getSnapshot);
  const current = useRef(null);
  if (!current.current || current.current.owner !== owner || current.current.scope !== state?.scope) {
    current.current = { owner, scope: state?.scope, active: true };
  }
  const view = current.current;
  useLayoutEffect(() => {
    view.active = true;
    return () => { view.active = false; };
  }, [view]);
  return state ? { ...state, isCurrent: () => current.current === view && view.active && owner.getSnapshot().scope === view.scope } : null;
}
