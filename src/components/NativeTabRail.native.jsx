import NativeSwipeRail from "./NativeSwipeRail";
import { adjacentSwipeTab } from "../domain/nativeGesturePolicy.mjs";
const tabs = ["feed", "search", "discover", "you"];
export default function NativeTabRail({ children, active, onChange }) {
  return <NativeSwipeRail positive="previous page" negative="next page" testID="main-tab-swipe-rail"
    onCommit={direction => { const next = adjacentSwipeTab(active, direction, tabs); if (next) onChange(next); }}>
    {children}
  </NativeSwipeRail>;
}
