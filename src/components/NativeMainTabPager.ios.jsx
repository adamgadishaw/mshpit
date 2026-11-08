import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import NativeSwipeRail from "./NativeSwipeRail";
import NativeTabPage from "./NativeTabPages.ios";
import { adjacentSwipeTab } from "../domain/nativeGesturePolicy.mjs";
import { colors } from "../theme";
const tabs = ["feed", "search", "discover", "you"];

// The resting tree owns exactly one page. A deliberate horizontal gesture may
// borrow one adjacent page; cancel releases it and commit promotes that very
// instance. There is no retained-page cache or idle neighbor preloading.
export default function NativeMainTabPager({ active, onChange, swipeScope, swipeEnabled = true, isCurrentSwipeRoute, renderPage, loading, member = false }) {
  const callbacks = useRef(null);
  callbacks.current = { onChange, isCurrentSwipeRoute };
  const [candidate, setCandidate] = useState(null);
  const [ready, setReady] = useState(null);
  const [contentReady, setContentReady] = useState(null);
  const life = useRef(null), candidateRef = useRef(null);
  const owner = useMemo(() => ({ active, swipeScope }), [active, swipeScope]);
  useLayoutEffect(() => { life.current = owner; return () => { if (life.current === owner) life.current = null; }; }, [owner]);
  const current = () => life.current === owner && swipeEnabled && (!callbacks.current.isCurrentSwipeRoute || callbacks.current.isCurrentSwipeRoute());
  const pending = candidate?.owner === owner && swipeEnabled ? candidate : null;
  candidateRef.current = pending;
  const prepare = useCallback((direction, gesture) => {
    if (!current()) return;
    const target = adjacentSwipeTab(active, direction, tabs);
    if (!target || (!member && (target === "feed" || target === "you"))) return;
    setCandidate(previous => previous?.owner === owner && previous.direction === direction && previous.gesture === gesture ? previous : { owner, direction, target, gesture });
  }, [owner, active, swipeEnabled, member]);
  const cancel = useCallback(() => {
    if (life.current !== owner) return;
    setCandidate(null); setReady(null); setContentReady(null);
  }, [owner]);
  const commit = useCallback(direction => {
    if (!current()) return;
    const target = adjacentSwipeTab(active, direction, tabs);
    if (target) callbacks.current.onChange?.(target, callbacks.current.isCurrentSwipeRoute);
  }, [owner, active, swipeEnabled]);
  const destinationReady = useCallback(() => {
    if (pending && candidateRef.current === pending && current()) setReady(pending);
  }, [pending, owner, swipeEnabled]);
  const destinationContentReady = useCallback(value => {
    if (pending && candidateRef.current === pending && current()) setContentReady(value ? pending : null);
  }, [pending, owner, swipeEnabled]);
  const index = tabs.indexOf(active);
  const readyDirection = useMemo(() => pending && ready === pending ? { direction: pending.direction, gesture: pending.gesture, contentReady: contentReady === pending } : null, [pending, ready, contentReady]);
  const renderPages = (x, width) => [active, ...(pending ? [pending.target] : [])].map(tab =>
    <NativeTabPage key={tab} tab={tab} active={active} offset={tabs.indexOf(tab) - index}
      x={x} width={width} loading={loading} renderPage={renderPage} onReady={destinationReady} onContentReady={destinationContentReady} />);
  return <NativeSwipeRail page pageKey={active} enabled={swipeEnabled} onCommit={commit}
    canPrevious={index > 0} canNext={index < tabs.length - 1}
    previewPrevious={member || tabs[index - 1] !== "feed"} previewNext={member || tabs[index + 1] !== "you"}
    onPageIntent={prepare} onPageCancel={cancel} pageReady={readyDirection}
    renderPages={renderPages} surfaceColor={colors.bg} testID="main-tab-swipe-rail" />;
}
