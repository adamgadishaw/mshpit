import { useEffect, useMemo, useReducer, useRef } from "react";
import { createEndlessFeed } from "../domain/endlessFeed.mjs";

export default function useEndlessFeed({ scope, listProps = {}, head = null, ...input }) {
  // Cached rows remain readable before verification and during a background
  // head refresh. Only an admitted head can authorize older-page transport.
  const headReady = !head || head.verified && head.status !== "loading";
  const options = { ...input, ready: input.ready && (input.visibleCount < input.loadedCount || headReady), hasMore: input.hasMore && headReady };
  const viewportHeight = useRef(0);
  const [, update] = useReducer(value => value + 1, 0);
  const owner = useMemo(() => createEndlessFeed({ changed: update }), [scope]);
  // Commit new rows before continuing a page whose projection was empty. A
  // retained hidden screen keeps its data but has no pagination authority.
  useEffect(() => { owner.connect(); return () => owner.dispose(); }, [owner]);
  useEffect(() => { owner.update(options); owner.layout(viewportHeight.current); });
  const admitted = fn => (...args) => { if (options.current()) fn(...args); };
  return {
    error: owner.error || options.sourceError,
    loading: owner.loading || options.loading,
    retry: admitted(() => owner.retry()),
    reset: () => owner.reset(),
    props: {
      onEndReached: admitted(() => owner.end()),
      onEndReachedThreshold: 0.6,
      scrollEventThrottle: listProps.scrollEventThrottle || 32,
      onScrollBeginDrag: event => { listProps.onScrollBeginDrag?.(event); if (options.current()) owner.interact(); },
      onLayout: event => { listProps.onLayout?.(event); if (options.current()) { viewportHeight.current = event.nativeEvent.layout.height; owner.layout(viewportHeight.current); } },
      onContentSizeChange: (width, height) => { listProps.onContentSizeChange?.(width, height); if (options.current()) owner.content(height, options.rowsCount); },
      onScroll: event => { listProps.onScroll?.(event); if (options.current()) owner.scroll(event.nativeEvent.contentOffset.y); },
    },
  };
}
