import { Children, cloneElement, useEffect } from "react";
import { RefreshControl, StyleSheet, Text, View } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import useReducedMotion from "../hooks/useReducedMotion";
import { colors, mono, radius, shadow, themeIsDark } from "../theme";

const SPIN_DURATION_MS = 900;
const vinylInk = themeIsDark ? colors.bg : colors.text;

function VinylRecord({ active, reduceMotion, compact = false }) {
  const rotation = useSharedValue(0);

  useEffect(() => {
    cancelAnimation(rotation);
    rotation.set(0);
    if (active && !reduceMotion) {
      rotation.set(withRepeat(
        withTiming(360, { duration: SPIN_DURATION_MS, easing: Easing.linear }),
        -1,
        false,
      ));
    }
    return () => cancelAnimation(rotation);
  }, [active, reduceMotion, rotation]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ rotateZ: `${rotation.get()}deg` }],
  }));

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
 * Adds Mshpit's refresh treatment without replacing React Native's pull
 * threshold or controlled RefreshControl contract. The only child must be a
 * vertical ScrollView, FlatList, or SectionList that accepts refreshControl.
 */
export default function VinylRefreshBoundary({
  children,
  refreshing = false,
  onRefresh,
  enabled = true,
  accessibilityLabel = "Refresh this screen",
  progressViewOffset = 0,
  indicatorOffset = 12,
  style,
  testID,
}) {
  const child = Children.only(children);
  const canRefresh = enabled && typeof onRefresh === "function";
  const requestRefresh = () => {
    if (!canRefresh || refreshing) return;
    onRefresh();
  };

  const refreshControl = (
    <RefreshControl
      refreshing={!!refreshing}
      onRefresh={requestRefresh}
      enabled={canRefresh}
      progressViewOffset={progressViewOffset}
      tintColor="transparent"
      colors={["transparent"]}
      progressBackgroundColor="transparent"
      accessibilityLabel={accessibilityLabel}
    />
  );
  const scrollChild = cloneElement(child, { refreshControl });

  return (
    <View style={[styles.boundary, style]} testID={testID}>
      {scrollChild}
      <VinylRefreshIndicator
        refreshing={!!refreshing}
        accessibilityLabel={accessibilityLabel}
        indicatorOffset={indicatorOffset}
        testID={testID}
      />
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
});
