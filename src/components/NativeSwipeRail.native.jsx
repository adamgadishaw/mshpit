import { useMemo, useRef, useState } from "react";
import { StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { ReduceMotion, useAnimatedReaction, useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { colors } from "../theme";
import useReducedMotion from "../hooks/useReducedMotion";
import useScreenReaderEnabled from "../hooks/useScreenReaderEnabled";
import { releasedSwipe, swipeAxis, swipeThreshold } from "../domain/nativeGesturePolicy.mjs";

// Only the visible action/tab rail owns this gesture. Media and post text are
// siblings outside its detector; platform back edges are reserved explicitly.
export default function NativeSwipeRail({ children, onCommit, positive = "Like", negative = "Repost", hint, enabled = true, testID }) {
  const { width: screenWidth } = useWindowDimensions();
  const reduced = useReducedMotion(), screenReader = useScreenReaderEnabled();
  const [armed, setArmed] = useState(null);
  const callback = useRef(onCommit); callback.current = onCommit;
  const commit = useRef(direction => callback.current?.(direction)).current;
  const startX = useSharedValue(0), startY = useSharedValue(0), width = useSharedValue(screenWidth - 32), x = useSharedValue(0);
  const pan = useMemo(() => Gesture.Pan().enabled(enabled && !screenReader).maxPointers(1).manualActivation(true)
    .onTouchesDown((event, manager) => {
      const touch = event.allTouches[0];
      if (!touch || event.numberOfTouches !== 1 || touch.absoluteX < 24 || touch.absoluteX > screenWidth - 24) { manager.fail(); return; }
      startX.set(touch.absoluteX); startY.set(touch.absoluteY);
    })
    .onTouchesMove((event, manager) => {
      const touch = event.allTouches[0];
      if (!touch || event.numberOfTouches !== 1) { manager.fail(); return; }
      const axis = swipeAxis(touch.absoluteX - startX.get(), touch.absoluteY - startY.get());
      if (axis === "vertical") manager.fail();
      else if (axis === "horizontal") manager.activate();
    })
    .onUpdate(event => { x.set(Math.max(-128, Math.min(128, event.absoluteX - startX.get()))); })
    .onEnd((event, success) => {
      const direction = releasedSwipe({ dx: event.absoluteX - startX.get(), dy: event.absoluteY - startY.get(), width: width.get(), startX: startX.get(), screenWidth, canceled: !success });
      if (direction) scheduleOnRN(commit, direction);
    })
    .onFinalize(() => { x.set(withSpring(0, { duration: 400, dampingRatio: 1, overshootClamping: true, reduceMotion: ReduceMotion.System })); }),
  [enabled, screenReader, screenWidth, startX, startY, width, x, commit]);
  useAnimatedReaction(
    () => Math.abs(x.get()) >= swipeThreshold(width.get()) ? (x.get() > 0 ? "positive" : "negative") : null,
    (next, previous) => { if (next !== previous) scheduleOnRN(setArmed, next); },
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
      <GestureDetector gesture={pan}><Animated.View style={[styles.content, contentStyle]}>{children}</Animated.View></GestureDetector>
    </View>
  </View>;
}
const styles = StyleSheet.create({
  rail: { minWidth: 0 }, track: { overflow: "hidden", minHeight: 48, justifyContent: "center" },
  content: { backgroundColor: colors.bgElev, minHeight: 48 },
  feedback: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 12 },
  hint: { color: colors.textDim, fontSize: 13, lineHeight: 20, paddingVertical: 5 },
  arm: { color: colors.amber, fontSize: 14, fontWeight: "600", maxWidth: 108 }, right: { textAlign: "right", color: colors.good },
});
