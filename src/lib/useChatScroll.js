import { useCallback, useRef } from "react";

const STICKY_DISTANCE = 96;

// Start at the newest message and follow incoming messages only while the reader
// is already near the bottom. Scrolling up to read history is never interrupted.
export default function useChatScroll() {
  const scrollRef = useRef(null);
  const stickToNewestRef = useRef(true);

  const onScroll = useCallback((event) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    const distance = contentSize.height - layoutMeasurement.height - contentOffset.y;
    stickToNewestRef.current = distance <= STICKY_DISTANCE;
  }, []);

  const onContentSizeChange = useCallback(() => {
    if (stickToNewestRef.current) scrollRef.current?.scrollToEnd({ animated: true });
  }, []);

  return { scrollRef, onScroll, onContentSizeChange };
}
