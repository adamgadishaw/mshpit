import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, View, useWindowDimensions } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { ReduceMotion, useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import useReducedMotion from "../hooks/useReducedMotion";
import useScreenReaderEnabled, { getConfirmedScreenReaderEnabled, subscribeConfirmedScreenReaderEnabled } from "../hooks/useScreenReaderEnabled";
import { iosBackSwipeCommits } from "../domain/iosNavigationPolicy.mjs";
import { colors } from "../theme";

export default function IosDetailNavigation({ children, enabled, onBack, isCurrentRoute, presentationKey, presentationScope }) {
  const { width } = useWindowDimensions();
  const reader = useScreenReaderEnabled(), reduced = useReducedMotion();
  const livePermission = useRef(null);
  const [permission, setPermission] = useState(null);
  const revision = useRef(0);
  const generation = useSharedValue(0), touching = useSharedValue(false);
  const x = useSharedValue(0), startX = useSharedValue(0), startY = useSharedValue(0);
  const ownerKey = presentationKey ?? onBack;
  useLayoutEffect(() => {
    // Effect setup is a new presentation even when Suspense reconnects the
    // same memoized component. Retired queued work never regains ownership.
    let mounted = true;
    const revoke = () => {
      generation.set(++revision.current);
      touching.set(false);
      x.set(0);
      if (livePermission.current) livePermission.current.active = false;
      livePermission.current = null;
    };
    const renew = () => {
      if (!mounted) return;
      revoke();
      const next = { generation: revision.current, active: !!enabled && !reader && getConfirmedScreenReaderEnabled() === false };
      livePermission.current = next;
      setPermission(next);
    };
    const unsubscribe = subscribeConfirmedScreenReaderEnabled(renew);
    renew();
    return () => { mounted = false; revoke(); unsubscribe(); };
  }, [enabled, reader, ownerKey, presentationScope, width]);
  const back = useMemo(() => () => {
    const current = () => permission?.active && livePermission.current === permission
      && getConfirmedScreenReaderEnabled() === false && (!isCurrentRoute || isCurrentRoute());
    if (!current()) return;
    // Keep the same fence through Root's potentially deferred close guard.
    onBack?.(undefined, current);
  }, [permission, onBack, isCurrentRoute]);
  const ownedGeneration = permission?.generation;
  const gesture = useMemo(() => Gesture.Pan().enabled(!!enabled && !reader).maxPointers(1)
    .activeOffsetX(12).failOffsetY([-12, 12])
    .onTouchesDown((event, manager) => {
      if (generation.get() !== ownedGeneration) { manager.fail(); return; }
      const touch = event.allTouches[0];
      if (!touch || event.numberOfTouches !== 1) { touching.set(false); manager.fail(); return; }
      touching.set(true);
      startX.set(touch.absoluteX); startY.set(touch.absoluteY);
    })
    .onUpdate(event => { if (generation.get() !== ownedGeneration || !touching.get()) return; x.set(Math.max(0, Math.min(width * 0.42, event.absoluteX - startX.get()))); })
    .onEnd((event, success) => {
      if (generation.get() !== ownedGeneration || !touching.get()) return;
      touching.set(false);
      if (iosBackSwipeCommits({ dx: event.absoluteX - startX.get(), dy: event.absoluteY - startY.get(), width, canceled: !success })) scheduleOnRN(back);
    })
    .onFinalize(() => { if (generation.get() !== ownedGeneration) return; touching.set(false); x.set(withSpring(0, { duration: 260, dampingRatio: 1, overshootClamping: true, reduceMotion: ReduceMotion.System })); }), [enabled, reader, width, x, startX, startY, back, generation, touching, ownedGeneration]);
  const animated = useAnimatedStyle(() => ({ transform: [{ translateX: reduced ? 0 : x.get() }] }));
  return <View style={styles.fill}>
    <Animated.View style={[styles.fill, animated]}>{children}</Animated.View>
    {enabled && !reader ? <GestureDetector gesture={gesture}><View style={styles.edge} testID="ios-detail-back-edge" accessible={false} accessibilityElementsHidden /></GestureDetector> : null}
  </View>;
}
const styles = StyleSheet.create({ fill: { flex: 1, minHeight: 0, backgroundColor: colors.bg }, edge: { position: "absolute", left: 0, top: 52, bottom: 0, width: 20 } });
