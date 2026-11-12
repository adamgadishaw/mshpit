import useIOSDetailPresentation from "../hooks/useIOSDetailPresentation";
import { Children, cloneElement, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Animated, Easing, RefreshControl, StyleSheet, View } from "react-native";
import { colors, themeIsDark } from "../theme";
import useReducedMotion from "../hooks/useReducedMotion";
import useAppActive from "../lib/useAppActive";
import { NativeScrollChromeContext } from "./NativeScrollChrome.ios";
import { usePageReturn } from "./PageReturnContext";
import { assignScrollRef, scrollPageToTop } from "../domain/pageReturn.mjs";
import useNativeTabPreview from "../hooks/useNativeTabPreview";

const VISIBLE_CYCLE_MS = 1000;

// UIKit still owns the pull gesture, threshold and inset. The record lives only
// in that empty overscroll space below the measured activity bar, never in a
// second scroll view or over a header.
// The website's grooved record/amber label is redrawn with native views.
export default function VinylRefreshBoundary({ children, refreshing = false, onRefresh, enabled = true, accessibilityLabel = "Refresh this screen", progressViewOffset = 0, style, testID }) {
  const { active: detailActive, current: presentationCurrent, guard, token,
    canAct = presentationCurrent, commandToken = token } = useIOSDetailPresentation();
  const child = Children.only(children);
  const page = usePageReturn();
  const scrollRef = useRef(null);
  const originalRef = child.props.ref;
  const composedRef = useCallback(value => {
    scrollRef.current = value;
    assignScrollRef(originalRef, value);
  }, [originalRef]);
  const chrome = useContext(NativeScrollChromeContext);
  const pending = useRef(null);
  const mounted = useRef(false);
  const [latched, setLatched] = useState(null);
  const gap = useRef(new Animated.Value(0)).current;
  const spin = useRef(new Animated.Value(0)).current;
  const pop = useRef(new Animated.Value(1)).current;
  const reduced = useReducedMotion();
  const appActive = useAppActive();
  const preview = useNativeTabPreview();
  const active = detailActive && appActive && !preview;
  const canRefresh = active && enabled && typeof onRefresh === "function";
  // Callback closures can change with fresh rows. Only actual presentation or
  // eligibility changes retire the visual hold and ignored-cancellation work.
  const lifetime = useMemo(() => ({}), [commandToken, chrome?.owner, canRefresh]);
  const busy = refreshing || (latched !== null && latched.token === lifetime);
  const admission = useMemo(() => ({}), [canRefresh, active, onRefresh, lifetime]);
  const current = useRef(null);
  current.current = { canRefresh, refreshing, onRefresh, active, admission, canAct, lifetime };
  useEffect(() => { mounted.current = true; return () => {
    mounted.current = false;
    clearTimeout(pending.current?.timer);
    pending.current = null;
  }; }, []);
  useEffect(() => {
    if (reduced) { spin.setValue(0); pop.setValue(1); return undefined; }
    if (!busy || !canRefresh) return undefined;
    spin.setValue(0); pop.setValue(1);
    const rotation = Animated.loop(Animated.timing(spin, { toValue: 1, duration: 900, easing: Easing.linear, useNativeDriver: true, isInteraction: false }));
    const bounce = Animated.sequence([
      Animated.timing(pop, { toValue: 1.1, duration: 120, useNativeDriver: true, isInteraction: false }),
      Animated.timing(pop, { toValue: 0.96, duration: 110, useNativeDriver: true, isInteraction: false }),
      Animated.timing(pop, { toValue: 1, duration: 140, useNativeDriver: true, isInteraction: false }),
    ]);
    rotation.start(); bounce.start();
    // Freeze the current pose while UIKit eases its inset closed. Resetting
    // here visibly snaps the record just as it starts moving back up.
    return () => { rotation.stop(); bounce.stop(); };
  }, [busy, reduced, canRefresh, spin, pop]);
  useEffect(() => {
    const request = latched;
    if (!request || request.token !== lifetime) return undefined;
    // Start the visual clock after commit, alongside the animation. The read
    // starts immediately on release; only fast completions keep the native
    // inset open long enough to show a full 900ms revolution and the pop.
    request.minimumUntil ??= Date.now() + VISIBLE_CYCLE_MS;
    if (reduced || !canRefresh) request.minimumUntil = 0;
    const release = () => {
      clearTimeout(request.timer);
      if (!request.completed || pending.current !== request || !mounted.current
        || current.current.lifetime !== request.token) return;
      const remaining = request.minimumUntil - Date.now();
      if (remaining > 0) { request.timer = setTimeout(release, remaining); return; }
      pending.current = null;
      setLatched(null);
    };
    request.release = release;
    release();
    return () => { clearTimeout(request.timer); request.release = null; };
  }, [latched, lifetime, reduced, canRefresh]);
  const requestRefresh = () => {
    const latest = current.current;
    if (!mounted.current || latest.admission !== admission || !latest.canAct() || !latest.active || !latest.canRefresh
      || latest.refreshing || pending.current?.token === lifetime) return;
    // A retired retained detail cannot block a newly admitted presentation.
    const request = { token: lifetime, completed: false };
    pending.current = request;
    setLatched(request);
    const settle = () => {
      if (pending.current !== request) return;
      request.completed = true;
      request.release?.();
    };
    try { Promise.resolve(latest.onRefresh()).then(settle, settle); } catch { settle(); }
  };
  const requestRef = useRef(requestRefresh);
  requestRef.current = requestRefresh;
  useEffect(() => active ? page?.register(() => {
    if (!current.current.canAct() || !current.current.active) return;
    scrollPageToTop(scrollRef.current);
    requestRef.current();
  }, canRefresh) : undefined, [page, canRefresh, active]);
  const onScroll = event => {
    const y = event?.nativeEvent?.contentOffset?.y;
    const inset = event?.nativeEvent?.contentInset?.top ?? child.props.contentInset?.top ?? 0;
    if (Number.isFinite(y)) gap.setValue(Math.max(0, -y - Math.max(0, inset)));
    child.props.onScroll?.(event);
  };
  const refreshControl = canRefresh ? <RefreshControl refreshing={!!busy} onRefresh={guard(requestRefresh)} enabled={canRefresh}
    progressViewOffset={progressViewOffset} tintColor="transparent" accessibilityLabel={accessibilityLabel}
    accessibilityHint="At the top, pull down and release to get the latest from the server."
    accessibilityState={{ busy: !!busy }} /> : undefined;
  const scrollChild = cloneElement(child, { ref: composedRef, refreshControl, onScroll,
    scrollEventThrottle: Math.min(child.props.scrollEventThrottle || 16, 16), alwaysBounceVertical: child.props.alwaysBounceVertical ?? true });
  return <View style={[styles.boundary, style]} testID={testID}>
    {scrollChild}
    <Animated.View pointerEvents="none" accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
      testID={testID ? `${testID}-vinyl` : undefined}
      style={[styles.indicator, { top: (chrome?.height || 0) + progressViewOffset, opacity: canRefresh ? gap.interpolate({ inputRange: [0, 32, 48], outputRange: [0, 0, 1], extrapolate: "clamp" }) : 0,
        transform: [{ translateY: gap.interpolate({ inputRange: [0, 160], outputRange: [-14, 66], extrapolate: "clamp" }) }] }]}>
      <Animated.View style={[styles.record, { transform: [{ scaleX: pop }, { scaleY: pop }, { rotateZ: spin.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] }) }] }]}>
        <View style={styles.grooveOuter} /><View style={styles.grooveInner} />
        <View style={styles.label}><View style={styles.spindle} /></View><View style={styles.glint} />
      </Animated.View>
    </Animated.View>
  </View>;
}
const styles = StyleSheet.create({
  boundary: { flex: 1, minHeight: 0 },
  indicator: { position: "absolute", left: 0, right: 0, height: 28, alignItems: "center" },
  record: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.textFaint, backgroundColor: themeIsDark ? colors.bg : colors.text },
  grooveOuter: { position: "absolute", width: 21, height: 21, borderRadius: 11, borderWidth: 1, borderColor: colors.line },
  grooveInner: { position: "absolute", width: 14, height: 14, borderRadius: 7, borderWidth: 1, borderColor: colors.textFaint },
  label: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.amberStrong, alignItems: "center", justifyContent: "center" },
  spindle: { width: 3, height: 3, borderRadius: 2, backgroundColor: colors.bg },
  glint: { position: "absolute", top: 5, left: 5, width: 8, height: 2, borderRadius: 1, backgroundColor: colors.textDim, opacity: 0.5, transform: [{ rotateZ: "-28deg" }] },
});
