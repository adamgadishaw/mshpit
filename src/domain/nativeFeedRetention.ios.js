import { retainNativeFeedForMedia as retainMedia } from "./nativeFeedMediaRetention.mjs";
import { iosBackGestureAllowed } from "./iosNavigationPolicy.mjs";

// Keep only the one existing Feed, not a second copy of any detail. Retain it
// through an uninterrupted readable chain so nested Back does not recreate a
// hidden base page. Protected/editor routes retain their unmount boundary.
export function retainNativeFeedForMedia(options) {
  if (retainMedia(options)) return true;
  const { platform, wide, accountId, tab, frames, hasOverlay } = options;
  return platform === "ios" && !wide && !!accountId && tab === "feed" && !!hasOverlay
    && Array.isArray(frames) && frames.length > 1 && !!frames[0] && Object.keys(frames[0]).length === 0
    && frames.slice(1).every(frame => iosBackGestureAllowed(frame)
      || !!frame?.photos && Object.keys(frame).every(key => key === "photos"));
}
