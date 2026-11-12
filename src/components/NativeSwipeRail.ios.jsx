import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { AppState, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { ReduceMotion, cancelAnimation, useAnimatedReaction, useAnimatedStyle, useSharedValue, withSpring, withTiming } from "react-native-reanimated";
import { scheduleOnRN, scheduleOnUI } from "react-native-worklets";
import { NativeTabSwipeContext } from "./nativeTabSwipeContext.mjs";
import { pageSettleDuration } from "../domain/iosPageGeometry.mjs";
import { releasedPageSwipe } from "../domain/iosPageSwipe.mjs";
import { colors } from "../theme";
import useReducedMotion from "../hooks/useReducedMotion";
import useScreenReaderEnabled, { getConfirmedScreenReaderEnabled, subscribeConfirmedScreenReaderEnabled } from "../hooks/useScreenReaderEnabled";
import { releasedSwipe, swipeAxis, swipeThreshold } from "../domain/nativeGesturePolicy.mjs";

// Rails own only their visible controls. Page mode owns main-tab content,
// with passive native exclusions for child gestures and reserved Back edges.
export default function NativeSwipeRail({ children, onCommit, positive = "Like", negative = "Repost", hint, enabled = true, testID, surfaceColor = colors.surface, page = false, pageKey, pageIndex, entryDirection = 0, canPrevious = true, canNext = true, previewPrevious = true, previewNext = true, renderPages, renderNavigation, onPageIntent, onPageCancel, pageReady = null }) {
  const { width: screenWidth } = useWindowDimensions();
  const reduced = useReducedMotion(), screenReader = useScreenReaderEnabled();
  const interactive = page && !!renderPages;
  const pageCallbacks = useRef(null);
  pageCallbacks.current = { onPageIntent, onPageCancel };
  const [armed, setArmed] = useState(null);
  const startX = useSharedValue(0), startY = useSharedValue(0), width = useSharedValue(screenWidth - 32), x = useSharedValue(0);
  const epoch = useSharedValue(0), touching = useSharedValue(false);
  const excluded = useSharedValue(false), settling = useSharedValue(false);
  const pageOrigin = useSharedValue(pageIndex ?? ["feed", "search", "discover", "you"].indexOf(pageKey));
  // A fresh admission token also accompanies each direction change. A→B→A
  // must not reuse A's old native layout while React has already replaced it.
  const gestureId = useSharedValue(0), waitingRelease = useSharedValue(null);
  const dragging = useSharedValue(false), dragOrigin = useSharedValue(0);
  const returningGesture = useSharedValue(0), carriedLayout = useSharedValue(null);
  const readinessTimer = useRef(null);
  const readyDirection = useSharedValue(null), requestedDirection = useSharedValue(null), dragX = useSharedValue(0);
  useLayoutEffect(() => { readyDirection.set(pageReady); }, [pageReady, readyDirection]);
  const lastPage = useRef(pageKey), hasPresentedPage = useRef(false);
  const appActive = useRef(AppState?.currentState !== "background" && AppState?.currentState !== "inactive");
  const live = useRef(null), sequence = useRef(0);
  const [owner, setOwner] = useState(null);
  const [permissionRevision, setPermissionRevision] = useState(0);
  // Publish a fresh owner after every layout reconnect, not just each render.
  // Captured worklets and RN dispatches from a retired presentation stay inert.
  // A replaced onCommit is a different action; never retarget its queued swipe.
  useLayoutEffect(() => {
    // Suspense can disconnect this listener across an OS activity change.
    appActive.current = AppState?.currentState !== "background" && AppState?.currentState !== "inactive";
    const next = { epoch: ++sequence.current, allowed: enabled && (!page || appActive.current) && !screenReader && getConfirmedScreenReaderEnabled() !== true, onCommit };
    live.current = next;
    epoch.set(next.epoch); touching.set(false); excluded.set(false); settling.set(false); setArmed(null);
    const oldIndex = ["feed", "search", "discover", "you"].indexOf(lastPage.current);
    const newIndex = pageIndex ?? ["feed", "search", "discover", "you"].indexOf(pageKey);
    if (page && !interactive && next.allowed && !reduced && ((oldIndex >= 0 && newIndex >= 0 && oldIndex !== newIndex) || (!hasPresentedPage.current && entryDirection))) {
      x.set((entryDirection || (newIndex > oldIndex ? 1 : -1)) * screenWidth * 0.26);
      x.set(withSpring(0, { damping: 26, stiffness: 230, mass: 0.8, overshootClamping: true, reduceMotion: ReduceMotion.System }));
    } else if (interactive) {
      // React promotion leaves the same tab's absolute coordinate untouched.
      // Rebase the UI origin and drag in ONE UI task: neither coordinate can
      // paint independently and kick the promoted surface offscreen.
      const resetEpoch = next.epoch;
      scheduleOnUI(() => { 'worklet'; if (epoch.get() !== resetEpoch) return; x.set(0); pageOrigin.set(newIndex); });
    } else x.set(0);
    lastPage.current = pageKey;
    hasPresentedPage.current = true;
    requestedDirection.set(null); dragX.set(0); waitingRelease.set(null); returningGesture.set(0); carriedLayout.set(null);
    setOwner(next);
    // Native permission events can round trip inside one React batch. Retire
    // immediately and publish a new interval even if the final boolean matches.
    const unsubscribe = subscribeConfirmedScreenReaderEnabled(() => {
      if (live.current !== next || getConfirmedScreenReaderEnabled() !== true) return;
      live.current = null;
      epoch.set(0); touching.set(false); x.set(0);
      pageCallbacks.current.onPageCancel?.();
      setPermissionRevision(revision => revision + 1);
    });
    let subscribed = true;
    const appSubscription = page ? AppState?.addEventListener("change", state => {
      if (!subscribed) return;
      appActive.current = state === "active";
      if (live.current === next) { live.current = null; epoch.set(0); touching.set(false); x.set(0); }
      pageCallbacks.current.onPageCancel?.();
      setPermissionRevision(revision => revision + 1);
    }) : null;
    return () => {
      subscribed = false;
      clearTimeout(readinessTimer.current); waitingRelease.set(null);
      if (interactive) pageCallbacks.current.onPageCancel?.();
      appSubscription?.remove();
      unsubscribe();
      if (live.current !== next) return;
      live.current = null;
      epoch.set(0); touching.set(false); if (!interactive) x.set(0);
    };
  }, [enabled, screenReader, permissionRevision, onCommit, screenWidth, epoch, touching, x, page, pageKey, pageIndex, reduced, excluded, settling, interactive, pageOrigin, returningGesture, carriedLayout]);
  const generation = owner?.allowed ? owner.epoch : 0;
  const rearm = useMemo(() => () => { if (live.current === owner) setPermissionRevision(revision => revision + 1); }, [owner]);
  const commit = useMemo(() => direction => {
    if (owner?.allowed && live.current === owner && (!page || !owner.dispatched)) {
      clearTimeout(readinessTimer.current);
      if (page) owner.dispatched = true;
      const accepted = owner.onCommit?.(direction);
      // Accepted local selection owns the destination until React promotes it.
      // A zero-delay timer cannot distinguish a declined route from a delayed
      // concurrent commit, and used to spring valid swipes back to the source.
      if (interactive && accepted === true) return;
      // Only an unaccepted callback needs recovery.
      const recover = () => { if (page && live.current === owner) { settling.set(true); x.set(withSpring(0, { duration: 300, dampingRatio: 1, reduceMotion: ReduceMotion.System }, finished => { if (finished) scheduleOnRN(rearm); })); } };
      if (interactive) readinessTimer.current = setTimeout(recover, 0); else recover();
    }
  }, [owner, page, settling, x, rearm, interactive]);
  const preparePage = useMemo(() => (direction, gesture) => {
    if (owner?.allowed && live.current === owner && gestureId.get() === gesture
        && requestedDirection.get() === direction && (touching.get() || settling.get())) pageCallbacks.current.onPageIntent?.(direction, gesture);
  }, [owner, gestureId, touching, settling, requestedDirection]);
  const cancelPage = useMemo(() => gesture => {
    if (live.current === owner && (gesture == null || gestureId.get() === gesture)) pageCallbacks.current.onPageCancel?.();
  }, [owner, gestureId]);
  const awaitPage = useMemo(() => gesture => {
    if (live.current !== owner || gestureId.get() !== gesture || waitingRelease.get()?.gesture !== gesture) return;
    clearTimeout(readinessTimer.current);
    readinessTimer.current = setTimeout(() => {
      if (live.current !== owner || gestureId.get() !== gesture || waitingRelease.get()?.gesture !== gesture) return;
      waitingRelease.set(null); settling.set(false); x.set(0); cancelPage(gesture);
    }, 2500);
  }, [owner, gestureId, waitingRelease, settling, x, cancelPage]);
  // Destination readiness includes its real native layout. Until then the
  // source covers the viewport. Once the actual screen is laid out, its normal
  // loading/empty/error UI can settle immediately; network completion never
  // holds a released gesture or blocks the next one.
  useAnimatedReaction(() => ({ ready: readyDirection.get(), released: waitingRelease.get() }), state => {
    const next = state.ready;
    if (!generation || epoch.get() !== generation || !interactive || !next || next.gesture !== gestureId.get() || requestedDirection.get() !== next.direction) return;
    if (touching.get()) x.set(dragX.get());
    const released = state.released;
    if (!released || released.gesture !== next.gesture || released.direction !== next.direction) return;
    waitingRelease.set(null);
    const target = next.direction === "negative" ? -width.get() : width.get();
    x.set(withTiming(target, { duration: pageSettleDuration(x.get(), width.get(), next.direction, released.velocity), reduceMotion: ReduceMotion.System }, finished => {
      if (finished && epoch.get() === generation && gestureId.get() === next.gesture) scheduleOnRN(commit, next.direction);
    }));
  });
  const showArmed = useMemo(() => value => {
    if (owner?.allowed && live.current === owner) setArmed(value);
  }, [owner]);
  const pan = useMemo(() => Gesture.Pan().enabled(enabled && !screenReader && !!owner?.allowed).maxPointers(1).manualActivation(true)
    .onTouchesDown((event, manager) => {
      if (!generation || epoch.get() !== generation || (page && settling.get())) { manager.fail(); return; }
      touching.set(false);
      const touch = event.allTouches[0];
      if (!touch || event.numberOfTouches !== 1 || touch.absoluteX < 24 || touch.absoluteX > screenWidth - 24) { manager.fail(); return; }
      requestedDirection.set(null); dragX.set(0); dragging.set(false); dragOrigin.set(0); carriedLayout.set(null); waitingRelease.set(null); gestureId.set(gestureId.get() + 1);
      startX.set(touch.absoluteX); startY.set(touch.absoluteY); touching.set(true);
    })
    .onTouchesMove((event, manager) => {
      if (!generation || epoch.get() !== generation) { manager.fail(); return; }
      if (!touching.get() || (page && excluded.get())) { touching.set(false); manager.fail(); return; }
      const touch = event.allTouches[0];
      if (!touch || event.numberOfTouches !== 1) { touching.set(false); manager.fail(); return; }
      const axis = swipeAxis(touch.absoluteX - startX.get(), touch.absoluteY - startY.get());
      if (axis === "vertical") { touching.set(false); manager.fail(); }
      else if (axis === "horizontal") {
        manager.activate();
        // A re-grab owns motion only after horizontal intent wins. Retain the
        // returning page's current offset instead of jumping to a fresh zero.
        if (!dragging.get()) {
          const ready = readyDirection.get();
          // Reuse layout only while the UI still owns an unfinished return:
          // its completion has not queued a native-page removal on RN.
          carriedLayout.set(interactive && returningGesture.get() && ready?.gesture === returningGesture.get() ? ready.direction : null);
          cancelAnimation(x); returningGesture.set(0);
          dragOrigin.set(interactive ? x.get() : 0); dragging.set(true);
        }
        if (interactive && !reduced) {
          const direction = touch.absoluteX - startX.get() + dragOrigin.get() < 0 ? "negative" : "positive";
          if (carriedLayout.get() !== direction) carriedLayout.set(null);
          if (requestedDirection.get() !== direction) { requestedDirection.set(direction); gestureId.set(gestureId.get() + 1); scheduleOnRN(preparePage, direction, gestureId.get()); }
        }
      }
    })
    .onUpdate(event => { if (!generation || epoch.get() !== generation || !touching.get() || (page && excluded.get())) return;
      if (!dragging.get()) {
        const ready = readyDirection.get();
        carriedLayout.set(interactive && returningGesture.get() && ready?.gesture === returningGesture.get() ? ready.direction : null);
        cancelAnimation(x); returningGesture.set(0);
        dragOrigin.set(interactive ? x.get() : 0); dragging.set(true);
      }
      const dx = event.absoluteX - startX.get() + dragOrigin.get();
      const boundary = page && ((dx > 0 && !canPrevious) || (dx < 0 && !canNext));
      const limit = page ? width.get() : 128;
      const movement = Math.max(-limit, Math.min(limit, boundary ? dx * 0.12 : dx));
      dragX.set(movement);
      if (interactive && !reduced) {
        const direction = dx < 0 ? "negative" : "positive";
        if (carriedLayout.get() !== direction) carriedLayout.set(null);
        if (!boundary && requestedDirection.get() !== direction) { requestedDirection.set(direction); gestureId.set(gestureId.get() + 1); scheduleOnRN(preparePage, direction, gestureId.get()); }
        const ready = readyDirection.get();
        x.set(!boundary && (ready?.direction === direction && ready?.gesture === gestureId.get() || carriedLayout.get() === direction) ? movement : 0);
      } else x.set(interactive && reduced ? 0 : movement); })
    .onEnd((event, success) => {
      if (!generation || epoch.get() !== generation || !touching.get() || (page && excluded.get())) return;
      touching.set(false);
      let direction = (page ? releasedPageSwipe : releasedSwipe)({ dx: event.absoluteX - startX.get() + dragOrigin.get(), dy: event.absoluteY - startY.get(), width: width.get(), startX: startX.get(), screenWidth, canceled: !success, velocityX: event.velocityX, canPrevious, canNext });
      if (interactive && direction && !(direction === "positive" ? previewPrevious : previewNext)) {
        settling.set(true); scheduleOnRN(commit, direction); return;
      }
      if (interactive && !reduced && direction && (direction !== readyDirection.get()?.direction || readyDirection.get()?.gesture !== gestureId.get())) {
        settling.set(true);
        if (requestedDirection.get() !== direction) { requestedDirection.set(direction); gestureId.set(gestureId.get() + 1); scheduleOnRN(preparePage, direction, gestureId.get()); }
        waitingRelease.set({ direction, gesture: gestureId.get(), velocity: event.velocityX || 0 });
        scheduleOnRN(awaitPage, gestureId.get());
        return;
      }
      if (direction && page && !reduced) {
        settling.set(true);
        const target = direction === "negative" ? -width.get() : width.get();
        const duration = pageSettleDuration(x.get(), width.get(), direction, event.velocityX || 0);
        x.set(withTiming(target, { duration, reduceMotion: ReduceMotion.System }, finished => {
          if (finished && epoch.get() === generation) scheduleOnRN(commit, direction);
        }));
      } else if (direction) scheduleOnRN(commit, direction);
    })
    .onFinalize(() => { if (!generation || epoch.get() !== generation) return; touching.set(false); excluded.set(false); if (settling.get()) return;
      const releasedGesture = gestureId.get();
      const ready = readyDirection.get();
      returningGesture.set(interactive && x.get() !== 0 && ready?.gesture === releasedGesture && ready.direction === requestedDirection.get() ? releasedGesture : 0);
      carriedLayout.set(null);
      x.set(withSpring(0, { duration: interactive ? 320 : 400, dampingRatio: 1, overshootClamping: true, reduceMotion: ReduceMotion.System }, finished => {
        if (returningGesture.get() === releasedGesture) returningGesture.set(0);
        if (finished && interactive && epoch.get() === generation) scheduleOnRN(cancelPage, releasedGesture);
      })); }),
  [enabled, screenReader, screenWidth, startX, startY, width, x, epoch, touching, generation, owner, commit, page, canPrevious, canNext, reduced, excluded, settling, interactive, requestedDirection, readyDirection, dragX, preparePage, cancelPage, gestureId, waitingRelease, awaitPage, previewPrevious, previewNext, dragging, dragOrigin, returningGesture, carriedLayout]);
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
  // Navigation is a fixed sibling, not another page or a child of the page pan.
  // It reads the exact same UI coordinates, including the atomic promotion rebase.
  if (interactive) return <>{renderNavigation?.(x, width, pageOrigin)}<NativeTabSwipeContext.Provider value={pageScope}>
    <GestureDetector gesture={pan}><View collapsable={false} testID={testID} style={styles.pageTrack}
      onLayout={event => width.set(event.nativeEvent.layout.width)}>{renderPages(x, width, pageOrigin)}</View></GestureDetector>
  </NativeTabSwipeContext.Provider></>;
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
  pageDestination: { ...StyleSheet.absoluteFill, alignItems: "center", justifyContent: "center" },
  destinationTitle: { position: "absolute", color: colors.textDim, fontSize: 24, fontWeight: "600" },
  pageTrack: { flex: 1, minHeight: 0, overflow: "hidden" },
  page: { flex: 1, minHeight: 0, shadowColor: "#000", shadowRadius: 18, shadowOffset: { width: 0, height: 0 } },
  rail: { minWidth: 0 }, track: { overflow: "hidden", minHeight: 48, justifyContent: "center" },
  content: { minHeight: 48 },
  feedback: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 12 },
  hint: { color: colors.textDim, fontSize: 13, lineHeight: 20, paddingVertical: 5 },
  arm: { color: colors.amber, fontSize: 14, fontWeight: "600", maxWidth: 108 }, right: { textAlign: "right", color: colors.good },
});
