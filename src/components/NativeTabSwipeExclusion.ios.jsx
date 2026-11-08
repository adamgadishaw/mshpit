import { useContext, useMemo } from "react";
import { View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { NativeTabSwipeContext } from "./nativeTabSwipeContext.mjs";

// Observe on the UI thread without ever activating/capturing child gestures.
// Keep observing until release so an edge-rejected parent cannot leave a stale
// exclusion behind. Canceling any observation also retires this touch's swipe.
export default function NativeTabSwipeExclusion({ children, style, asChild = false }) {
  const scope = useContext(NativeTabSwipeContext);
  const observer = useMemo(() => {
    if (!scope) return null;
    const { excluded, touching, epoch, generation, gesture } = scope;
    return Gesture.Manual().simultaneousWithExternalGesture(gesture)
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
  }, [scope]);
  if (!observer) return children;
  if (asChild) return <GestureDetector gesture={observer}>{children}</GestureDetector>;
  return <GestureDetector gesture={observer}><View collapsable={false} style={style}>{children}</View></GestureDetector>;
}
