import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { AppState, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { ReduceMotion, useAnimatedReaction, useAnimatedStyle, useSharedValue, withSpring, withTiming } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { NativeTabSwipeContext } from "./nativeTabSwipeContext.mjs";
import { releasedPageSwipe } from "../domain/iosPageSwipe.mjs";
import { colors } from "../theme";
import useReducedMotion from "../hooks/useReducedMotion";
import useScreenReaderEnabled, { getConfirmedScreenReaderEnabled, subscribeConfirmedScreenReaderEnabled } from "../hooks/useScreenReaderEnabled";
import { releasedSwipe, swipeAxis, swipeThreshold } from "../domain/nativeGesturePolicy.mjs";

// Rails own only their visible controls. Page mode owns main-tab content,
// with passive native exclusions for child gestures and reserved Back edges.
export default function NativeSwipeRail({ children, onCommit, positive = "Like", negative = "Repost", hint, enabled = true, testID, surfaceColor = colors.surface, page = false, pageKey, entryDirection = 0, canPrevious = true, canNext = true }) {
  const { width: screenWidth } = useWindowDimensions();
  const reduced = useReducedMotion(), screenReader = useScreenReaderEnabled();
  const [armed, setArmed] = useState(null);
  const startX = useSharedValue(0), startY = useSharedValue(0), width = useSharedValue(screenWidth - 32), x = useSharedValue(0);
  const epoch = useSharedValue(0), touching = useSharedValue(false);
  const excluded = useSharedValue(false), settling = useSharedValue(false);
  const lastPage = useRef(pageKey), hasPresentedPage = useRef(false);
  const appActive = useRef(AppState?.currentState !== "background" && AppState?.currentState !== "inactive");
  const live = useRef(null), sequence = useRef(0);
  const [owner, setOwner] = useState(null);
  const [permissionRevision, setPermissionRevision] = useState(0);
  // Publish a fresh owner after every layout reconnect, not just each render.
  // Captured worklets and RN dispatches from a retired presentation stay inert.
  // A replaced onCommit is a different action; never retarget its queued swipe.
  useLayoutEffect(() => {
    const next = { epoch: ++sequence.current, allowed: enabled && (!page || appActive.current) && !screenReader && getConfirmedScreenReaderEnabled() !== true, onCommit };
    live.current = next;
    epoch.set(next.epoch); touching.set(false); excluded.set(false); settling.set(false); setArmed(null);
    const oldIndex = ["feed", "search", "discover", "you"].indexOf(lastPage.current);
    const newIndex = ["feed", "search", "discover", "you"].indexOf(pageKey);
    if (page && next.allowed && !reduced && ((oldIndex >= 0 && newIndex >= 0 && oldIndex !== newIndex) || (!hasPresentedPage.current && entryDirection))) {
      x.set((entryDirection || (newIndex > oldIndex ? 1 : -1)) * screenWidth * 0.26);
      x.set(withSpring(0, { damping: 26, stiffness: 230, mass: 0.8, overshootClamping: true, reduceMotion: ReduceMotion.System }));
    } else x.set(0);
    lastPage.current = pageKey;
    hasPresentedPage.current = true;
    setOwner(next);
    // Native permission events can round trip inside one React batch. Retire
    // immediately and publish a new interval even if the final boolean matches.
    const unsubscribe = subscribeConfirmedScreenReaderEnabled(() => {
      if (live.current !== next || getConfirmedScreenReaderEnabled() !== true) return;
      live.current = null;
      epoch.set(0); touching.set(false); x.set(0);
      setPermissionRevision(revision => revision + 1);
    });
    let subscribed = true;
    const appSubscription = page ? AppState?.addEventListener("change", state => {
      if (!subscribed) return;
      appActive.current = state === "active";
      if (live.current === next) { live.current = null; epoch.set(0); touching.set(false); x.set(0); }
      setPermissionRevision(revision => revision + 1);
    }) : null;
    return () => {
      subscribed = false;
      appSubscription?.remove();
      unsubscribe();
      if (live.current !== next) return;
      live.current = null;
      epoch.set(0); touching.set(false); x.set(0);
    };
  }, [enabled, screenReader, permissionRevision, onCommit, screenWidth, epoch, touching, x, page, pageKey, reduced, excluded, settling]);
  const generation = owner?.allowed ? owner.epoch : 0;
  const rearm = useMemo(() => () => { if (live.current === owner) setPermissionRevision(revision => revision + 1); }, [owner]);
  const commit = useMemo(() => direction => {
    if (owner?.allowed && live.current === owner && (!page || !owner.dispatched)) {
      if (page) owner.dispatched = true;
      owner.onCommit?.(direction);
      // A guarded route callback can decline navigation. Never strand its page
      // offscreen while waiting for a subsequent state update.
      if (page && live.current === owner) { settling.set(true); x.set(withSpring(0, { duration: 300, dampingRatio: 1, reduceMotion: ReduceMotion.System }, finished => { if (finished) scheduleOnRN(rearm); })); }
    }
  }, [owner, page, settling, x, rearm]);
  const showArmed = useMemo(() => value => {
    if (owner?.allowed && live.current === owner) setArmed(value);
  }, [owner]);
  const pan = useMemo(() => Gesture.Pan().enabled(enabled && !screenReader && !!owner?.allowed).maxPointers(1).manualActivation(true)
    .onTouchesDown((event, manager) => {
      if (!generation || epoch.get() !== generation || (page && settling.get())) { manager.fail(); return; }
      touching.set(false);
      const touch = event.allTouches[0];
      if (!touch || event.numberOfTouches !== 1 || touch.absoluteX < 24 || touch.absoluteX > screenWidth - 24) { manager.fail(); return; }
      startX.set(touch.absoluteX); startY.set(touch.absoluteY); touching.set(true);
    })
    .onTouchesMove((event, manager) => {
      if (!generation || epoch.get() !== generation) { manager.fail(); return; }
      if (!touching.get() || (page && excluded.get())) { touching.set(false); manager.fail(); return; }
      const touch = event.allTouches[0];
      if (!touch || event.numberOfTouches !== 1) { touching.set(false); manager.fail(); return; }
      const axis = swipeAxis(touch.absoluteX - startX.get(), touch.absoluteY - startY.get());
      if (axis === "vertical") { touching.set(false); manager.fail(); }
      else if (axis === "horizontal") manager.activate();
    })
    .onUpdate(event => { if (!generation || epoch.get() !== generation || !touching.get() || (page && excluded.get())) return; const dx = event.absoluteX - startX.get();
      const boundary = page && ((dx > 0 && !canPrevious) || (dx < 0 && !canNext));
      x.set(Math.max(page ? -screenWidth : -128, Math.min(page ? screenWidth : 128, boundary ? dx * 0.12 : dx))); })
    .onEnd((event, success) => {
      if (!generation || epoch.get() !== generation || !touching.get() || (page && excluded.get())) return;
      touching.set(false);
      const direction = (page ? releasedPageSwipe : releasedSwipe)({ dx: event.absoluteX - startX.get(), dy: event.absoluteY - startY.get(), width: width.get(), startX: startX.get(), screenWidth, canceled: !success, velocityX: event.velocityX, canPrevious, canNext });
      if (direction && page && !reduced) {
        settling.set(true);
        const target = direction === "negative" ? -screenWidth : screenWidth;
        const speed = Math.max(850, Math.abs(event.velocityX || 0));
        const duration = Math.max(110, Math.min(240, Math.abs(target - x.get()) / speed * 1000));
        x.set(withTiming(target, { duration, reduceMotion: ReduceMotion.System }, finished => {
          if (finished && epoch.get() === generation) scheduleOnRN(commit, direction);
        }));
      } else if (direction) scheduleOnRN(commit, direction);
    })
    .onFinalize(() => { if (!generation || epoch.get() !== generation) return; touching.set(false); excluded.set(false); if (settling.get()) return; x.set(withSpring(0, { duration: 400, dampingRatio: 1, overshootClamping: true, reduceMotion: ReduceMotion.System })); }),
  [enabled, screenReader, screenWidth, startX, startY, width, x, epoch, touching, generation, owner, commit, page, canPrevious, canNext, reduced, excluded, settling]);
  useAnimatedReaction(
    () => Math.abs(x.get()) >= swipeThreshold(width.get()) ? (x.get() > 0 ? "positive" : "negative") : null,
    (next, previous) => { if (hint && next !== previous) scheduleOnRN(showArmed, next); },
  );
  const contentStyle = useAnimatedStyle(() => {
    const dx = reduced ? 0 : x.get(), progress = Math.min(1, Math.abs(dx) / screenWidth);
    return page ? { transform: [{ perspective: 1200 }, { translateX: dx }, { rotateY: `${-dx / screenWidth * 4}deg` }, { scale: 1 - progress * 0.025 }], shadowOpacity: progress * 0.22 }
      : { transform: [{ translateX: dx }] };
  });
  const positiveStyle = useAnimatedStyle(() => ({ opacity: x.get() >= swipeThreshold(width.get()) ? 1 : 0 }));
  const negativeStyle = useAnimatedStyle(() => ({ opacity: x.get() <= -swipeThreshold(width.get()) ? 1 : 0 }));
  const pageScope = useMemo(() => ({ gesture: pan, excluded, touching, epoch, generation }), [pan, excluded, touching, epoch, generation]);
  if (page) return <NativeTabSwipeContext.Provider value={pageScope}>
    <View testID={testID} style={styles.pageTrack} onLayout={event => width.set(event.nativeEvent.layout.width)}>
      <View pointerEvents="none" style={styles.pageDestination} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Animated.Text style={[styles.destinationTitle, positiveStyle]}>{positive}</Animated.Text>
        <Animated.Text style={[styles.destinationTitle, negativeStyle]}>{negative}</Animated.Text>
      </View>
      <GestureDetector gesture={pan}><Animated.View style={[styles.page, { backgroundColor: surfaceColor }, contentStyle]}>{children}</Animated.View></GestureDetector>
    </View>
  </NativeTabSwipeContext.Provider>;
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
  pageDestination: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center" },
  destinationTitle: { position: "absolute", color: colors.textDim, fontSize: 24, fontWeight: "600" },
  pageTrack: { flex: 1, minHeight: 0, overflow: "hidden" },
  page: { flex: 1, minHeight: 0, shadowColor: "#000", shadowRadius: 18, shadowOffset: { width: 0, height: 0 } },
  rail: { minWidth: 0 }, track: { overflow: "hidden", minHeight: 48, justifyContent: "center" },
  content: { minHeight: 48 },
  feedback: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 12 },
  hint: { color: colors.textDim, fontSize: 13, lineHeight: 20, paddingVertical: 5 },
  arm: { color: colors.amber, fontSize: 14, fontWeight: "600", maxWidth: 108 }, right: { textAlign: "right", color: colors.good },
});
