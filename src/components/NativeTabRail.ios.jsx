import { useLayoutEffect, useMemo, useRef } from "react";
import { colors } from "../theme";
import NativeSwipeRail from "./NativeSwipeRail";
import { adjacentSwipeTab } from "../domain/nativeGesturePolicy.mjs";
const tabs = ["feed", "search", "discover", "you"];
export default function NativeTabRail({ children, active, onChange, swipeScope, swipeEnabled = true, isCurrentSwipeRoute }) {
  const callback = useRef({ onChange, isCurrentSwipeRoute });
  useLayoutEffect(() => { callback.current = { onChange, isCurrentSwipeRoute }; }, [onChange, isCurrentSwipeRoute]);
  // Same-tab renders keep a valid swipe. Changing tabs retires the whole rail,
  // so a queued Feed swipe can never become a Search-to-Discover action.
  const commit = useMemo(() => direction => {
    const next = adjacentSwipeTab(active, direction, tabs);
    const { onChange: change, isCurrentSwipeRoute: current } = callback.current;
    if (next && (!current || current())) change?.(next, current);
  }, [active, swipeScope]);
  return <NativeSwipeRail key={active} enabled={swipeEnabled} positive="previous page" negative="next page" testID="main-tab-swipe-rail" surfaceColor={colors.bg} onCommit={commit}>
    {children}
  </NativeSwipeRail>;
}
