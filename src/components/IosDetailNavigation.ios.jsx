import { useContext, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AppState, StyleSheet, View, useWindowDimensions } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { ReduceMotion, cancelAnimation, useAnimatedStyle, useSharedValue, withSpring, withTiming } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import useReducedMotion from "../hooks/useReducedMotion";
import useScreenReaderEnabled, { getConfirmedScreenReaderEnabled, subscribeConfirmedScreenReaderEnabled } from "../hooks/useScreenReaderEnabled";
import { iosBackSwipeCommits } from "../domain/iosNavigationPolicy.mjs";
import { IOSDetailBackContext } from "../hooks/useIOSDetailBackBlock";
import { NativeFeedBackContext } from "./nativeFeedBackContext.mjs";
import { colors } from "../theme";

export default function IosDetailNavigation({ children, enabled, onBack, isCurrentRoute, presentationKey, presentationScope }) {
  const { width } = useWindowDimensions();
  const revealPrevious = useContext(NativeFeedBackContext);
  const appActive = useRef(AppState?.currentState === "active");
  const reader = useScreenReaderEnabled(), reduced = useReducedMotion();
  const livePermission = useRef(null);
  const [permission, setPermission] = useState(null);
  const revision = useRef(0);
  const generation = useSharedValue(0), touching = useSharedValue(false);
  const x = useSharedValue(0), startX = useSharedValue(0), startY = useSharedValue(0);
  const settling = useSharedValue(false);
  const blockers = useRef(new Set());
  const [blockRevision, setBlockRevision] = useState(0);
  const blockScope = useMemo(() => ({
    add(token) {
      blockers.current.add(token);
      // Revoke immediately, before the state update: a queued native release
      // must not outrun a newly opened inline editor.
      generation.set(++revision.current);
      touching.set(false); settling.set(false); cancelAnimation(x); x.set(0);
      if (livePermission.current) livePermission.current.active = false;
      setBlockRevision(value => value + 1);
    },
    remove(token) {
      if (blockers.current.delete(token)) setBlockRevision(value => value + 1);
    },
  }), []);
  const canSwipe = enabled && blockers.current.size === 0;
  const ownerKey = presentationKey ?? onBack;
  useLayoutEffect(() => {
    // Effect setup is a new presentation even when Suspense reconnects the
    // same memoized component. Retired queued work never regains ownership.
    let mounted = true;
    // Suspense can disconnect subscriptions while the OS changes state.
    appActive.current = AppState?.currentState === "active";
    const revoke = () => {
      generation.set(++revision.current);
      touching.set(false); settling.set(false);
      cancelAnimation(x); x.set(0);
      if (livePermission.current) livePermission.current.active = false;
      livePermission.current = null;
    };
    const renew = () => {
      if (!mounted) return;
      revoke();
      const next = { generation: revision.current, active: !!enabled && appActive.current && blockers.current.size === 0 && !reader && getConfirmedScreenReaderEnabled() === false };
      livePermission.current = next;
      setPermission(next);
    };
    const unsubscribe = subscribeConfirmedScreenReaderEnabled(renew);
    const appSubscription = AppState?.addEventListener("change", state => {
      if (!mounted) return;
      appActive.current = state === "active";
      renew();
    });
    renew();
    return () => { mounted = false; revoke(); unsubscribe(); appSubscription?.remove(); };
  }, [enabled, reader, ownerKey, presentationScope, width, blockRevision, revealPrevious, reduced]);
  const recover = useMemo(() => () => {
    if (!permission || livePermission.current !== permission) return;
    settling.set(false);
    x.set(withSpring(0, { duration: 260, dampingRatio: 1, overshootClamping: true, reduceMotion: ReduceMotion.System }));
  }, [permission]);
  const back = useMemo(() => () => {
    const dispatch = {};
    const eligible = () => appActive.current && blockers.current.size === 0 && permission?.active && livePermission.current === permission
      && getConfirmedScreenReaderEnabled() === false && (!isCurrentRoute || isCurrentRoute());
    if (!eligible()) { recover(); return; }
    permission.dispatch = dispatch;
    const current = () => permission.dispatch === dispatch && eligible();
    // Keep the same fence through Root's potentially deferred close guard.
    onBack?.(undefined, current);
    // Root updates its navigation ref synchronously. A declined/deferred close
    // should restore the current screen, never strand it offscreen. Fence the
    // old deferred guard when a newer deliberate gesture is dispatched.
    if (current()) recover();
  }, [permission, onBack, isCurrentRoute, recover]);
  const ownedGeneration = permission?.generation;
  const gesture = useMemo(() => Gesture.Pan().enabled(!!canSwipe && !reader && !!permission?.active).maxPointers(1)
    .activeOffsetX(12).failOffsetY([-12, 12])
    .onTouchesDown((event, manager) => {
      if (generation.get() !== ownedGeneration || settling.get()) { manager.fail(); return; }
      const touch = event.allTouches[0];
      if (!touch || event.numberOfTouches !== 1) { touching.set(false); manager.fail(); return; }
      cancelAnimation(x);
      touching.set(true);
      startX.set(touch.absoluteX - x.get()); startY.set(touch.absoluteY);
    })
    .onUpdate(event => {
      if (generation.get() !== ownedGeneration || !touching.get()) return;
      x.set(Math.max(0, Math.min(revealPrevious ? width : width * 0.42, event.absoluteX - startX.get())));
    })
    .onEnd((event, success) => {
      if (generation.get() !== ownedGeneration || !touching.get()) return;
      touching.set(false);
      if (!iosBackSwipeCommits({ dx: event.absoluteX - startX.get(), dy: event.absoluteY - startY.get(), width, canceled: !success })) return;
      // A deliberate reversal means stay, even after crossing the threshold.
      if (Number.isFinite(event.velocityX) && event.velocityX < -80) return;
      if (revealPrevious && !reduced) {
        settling.set(true);
        x.set(withTiming(width, { duration: 180, reduceMotion: ReduceMotion.System }, finished => {
          if (finished && generation.get() === ownedGeneration) scheduleOnRN(back);
        }));
      } else { settling.set(true); scheduleOnRN(back); }
    })
    .onFinalize(() => {
      if (generation.get() !== ownedGeneration) return;
      touching.set(false);
      if (settling.get()) return;
      x.set(withSpring(0, { duration: 260, dampingRatio: 1, overshootClamping: true, reduceMotion: ReduceMotion.System }));
    }), [canSwipe, reader, width, x, startX, startY, back, generation, touching, ownedGeneration, permission, revealPrevious, reduced, settling]);
  const animated = useAnimatedStyle(() => ({ transform: [{ translateX: reduced ? 0 : x.get() }] }));
  return <IOSDetailBackContext.Provider value={blockScope}><View style={[styles.fill, styles.viewport, revealPrevious && styles.transparent]}>
    <Animated.View style={[styles.fill, animated]}>{children}</Animated.View>
    {canSwipe && !reader ? <GestureDetector gesture={gesture}><View style={styles.edge} testID="ios-detail-back-edge" accessible={false} accessibilityElementsHidden /></GestureDetector> : null}
  </View></IOSDetailBackContext.Provider>;
}
const styles = StyleSheet.create({ fill: { flex: 1, minHeight: 0, backgroundColor: colors.bg }, viewport: { overflow: "hidden" }, transparent: { backgroundColor: "transparent" }, edge: { position: "absolute", left: 0, top: 52, bottom: 0, width: 20 } });
