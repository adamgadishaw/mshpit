import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { useWindowDimensions } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { ReduceMotion, useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { galleryGestureAction, galleryGestureAxis } from "../domain/mediaViewer.mjs";
import useReducedMotion from "../hooks/useReducedMotion";
import useScreenReaderEnabled, { getConfirmedScreenReaderEnabled, subscribeConfirmedScreenReaderEnabled } from "../hooks/useScreenReaderEnabled";

// Images only: video controls remain outside the detector. PhotoViewer keys
// this owner to the displayed item; Root supplies the current gallery scope.
export default function NativePhotoSwipe({ children, count, onNext, onPrevious, onClose, presentation, isCurrentRoute }) {
  const { width } = useWindowDimensions();
  const reduced = useReducedMotion(), reader = useScreenReaderEnabled();
  const startX = useSharedValue(0), startY = useSharedValue(0), axis = useSharedValue(null), x = useSharedValue(0), y = useSharedValue(0);
  const epoch = useSharedValue(0), touching = useSharedValue(false);
  const live = useRef(null), sequence = useRef(0);
  const [owner, setOwner] = useState(null);
  const [readerRevision, setReaderRevision] = useState(0);
  // Reconnects (including StrictMode/Suspense) and permission/presentation
  // changes retire both UI worklets and already queued RN callbacks. Capture
  // the callbacks belonging to this item, never retarget a queued gesture.
  useLayoutEffect(() => {
    const next = { epoch: ++sequence.current, allowed: !reader && getConfirmedScreenReaderEnabled() !== true, isCurrentRoute, next: onNext, prev: onPrevious, close: onClose };
    live.current = next; epoch.set(next.epoch); touching.set(false);
    axis.set(null); x.set(0); y.set(0); setOwner(next);
    const retire = () => {
      if (live.current !== next) return;
      live.current = null; epoch.set(0); touching.set(false);
      axis.set(null); x.set(0); y.set(0);
    };
    // Native permission events can round-trip inside one React batch. Retire
    // synchronously on known-on, then publish a fresh owner even if the final
    // boolean snapshot is unchanged. A retired listener cannot revoke a peer.
    const unsubscribe = subscribeConfirmedScreenReaderEnabled(() => {
      if (live.current !== next || getConfirmedScreenReaderEnabled() !== true) return;
      retire(); setReaderRevision(value => value + 1);
    });
    return () => { unsubscribe(); retire(); };
    // Callback identity changes on unrelated viewer renders; the owning item
    // is a keyed child, and presentation changes whenever Root retires it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reader, readerRevision, width, count, presentation, epoch, touching, axis, x, y]);
  const generation = owner?.allowed ? owner.epoch : 0;
  const dispatch = useMemo(() => action => {
    if (!owner?.allowed || live.current !== owner || getConfirmedScreenReaderEnabled() === true || owner.isCurrentRoute?.() === false) return;
    owner[action]?.();
  }, [owner]);
  const pan = useMemo(() => Gesture.Pan().enabled(!reader && !!owner?.allowed).maxPointers(1).manualActivation(true)
    .onTouchesDown((event, manager) => {
      if (!generation || epoch.get() !== generation) { manager.fail(); return; }
      touching.set(false); axis.set(null);
      const touch = event.allTouches[0];
      if (!touch || event.numberOfTouches !== 1 || touch.absoluteX < 24 || touch.absoluteX > width - 24) { manager.fail(); return; }
      startX.set(touch.absoluteX); startY.set(touch.absoluteY); touching.set(true);
    })
    .onTouchesMove((event, manager) => {
      if (!generation || epoch.get() !== generation || !touching.get()) { manager.fail(); return; }
      const touch = event.allTouches[0];
      if (!touch || event.numberOfTouches !== 1) { touching.set(false); manager.fail(); return; }
      const dx = touch.absoluteX - startX.get(), dy = touch.absoluteY - startY.get();
      if (axis.get()) return;
      const next = galleryGestureAxis({ dx, dy });
      if (next === "x" && count < 2 || dy < -12 && Math.abs(dy) > Math.abs(dx) * 1.2) { touching.set(false); manager.fail(); return; }
      if (next) { axis.set(next); manager.activate(); }
    })
    .onUpdate(event => {
      if (!generation || epoch.get() !== generation || !touching.get()) return;
      if (axis.get() === "x") x.set(event.absoluteX - startX.get());
      else if (axis.get() === "y") y.set(Math.max(0, event.absoluteY - startY.get()));
    })
    .onEnd((event, success) => {
      if (!generation || epoch.get() !== generation || !touching.get()) return;
      touching.set(false);
      if (!success) return;
      const action = galleryGestureAction({ axis: axis.get(), dx: event.absoluteX - startX.get(), dy: event.absoluteY - startY.get(), count });
      if (action) {
        if (action === "next") x.set(72);
        if (action === "prev") x.set(-72);
        scheduleOnRN(dispatch, action);
      }
    })
    .onFinalize(() => {
      if (!generation || epoch.get() !== generation) return;
      touching.set(false); axis.set(null);
      const settle = { duration: 400, dampingRatio: 1, overshootClamping: true, reduceMotion: ReduceMotion.System };
      x.set(withSpring(0, settle)); y.set(withSpring(0, settle));
    }), [reader, width, count, owner, generation, dispatch, epoch, touching, startX, startY, axis, x, y]);
  const motion = useAnimatedStyle(() => ({ flex: 1, transform: [{ translateX: reduced ? 0 : x.get() }, { translateY: reduced ? 0 : y.get() }] }));
  return <GestureDetector gesture={pan}><Animated.View style={motion}>{children}</Animated.View></GestureDetector>;
}
