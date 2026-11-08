import { useCallback, useRef } from "react";
import useReducedMotion from "../hooks/useReducedMotion";

const STICKY_DISTANCE = 96;

// Message count keeps an empty/loading placeholder from consuming the initial
// history positioning. Without a count, only the first layout is initial.
export default function useChatScroll({ messageCount, scopeKey } = {}) {
  const reducedMotion = useReducedMotion();
  const reducedMotionRef = useRef(reducedMotion);
  reducedMotionRef.current = reducedMotion;
  const scrollRef = useRef(null);
  const stickToNewestRef = useRef(true);
  const positionedHistoryRef = useRef(false);
  const scopeRef = useRef({ key: scopeKey });
  if (scopeRef.current.key !== scopeKey) {
    scopeRef.current = { key: scopeKey };
    stickToNewestRef.current = true;
    positionedHistoryRef.current = false;
  }
  // Identity changes on every transition, including leaving and returning to
  // the same room, so old native event handlers cannot revive on a round trip.
  const scope = scopeRef.current;

  const onScroll = useCallback((event) => {
    if (scopeRef.current !== scope) return;
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    const distance = contentSize.height - layoutMeasurement.height - contentOffset.y;
    stickToNewestRef.current = distance <= STICKY_DISTANCE;
  }, [scope]);

  const onContentSizeChange = useCallback(() => {
    if (scopeRef.current !== scope) return;
    if (!stickToNewestRef.current || !scrollRef.current) return;
    const hasMessages = messageCount === undefined || messageCount > 0;
    scrollRef.current.scrollToEnd({
      animated: hasMessages && positionedHistoryRef.current && !reducedMotionRef.current,
    });
    if (hasMessages) positionedHistoryRef.current = true;
  }, [messageCount, scope]);

  return { scrollRef, onScroll, onContentSizeChange };
}
