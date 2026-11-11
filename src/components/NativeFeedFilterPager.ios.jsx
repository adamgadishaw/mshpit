import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import NativeSwipeRail from "./NativeSwipeRail";
import NativeTabPage from "./NativeTabPages.ios";
import { adjacentSwipeTab } from "../domain/nativeGesturePolicy.mjs";
import { colors } from "../theme";
export const FEED_FILTERS = ["following", "local", "everyone", "news"];
const tabs = FEED_FILTERS;

// One current page and at most one deliberate neighboring preview. Visited
// Feed filters can stay mounted offscreen, with reads and actions paused, so a
// return swipe preserves the exact list, scroll position and pagination state.
export default function NativeFeedFilterPager({ active, onChange, swipeScope, swipeEnabled = true, isCurrentSwipeRoute, renderPage, loading, tapRevision = 0, retainVisited = false }) {
  const callbacks = useRef(null);
  callbacks.current = { onChange, isCurrentSwipeRoute };
  const visited = useRef(new Set());
  useLayoutEffect(() => { if (retainVisited && tabs.includes(active)) visited.current.add(active); else visited.current.clear(); }, [active, retainVisited]);
  const [candidate, setCandidate] = useState(null);
  const [ready, setReady] = useState(null);
  const [contentReady, setContentReady] = useState(null);
  const life = useRef(null), candidateRef = useRef(null);
  const owner = useMemo(() => ({ active, swipeScope, tapRevision }), [active, swipeScope, tapRevision]);
  useLayoutEffect(() => { life.current = owner; return () => { if (life.current === owner) life.current = null; }; }, [owner]);
  const current = () => life.current === owner && swipeEnabled && (!callbacks.current.isCurrentSwipeRoute || callbacks.current.isCurrentSwipeRoute());
  const pending = candidate?.owner === owner && swipeEnabled ? candidate : null;
  candidateRef.current = pending;
  const prepare = useCallback((direction, gesture) => {
    if (!current()) return;
    const target = adjacentSwipeTab(active, direction, tabs);
    if (!target) return;
    setCandidate(previous => previous?.owner === owner && previous.direction === direction && previous.gesture === gesture ? previous : { owner, direction, target, gesture });
  }, [owner, active, swipeEnabled]);
  const cancel = useCallback(() => {
    if (life.current !== owner) return;
    setCandidate(null); setReady(null); setContentReady(null);
  }, [owner]);
  const commit = useCallback(direction => {
    if (!current()) return false;
    const target = adjacentSwipeTab(active, direction, tabs);
    if (!target || !callbacks.current.onChange) return false;
    return callbacks.current.onChange(target, callbacks.current.isCurrentSwipeRoute) !== false;
  }, [owner, active, swipeEnabled]);
  const destinationReady = useCallback(() => {
    if (pending && candidateRef.current === pending && current()) setReady(pending);
  }, [pending, owner, swipeEnabled]);
  const destinationContentReady = useCallback(value => {
    if (pending && candidateRef.current === pending && current()) setContentReady(value ? pending : null);
  }, [pending, owner, swipeEnabled]);
  const index = tabs.indexOf(active);
  const readyDirection = useMemo(() => pending && ready === pending ? { direction: pending.direction, gesture: pending.gesture, contentReady: contentReady === pending } : null, [pending, ready, contentReady]);
  const visiblePages = [active, ...(pending ? [pending.target] : [])];
  const pages = retainVisited ? [...new Set([...visited.current, ...visiblePages])] : visiblePages;
  const renderPages = (x, width, origin) => pages.map(tab =>
    <NativeTabPage key={tab} tab={tab} active={active} parked={!visiblePages.includes(tab)} position={tabs.indexOf(tab)} origin={origin}
      x={x} width={width} loading={loading} renderPage={(key, preview) => renderPage(key, preview, key === active || key === pending?.target)} onReady={tab === pending?.target ? destinationReady : undefined} onContentReady={tab === pending?.target ? destinationContentReady : undefined} />);
  return <NativeSwipeRail page pageKey={active} pageIndex={index} enabled={swipeEnabled} onCommit={commit}
    canPrevious={index > 0} canNext={index < tabs.length - 1}
    onPageIntent={prepare} onPageCancel={cancel} pageReady={readyDirection}
    renderPages={renderPages} surfaceColor={colors.bg} testID="feed-filter-swipe-rail" />;
}
