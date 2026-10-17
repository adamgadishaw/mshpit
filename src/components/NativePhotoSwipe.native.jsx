import { useMemo, useRef } from "react";
import { useWindowDimensions } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { ReduceMotion, useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { galleryGestureAction, galleryGestureAxis } from "../domain/mediaViewer.mjs";
import useReducedMotion from "../hooks/useReducedMotion";
import useScreenReaderEnabled from "../hooks/useScreenReaderEnabled";

// This detector wraps photos only. Native video controls and scrubbers are
// siblings, with no gallery/post/page pan detector above their touch region.
export default function NativePhotoSwipe({ children, count, onNext, onPrevious, onClose }) {
  const { width } = useWindowDimensions();
  const reduced = useReducedMotion(), reader = useScreenReaderEnabled();
  const callbacks = useRef({}); callbacks.current = { next: onNext, prev: onPrevious, close: onClose };
  const dispatch = useRef(action => callbacks.current[action]?.()).current;
  const startX = useSharedValue(0), startY = useSharedValue(0), axis = useSharedValue(null), x = useSharedValue(0), y = useSharedValue(0);
  const pan = useMemo(() => Gesture.Pan().enabled(!reader).maxPointers(1).manualActivation(true)
    .onTouchesDown((event, manager) => {
      const touch = event.allTouches[0]; axis.set(null);
      if (!touch || event.numberOfTouches !== 1 || touch.absoluteX < 24 || touch.absoluteX > width - 24) { manager.fail(); return; }
      startX.set(touch.absoluteX); startY.set(touch.absoluteY);
    })
    .onTouchesMove((event, manager) => {
      const touch = event.allTouches[0];
      if (!touch || event.numberOfTouches !== 1) { manager.fail(); return; }
      const dx = touch.absoluteX - startX.get(), dy = touch.absoluteY - startY.get();
      if (axis.get()) return;
      const next = galleryGestureAxis({ dx, dy });
      if (next === "x" && count < 2 || dy < -12 && Math.abs(dy) > Math.abs(dx) * 1.2) { manager.fail(); return; }
      if (next) { axis.set(next); manager.activate(); }
    })
    .onUpdate(event => {
      if (axis.get() === "x") x.set(event.absoluteX - startX.get());
      else if (axis.get() === "y") y.set(Math.max(0, event.absoluteY - startY.get()));
    })
    .onEnd((event, success) => {
      if (!success) return;
      const action = galleryGestureAction({ axis: axis.get(), dx: event.absoluteX - startX.get(), dy: event.absoluteY - startY.get(), count });
      if (action) {
        if (action === "next") x.set(72);
        if (action === "prev") x.set(-72);
        scheduleOnRN(dispatch, action);
      }
    })
    .onFinalize(() => {
      axis.set(null);
      const settle = { duration: 400, dampingRatio: 1, overshootClamping: true, reduceMotion: ReduceMotion.System };
      x.set(withSpring(0, settle)); y.set(withSpring(0, settle));
    }), [reader, width, count, dispatch, startX, startY, axis, x, y]);
  const motion = useAnimatedStyle(() => ({ flex: 1, transform: [{ translateX: reduced ? 0 : x.get() }, { translateY: reduced ? 0 : y.get() }] }));
  return <GestureDetector gesture={pan}><Animated.View style={motion}>{children}</Animated.View></GestureDetector>;
}
