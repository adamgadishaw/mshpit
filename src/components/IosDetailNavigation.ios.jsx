import { useLayoutEffect, useMemo, useRef } from "react";
import { StyleSheet, View, useWindowDimensions } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { ReduceMotion, useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import useReducedMotion from "../hooks/useReducedMotion";
import useScreenReaderEnabled from "../hooks/useScreenReaderEnabled";
import { iosBackSwipeCommits } from "../domain/iosNavigationPolicy.mjs";
import { colors } from "../theme";

export default function IosDetailNavigation({ children, enabled, onBack }) {
  const { width } = useWindowDimensions();
  const reader = useScreenReaderEnabled(), reduced = useReducedMotion();
  const callback = useRef(onBack), livePermission = useRef(null);
  // A queued RN dispatch belongs to this mounted permission interval, not the
  // next screen or a later enabled/VoiceOver-off interval with the same values.
  const permission = useMemo(() => ({ allowed: !!enabled && !reader }), [enabled, reader]);
  useLayoutEffect(() => { callback.current = onBack; }, [onBack]);
  useLayoutEffect(() => {
    livePermission.current = permission;
    return () => { livePermission.current = null; };
  }, [permission]);
  const back = useMemo(() => () => {
    if (permission.allowed && livePermission.current === permission) callback.current?.();
  }, [permission]);
  const x = useSharedValue(0), startX = useSharedValue(0), startY = useSharedValue(0);
  const gesture = useMemo(() => Gesture.Pan().enabled(!!enabled && !reader).maxPointers(1)
    .activeOffsetX(12).failOffsetY([-12, 12])
    .onTouchesDown((event, manager) => {
      const touch = event.allTouches[0];
      if (!touch || event.numberOfTouches !== 1) { manager.fail(); return; }
      startX.set(touch.absoluteX); startY.set(touch.absoluteY);
    })
    .onUpdate(event => { x.set(Math.max(0, Math.min(width * 0.42, event.absoluteX - startX.get()))); })
    .onEnd((event, success) => {
      if (iosBackSwipeCommits({ dx: event.absoluteX - startX.get(), dy: event.absoluteY - startY.get(), width, canceled: !success })) scheduleOnRN(back);
    })
    .onFinalize(() => { x.set(withSpring(0, { duration: 260, dampingRatio: 1, overshootClamping: true, reduceMotion: ReduceMotion.System })); }), [enabled, reader, width, x, startX, startY, back]);
  const animated = useAnimatedStyle(() => ({ transform: [{ translateX: reduced ? 0 : x.get() }] }));
  return <View style={styles.fill}>
    <Animated.View style={[styles.fill, animated]}>{children}</Animated.View>
    {enabled && !reader ? <GestureDetector gesture={gesture}><View style={styles.edge} testID="ios-detail-back-edge" accessible={false} accessibilityElementsHidden /></GestureDetector> : null}
  </View>;
}
const styles = StyleSheet.create({ fill: { flex: 1, minHeight: 0, backgroundColor: colors.bg }, edge: { position: "absolute", left: 0, top: 52, bottom: 0, width: 20 } });
