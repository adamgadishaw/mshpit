import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import NativeSwipeRail from "./NativeSwipeRail";
import NativeTabPage from "./NativeTabPages.ios";
import { adjacentSwipeTab } from "../domain/nativeGesturePolicy.mjs";
import { colors } from "../theme";
import { DISCOVER_PROGRAMME_SECTIONS } from "../domain/discoverProgramme.mjs";
import useNativeTabPreview from "../hooks/useNativeTabPreview";
import { NativeTabPreviewContext } from "./nativeTabPreviewContext.mjs";
const tabs = DISCOVER_PROGRAMME_SECTIONS.map(section => section.key);

// One current page and at most one deliberate neighboring preview. Cancellation
// keeps the source; commit promotes the exact incoming instance without a reload.
export default function NativeDiscoverSectionPager({ active, onChange, swipeScope, swipeEnabled = true, isCurrentSwipeRoute, renderPage, renderNavigation, scrollNavigation = false, loading, tapRevision = 0 }) {
  const inheritedPreview = useNativeTabPreview();
  const callbacks = useRef(null);
  callbacks.current = { onChange, isCurrentSwipeRoute };
  const [candidate, setCandidate] = useState(null);
  const [ready, setReady] = useState(null);
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
    setCandidate(null); setReady(null);
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
  const index = tabs.indexOf(active);
  const readyDirection = useMemo(() => pending && ready === pending ? { direction: pending.direction, gesture: pending.gesture } : null, [pending, ready]);
  // A readiness update must not rerender the unchanged outgoing Discover tree.
  const renderSection = useCallback((key, preview) => <NativeTabPreviewContext.Provider value={inheritedPreview || preview}>{renderPage(key, inheritedPreview || preview)}</NativeTabPreviewContext.Provider>, [inheritedPreview, renderPage]);
  const renderPages = (x, width, origin) => [active, ...(pending ? [pending.target] : [])].map(tab =>
    <DiscoverPage key={tab} tab={tab} active={active} position={tabs.indexOf(tab)} origin={origin}
      x={x} width={width} loading={loading} renderPage={scrollNavigation ? renderPage : renderSection}
      renderNavigation={scrollNavigation ? renderNavigation : undefined} onReady={tab === pending?.target ? destinationReady : undefined} />);
  return <NativeSwipeRail page pageKey={active} pageIndex={index} enabled={swipeEnabled} onCommit={commit}
    canPrevious={index > 0} canNext={index < tabs.length - 1}
    onPageIntent={prepare} onPageCancel={cancel} pageReady={readyDirection}
    renderPages={renderPages} renderNavigation={scrollNavigation ? undefined : renderNavigation} surfaceColor={colors.bg} testID="discover-section-swipe-rail" />;
}

function DiscoverPage({ renderPage, renderNavigation, x, width, origin, ...props }) {
  const render = useCallback((key, preview) => renderPage(key, preview, renderNavigation?.(x, width, origin)),
    [renderPage, renderNavigation, x, width, origin]);
  return <NativeTabPage {...props} x={x} width={width} origin={origin} renderPage={render} />;
}
