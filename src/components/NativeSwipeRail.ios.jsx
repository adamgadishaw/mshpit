import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { ReduceMotion, useAnimatedReaction, useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { colors } from "../theme";
import useReducedMotion from "../hooks/useReducedMotion";
import useScreenReaderEnabled, { getConfirmedScreenReaderEnabled, subscribeConfirmedScreenReaderEnabled } from "../hooks/useScreenReaderEnabled";
import { releasedSwipe, swipeAxis, swipeThreshold } from "../domain/nativeGesturePolicy.mjs";

// Only the visible action/tab rail owns this gesture. Media and post text are
// siblings outside its detector; platform back edges are reserved explicitly.
export default function NativeSwipeRail({ children, onCommit, positive = "Like", negative = "Repost", hint, enabled = true, testID, surfaceColor = colors.surface }) {
  const { width: screenWidth } = useWindowDimensions();
  const reduced = useReducedMotion(), screenReader = useScreenReaderEnabled();
  const [armed, setArmed] = useState(null);
  const startX = useSharedValue(0), startY = useSharedValue(0), width = useSharedValue(screenWidth - 32), x = useSharedValue(0);
  const epoch = useSharedValue(0), touching = useSharedValue(false);
  const live = useRef(null), sequence = useRef(0);
  const [owner, setOwner] = useState(null);
  const [permissionRevision, setPermissionRevision] = useState(0);
  // Publish a fresh owner after every layout reconnect, not just each render.
  // Captured worklets and RN dispatches from a retired presentation stay inert.
  // A replaced onCommit is a different action; never retarget its queued swipe.
  useLayoutEffect(() => {
    const next = { epoch: ++sequence.current, allowed: enabled && !screenReader && getConfirmedScreenReaderEnabled() !== true, onCommit };
    live.current = next;
    epoch.set(next.epoch); touching.set(false); x.set(0); setArmed(null);
    setOwner(next);
    // Native permission events can round trip inside one React batch. Retire
    // immediately and publish a new interval even if the final boolean matches.
    const unsubscribe = subscribeConfirmedScreenReaderEnabled(() => {
      if (live.current !== next || getConfirmedScreenReaderEnabled() !== true) return;
      live.current = null;
      epoch.set(0); touching.set(false); x.set(0);
      setPermissionRevision(revision => revision + 1);
    });
    return () => {
      unsubscribe();
      if (live.current !== next) return;
      live.current = null;
      epoch.set(0); touching.set(false); x.set(0);
    };
  }, [enabled, screenReader, permissionRevision, onCommit, screenWidth, epoch, touching, x]);
  const generation = owner?.allowed ? owner.epoch : 0;
  const commit = useMemo(() => direction => {
    if (owner?.allowed && live.current === owner) owner.onCommit?.(direction);
  }, [owner]);
  const showArmed = useMemo(() => value => {
    if (owner?.allowed && live.current === owner) setArmed(value);
  }, [owner]);
  const pan = useMemo(() => Gesture.Pan().enabled(enabled && !screenReader && !!owner?.allowed).maxPointers(1).manualActivation(true)
    .onTouchesDown((event, manager) => {
      if (!generation || epoch.get() !== generation) { manager.fail(); return; }
      touching.set(false);
      const touch = event.allTouches[0];
      if (!touch || event.numberOfTouches !== 1 || touch.absoluteX < 24 || touch.absoluteX > screenWidth - 24) { manager.fail(); return; }
      startX.set(touch.absoluteX); startY.set(touch.absoluteY); touching.set(true);
    })
    .onTouchesMove((event, manager) => {
      if (!generation || epoch.get() !== generation || !touching.get()) { manager.fail(); return; }
      const touch = event.allTouches[0];
      if (!touch || event.numberOfTouches !== 1) { touching.set(false); manager.fail(); return; }
      const axis = swipeAxis(touch.absoluteX - startX.get(), touch.absoluteY - startY.get());
      if (axis === "vertical") { touching.set(false); manager.fail(); }
      else if (axis === "horizontal") manager.activate();
    })
    .onUpdate(event => { if (!generation || epoch.get() !== generation || !touching.get()) return; x.set(Math.max(-128, Math.min(128, event.absoluteX - startX.get()))); })
    .onEnd((event, success) => {
      if (!generation || epoch.get() !== generation || !touching.get()) return;
      touching.set(false);
      const direction = releasedSwipe({ dx: event.absoluteX - startX.get(), dy: event.absoluteY - startY.get(), width: width.get(), startX: startX.get(), screenWidth, canceled: !success });
      if (direction) scheduleOnRN(commit, direction);
    })
    .onFinalize(() => { if (!generation || epoch.get() !== generation) return; touching.set(false); x.set(withSpring(0, { duration: 400, dampingRatio: 1, overshootClamping: true, reduceMotion: ReduceMotion.System })); }),
  [enabled, screenReader, screenWidth, startX, startY, width, x, epoch, touching, generation, owner, commit]);
  useAnimatedReaction(
    () => Math.abs(x.get()) >= swipeThreshold(width.get()) ? (x.get() > 0 ? "positive" : "negative") : null,
    (next, previous) => { if (hint && next !== previous) scheduleOnRN(showArmed, next); },
  );
  const contentStyle = useAnimatedStyle(() => ({ transform: [{ translateX: reduced ? 0 : x.get() }] }));
  const positiveStyle = useAnimatedStyle(() => ({ opacity: x.get() >= swipeThreshold(width.get()) ? 1 : 0 }));
  const negativeStyle = useAnimatedStyle(() => ({ opacity: x.get() <= -swipeThreshold(width.get()) ? 1 : 0 }));
  return <View testID={testID} onLayout={event => width.set(event.nativeEvent.layout.width)} style={styles.rail}>
    {hint ? <Text style={styles.hint}>{armed ? `Release to ${(armed === "positive" ? positive : negative).toLowerCase()}` : hint}</Text> : null}
    <View style={styles.track}>
      <View pointerEvents="none" style={styles.feedback} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Animated.Text style={[styles.arm, positiveStyle]}>Release to {positive.toLowerCase()}</Animated.Text>
        <Animated.Text style={[styles.arm, styles.right, negativeStyle]}>Release to {negative.toLowerCase()}</Animated.Text>
      </View>
      <GestureDetector gesture={pan}><Animated.View style={[styles.content, { backgroundColor: surfaceColor }, contentStyle]}>{children}</Animated.View></GestureDetector>
    </View>
  </View>;
}
const styles = StyleSheet.create({
  rail: { minWidth: 0 }, track: { overflow: "hidden", minHeight: 48, justifyContent: "center" },
  content: { minHeight: 48 },
  feedback: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 12 },
  hint: { color: colors.textDim, fontSize: 13, lineHeight: 20, paddingVertical: 5 },
  arm: { color: colors.amber, fontSize: 14, fontWeight: "600", maxWidth: 108 }, right: { textAlign: "right", color: colors.good },
});
