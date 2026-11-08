// The discovery rail is its own virtualized row, never part of a concert post.
// It deliberately has no post id, so media/view/dwell qualification ignores it.
export const IOS_FEED_DISCOVERY_SLOT = Object.freeze({ kind: "ios-people-discovery" });
const POSTS_BEFORE_DISCOVERY = 3;

export function feedDiscoveryPlacement(rows, { platform, enabled = false, newsTab = false } = {}) {
  if (platform !== "ios") return { rows, placement: enabled ? "header" : "hidden", index: -1 };
  if (!enabled || newsTab) return { rows, placement: "hidden", index: -1 };
  if (!rows.length) return { rows, placement: "header", index: -1 };
  const index = Math.min(POSTS_BEFORE_DISCOVERY, rows.length);
  return { rows: [...rows.slice(0, index), IOS_FEED_DISCOVERY_SLOT, ...rows.slice(index)], placement: "inline", index };
}

// Analytics and open callbacks retain the original post positions despite the
// inserted non-post row. An inset itself must never qualify as a post view.
export function feedPostPosition(index, discoveryIndex = -1) {
  if (!Number.isSafeInteger(index) || index < 0) return 0;
  return discoveryIndex >= 0 && index > discoveryIndex ? index - 1 : index;
}
