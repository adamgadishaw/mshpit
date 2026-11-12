import { useContext, useMemo } from "react";
import { View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { NativeTabSwipeContext } from "./nativeTabSwipeContext.mjs";

// Observe on the UI thread without ever activating/capturing child gestures.
// Keep observing until release so an edge-rejected parent cannot leave a stale
// exclusion behind. Canceling any observation also retires this touch's swipe.
export function useNativeTabSwipeExclusionGesture({ enabled = true, nativeGesture = null, ancestorGesture = null } = {}) {
  const scope = useContext(NativeTabSwipeContext);
  return useMemo(() => {
    if (!scope || !enabled) return null;
    const { excluded, touching, epoch, generation, gesture } = scope;
    return Gesture.Manual().cancelsTouchesInView(false)
      .simultaneousWithExternalGesture(gesture, ...[nativeGesture, ancestorGesture].filter(Boolean))
      .onTouchesDown((_event, manager) => {
        if (epoch.get() !== generation) { manager.fail(); return; }
        excluded.set(true); touching.set(false); manager.begin();
      })
      .onTouchesMove(() => { if (epoch.get() === generation) touching.set(false); })
      .onTouchesUp((_event, manager) => {
        if (epoch.get() === generation) { touching.set(false); excluded.set(false); }
        manager.fail();
      })
      .onTouchesCancelled((_event, manager) => {
        if (epoch.get() === generation) { touching.set(false); excluded.set(false); }
        manager.fail();
      });
  }, [scope, enabled, nativeGesture, ancestorGesture]);
}

export default function NativeTabSwipeExclusion({ children, style, asChild = false }) {
  const observer = useNativeTabSwipeExclusionGesture();
  if (!observer) return children;
  if (asChild) return <GestureDetector gesture={observer}>{children}</GestureDetector>;
  return <GestureDetector gesture={observer}><View collapsable={false} style={style}>{children}</View></GestureDetector>;
}
