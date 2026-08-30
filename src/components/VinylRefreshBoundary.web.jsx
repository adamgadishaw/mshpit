import { Children, useEffect, useRef } from "react";
import {
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import useReducedMotion from "../hooks/useReducedMotion";
import { colors, focusRing, mono, radius, shadow, themeIsDark } from "../theme";

const SPIN_DURATION_MS = 900;
const vinylInk = themeIsDark ? colors.bg : colors.text;

function VinylRecord({ active, reduceMotion, compact = false }) {
  const rotation = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    rotation.stopAnimation();
    rotation.setValue(0);
    if (!active || reduceMotion) return undefined;

    const animation = Animated.loop(
      Animated.timing(rotation, {
        toValue: 1,
        duration: SPIN_DURATION_MS,
        easing: Easing.linear,
        useNativeDriver: false,
      }),
    );
    animation.start();
    return () => animation.stop();
  }, [active, reduceMotion, rotation]);

  const animatedStyle = active && !reduceMotion
    ? {
        transform: [{
          rotateZ: rotation.interpolate({
            inputRange: [0, 1],
            outputRange: ["0deg", "360deg"],
          }),
        }],
      }
    : null;

  return (
    <Animated.View
      style={[styles.record, compact && styles.recordCompact, animatedStyle]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <View style={styles.grooveOuter} />
      <View style={styles.grooveInner} />
      <View style={styles.recordLabel}>
        <View style={styles.spindle} />
      </View>
      <View style={styles.recordGlint} />
    </Animated.View>
  );
}

export function VinylRefreshIndicator({
  refreshing,
  accessibilityLabel = "Refresh this screen",
  indicatorOffset = 12,
  testID,
}) {
  const reduceMotion = useReducedMotion();
  if (!refreshing) return null;

  return (
    <View
      pointerEvents="none"
      style={[styles.statusPosition, { top: indicatorOffset }]}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={`${accessibilityLabel} in progress`}
      accessibilityLiveRegion="polite"
      accessibilityValue={{ text: "Refreshing" }}
      testID={testID ? `${testID}-status` : undefined}
    >
      <View style={styles.statusPill}>
        <VinylRecord active reduceMotion={reduceMotion} />
        <Text style={styles.statusText}>REFRESHING</Text>
      </View>
    </View>
  );
}

/**
 * Web intentionally uses an explicit refresh button. Browsers have no
 * cross-browser pull-to-refresh contract, and the platform split keeps the
 * native Reanimated runtime out of the initial web bundle.
 */
export default function VinylRefreshBoundary({
  children,
  refreshing = false,
  onRefresh,
  enabled = true,
  accessibilityLabel = "Refresh this screen",
  indicatorOffset = 12,
  style,
  testID,
}) {
  const child = Children.only(children);
  const reduceMotion = useReducedMotion();
  const canRefresh = enabled && typeof onRefresh === "function";
  const requestRefresh = () => {
    if (!canRefresh || refreshing) return;
    onRefresh();
  };

  return (
    <View style={[styles.boundary, style]} testID={testID}>
      {child}
      <VinylRefreshIndicator
        refreshing={!!refreshing}
        accessibilityLabel={accessibilityLabel}
        indicatorOffset={indicatorOffset}
        testID={testID}
      />
      <Pressable
        onPress={requestRefresh}
        disabled={!canRefresh || refreshing}
        style={({ focused, pressed }) => [
          styles.webButton,
          { top: indicatorOffset },
          pressed && styles.webButtonPressed,
          focused && focusRing,
          (!canRefresh || refreshing) && styles.webButtonDisabled,
        ]}
        accessibilityRole="button"
        accessibilityLabel={refreshing ? `${accessibilityLabel} in progress` : accessibilityLabel}
        accessibilityHint="Press Enter or Space to refresh"
        accessibilityState={{ disabled: !canRefresh || refreshing, busy: !!refreshing }}
        testID={testID ? `${testID}-web-button` : undefined}
      >
        <VinylRecord active={!!refreshing} reduceMotion={reduceMotion} compact />
        <Text style={styles.webButtonText}>{refreshing ? "Refreshing" : "Refresh"}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  boundary: {
    flex: 1,
    minHeight: 0,
    position: "relative",
  },
  statusPosition: {
    position: "absolute",
    left: 0,
    right: 0,
    zIndex: 20,
    alignItems: "center",
  },
  statusPill: {
    minHeight: 38,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.bgElev,
    ...shadow.control,
  },
  statusText: {
    color: colors.textDim,
    fontFamily: mono,
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 1.2,
  },
  record: {
    width: 26,
    height: 26,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 13,
    borderWidth: 1,
    borderColor: colors.textFaint,
    backgroundColor: vinylInk,
    overflow: "hidden",
  },
  recordCompact: {
    width: 22,
    height: 22,
    borderRadius: 11,
  },
  grooveOuter: {
    position: "absolute",
    width: "76%",
    height: "76%",
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.line,
  },
  grooveInner: {
    position: "absolute",
    width: "48%",
    height: "48%",
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.textFaint,
  },
  recordLabel: {
    width: "34%",
    height: "34%",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.pill,
    backgroundColor: colors.amberStrong,
  },
  spindle: {
    width: 3,
    height: 3,
    borderRadius: radius.pill,
    backgroundColor: colors.bg,
  },
  recordGlint: {
    position: "absolute",
    top: "14%",
    left: "20%",
    width: "30%",
    height: 2,
    borderRadius: radius.pill,
    backgroundColor: colors.textDim,
    opacity: 0.5,
    transform: [{ rotateZ: "-28deg" }],
  },
  webButton: {
    position: "absolute",
    right: 12,
    zIndex: 21,
    minWidth: 104,
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 12,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    ...shadow.control,
  },
  webButtonPressed: {
    opacity: 0.78,
    transform: [{ scale: 0.98 }],
  },
  webButtonDisabled: {
    opacity: 0.62,
  },
  webButtonText: {
    color: colors.text,
    fontFamily: mono,
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
});
