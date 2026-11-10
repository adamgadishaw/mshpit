import { Children, cloneElement, useEffect, useMemo, useRef, useState } from "react";
import { Animated, Easing, RefreshControl, StyleSheet, View } from "react-native";
import { colors, themeIsDark } from "../theme";
import useReducedMotion from "../hooks/useReducedMotion";
import useAppActive from "../lib/useAppActive";

// UIKit still owns the pull gesture, threshold and inset. The record lives only
// in that empty overscroll space, never in a second scroll view or over a header.
// The website's grooved record/amber label is redrawn with native views.
export default function VinylRefreshBoundary({ children, refreshing = false, onRefresh, enabled = true, accessibilityLabel = "Refresh this screen", progressViewOffset = 0, style, testID }) {
  const child = Children.only(children);
  const pending = useRef(null);
  const mounted = useRef(false);
  const [latched, setLatched] = useState(false);
  const gap = useRef(new Animated.Value(0)).current;
  const spin = useRef(new Animated.Value(0)).current;
  const pop = useRef(new Animated.Value(1)).current;
  const reduced = useReducedMotion();
  const active = useAppActive();
  const busy = refreshing || latched;
  const canRefresh = enabled && typeof onRefresh === "function";
  const admission = useMemo(() => ({}), [canRefresh, active, onRefresh]);
  const current = useRef(null);
  current.current = { canRefresh, refreshing, onRefresh, active, admission };
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; pending.current = null; }; }, []);
  useEffect(() => {
    spin.setValue(0); pop.setValue(1);
    if (!busy || reduced || !active) return undefined;
    const rotation = Animated.loop(Animated.timing(spin, { toValue: 1, duration: 900, easing: Easing.linear, useNativeDriver: true, isInteraction: false }));
    const bounce = Animated.sequence([
      Animated.timing(pop, { toValue: 1.1, duration: 120, useNativeDriver: true, isInteraction: false }),
      Animated.timing(pop, { toValue: 0.96, duration: 110, useNativeDriver: true, isInteraction: false }),
      Animated.timing(pop, { toValue: 1, duration: 140, useNativeDriver: true, isInteraction: false }),
    ]);
    rotation.start(); bounce.start();
    return () => { rotation.stop(); bounce.stop(); spin.setValue(0); pop.setValue(1); };
  }, [busy, reduced, active, spin, pop]);
  const requestRefresh = () => {
    const latest = current.current;
    if (!mounted.current || latest.admission !== admission || !latest.active || !latest.canRefresh || latest.refreshing || pending.current) return;
    const request = {};
    pending.current = request;
    setLatched(true);
    const settle = () => {
      if (pending.current !== request) return;
      pending.current = null;
      if (mounted.current) setLatched(false);
    };
    try { Promise.resolve(latest.onRefresh()).then(settle, settle); } catch { settle(); }
  };
  const onScroll = event => {
    const y = event?.nativeEvent?.contentOffset?.y;
    const inset = event?.nativeEvent?.contentInset?.top ?? child.props.contentInset?.top ?? 0;
    if (Number.isFinite(y)) gap.setValue(Math.max(0, -y - Math.max(0, inset)));
    child.props.onScroll?.(event);
  };
  const refreshControl = <RefreshControl refreshing={!!busy} onRefresh={requestRefresh} enabled={canRefresh}
    progressViewOffset={progressViewOffset} tintColor="transparent" accessibilityLabel={accessibilityLabel}
    accessibilityHint="At the top, pull down and release to get the latest from the server."
    accessibilityState={{ busy: !!busy }} />;
  const scrollChild = cloneElement(child, { refreshControl, onScroll,
    scrollEventThrottle: Math.min(child.props.scrollEventThrottle || 16, 16), alwaysBounceVertical: child.props.alwaysBounceVertical ?? true });
  return <View style={[styles.boundary, style]} testID={testID}>
    {scrollChild}
    <Animated.View pointerEvents="none" accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
      testID={testID ? `${testID}-vinyl` : undefined}
      style={[styles.indicator, { top: progressViewOffset, opacity: canRefresh ? gap.interpolate({ inputRange: [0, 32, 48], outputRange: [0, 0, 1], extrapolate: "clamp" }) : 0,
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
