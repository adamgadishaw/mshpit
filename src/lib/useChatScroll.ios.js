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
  const viewportRef = useRef({ layout: null, scroll: null, following: null });
  const scopeRef = useRef({ key: scopeKey });
  if (scopeRef.current.key !== scopeKey) {
    scopeRef.current = { key: scopeKey };
    stickToNewestRef.current = true;
    positionedHistoryRef.current = false;
    // The native viewport can remain mounted across auth/thread changes and
    // will not emit another layout until its dimensions actually change.
    viewportRef.current = { layout: viewportRef.current.layout, scroll: null, following: null };
  }
  // Identity changes on every transition, including leaving and returning to
  // the same room, so old native event handlers cannot revive on a round trip.
  const scope = scopeRef.current;

  const onScroll = useCallback((event) => {
    if (scopeRef.current !== scope) return;
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    const distance = contentSize.height - layoutMeasurement.height - contentOffset.y;
    const viewport = viewportRef.current;
    // UIKit can report the smaller viewport before React receives onLayout.
    // That geometry change is not the reader scrolling away from the newest.
    const previousHeight = viewport.scroll?.height ?? viewport.layout?.height;
    if (viewport.layout && previousHeight !== layoutMeasurement.height && stickToNewestRef.current && !viewport.following) {
      viewport.following = { height: layoutMeasurement.height, offset: viewport.scroll?.offset ?? contentOffset.y };
    }
    viewport.scroll = { height: layoutMeasurement.height, offset: contentOffset.y };
    if (viewport.following) {
      const reachedEnd = layoutMeasurement.height === viewport.following.height && distance <= 1;
      // Also honor accessibility/native scrolling toward older messages, which
      // need not produce onScrollBeginDrag.
      const movedToHistory = contentOffset.y < viewport.following.offset - 1;
      if (!reachedEnd && !movedToHistory) {
        viewport.following.offset = contentOffset.y;
        return;
      }
      viewport.following = null;
    }
    stickToNewestRef.current = distance <= STICKY_DISTANCE;
  }, [scope]);

  const onLayout = useCallback((event) => {
    if (scopeRef.current !== scope) return;
    const { width, height } = event.nativeEvent.layout;
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return;
    const viewport = viewportRef.current;
    const previous = viewport.layout;
    viewport.layout = { width, height };
    if (!previous || (previous.width === width && previous.height === height)) return;
    if (!stickToNewestRef.current || !scrollRef.current) return;
    viewport.following = { height, offset: viewport.scroll?.offset ?? 0 };
    // Keyboard/composer resizing already animates the viewport. A second scroll
    // animation would lag behind it. Do not consume initial history positioning.
    scrollRef.current.scrollToEnd({ animated: false });
  }, [scope]);

  const onScrollBeginDrag = useCallback((event) => {
    if (scopeRef.current !== scope) return;
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    viewportRef.current.following = null;
    viewportRef.current.scroll = { height: layoutMeasurement.height, offset: contentOffset.y };
    stickToNewestRef.current = contentSize.height - layoutMeasurement.height - contentOffset.y <= STICKY_DISTANCE;
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

  return { scrollRef, onScroll, onContentSizeChange, onLayout, onScrollBeginDrag };
}
