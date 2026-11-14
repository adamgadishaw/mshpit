import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";

// Feed remains mounted under a detail. Render boundaries and every effect
// reconnect get distinct admission tokens: old native events never revive.
export default function useFeedPresentation({ active, presentation, scope, refreshControllerRef, onPause, onRetire }) {
  const generation = useMemo(() => ({ active }), [active, presentation, scope]);
  const live = useRef(null), pause = useRef(onPause), retire = useRef(null);
  const [, update] = useState(0);
  if (live.current?.generation !== generation) live.current = { generation, mounted: false };
  const token = live.current;
  pause.current = onPause;
  retire.current = { scope, onRetire };
  const current = useCallback(() => live.current === token && token.mounted && generation.active
    && presentation?.current() !== false, [token, generation, presentation]);
  const currentRef = useRef(current);
  currentRef.current = current;
  useLayoutEffect(() => {
    const admitted = { generation, mounted: true };
    live.current = admitted;
    // Descendant card hooks snapshot render-time authority. Publish a new
    // callback identity after every admission, including first mount and Back.
    update(value => value + 1);
    if (!generation.active || refreshControllerRef?.current?.signal.aborted) {
      refreshControllerRef?.current?.abort();
      if (refreshControllerRef) refreshControllerRef.current = null;
      pause.current?.();
    }
    return () => {
      // Close already-earned dwell at the layout departure cutoff, not during
      // a later hidden timer. Privacy changes discard the old scope instead.
      if (admitted.mounted && generation.active) retire.current?.onRetire?.(Date.now(), retire.current.scope === scope);
      admitted.mounted = false;
      refreshControllerRef?.current?.abort();
    };
  }, [generation, refreshControllerRef]);
  return { current, currentRef };
}
